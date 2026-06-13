use std::sync::atomic::Ordering;

use sysinfo::{ProcessesToUpdate, Pid, System};
use tauri::command;

use crate::services::game::state::{CANCEL_DOWNLOAD, GAME_PROCESS_PID};

pub(crate) fn is_minecraft_java_process_running() -> bool {
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    for (_pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        if !(name.contains("javaw.exe")
            || name == "javaw"
            || name == "javaw.exe"
            || name.contains("java.exe")
            || name == "java"
            || name == "java.exe")
        {
            continue;
        }

        let cmd = process
            .cmd()
            .iter()
            .map(|s| s.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase();

        let looks_like_client_launch = cmd.contains("net.minecraft.client.main.main")
            || cmd.contains("--gamedir")
            || cmd.contains("cpw.mods.bootstraplauncher")
            || cmd.contains("fabric-loader")
            || cmd.contains("org.quiltmc.loader")
            || cmd.contains("minecraft.client.main")
            || (cmd.contains("main")
                && cmd.contains("minecraft")
                && (cmd.contains("natives") || cmd.contains("--accessToken")));

        if looks_like_client_launch {
            return true;
        }
    }
    false
}

#[command]
pub fn is_game_running_now() -> Result<bool, String> {
    let pid = GAME_PROCESS_PID.load(Ordering::SeqCst);
    if pid != 0 {
        let mut sys = System::new_all();
        sys.refresh_processes(ProcessesToUpdate::All, true);

        let pid_u32 = pid as u32;
        let pid_obj = Pid::from_u32(pid_u32);
        if sys.process(pid_obj).is_some() {
            return Ok(true);
        }

        GAME_PROCESS_PID.store(0, Ordering::SeqCst);
        return Ok(false);
    }

    Ok(is_minecraft_java_process_running())
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
