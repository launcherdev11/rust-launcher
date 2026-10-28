use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager};

pub const EVENT_WINDOW_IDLE: &str = "window-idle";

static IDLE: AtomicBool = AtomicBool::new(false);

pub fn sync(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let idle = window.is_minimized().unwrap_or(false) || !window.is_visible().unwrap_or(true);
    if IDLE.swap(idle, Ordering::SeqCst) == idle {
        return;
    }

    let _ = app.emit(EVENT_WINDOW_IDLE, idle);

    #[cfg(windows)]
    set_webview_visible(&window, !idle);
}

#[cfg(windows)]
fn set_webview_visible(window: &tauri::WebviewWindow, visible: bool) {
    let _ = window.with_webview(move |webview| unsafe {
        let _ = webview.controller().SetIsVisible(visible);
    });
}
