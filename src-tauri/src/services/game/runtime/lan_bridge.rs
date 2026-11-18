use std::borrow::Cow;
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

use super::lan_discovery;
use crate::services::game::state::GAME_PROCESS_PID;

pub const EVENT_LAN_BRIDGE_STATUS: &str = "lan-bridge-status";
pub const EVENT_GAME_LAN_PORT: &str = "game-lan-port";
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

const GAME_LAN_PORT_NONE: u32 = 0;
const WORLD_QUERY_TIMEOUT: Duration = Duration::from_secs(3);
const PORT_PROBE_TIMEOUT: Duration = Duration::from_millis(1500);
const MAX_STATUS_PACKET: usize = 4 * 1024 * 1024;
const MAX_LISTED_PLAYERS: usize = 20;

static GAME_LAN_PORT: AtomicU32 = AtomicU32::new(GAME_LAN_PORT_NONE);

#[derive(Debug, PartialEq, Eq)]
enum LanLogEvent {
    Opened(u16),
    Closed,
}

fn is_log_prefix(head: &str) -> bool {
    !head.contains("[CHAT]") && (head.is_empty() || head.ends_with(": ") || head.ends_with(") "))
}

fn strip_ansi(line: &str) -> Cow<'_, str> {
    if !line.contains('\u{1b}') {
        return Cow::Borrowed(line);
    }
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        if chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if ('\u{40}'..='\u{7e}').contains(&next) {
                    break;
                }
            }
        }
    }
    Cow::Owned(out)
}

fn unwrap_cdata(line: &str) -> &str {
    let Some(start) = line.find("<![CDATA[") else {
        return line;
    };
    let inner = &line[start + "<![CDATA[".len()..];
    inner.find("]]>").map_or(inner, |end| &inner[..end])
}

fn leading_port(text: &str) -> Option<u16> {
    let digits = text.len() - text.trim_start_matches(|c: char| c.is_ascii_digit()).len();
    if digits == 0 || text[digits..].starts_with(|c: char| c.is_alphanumeric()) {
        return None;
    }
    text[..digits].parse::<u16>().ok().filter(|p| *p != 0)
}

fn lan_log_event(line: &str) -> Option<LanLogEvent> {
    let clean = strip_ansi(line);
    let line = unwrap_cdata(clean.trim()).trim_end();
    if let Some(head) = line.strip_suffix("Stopping server") {
        return is_log_prefix(head).then_some(LanLogEvent::Closed);
    }
    for marker in ["Started serving on ", "Started on "] {
        let Some(idx) = line.rfind(marker) else { continue };
        if !is_log_prefix(&line[..idx]) {
            continue;
        }
        return leading_port(&line[idx + marker.len()..]).map(LanLogEvent::Opened);
    }
    None
}

fn publish_game_lan_port(app: &AppHandle, port: Option<u16>) {
    let next = port.map_or(GAME_LAN_PORT_NONE, u32::from);
    if GAME_LAN_PORT.swap(next, Ordering::SeqCst) != next {
        eprintln!("[LanBridge] game LAN port = {port:?}");
        let _ = app.emit(EVENT_GAME_LAN_PORT, port);
    }
}

pub(crate) fn observe_game_log_line(app: &AppHandle, line: &str) {
    match lan_log_event(line) {
        Some(LanLogEvent::Opened(port)) => publish_game_lan_port(app, Some(port)),
        Some(LanLogEvent::Closed) => publish_game_lan_port(app, None),
        None => {}
    }
}

