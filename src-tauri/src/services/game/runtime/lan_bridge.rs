use std::collections::HashMap;
use std::ops::RangeInclusive;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, watch};

pub const EVENT_LAN_BRIDGE_STATUS: &str = "lan-bridge-status";
const SESSION_HEADER: &str = "x-lan-session";

const FRAME_OPEN: u8 = 1;
const FRAME_DATA: u8 = 2;
const FRAME_CLOSE: u8 = 3;
const FRAME_HEADER_LEN: usize = 9;
const MAX_FRAME_PAYLOAD: usize = 1024 * 1024;

const READ_CHUNK: usize = 16 * 1024;
const OUTBOUND_BATCH_MAX: usize = 48 * 1024;

const HOST_CONNECT_ATTEMPTS: u32 = 4;
const HOST_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const HOST_CONNECT_RETRY_DELAY: Duration = Duration::from_millis(300);

const GUEST_PORT_RANGE: RangeInclusive<u16> = 25570..=25599;

#[derive(Debug, Clone, Serialize)]
pub struct LanBridgeStatusPayload {
    pub session_id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

type StatusFn = Arc<dyn Fn(&str, Option<String>) + Send + Sync>;

#[derive(Debug, PartialEq, Eq)]
struct Frame {
    kind: u8,
    conn_id: u32,
    payload: Vec<u8>,
}

fn encode_frame(kind: u8, conn_id: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(FRAME_HEADER_LEN + payload.len());
    out.push(kind);
    out.extend_from_slice(&conn_id.to_be_bytes());
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    out
}

fn parse_frames(buf: &[u8]) -> Result<(Vec<Frame>, usize), String> {
    let mut frames = Vec::new();
    let mut off = 0;
    while buf.len() - off >= FRAME_HEADER_LEN {
        let kind = buf[off];
        let conn_id = u32::from_be_bytes(buf[off + 1..off + 5].try_into().unwrap());
        let len = u32::from_be_bytes(buf[off + 5..off + 9].try_into().unwrap()) as usize;
        if len > MAX_FRAME_PAYLOAD {
            return Err(format!("lan bridge frame too large: {len} bytes"));
        }
        let end = off + FRAME_HEADER_LEN + len;
        if end > buf.len() {
            break;
        }
        frames.push(Frame {
            kind,
            conn_id,
            payload: buf[off + FRAME_HEADER_LEN..end].to_vec(),
        });
        off = end;
    }
    Ok((frames, off))
}

enum ConnMsg {
    Data(Vec<u8>),
    Close,
}

struct GuestListener {
    port: u16,
    stop_tx: watch::Sender<bool>,
}

struct TunnelState {
    outbound: Option<mpsc::UnboundedSender<Vec<u8>>>,
    generation: u64,
    conns: HashMap<u32, mpsc::UnboundedSender<ConnMsg>>,
    next_conn_id: u32,
    listener: Option<GuestListener>,
    partial: Vec<u8>,
}

struct Tunnel {
    id: String,
    state: Mutex<TunnelState>,
    paused_tx: watch::Sender<bool>,
    host_port: Arc<AtomicU32>,
    status: StatusFn,
}

impl Tunnel {
    fn new(id: String, host_port: Arc<AtomicU32>, status: StatusFn) -> Arc<Self> {
        let (paused_tx, _) = watch::channel(false);
        Arc::new(Self {
            id,
            state: Mutex::new(TunnelState {
                outbound: None,
                generation: 0,
                conns: HashMap::new(),
                next_conn_id: 0,
                listener: None,
                partial: Vec::new(),
            }),
            paused_tx,
            host_port,
            status,
        })
    }

    fn lock(&self) -> MutexGuard<'_, TunnelState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn emit(&self, state: &str, detail: Option<String>) {
        (self.status)(state, detail);
    }

    fn report_connections(&self) {
        let count = self.lock().conns.len();
        self.emit("connections", Some(count.to_string()));
    }

