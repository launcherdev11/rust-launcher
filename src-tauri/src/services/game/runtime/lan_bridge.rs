use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use once_cell::sync::OnceCell;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex, watch};

pub const EVENT_LAN_BRIDGE_DATA: &str = "lan-bridge-data";
pub const EVENT_LAN_BRIDGE_STATUS: &str = "lan-bridge-status";

#[derive(Debug, Clone, Serialize)]
pub struct LanBridgeDataPayload {
    pub session_id: String,
    pub data_b64: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LanBridgeStatusPayload {
    pub session_id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

struct BridgeSession {
    write_tx: Option<mpsc::Sender<Vec<u8>>>,
    run_tx: Option<watch::Sender<bool>>,
    role: Option<&'static str>,
    guest_port: Option<u16>,
    pending_chunks: VecDeque<Vec<u8>>,
    pending_bytes: usize,
}

impl BridgeSession {
    fn idle() -> Self {
        Self {
            write_tx: None,
            run_tx: None,
            role: None,
            guest_port: None,
            pending_chunks: VecDeque::new(),
            pending_bytes: 0,
        }
    }
}

const PENDING_CHUNKS_MAX: usize = 512;
const PENDING_BYTES_MAX: usize = 4 * 1024 * 1024;

static BRIDGES: OnceCell<Arc<Mutex<HashMap<String, BridgeSession>>>> = OnceCell::new();

fn bridges_state() -> Arc<Mutex<HashMap<String, BridgeSession>>> {
    BRIDGES
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

fn normalize_session_id(session_id: &str) -> String {
    let trimmed = session_id.trim();
    if trimmed.is_empty() {
        "default".into()
    } else {
        trimmed.to_string()
    }
}

async fn emit_status(app: &AppHandle, session_id: &str, state: &str, detail: Option<String>) {
    let _ = app.emit(
        EVENT_LAN_BRIDGE_STATUS,
        LanBridgeStatusPayload {
            session_id: session_id.to_string(),
            state: state.into(),
            detail,
        },
    );
}

async fn stop_session(session: &mut BridgeSession) {
    if let Some(tx) = session.run_tx.take() {
        let _ = tx.send(false);
    }
    session.write_tx = None;
    session.role = None;
    session.guest_port = None;
    session.pending_chunks.clear();
    session.pending_bytes = 0;
}

#[tauri::command]
pub async fn lan_bridge_start_guest(app: AppHandle, session_id: String) -> Result<u16, String> {
    let sid = normalize_session_id(&session_id);
    let state = bridges_state();
    let mut map = state.lock().await;
    if let Some(existing) = map.get_mut(&sid) {
        stop_session(existing).await;
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("lan bridge bind failed: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("lan bridge addr: {e}"))?
        .port();

    let (run_tx, run_rx) = watch::channel(true);
    let session = BridgeSession {
        write_tx: None,
        run_tx: Some(run_tx),
        role: Some("guest"),
        guest_port: Some(port),
        pending_chunks: VecDeque::new(),
        pending_bytes: 0,
    };
    map.insert(sid.clone(), session);
    drop(map);

    let app2 = app.clone();
    let state2 = state.clone();
    let sid2 = sid.clone();
    tokio::spawn(async move {
        emit_status(&app2, &sid2, "listening", Some(format!("127.0.0.1:{port}"))).await;
        eprintln!("[LanBridge:{sid2}] guest listening on 127.0.0.1:{port}");

        loop {
            if !*run_rx.borrow() {
                emit_status(&app2, &sid2, "stopped", None).await;
                break;
            }

            let mut run_rx_accept = run_rx.clone();
            tokio::select! {
                accept = listener.accept() => {
                    match accept {
                        Ok((stream, peer)) => {
                            eprintln!("[LanBridge:{sid2}] guest accepted from {peer}");
                            emit_status(&app2, &sid2, "connected", Some(peer.to_string())).await;

                            let (conn_tx, mut conn_rx) = mpsc::channel::<Vec<u8>>(1024);
                            let pending = {
                                let mut g = state2.lock().await;
                                let Some(session) = g.get_mut(&sid2) else { break; };
                                if session.role != Some("guest") {
                                    break;
                                }
                                session.write_tx = Some(conn_tx.clone());
                                let drained = session.pending_chunks.drain(..).collect::<Vec<_>>();
                                session.pending_bytes = 0;
                                drained
                            };
                            {
                                if !pending.is_empty() {
                                    eprintln!(
                                        "[LanBridge:{sid2}] guest flushing {} buffered chunks after accept",
                                        pending.len()
                                    );
                                }
                                for chunk in pending {
                                    if conn_tx.send(chunk).await.is_err() {
                                        eprintln!("[LanBridge:{sid2}] guest failed to flush buffered chunk");
                                        break;
                                    }
                                }
                            }

                            run_stream_loop(app2.clone(), sid2.clone(), stream, &mut conn_rx, run_rx.clone()).await;

                            {
                                let mut g = state2.lock().await;
                                if let Some(session) = g.get_mut(&sid2) {
                                    if session.role == Some("guest") {
                                        session.write_tx = None;
                                        emit_status(
                                            &app2,
                                            &sid2,
                                            "listening",
                                            Some(format!("127.0.0.1:{port}")),
                                        )
                                        .await;
                                        eprintln!(
                                            "[LanBridge:{sid2}] guest TCP closed; still listening on {port}"
                                        );
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            emit_status(&app2, &sid2, "error", Some(e.to_string())).await;
                            break;
                        }
                    }
                }
                _ = run_rx_accept.changed() => {
                    if !*run_rx_accept.borrow() {
                        emit_status(&app2, &sid2, "stopped", None).await;
                        break;
                    }
                }
            }
        }

        let mut g = state2.lock().await;
        if let Some(session) = g.get_mut(&sid2) {
            if session.role == Some("guest") {
                *session = BridgeSession::idle();
            }
        }
        eprintln!("[LanBridge:{sid2}] guest task exited");
    });

    Ok(port)
}

#[tauri::command]
pub async fn lan_bridge_start_host(
    app: AppHandle,
    session_id: String,
    lan_port: u16,
) -> Result<(), String> {
    if lan_port == 0 {
        return Err("invalid lan port".into());
    }

    let sid = normalize_session_id(&session_id);
    let state = bridges_state();
    let mut map = state.lock().await;
    if let Some(existing) = map.get_mut(&sid) {
        stop_session(existing).await;
    }

    let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(1024);
    let (run_tx, run_rx) = watch::channel(true);
    map.insert(
        sid.clone(),
        BridgeSession {
            write_tx: Some(write_tx),
            run_tx: Some(run_tx),
            role: Some("host"),
            guest_port: None,
            pending_chunks: VecDeque::new(),
            pending_bytes: 0,
        },
    );
    drop(map);

    let app2 = app.clone();
    let state2 = state.clone();
    let sid2 = sid.clone();
    tokio::spawn(async move {
        let target = format!("127.0.0.1:{lan_port}");
        let mut attempt: u32 = 0;
        loop {
            if !*run_rx.borrow() {
                emit_status(&app2, &sid2, "stopped", None).await;
                break;
            }
            attempt = attempt.saturating_add(1);
            emit_status(
                &app2,
                &sid2,
                "connecting",
                Some(format!("{target} attempt={attempt}")),
            )
            .await;
            eprintln!("[LanBridge:{sid2}] host connect attempt #{attempt} to {target}");

            match TcpStream::connect(("127.0.0.1", lan_port)).await {
                Ok(stream) => {
                    emit_status(&app2, &sid2, "connected", Some(format!("attempt={attempt}"))).await;
                    eprintln!("[LanBridge:{sid2}] host connected to {target} on attempt {attempt}");
                    run_stream_loop(app2.clone(), sid2.clone(), stream, &mut write_rx, run_rx.clone()).await;
                    if !*run_rx.borrow() {
                        break;
                    }
                    emit_status(&app2, &sid2, "reconnecting", Some(target.clone())).await;
                    eprintln!("[LanBridge:{sid2}] host stream ended, reconnecting to {target}");
                }
                Err(e) => {
                    emit_status(
                        &app2,
                        &sid2,
                        "retrying",
                        Some(format!("{target} attempt={attempt} err={e}")),
                    )
                    .await;
                    let delay_ms = (attempt.min(40) as u64) * 100;
                    tokio::time::sleep(Duration::from_millis(delay_ms.max(250))).await;
                }
            }
        }

        let mut g = state2.lock().await;
        if let Some(session) = g.get_mut(&sid2) {
            if session.role == Some("host") {
                *session = BridgeSession::idle();
            }
        }
        eprintln!("[LanBridge:{sid2}] host task exited");
    });

    Ok(())
}

#[tauri::command]
pub async fn lan_bridge_write(session_id: String, data_b64: String) -> Result<(), String> {
    let sid = normalize_session_id(&session_id);
    let bytes = B64
        .decode(data_b64.as_bytes())
        .map_err(|e| format!("invalid bridge payload: {e}"))?;
    if bytes.is_empty() {
        return Ok(());
    }
    let state = bridges_state();
    let (tx_opt, should_buffer_guest) = {
        let guard = state.lock().await;
        match guard.get(&sid) {
            Some(session) => (session.write_tx.clone(), session.role == Some("guest")),
            None => (None, false),
        }
    };
    if let Some(tx) = tx_opt {
        tx.send(bytes)
            .await
            .map_err(|_| "lan bridge is not accepting data".to_string())?;
        return Ok(());
    }
    if should_buffer_guest {
        let mut guard = state.lock().await;
        let Some(session) = guard.get_mut(&sid) else {
            return Err("lan bridge is not running".into());
        };
        let len = bytes.len();
        if session.pending_chunks.len() >= PENDING_CHUNKS_MAX
            || session.pending_bytes + len > PENDING_BYTES_MAX
        {
            while session.pending_chunks.len() >= PENDING_CHUNKS_MAX
                || session.pending_bytes + len > PENDING_BYTES_MAX
            {
                if let Some(old) = session.pending_chunks.pop_front() {
                    session.pending_bytes = session.pending_bytes.saturating_sub(old.len());
                } else {
                    break;
                }
            }
        }
        session.pending_bytes = session.pending_bytes.saturating_add(len);
        session.pending_chunks.push_back(bytes);
        if session.pending_chunks.len() == 1 {
            eprintln!("[LanBridge:{sid}] guest buffering peer data until local TCP accept");
        }
        return Ok(());
    }
    Err(format!("lan bridge is not running ({sid})"))
}

#[tauri::command]
pub async fn lan_bridge_stop(session_id: Option<String>) -> Result<(), String> {
    let state = bridges_state();
    let mut map = state.lock().await;
    match session_id {
        Some(raw) => {
            let sid = normalize_session_id(&raw);
            if let Some(session) = map.get_mut(&sid) {
                eprintln!(
                    "[LanBridge:{sid}] stop requested (role={:?}, port={:?})",
                    session.role, session.guest_port
                );
                stop_session(session).await;
                map.remove(&sid);
            }
        }
        None => {
            let keys: Vec<String> = map.keys().cloned().collect();
            eprintln!("[LanBridge] stop all requested ({} sessions)", keys.len());
            for sid in keys {
                if let Some(session) = map.get_mut(&sid) {
                    stop_session(session).await;
                }
                map.remove(&sid);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn lan_bridge_guest_port(session_id: Option<String>) -> Result<Option<u16>, String> {
    let state = bridges_state();
    let map = state.lock().await;
    let sid = normalize_session_id(session_id.as_deref().unwrap_or("default"));
    Ok(map.get(&sid).and_then(|s| s.guest_port))
}

async fn run_stream_loop(
    app: AppHandle,
    session_id: String,
    stream: TcpStream,
    write_rx: &mut mpsc::Receiver<Vec<u8>>,
    mut run_rx: watch::Receiver<bool>,
) {
    let (mut reader, mut writer) = stream.into_split();
    let mut buf = vec![0u8; 16 * 1024];

    loop {
        if !*run_rx.borrow() {
            emit_status(&app, &session_id, "stopped", None).await;
            break;
        }

        tokio::select! {
            read = reader.read(&mut buf) => {
                match read {
                    Ok(0) => {
                        emit_status(&app, &session_id, "closed", Some("tcp eof".into())).await;
                        break;
                    }
                    Ok(n) => {
                        let _ = app.emit(
                            EVENT_LAN_BRIDGE_DATA,
                            LanBridgeDataPayload {
                                session_id: session_id.clone(),
                                data_b64: B64.encode(&buf[..n]),
                            },
                        );
                    }
                    Err(e) => {
                        emit_status(&app, &session_id, "error", Some(e.to_string())).await;
                        break;
                    }
                }
            }
            chunk = write_rx.recv() => {
                match chunk {
                    Some(data) => {
                        if let Err(e) = writer.write_all(&data).await {
                            emit_status(&app, &session_id, "error", Some(e.to_string())).await;
                            break;
                        }
                        if let Err(e) = writer.flush().await {
                            emit_status(&app, &session_id, "error", Some(e.to_string())).await;
                            break;
                        }
                    }
                    None => break,
                }
            }
            _ = run_rx.changed() => {
                if !*run_rx.borrow() {
                    emit_status(&app, &session_id, "stopped", None).await;
                    break;
                }
            }
        }
    }
}
