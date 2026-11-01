use std::path::{Path, PathBuf};

use tauri::{App, Manager};

pub fn launcher_icon_file_path(exe: &Path) -> Option<PathBuf> {
    let parent = exe.parent()?;
    let candidates = [
        parent.join("icons/icon.ico"),
        parent.join("resources/icons/icon.ico"),
        parent.join("../icons/icon.ico"),
        parent.join("../../src-tauri/icons/icon.ico"),
        parent.join("../../../src-tauri/icons/icon.ico"),
    ];
    for path in candidates {
        if path.is_file() {
            return path.canonicalize().ok().or(Some(path));
        }
    }
    None
}

pub fn apply_launcher_icon_to_main_window(app: &App) {
    let Some(icon) = app.default_window_icon().cloned() else {
        return;
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_icon(icon);
    }
}