    fn attach(&self, outbound: mpsc::UnboundedSender<Vec<u8>>) -> u64 {
        let (generation, stale) = {
            let mut s = self.lock();
            s.outbound = Some(outbound);
            s.generation += 1;
            s.partial.clear();
            (s.generation, std::mem::take(&mut s.conns))
        };
        if !stale.is_empty() {
            eprintln!("[LanBridge:{}] reattach: closing {} stale connections", self.id, stale.len());
        }
        for tx in stale.values() {
            let _ = tx.send(ConnMsg::Close);
        }
        self.paused_tx.send_replace(false);
        self.report_connections();
        generation
    }

    fn detach(&self, generation: Option<u64>) {
        let stale = {
            let mut s = self.lock();
            if generation.is_some_and(|g| g != s.generation) {
                return;
            }
            s.outbound = None;
            s.partial.clear();
            std::mem::take(&mut s.conns)
        };
        for tx in stale.values() {
            let _ = tx.send(ConnMsg::Close);
        }
        self.paused_tx.send_replace(false);
    }

    fn shutdown(&self) {
        self.detach(None);
        if let Some(listener) = self.lock().listener.take() {
            let _ = listener.stop_tx.send(true);
        }
        self.emit("stopped", None);
    }

    fn guest_port(&self) -> Option<u16> {
        self.lock().listener.as_ref().map(|l| l.port)
    }

    fn unregister(&self, conn_id: u32, tx: &mpsc::UnboundedSender<ConnMsg>) -> bool {
        let mut s = self.lock();
        match s.conns.get(&conn_id) {
            Some(current) if current.same_channel(tx) => {
                s.conns.remove(&conn_id);
                true
            }
            _ => false,
        }
    }

    fn handle_incoming(self: &Arc<Self>, bytes: &[u8]) -> Result<(), String> {
        let frames = {
            let mut s = self.lock();
            let parsed = if s.partial.is_empty() {
                parse_frames(bytes).map(|(frames, used)| (frames, bytes[used..].to_vec()))
            } else {
                let mut buf = std::mem::take(&mut s.partial);
                buf.extend_from_slice(bytes);
                parse_frames(&buf).map(|(frames, used)| (frames, buf[used..].to_vec()))
            };
            match parsed {
                Ok((frames, rest)) => {
                    s.partial = rest;
                    frames
                }
                Err(e) => {
                    s.partial.clear();
                    return Err(e);
                }
            }
        };
        for frame in frames {
            self.dispatch(frame);
        }
        Ok(())
    }

    fn dispatch(self: &Arc<Self>, frame: Frame) {
        match frame.kind {
            FRAME_OPEN => self.open_remote(frame.conn_id),
            FRAME_DATA => {
                let tx = self.lock().conns.get(&frame.conn_id).cloned();
                match tx {
                    Some(tx) => {
                        let _ = tx.send(ConnMsg::Data(frame.payload));
                    }
                    None => self.send_close(frame.conn_id),
                }
            }
            FRAME_CLOSE => {
                let tx = self.lock().conns.remove(&frame.conn_id);
                if let Some(tx) = tx {
                    let _ = tx.send(ConnMsg::Close);
                }
            }
            _ => {}
        }
    }

    fn send_close(&self, conn_id: u32) {
        if let Some(out) = self.lock().outbound.clone() {
            let _ = out.send(encode_frame(FRAME_CLOSE, conn_id, &[]));
        }
    }

    fn open_remote(self: &Arc<Self>, conn_id: u32) {
        let Some(outbound) = self.lock().outbound.clone() else {
            return;
        };
        let port = self.host_port.load(Ordering::Relaxed) as u16;
        if port == 0 {
            eprintln!("[LanBridge:{}] conn #{conn_id} refused: world is not shared", self.id);
            self.emit("refused", Some("world not shared".into()));
            let _ = outbound.send(encode_frame(FRAME_CLOSE, conn_id, &[]));
            return;
        }

        let (tx, rx) = mpsc::unbounded_channel();
        let replaced = self.lock().conns.insert(conn_id, tx.clone());
        if let Some(old) = replaced {
            let _ = old.send(ConnMsg::Close);
        }

        let tunnel = self.clone();
        tokio::spawn(async move {
            match connect_lan(port).await {
                Ok(stream) => {
                    eprintln!("[LanBridge:{}] conn #{conn_id} -> LAN :{port}", tunnel.id);
                    run_conn(tunnel, conn_id, stream, rx, tx, outbound).await;
                }
                Err(e) => {
                    eprintln!("[LanBridge:{}] conn #{conn_id} LAN :{port} unreachable: {e}", tunnel.id);
                    tunnel.emit("error", Some(format!("LAN port {port}: {e}")));
                    if tunnel.unregister(conn_id, &tx) {
                        let _ = outbound.send(encode_frame(FRAME_CLOSE, conn_id, &[]));
                    }
                }
            }
        });
    }

