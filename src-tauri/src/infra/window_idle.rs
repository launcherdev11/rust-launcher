use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager};

use crate::services::game::state::GAME_PROCESS_PID;

pub const EVENT_WINDOW_IDLE: &str = "window-idle";

static IDLE: AtomicBool = AtomicBool::new(false);
static HIDDEN: AtomicBool = AtomicBool::new(false);

pub fn sync(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let hidden = window.is_minimized().unwrap_or(false) || !window.is_visible().unwrap_or(true);
    let game_running = GAME_PROCESS_PID.load(Ordering::SeqCst) != 0;
    let idle = hidden || (game_running && !window.is_focused().unwrap_or(false));

    if IDLE.swap(idle, Ordering::SeqCst) != idle {
        let _ = app.emit(EVENT_WINDOW_IDLE, idle);
    }

    if HIDDEN.swap(hidden, Ordering::SeqCst) != hidden {
        #[cfg(windows)]
        set_webview_visible(&window, !hidden);
    }
}

#[cfg(windows)]
fn set_webview_visible(window: &tauri::WebviewWindow, visible: bool) {
    let _ = window.with_webview(move |webview| unsafe {
        let _ = webview.controller().SetIsVisible(visible);
    });
}
