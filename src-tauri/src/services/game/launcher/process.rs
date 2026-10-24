use std::sync::atomic::Ordering;

use sysinfo::{ProcessesToUpdate, Pid, System};
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

    let pid_u32 = pid as u32;
    let pid_obj = Pid::from_u32(pid_u32);

    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    if let Some(process) = sys.process(pid_obj) {
        let _ = process.kill();
    }

    Ok(())
}

#[command]
pub fn cancel_download() {
    CANCEL_DOWNLOAD.store(true, Ordering::SeqCst);
}

#[command]
pub fn reset_download_cancel() {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
}