    fn open_local(self: &Arc<Self>, stream: TcpStream) {
        let (tx, rx) = mpsc::unbounded_channel();
        let opened = {
            let mut s = self.lock();
            match s.outbound.clone() {
                Some(outbound) => {
                    s.next_conn_id = s.next_conn_id.wrapping_add(1).max(1);
                    let conn_id = s.next_conn_id;
                    s.conns.insert(conn_id, tx.clone());
                    Some((conn_id, outbound))
                }
                None => None,
            }
        };
        let Some((conn_id, outbound)) = opened else {
            eprintln!("[LanBridge:{}] local connection dropped: P2P channel is not attached", self.id);
            self.emit("refused", Some("p2p channel not attached".into()));
            return;
        };
        if outbound.send(encode_frame(FRAME_OPEN, conn_id, &[])).is_err() {
            self.unregister(conn_id, &tx);
            return;
        }
        eprintln!("[LanBridge:{}] conn #{conn_id} opened by game", self.id);
        tokio::spawn(run_conn(self.clone(), conn_id, stream, rx, tx, outbound));
    }

    async fn start_guest_listener(self: &Arc<Self>, preferred: Option<u16>) -> Result<u16, String> {
        if let Some(port) = self.guest_port() {
            return Ok(port);
        }
        let listener = bind_guest_listener(preferred).await?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("lan bridge addr: {e}"))?
            .port();

        let (stop_tx, mut stop_rx) = watch::channel(false);
        {
            let mut s = self.lock();
            if let Some(existing) = s.listener.as_ref() {
                return Ok(existing.port);
            }
            s.listener = Some(GuestListener { port, stop_tx });
        }

        let tunnel = self.clone();
        tokio::spawn(async move {
            eprintln!("[LanBridge:{}] guest listening on 127.0.0.1:{port}", tunnel.id);
            loop {
                tokio::select! {
                    accepted = listener.accept() => match accepted {
                        Ok((stream, _)) => tunnel.open_local(stream),
                        Err(e) => {
                            eprintln!("[LanBridge:{}] accept failed: {e}", tunnel.id);
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                    },
                    _ = stop_rx.changed() => break,
                }
            }
            eprintln!("[LanBridge:{}] guest listener on {port} stopped", tunnel.id);
        });

        self.emit("listening", Some(format!("127.0.0.1:{port}")));
        Ok(port)
    }
}

async fn bind_guest_listener(preferred: Option<u16>) -> Result<TcpListener, String> {
    let candidates = preferred.into_iter().chain(GUEST_PORT_RANGE);
    for port in candidates {
        if let Ok(listener) = TcpListener::bind(("127.0.0.1", port)).await {
            return Ok(listener);
        }
    }
    TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("lan bridge bind failed: {e}"))
}

async fn connect_lan(port: u16) -> Result<TcpStream, String> {
    let mut last_err = String::new();
    for attempt in 0..HOST_CONNECT_ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(HOST_CONNECT_RETRY_DELAY).await;
        }
        for host in ["127.0.0.1", "::1"] {
            match tokio::time::timeout(HOST_CONNECT_TIMEOUT, TcpStream::connect((host, port))).await {
                Ok(Ok(stream)) => return Ok(stream),
                Ok(Err(e)) => last_err = e.to_string(),
                Err(_) => last_err = "connect timeout".into(),
            }
        }
    }
    Err(last_err)
}

