use tauri::{AppHandle, Emitter};

use crate::models::events::{GameConsoleLinePayload, EVENT_GAME_CONSOLE_LINE};

pub fn log_to_console(app: &AppHandle, line: &str) {
    let payload = GameConsoleLinePayload {
        line: line.to_string(),
        source: "stdout".to_string(),
    };
    let _ = app.emit(EVENT_GAME_CONSOLE_LINE, payload);
}
