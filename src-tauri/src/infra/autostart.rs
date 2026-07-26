use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

pub fn sync_autostart_from_settings(app: &AppHandle, enabled: bool) {
    let manager = app.autolaunch();
    let current = manager.is_enabled().unwrap_or(false);
    if current == enabled {
        return;
    }

    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };

    if let Err(e) = result {
        eprintln!("[16Launcher] autostart sync failed: {e}");
    }
}
