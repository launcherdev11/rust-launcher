use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

fn main_window_in_background(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return true;
    };
    let hidden = !window.is_visible().unwrap_or(true);
    let minimized = window.is_minimized().unwrap_or(false);
    hidden || minimized
}

#[tauri::command]
pub fn os_notify(app: AppHandle, title: String, body: Option<String>) {
    if !main_window_in_background(&app) {
        return;
    }

    let mut builder = app.notification().builder().title(title);
    if let Some(body) = body.filter(|b| !b.is_empty()) {
        builder = builder.body(body);
    }
    if let Err(e) = builder.show() {
        eprintln!("[16Launcher] os notification failed: {e}");
    }
}
