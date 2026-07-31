//! Local TCP ↔ frontend bridge for Minecraft LAN over WebRTC DataChannel.
//!
//! Guest: listens on 127.0.0.1:0 → MC client connects → bytes go to UI/DC.
//! Host: connects to 127.0.0.1:{lan_port} when guest opens a session.
//!
//! The guest listener MUST stay alive for the whole join session: Minecraft may
//! probe/reconnect, and closing the Tauri process kills the port (connection refused).

use std::sync::Arc;
use std::collections::VecDeque;
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
    /// Base64-encoded TCP chunk from the local Minecraft socket.
    pub data_b64: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LanBridgeStatusPayload {
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

struct BridgeInner {
    write_tx: Option<mpsc::Sender<Vec<u8>>>,
    /// Signal all bridge tasks to stop (`true` = running).
    run_tx: Option<watch::Sender<bool>>,
    role: Option<&'static str>,
    guest_port: Option<u16>,
    /// Chunks from peer before local TCP writer is ready.
    pending_chunks: VecDeque<Vec<u8>>,
    pending_bytes: usize,
}

impl BridgeInner {
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

static BRIDGE: OnceCell<Arc<Mutex<BridgeInner>>> = OnceCell::new();

fn bridge_state() -> Arc<Mutex<BridgeInner>> {
    BRIDGE
        .get_or_init(|| Arc::new(Mutex::new(BridgeInner::idle())))
        .clone()
}

async fn emit_status(app: &AppHandle, state: &str, detail: Option<String>) {
    let _ = app.emit(
        EVENT_LAN_BRIDGE_STATUS,
        LanBridgeStatusPayload {
            state: state.into(),
            detail,
        },
    );
}

async fn stop_locked(inner: &mut BridgeInner) {
    if let Some(tx) = inner.run_tx.take() {
        let _ = tx.send(false);
    }
    inner.write_tx = None;
    inner.role = None;
    inner.guest_port = None;
    inner.pending_chunks.clear();
    inner.pending_bytes = 0;
}

/// Guest side: bind localhost and keep accepting until stopped.
#[tauri::command]
pub async fn lan_bridge_start_guest(app: AppHandle) -> Result<u16, String> {
    let state = bridge_state();
    let mut guard = state.lock().await;
    stop_locked(&mut guard).await;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("lan bridge bind failed: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("lan bridge addr: {e}"))?
        .port();

    let (run_tx, run_rx) = watch::channel(true);
    // Writer appears after accept(); until then we queue inbound peer chunks.
    guard.write_tx = None;
    guard.run_tx = Some(run_tx);
    guard.role = Some("guest");
    guard.guest_port = Some(port);
    guard.pending_chunks.clear();
    guard.pending_bytes = 0;
    drop(guard);

    let app2 = app.clone();
    let state2 = state.clone();
    tokio::spawn(async move {
        emit_status(&app2, "listening", Some(format!("127.0.0.1:{port}"))).await;
        eprintln!("[LanBridge] guest listening on 127.0.0.1:{port}");

        loop {
            if !*run_rx.borrow() {
                emit_status(&app2, "stopped", None).await;
                break;
            }

            let mut run_rx_accept = run_rx.clone();
            tokio::select! {
                accept = listener.accept() => {
                    match accept {
                        Ok((stream, peer)) => {
                            eprintln!("[LanBridge] guest accepted from {peer}");
                            emit_status(&app2, "connected", Some(peer.to_string())).await;

                            let (conn_tx, mut conn_rx) = mpsc::channel::<Vec<u8>>(1024);
                            let pending = {
                                let mut g = state2.lock().await;
                                if g.role != Some("guest") {
                                    break;
                                }
                                g.write_tx = Some(conn_tx.clone());
                                let drained = g.pending_chunks.drain(..).collect::<Vec<_>>();
                                g.pending_bytes = 0;
                                drained
                            };
                            {
                                if !pending.is_empty() {
                                    eprintln!(
                                        "[LanBridge] guest flushing {} buffered chunks after accept",
                                        pending.len()
                                    );
                                }
                                for chunk in pending {
                                    if conn_tx.send(chunk).await.is_err() {
                                        eprintln!("[LanBridge] guest failed to flush buffered chunk");
                                        break;
                                    }
                                }
                            }

                            run_stream_loop(app2.clone(), stream, &mut conn_rx, run_rx.clone()).await;

                            {
                                let mut g = state2.lock().await;
                                if g.role == Some("guest") {
                                    // Keep port advertised; drop writer until next accept.
                                    g.write_tx = None;
                                    emit_status(
                                        &app2,
                                        "listening",
                                        Some(format!("127.0.0.1:{port}")),
                                    )
                                    .await;
                                    eprintln!(
                                        "[LanBridge] guest TCP closed; still listening on {port}"
                                    );
                                }
                            }
                        }
                        Err(e) => {
                            emit_status(&app2, "error", Some(e.to_string())).await;
                            break;
                        }
                    }
                }
                _ = run_rx_accept.changed() => {
                    if !*run_rx_accept.borrow() {
                        emit_status(&app2, "stopped", None).await;
                        break;
                    }
                }
            }
        }

        let mut g = state2.lock().await;
        if g.role == Some("guest") {
            *g = BridgeInner::idle();
        }
        eprintln!("[LanBridge] guest task exited");
    });

    Ok(port)
}

/// Host side: connect to local Open-to-LAN Minecraft port.
#[tauri::command]
pub async fn lan_bridge_start_host(app: AppHandle, lan_port: u16) -> Result<(), String> {
    if lan_port == 0 {
        return Err("invalid lan port".into());
    }

    let state = bridge_state();
    let mut guard = state.lock().await;
    stop_locked(&mut guard).await;

    let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(1024);
    let (run_tx, run_rx) = watch::channel(true);
    guard.write_tx = Some(write_tx);
    guard.run_tx = Some(run_tx);
    guard.role = Some("host");
    drop(guard);

    let app2 = app.clone();
    tokio::spawn(async move {
        let target = format!("127.0.0.1:{lan_port}");
        let mut attempt: u32 = 0;
        loop {
            if !*run_rx.borrow() {
                emit_status(&app2, "stopped", None).await;
                break;
            }
            attempt = attempt.saturating_add(1);
            emit_status(
                &app2,
                "connecting",
                Some(format!("{target} attempt={attempt}")),
            )
            .await;
            eprintln!("[LanBridge] host connect attempt #{attempt} to {target}");

            match TcpStream::connect(("127.0.0.1", lan_port)).await {
                Ok(stream) => {
                    emit_status(&app2, "connected", Some(format!("attempt={attempt}"))).await;
                    eprintln!("[LanBridge] host connected to {target} on attempt {attempt}");
                    run_stream_loop(app2.clone(), stream, &mut write_rx, run_rx.clone()).await;
                    if !*run_rx.borrow() {
                        break;
                    }
                    emit_status(&app2, "reconnecting", Some(target.clone())).await;
                    eprintln!("[LanBridge] host stream ended, reconnecting to {target}");
                }
                Err(e) => {
                    emit_status(
                        &app2,
                        "retrying",
                        Some(format!("{target} attempt={attempt} err={e}")),
                    )
                    .await;
                    let delay_ms = (attempt.min(40) as u64) * 100;
                    tokio::time::sleep(Duration::from_millis(delay_ms.max(250))).await;
                }
            }
        }

        let state = bridge_state();
        let mut g = state.lock().await;
        if g.role == Some("host") {
            *g = BridgeInner::idle();
        }
        eprintln!("[LanBridge] host task exited");
    });

    Ok(())
}

/// Bytes arriving from the WebRTC peer → write into the local TCP socket.
#[tauri::command]
pub async fn lan_bridge_write(data_b64: String) -> Result<(), String> {
    let bytes = B64
        .decode(data_b64.as_bytes())
        .map_err(|e| format!("invalid bridge payload: {e}"))?;
    if bytes.is_empty() {
        return Ok(());
    }
    let state = bridge_state();
    let (tx_opt, should_buffer_guest) = {
        let guard = state.lock().await;
        (guard.write_tx.clone(), guard.role == Some("guest"))
    };
    if let Some(tx) = tx_opt {
        tx.send(bytes)
            .await
            .map_err(|_| "lan bridge is not accepting data".to_string())?;
        return Ok(());
    }
    if should_buffer_guest {
        let mut guard = state.lock().await;
        let len = bytes.len();
        if guard.pending_chunks.len() >= PENDING_CHUNKS_MAX || guard.pending_bytes + len > PENDING_BYTES_MAX {
            while guard.pending_chunks.len() >= PENDING_CHUNKS_MAX
                || guard.pending_bytes + len > PENDING_BYTES_MAX
            {
                if let Some(old) = guard.pending_chunks.pop_front() {
                    guard.pending_bytes = guard.pending_bytes.saturating_sub(old.len());
                } else {
                    break;
                }
            }
        }
        guard.pending_bytes = guard.pending_bytes.saturating_add(len);
        guard.pending_chunks.push_back(bytes);
        if guard.pending_chunks.len() == 1 {
            eprintln!("[LanBridge] guest buffering peer data until local TCP accept");
        }
        return Ok(());
    }
    Err("lan bridge is not running".into())
}

#[tauri::command]
pub async fn lan_bridge_stop() -> Result<(), String> {
    let state = bridge_state();
    let mut guard = state.lock().await;
    eprintln!(
        "[LanBridge] stop requested (role={:?}, port={:?})",
        guard.role, guard.guest_port
    );
    stop_locked(&mut guard).await;
    Ok(())
}

#[tauri::command]
pub async fn lan_bridge_guest_port() -> Result<Option<u16>, String> {
    let state = bridge_state();
    let guard = state.lock().await;
    Ok(guard.guest_port)
}

async fn run_stream_loop(
    app: AppHandle,
    stream: TcpStream,
    write_rx: &mut mpsc::Receiver<Vec<u8>>,
    mut run_rx: watch::Receiver<bool>,
) {
    let (mut reader, mut writer) = stream.into_split();
    // Keep chunks modest: each read becomes one WebRTC DataChannel message via IPC.
    // Large bursts amplify reordering/backpressure issues on the JS bridge.
    let mut buf = vec![0u8; 16 * 1024];

    loop {
        if !*run_rx.borrow() {
            emit_status(&app, "stopped", None).await;
            break;
        }

        tokio::select! {
            read = reader.read(&mut buf) => {
                match read {
                    Ok(0) => {
                        emit_status(&app, "closed", Some("tcp eof".into())).await;
                        break;
                    }
                    Ok(n) => {
                        let _ = app.emit(
                            EVENT_LAN_BRIDGE_DATA,
                            LanBridgeDataPayload {
                                data_b64: B64.encode(&buf[..n]),
                            },
                        );
                    }
                    Err(e) => {
                        emit_status(&app, "error", Some(e.to_string())).await;
                        break;
                    }
                }
            }
            chunk = write_rx.recv() => {
                match chunk {
                    Some(data) => {
                        if let Err(e) = writer.write_all(&data).await {
                            emit_status(&app, "error", Some(e.to_string())).await;
                            break;
                        }
                        if let Err(e) = writer.flush().await {
                            emit_status(&app, "error", Some(e.to_string())).await;
                            break;
                        }
                    }
                    None => break,
                }
            }
            _ = run_rx.changed() => {
                if !*run_rx.borrow() {
                    emit_status(&app, "stopped", None).await;
                    break;
                }
            }
        }
    }
}