pub(crate) fn clear_game_lan_port(app: &AppHandle) {
    publish_game_lan_port(app, None);
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LanWorldInfo {
    motd: Option<String>,
    version: Option<String>,
    players_online: Option<u32>,
    players_max: Option<u32>,
    players: Vec<String>,
}

fn put_varint(out: &mut Vec<u8>, value: i32) {
    let mut rest = value as u32;
    loop {
        let byte = (rest & 0x7f) as u8;
        rest >>= 7;
        if rest == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

fn take_varint(buf: &[u8]) -> Option<(i32, usize)> {
    let mut value = 0u32;
    for (i, byte) in buf.iter().take(5).enumerate() {
        value |= u32::from(byte & 0x7f) << (7 * i);
        if byte & 0x80 == 0 {
            return Some((value as i32, i + 1));
        }
    }
    None
}

async fn read_varint(stream: &mut TcpStream) -> std::io::Result<i32> {
    let mut value = 0u32;
    for i in 0..5 {
        let byte = stream.read_u8().await?;
        value |= u32::from(byte & 0x7f) << (7 * i);
        if byte & 0x80 == 0 {
            return Ok(value as i32);
        }
    }
    Err(std::io::ErrorKind::InvalidData.into())
}

fn status_request(port: u16) -> Vec<u8> {
    const HOST: &[u8] = b"127.0.0.1";
    let mut handshake = Vec::with_capacity(HOST.len() + 8);
    put_varint(&mut handshake, 0);
    put_varint(&mut handshake, -1);
    put_varint(&mut handshake, HOST.len() as i32);
    handshake.extend_from_slice(HOST);
    handshake.extend_from_slice(&port.to_be_bytes());
    put_varint(&mut handshake, 1);

    let mut out = Vec::with_capacity(handshake.len() + 4);
    put_varint(&mut out, handshake.len() as i32);
    out.extend_from_slice(&handshake);
    out.extend_from_slice(&[1, 0]);
    out
}

fn status_json(packet: &[u8]) -> Option<&[u8]> {
    let (packet_id, id_len) = take_varint(packet)?;
    if packet_id != 0 {
        return None;
    }
    let rest = &packet[id_len..];
    let (json_len, len_len) = take_varint(rest)?;
    rest.get(len_len..len_len + usize::try_from(json_len).ok()?)
}

fn collect_chat_text(value: &serde_json::Value, out: &mut String) {
    match value {
        serde_json::Value::String(text) => out.push_str(text),
        serde_json::Value::Array(parts) => parts.iter().for_each(|part| collect_chat_text(part, out)),
        serde_json::Value::Object(map) => {
            if let Some(text) = map.get("text") {
                collect_chat_text(text, out);
            }
            if let Some(extra) = map.get("extra") {
                collect_chat_text(extra, out);
            }
        }
        _ => {}
    }
}

fn strip_format_codes(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c == '\u{a7}' {
            chars.next();
        } else {
            out.push(c);
        }
    }
    out
}

fn parse_world_status(json: &[u8]) -> Option<LanWorldInfo> {
    let root: serde_json::Value = serde_json::from_slice(json).ok()?;
    let mut motd = String::new();
    if let Some(description) = root.get("description") {
        collect_chat_text(description, &mut motd);
    }
    let motd = strip_format_codes(&motd).trim().to_string();
    let players = root.get("players");
    let count = |key: &str| {
        players
            .and_then(|p| p.get(key))
            .and_then(serde_json::Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
    };
    Some(LanWorldInfo {
        motd: (!motd.is_empty()).then_some(motd),
        version: root
            .pointer("/version/name")
            .and_then(serde_json::Value::as_str)
            .map(strip_format_codes),
        players_online: count("online"),
        players_max: count("max"),
        players: players
            .and_then(|p| p.get("sample"))
            .and_then(serde_json::Value::as_array)
            .map(|sample| {
                sample
                    .iter()
                    .filter_map(|entry| entry.get("name")?.as_str())
                    .take(MAX_LISTED_PLAYERS)
                    .map(strip_format_codes)
                    .collect()
            })
            .unwrap_or_default(),
    })
}

async fn query_world(port: u16) -> Option<LanWorldInfo> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.ok()?;
    stream.write_all(&status_request(port)).await.ok()?;
    let len = usize::try_from(read_varint(&mut stream).await.ok()?).ok()?;
    if len == 0 || len > MAX_STATUS_PACKET {
        return None;
    }
    let mut packet = vec![0u8; len];
    stream.read_exact(&mut packet).await.ok()?;
    parse_world_status(status_json(&packet)?)
}

#[tauri::command]
pub fn lan_bridge_game_port() -> Option<u16> {
    match GAME_LAN_PORT.load(Ordering::SeqCst) {
        GAME_LAN_PORT_NONE => None,
        port => u16::try_from(port).ok(),
    }
}

#[tauri::command]
pub async fn lan_bridge_query_world(port: u16) -> Result<Option<LanWorldInfo>, String> {
    Ok(tokio::time::timeout(WORLD_QUERY_TIMEOUT, query_world(port))
        .await
        .ok()
        .flatten())
}

async fn answers_status(port: u16) -> bool {
    tokio::time::timeout(PORT_PROBE_TIMEOUT, query_world(port))
        .await
        .ok()
        .flatten()
        .is_some()
}

async fn first_answering(mut ports: Vec<u16>, preferred: Option<u16>) -> Option<u16> {
    ports.sort_unstable();
    ports.dedup();
    if let Some(pos) = preferred.and_then(|p| ports.iter().position(|x| *x == p)) {
        ports.swap(0, pos);
    }
    let checks = ports
        .into_iter()
        .map(|port| async move { answers_status(port).await.then_some(port) });
    futures_util::future::join_all(checks)
        .await
        .into_iter()
        .flatten()
        .next()
}

async fn detect_game_lan_port(current: Option<u16>) -> Option<u16> {
    let pid = u32::try_from(GAME_PROCESS_PID.load(Ordering::SeqCst)).unwrap_or(0);
    if pid == 0 {
        return None;
    }
    let ports = tokio::task::spawn_blocking(move || lan_discovery::listening_ports(pid))
        .await
        .unwrap_or_default();
    first_answering(ports, current).await
}

#[tauri::command]
pub async fn lan_bridge_detect_port(app: AppHandle) -> Result<Option<u16>, String> {
    let current = lan_bridge_game_port();
    match detect_game_lan_port(current).await {
        Some(port) => publish_game_lan_port(&app, Some(port)),
        None => {
            if let Some(port) = current {
                if !answers_status(port).await {
                    publish_game_lan_port(&app, None);
                }
            }
        }
    }
    Ok(lan_bridge_game_port())
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
    fn lan_port_is_read_from_game_log_formats() {
        for line in [
            "[12:00:00] [Render thread/INFO]: Started serving on 51234",
            "[14Jan2024 12:00:00.000] [Render thread/INFO] [net.minecraft.client.server.IntegratedServer/]: Started serving on 51234",
            "[12:00:00] [Render thread/INFO] (Minecraft) Started serving on 51234",
            "[12:00:00] [Client thread/INFO]: Started on 51234",
            "Started on 51234\r",
            "\u{1b}[32m[12:00:00] [Server thread/INFO] [minecraft/IntegratedServer]: Started serving on 51234\u{1b}[m",
            "    <log4j:Message><![CDATA[Started serving on 51234]]></log4j:Message>",
            "[12:00:00] [Server thread/INFO]: Started serving on 51234.",
        ] {
            assert_eq!(lan_log_event(line), Some(LanLogEvent::Opened(51234)), "{line}");
        }
        assert_eq!(
            lan_log_event("[12:00:00] [Server thread/INFO]: Stopping server"),
            Some(LanLogEvent::Closed)
        );
    }

    #[test]
    fn chat_and_foreign_log_lines_do_not_change_lan_port() {
        for line in [
            "[12:00:00] [Render thread/INFO]: [CHAT] <Steve> Started on 1234",
            "[12:00:00] [Render thread/INFO]: [System] [CHAT] Started serving on 1234",
            "[12:00:00] [Render thread/INFO]: [CHAT] Steve: Stopping server",
            "[12:00:00] [main/INFO]: Web server Started on 8080",
            "[12:00:00] [Render thread/INFO]: Started serving on 99999",
            "[12:00:00] [Render thread/INFO]: Started serving on 0",
            "[12:00:00] [Render thread/INFO]: Started serving on 5123x",
        ] {
            assert_eq!(lan_log_event(line), None, "{line}");
        }
    }

    #[test]
    fn world_status_flattens_chat_and_format_codes() {
        let json = br#"{
            "description": {"text": "\u00a7aSteve", "extra": [{"text": " - "}, "New World"]},
            "version": {"name": "1.20.1", "protocol": 763},
            "players": {"online": 2, "max": 8, "sample": [{"name": "Steve"}, {"name": "Alex"}]}
        }"#;
        let info = parse_world_status(json).unwrap();
        assert_eq!(info.motd.as_deref(), Some("Steve - New World"));
        assert_eq!(info.version.as_deref(), Some("1.20.1"));
        assert_eq!((info.players_online, info.players_max), (Some(2), Some(8)));
        assert_eq!(info.players, ["Steve", "Alex"]);
    }

    #[tokio::test]
    async fn world_query_reads_status_packet() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let expected = status_request(port);
            let mut got = vec![0u8; expected.len()];
            stream.read_exact(&mut got).await.unwrap();
            assert_eq!(got, expected);

            let json = br#"{"description":"World","players":{"online":1,"max":8}}"#;
            let mut body = Vec::new();
            put_varint(&mut body, 0);
            put_varint(&mut body, json.len() as i32);
            body.extend_from_slice(json);
            let mut packet = Vec::new();
            put_varint(&mut packet, body.len() as i32);
            packet.extend_from_slice(&body);
            stream.write_all(&packet).await.unwrap();
        });
        let info = query_world(port).await.unwrap();
        assert_eq!(info.motd.as_deref(), Some("World"));
        assert_eq!(info.players_online, Some(1));
    }

    #[tokio::test]
    async fn world_query_is_none_when_nothing_listens() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        assert_eq!(query_world(port).await, None);
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
