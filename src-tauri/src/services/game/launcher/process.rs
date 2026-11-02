use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::command;

use crate::infra::process_probe;
use crate::services::game::state::{CANCEL_DOWNLOAD, GAME_PROCESS_MAX_HEAP_BYTES, GAME_PROCESS_PID};

pub(crate) fn is_our_game_process_alive() -> bool {
    let pid = GAME_PROCESS_PID.load(Ordering::SeqCst);
    pid != 0 && process_probe::is_alive(pid as u32)
}

#[command]
pub fn stop_game() -> Result<(), String> {
    let pid = GAME_PROCESS_PID.swap(0, Ordering::SeqCst);
    if pid == 0 {
        return Ok(());
    }
    crate::services::game::run_history::STOP_REQUESTED.store(true, Ordering::SeqCst);
    process_probe::terminate(pid as u32);
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameProcessStats {
    pid: u32,
    memory_bytes: u64,
    // 0–100 от всех ядер
    cpu_percent: f32,
    max_heap_bytes: Option<u64>,
    system_total_bytes: u64,
    system_available_bytes: u64,
}

// cpu_percent считается по разнице процессорного времени между замерами
struct CpuSample {
    pid: u32,
    cpu_time: Duration,
    at: Instant,
}

static LAST_CPU_SAMPLE: Mutex<Option<CpuSample>> = Mutex::new(None);

fn parse_jvm_size(value: &str) -> Option<u64> {
    let value = value.trim();
    let (digits, unit) = value.split_at(value.find(|c: char| !c.is_ascii_digit())?);
    let n: u64 = digits.parse().ok()?;
    let mult = match unit.to_ascii_lowercase().as_str() {
        "k" => 1024,
        "m" => 1024 * 1024,
        "g" => 1024 * 1024 * 1024,
        "t" => 1024u64.pow(4),
        _ => return None,
    };
    Some(n * mult)
}

pub(crate) fn max_heap_from_args<S: AsRef<str>>(args: &[S]) -> Option<u64> {
    args.iter()
        .filter_map(|arg| arg.as_ref().strip_prefix("-Xmx"))
        .last()
        .and_then(parse_jvm_size)
}

#[command]
pub fn get_game_process_stats() -> Option<GameProcessStats> {
    let pid = GAME_PROCESS_PID.load(Ordering::SeqCst) as u32;
    let mut last = LAST_CPU_SAMPLE.lock().unwrap_or_else(|e| e.into_inner());
    if pid == 0 {
        *last = None;
        return None;
    }

    let snapshot = process_probe::snapshot(pid)?;
    let now = Instant::now();
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f32;
    let cpu_percent = match last.as_ref().filter(|s| s.pid == pid) {
        Some(prev) => {
            let wall = now.duration_since(prev.at).as_secs_f32();
            let busy = snapshot.cpu_time.saturating_sub(prev.cpu_time).as_secs_f32();
            if wall > 0.0 {
                (busy / wall / cores * 100.0).clamp(0.0, 100.0)
            } else {
                0.0
            }
        }
        None => 0.0,
    };
    *last = Some(CpuSample {
        pid,
        cpu_time: snapshot.cpu_time,
        at: now,
    });

    let (system_total_bytes, system_available_bytes) = process_probe::system_memory();
    let max_heap = GAME_PROCESS_MAX_HEAP_BYTES.load(Ordering::SeqCst);

    Some(GameProcessStats {
        pid,
        memory_bytes: snapshot.memory_bytes,
        cpu_percent,
        max_heap_bytes: (max_heap > 0).then_some(max_heap),
        system_total_bytes,
        system_available_bytes,
    })
}

#[command]
pub fn cancel_download() {
    CANCEL_DOWNLOAD.store(true, Ordering::SeqCst);
}

#[command]
pub fn reset_download_cancel() {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_xmx_units() {
        assert_eq!(parse_jvm_size("4G"), Some(4 * 1024 * 1024 * 1024));
        assert_eq!(parse_jvm_size("2048m"), Some(2048 * 1024 * 1024));
        assert_eq!(parse_jvm_size("512"), None);
        let args = ["-Xms1G", "-Xmx2G", "-Xmx6G"];
        assert_eq!(max_heap_from_args(&args), Some(6 * 1024 * 1024 * 1024));
    }

    #[test]
    fn probes_own_process() {
        let pid = std::process::id();
        assert!(process_probe::is_alive(pid));
        let snapshot = process_probe::snapshot(pid).expect("snapshot");
        assert!(snapshot.memory_bytes > 0);
        assert!(snapshot.start_time > 0);
        assert!(!snapshot.name.is_empty());
        assert!(!process_probe::is_alive(0));
    }

    #[test]
    fn reads_system_info() {
        let (total, available) = process_probe::system_memory();
        assert!(total > 0 && available > 0 && available <= total);
        assert!(!process_probe::os_description().is_empty());
    }
}