async fn run_conn(
    tunnel: Arc<Tunnel>,
    conn_id: u32,
    stream: TcpStream,
    mut rx: mpsc::UnboundedReceiver<ConnMsg>,
    tx: mpsc::UnboundedSender<ConnMsg>,
    outbound: mpsc::UnboundedSender<Vec<u8>>,
) {
    let _ = stream.set_nodelay(true);
    let (mut reader, mut writer) = stream.into_split();
    let mut paused_rx = tunnel.paused_tx.subscribe();
    tunnel.report_connections();

    let read_side = async {
        let mut buf = vec![0u8; READ_CHUNK];
        loop {
            loop {
                let paused = *paused_rx.borrow_and_update();
                if !paused {
                    break;
                }
                if paused_rx.changed().await.is_err() {
                    return;
                }
            }
            match reader.read(&mut buf).await {
                Ok(0) | Err(_) => return,
                Ok(n) => {
                    if outbound.send(encode_frame(FRAME_DATA, conn_id, &buf[..n])).is_err() {
                        return;
                    }
                }
            }
        }
    };

    let write_side = async {
        while let Some(msg) = rx.recv().await {
            match msg {
                ConnMsg::Data(data) => {
                    if writer.write_all(&data).await.is_err() {
                        return;
                    }
                }
                ConnMsg::Close => break,
            }
        }
        let _ = writer.shutdown().await;
    };

    tokio::select! {
        _ = read_side => {}
        _ = write_side => {}
    }

    if tunnel.unregister(conn_id, &tx) {
        let _ = outbound.send(encode_frame(FRAME_CLOSE, conn_id, &[]));
    }
    eprintln!("[LanBridge:{}] conn #{conn_id} closed", tunnel.id);
    tunnel.report_connections();
}

static TUNNELS: Lazy<Mutex<HashMap<String, Arc<Tunnel>>>> = Lazy::new(|| Mutex::new(HashMap::new()));
static HOST_LAN_PORT: Lazy<Arc<AtomicU32>> = Lazy::new(|| Arc::new(AtomicU32::new(0)));
static LAST_GUEST_PORTS: Lazy<Mutex<HashMap<String, u16>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn tunnels() -> MutexGuard<'static, HashMap<String, Arc<Tunnel>>> {
    TUNNELS.lock().unwrap_or_else(PoisonError::into_inner)
}

fn normalize_session_id(session_id: &str) -> String {
    let trimmed = session_id.trim();
    if trimmed.is_empty() {
        "default".into()
    } else {
        trimmed.to_string()
    }
}

fn tunnel_for(app: &AppHandle, sid: &str) -> Arc<Tunnel> {
    tunnels()
        .entry(sid.to_string())
        .or_insert_with(|| {
            let app = app.clone();
            let session_id = sid.to_string();
            let status: StatusFn = Arc::new(move |state, detail| {
                let _ = app.emit(
                    EVENT_LAN_BRIDGE_STATUS,
                    LanBridgeStatusPayload {
                        session_id: session_id.clone(),
                        state: state.into(),
                        detail,
                    },
                );
            });
            Tunnel::new(sid.to_string(), HOST_LAN_PORT.clone(), status)
        })
        .clone()
}

fn existing_tunnel(sid: &str) -> Option<Arc<Tunnel>> {
    tunnels().get(sid).cloned()
}

