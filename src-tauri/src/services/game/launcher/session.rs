use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{command, AppHandle, Emitter};

use crate::app::paths::launcher_data_dir;
use crate::infra::fs_atomic::write_atomic;
use crate::models::events::{
    GameProcessExitedPayload, PlaytimeUpdatedPayload, EVENT_GAME_PROCESS_EXITED,
    EVENT_PLAYTIME_UPDATED,
};
use crate::services::game::profiles::{
    finish_playtime_session, flush_active_playtime, start_playtime_session,
};
use crate::services::game::state::GAME_PROCESS_PID;

const SESSION_FILE: &str = "running_game.json";
const START_TIME_TOLERANCE_SECS: u64 = 2;
const PLAYTIME_FLUSH_INTERVAL: Duration = Duration::from_secs(30);

static WATCHER_ACTIVE: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StoredSession {
    pid: u32,
    process_start_time: u64,
    profile_id: Option<String>,
    started_at_ms: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct RunningGameSession {
    pub profile_id: Option<String>,
    pub started_at_ms: u64,
}

fn session_path() -> Option<std::path::PathBuf> {
    launcher_data_dir().ok().map(|dir| dir.join(SESSION_FILE))
}

fn probe_process(pid: u32) -> Option<(String, u64)> {
    let pid = Pid::from_u32(pid);
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    sys.process(pid).map(|p| {
        (
            p.name().to_string_lossy().to_ascii_lowercase(),
            p.start_time(),
        )
    })
}

fn is_java_name(name: &str) -> bool {
    name.contains("java")
}

pub(crate) fn remember_game_session(pid: u32, profile_id: Option<String>) {
    let Some(path) = session_path() else { return };
    let Some((_, process_start_time)) = probe_process(pid) else {
        return;
    };
    let started_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let session = StoredSession {
        pid,
        process_start_time,
        profile_id,
        started_at_ms,
    };
    match serde_json::to_vec(&session) {
        Ok(bytes) => {
            if let Err(e) = write_atomic(&path, bytes) {
                eprintln!("[Launch] Не удалось сохранить сессию игры: {e}");
            }
        }
        Err(e) => eprintln!("[Launch] Не удалось сериализовать сессию игры: {e}"),
    }
}

pub(crate) fn forget_game_session() {
    if let Some(path) = session_path() {
        let _ = std::fs::remove_file(path);
    }
}

fn load_alive_session() -> Option<StoredSession> {
    let path = session_path()?;
    let text = std::fs::read_to_string(&path).ok()?;
    let session: StoredSession = match serde_json::from_str(&text) {
        Ok(s) => s,
        Err(_) => {
            forget_game_session();
            return None;
        }
    };

    let alive = probe_process(session.pid).is_some_and(|(name, start_time)| {
        is_java_name(&name)
            && start_time.abs_diff(session.process_start_time) <= START_TIME_TOLERANCE_SECS
    });
    if alive {
        Some(session)
    } else {
        forget_game_session();
        None
    }
}

fn spawn_session_watcher(app: AppHandle, pid: u32) {
    if WATCHER_ACTIVE.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        let mut last_flush_at = Instant::now();
        while probe_process(pid).is_some() {
            if last_flush_at.elapsed() >= PLAYTIME_FLUSH_INTERVAL {
                if let Some((profile_id, delta_seconds, total_seconds)) = flush_active_playtime() {
                    let _ = app.emit(
                        EVENT_PLAYTIME_UPDATED,
                        PlaytimeUpdatedPayload {
                            profile_id,
                            delta_seconds,
                            total_seconds,
                        },
                    );
                }
                last_flush_at = Instant::now();
            }
            std::thread::sleep(Duration::from_secs(1));
        }

        forget_game_session();
        let _ = GAME_PROCESS_PID.compare_exchange(pid as u64, 0, Ordering::SeqCst, Ordering::SeqCst);
        let _ = app.emit(
            EVENT_GAME_PROCESS_EXITED,
            GameProcessExitedPayload { exit_code: None },
        );
        if let Some((profile_id, delta_seconds, total_seconds)) = finish_playtime_session() {
            let _ = app.emit(
                EVENT_PLAYTIME_UPDATED,
                PlaytimeUpdatedPayload {
                    profile_id,
                    delta_seconds,
                    total_seconds,
                },
            );
        }
        WATCHER_ACTIVE.store(false, Ordering::SeqCst);
    });
}

#[command]
pub fn get_running_game_session(app: AppHandle) -> Option<RunningGameSession> {
    let session = load_alive_session()?;
    let pid = session.pid as u64;

    let current = GAME_PROCESS_PID.load(Ordering::SeqCst);
    if current == 0 {
        GAME_PROCESS_PID.store(pid, Ordering::SeqCst);
        if let Some(profile_id) = session.profile_id.as_deref() {
            start_playtime_session(profile_id);
        }
        spawn_session_watcher(app, session.pid);
    } else if current != pid {
        return None;
    }

    Some(RunningGameSession {
        profile_id: session.profile_id,
        started_at_ms: session.started_at_ms,
    })
}
