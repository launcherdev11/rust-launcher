use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::env;
pub fn load_project_env_for_runtime() {
    static ENV_LOADED: OnceLock<()> = OnceLock::new();
    let _ = ENV_LOADED.get_or_init(|| {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let candidate_paths = [
            manifest_dir.join(".env"),
            manifest_dir.join("../.env"),
            PathBuf::from(".env"),
        ];
        for path in candidate_paths {
            if path.exists() {
                let _ = dotenvy::from_path(path);
            }
        }
    });
}

#[cfg(not(target_os = "linux"))]
#[allow(dead_code)]
pub(crate) fn apply_linux_display_env(_cmd: &mut std::process::Command) {}

#[cfg(target_os = "linux")]
pub(crate) fn apply_linux_display_env(cmd: &mut std::process::Command) {
    let xdg_session_type = env::var("XDG_SESSION_TYPE")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let has_wayland = env::var_os("WAYLAND_DISPLAY").is_some() || xdg_session_type == "wayland";

    if has_wayland {
        if env::var_os("WINIT_UNIX_BACKEND").is_none() {
            cmd.env("WINIT_UNIX_BACKEND", "wayland");
        }
        if env::var_os("GDK_BACKEND").is_none() {
            cmd.env("GDK_BACKEND", "wayland,x11");
        }
    }

    if env::var_os("_JAVA_AWT_WM_NONREPARENTING").is_none() {
        cmd.env("_JAVA_AWT_WM_NONREPARENTING", "1");
    }
}