#[tauri::command]
pub async fn lan_bridge_attach(
    app: AppHandle,
    session_id: String,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<u64, String> {
    let sid = normalize_session_id(&session_id);
    let tunnel = tunnel_for(&app, &sid);
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let generation = tunnel.attach(tx);

    tokio::spawn(async move {
        let mut carry: Option<Vec<u8>> = None;
        loop {
            let first = match carry.take() {
                Some(frame) => frame,
                None => match rx.recv().await {
                    Some(frame) => frame,
                    None => break,
                },
            };
            let mut batch = first;
            while batch.len() < OUTBOUND_BATCH_MAX {
                match rx.try_recv() {
                    Ok(next) if batch.len() + next.len() <= OUTBOUND_BATCH_MAX => {
                        batch.extend_from_slice(&next)
                    }
                    Ok(next) => {
                        carry = Some(next);
                        break;
                    }
                    Err(_) => break,
                }
            }
            if on_frame.send(InvokeResponseBody::Raw(batch)).is_err() {
                break;
            }
        }
    });
    Ok(generation)
}

#[tauri::command]
pub async fn lan_bridge_write(request: Request<'_>) -> Result<(), String> {
    let sid = request
        .headers()
        .get(SESSION_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(normalize_session_id)
        .ok_or_else(|| "lan bridge: missing session header".to_string())?;
    let tunnel = existing_tunnel(&sid).ok_or_else(|| format!("lan bridge is not running ({sid})"))?;
    match request.body() {
        InvokeBody::Raw(bytes) => tunnel.handle_incoming(bytes),
        InvokeBody::Json(value) => {
            let bytes: Vec<u8> = serde_json::from_value(value.clone())
                .map_err(|e| format!("lan bridge: bad body: {e}"))?;
            tunnel.handle_incoming(&bytes)
        }
    }
}

#[tauri::command]
pub async fn lan_bridge_set_flow(session_id: String, paused: bool) -> Result<(), String> {
    let sid = normalize_session_id(&session_id);
    if let Some(tunnel) = existing_tunnel(&sid) {
        tunnel.paused_tx.send_replace(paused);
    }
    Ok(())
}

#[tauri::command]
pub async fn lan_bridge_start_guest(app: AppHandle, session_id: String) -> Result<u16, String> {
    let sid = normalize_session_id(&session_id);
    let tunnel = tunnel_for(&app, &sid);
    let preferred = LAST_GUEST_PORTS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&sid)
        .copied();
    let port = tunnel.start_guest_listener(preferred).await?;
    LAST_GUEST_PORTS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(sid, port);
    Ok(port)
}

#[tauri::command]
pub async fn lan_bridge_set_host_port(port: Option<u16>) -> Result<(), String> {
    HOST_LAN_PORT.store(port.unwrap_or(0) as u32, Ordering::Relaxed);
    eprintln!("[LanBridge] host LAN port = {port:?}");
    Ok(())
}

#[tauri::command]
pub async fn lan_bridge_probe_port(port: u16) -> Result<bool, String> {
    if port == 0 {
        return Ok(false);
    }
    for host in ["127.0.0.1", "::1"] {
        let attempt = tokio::time::timeout(Duration::from_millis(1500), TcpStream::connect((host, port)));
        if let Ok(Ok(_)) = attempt.await {
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
pub async fn lan_bridge_detach(session_id: String, generation: Option<u64>) -> Result<(), String> {
    let sid = normalize_session_id(&session_id);
    if let Some(tunnel) = existing_tunnel(&sid) {
        tunnel.detach(generation);
    }
    Ok(())
}

#[tauri::command]
pub async fn lan_bridge_stop(session_id: Option<String>) -> Result<(), String> {
    let removed: Vec<Arc<Tunnel>> = {
        let mut map = tunnels();
        match session_id {
            Some(raw) => map.remove(&normalize_session_id(&raw)).into_iter().collect(),
            None => map.drain().map(|(_, t)| t).collect(),
        }
    };
    if !removed.is_empty() {
        eprintln!("[LanBridge] stop {} session(s)", removed.len());
    }
    for tunnel in removed {
        tunnel.shutdown();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quiet() -> StatusFn {
        Arc::new(|_, _| {})
    }

    fn wire(from: mpsc::UnboundedReceiver<Vec<u8>>, to: Arc<Tunnel>) {
        let mut from = from;
        tokio::spawn(async move {
            while let Some(bytes) = from.recv().await {
                for piece in bytes.chunks(7) {
                    to.handle_incoming(piece).expect("valid frames");
                }
            }
        });
    }

    async fn echo_server() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut buf = [0u8; 1024];
                    loop {
                        match stream.read(&mut buf).await {
                            Ok(0) | Err(_) => return,
                            Ok(n) => stream.write_all(&buf[..n]).await.unwrap(),
                        }
                    }
                });
            }
        });
        port
    }

    async fn pair(host_port: u16) -> (Arc<Tunnel>, Arc<Tunnel>) {
        let host = Tunnel::new("host".into(), Arc::new(AtomicU32::new(host_port as u32)), quiet());
        let guest = Tunnel::new("guest".into(), Arc::new(AtomicU32::new(0)), quiet());
        let (host_tx, host_rx) = mpsc::unbounded_channel();
        let (guest_tx, guest_rx) = mpsc::unbounded_channel();
        host.attach(host_tx);
        guest.attach(guest_tx);
        wire(host_rx, guest.clone());
        wire(guest_rx, host.clone());
        (host, guest)
    }

    async fn roundtrip(port: u16, msg: &[u8]) -> TcpStream {
        let mut client = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        client.write_all(msg).await.unwrap();
        let mut got = vec![0u8; msg.len()];
        tokio::time::timeout(Duration::from_secs(5), client.read_exact(&mut got))
            .await
            .expect("echo timeout")
            .unwrap();
        assert_eq!(got, msg);
        client
    }

    #[test]
    fn frames_roundtrip_with_partial_tail() {
        let mut wire = encode_frame(FRAME_OPEN, 7, &[]);
        wire.extend(encode_frame(FRAME_DATA, 7, b"hello"));
        wire.extend(encode_frame(FRAME_CLOSE, 7, &[]));
        let cut = wire.len() - 3;
        let (frames, used) = parse_frames(&wire[..cut]).unwrap();
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[1].payload, b"hello");
        let (rest, _) = parse_frames(&wire[used..]).unwrap();
        assert_eq!(rest, vec![Frame { kind: FRAME_CLOSE, conn_id: 7, payload: vec![] }]);
    }

    #[test]
    fn oversized_frame_is_rejected() {
        let mut bad = vec![FRAME_DATA, 0, 0, 0, 1];
        bad.extend_from_slice(&u32::MAX.to_be_bytes());
        assert!(parse_frames(&bad).is_err());
    }

    #[tokio::test]
    async fn sequential_and_parallel_connections_stay_isolated() {
        let lan = echo_server().await;
        let (_host, guest) = pair(lan).await;
        let port = guest.start_guest_listener(None).await.unwrap();

        let ping = roundtrip(port, b"status-ping").await;
        drop(ping);
        let mut a = roundtrip(port, b"login-a").await;
        let mut b = roundtrip(port, b"login-b").await;

        a.write_all(b"more-a").await.unwrap();
        b.write_all(b"more-b").await.unwrap();
        let mut ga = [0u8; 6];
        let mut gb = [0u8; 6];
        a.read_exact(&mut ga).await.unwrap();
        b.read_exact(&mut gb).await.unwrap();
        assert_eq!(&ga, b"more-a");
        assert_eq!(&gb, b"more-b");
    }

    #[tokio::test]
    async fn refused_when_world_not_shared() {
        let (_host, guest) = pair(0).await;
        let port = guest.start_guest_listener(None).await.unwrap();
        let mut client = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        client.write_all(b"handshake").await.unwrap();
        let mut buf = [0u8; 16];
        let n = tokio::time::timeout(Duration::from_secs(5), client.read(&mut buf))
            .await
            .expect("guest connection should be closed")
            .unwrap_or(0);
        assert_eq!(n, 0);
    }

    #[tokio::test]
    async fn reattach_keeps_listener_port() {
        let lan = echo_server().await;
        let (host, guest) = pair(lan).await;
        let port = guest.start_guest_listener(None).await.unwrap();
        let _ = roundtrip(port, b"before").await;

        let (host_tx, host_rx) = mpsc::unbounded_channel();
        let (guest_tx, guest_rx) = mpsc::unbounded_channel();
        host.attach(host_tx);
        guest.attach(guest_tx);
        wire(host_rx, guest.clone());
        wire(guest_rx, host.clone());

        assert_eq!(guest.start_guest_listener(None).await.unwrap(), port);
        let _ = roundtrip(port, b"after").await;
    }
}
