use std::sync::atomic::Ordering;
use std::sync::Mutex;

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::command;

use crate::services::game::state::{CANCEL_DOWNLOAD, GAME_PROCESS_PID};

pub(crate) fn is_our_game_process_alive() -> bool {
    let pid = GAME_PROCESS_PID.load(Ordering::SeqCst);
    if pid == 0 {
        return false;
    }

    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    sys.process(Pid::from_u32(pid as u32)).is_some()
}

#[command]
pub fn stop_game() -> Result<(), String> {
    let pid = GAME_PROCESS_PID.swap(0, Ordering::SeqCst);
    if pid == 0 {
        return Ok(());
    }
    crate::services::game::run_history::STOP_REQUESTED.store(true, Ordering::SeqCst);

    let pid_u32 = pid as u32;
    let pid_obj = Pid::from_u32(pid_u32);

    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    if let Some(process) = sys.process(pid_obj) {
        let _ = process.kill();
    }

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

// cpu_usage считается между замерами, поэтому System живёт между вызовами
static STATS_SYSTEM: Mutex<Option<(u32, System)>> = Mutex::new(None);

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

fn max_heap_from_cmd(cmd: &[std::ffi::OsString]) -> Option<u64> {
    cmd.iter()
        .filter_map(|arg| arg.to_str()?.strip_prefix("-Xmx"))
        .last()
        .and_then(parse_jvm_size)
}

#[command]
pub fn get_game_process_stats() -> Option<GameProcessStats> {
    let pid = GAME_PROCESS_PID.load(Ordering::SeqCst) as u32;
    let mut guard = STATS_SYSTEM.lock().unwrap_or_else(|e| e.into_inner());
    if pid == 0 {
        *guard = None;
        return None;
    }
    if guard.as_ref().map(|(p, _)| *p) != Some(pid) {
        *guard = Some((pid, System::new()));
    }
    let (_, sys) = guard.as_mut()?;

    let sys_pid = Pid::from_u32(pid);
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[sys_pid]),
        true,
        ProcessRefreshKind::nothing()
            .with_cpu()
            .with_memory()
            .with_cmd(UpdateKind::OnlyIfNotSet),
    );
    sys.refresh_memory();
    let process = sys.process(sys_pid)?;
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f32;

    Some(GameProcessStats {
        pid,
        memory_bytes: process.memory(),
        cpu_percent: (process.cpu_usage() / cores).clamp(0.0, 100.0),
        max_heap_bytes: max_heap_from_cmd(process.cmd()),
        system_total_bytes: sys.total_memory(),
        system_available_bytes: sys.available_memory(),
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
        let cmd = ["java", "-Xms1G", "-Xmx2G", "-Xmx6G"].map(std::ffi::OsString::from);
        assert_eq!(max_heap_from_cmd(&cmd), Some(6 * 1024 * 1024 * 1024));
    }
}
