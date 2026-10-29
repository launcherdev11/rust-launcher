#[cfg(target_os = "windows")]
pub(crate) fn apply_windows_graphics_preference(
    cmd: &mut std::process::Command,
    java_path: &std::path::Path,
    adapter: Option<&str>,
) {
    const KEY: &str = "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences";
    let value_name = java_path.to_string_lossy().to_string();

    let reg = |args: &[&str]| -> bool {
        let mut c = std::process::Command::new("reg");
        c.args(args)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        crate::infra::process::hide_console(&mut c);
        c.status().is_ok_and(|s| s.success())
    };

    let preference = match adapter.map(str::trim).filter(|value| !value.is_empty()) {
        Some(adapter) => {
            let lower = adapter.to_lowercase();
            let integrated = lower.contains("integrated")
                || lower.contains("uhd")
                || lower.contains("iris")
                || lower.contains("vega")
                || lower.contains("radeon graphics");
            cmd.env("MC16_SELECTED_GRAPHICS_ADAPTER", adapter);
            if integrated { "1" } else { "2" }
        }
        None => {
            if reg(&["query", KEY, "/v", &value_name]) {
                return;
            }
            "2"
        }
    };

    let data = format!("GpuPreference={preference};");
    reg(&["add", KEY, "/v", &value_name, "/t", "REG_SZ", "/d", &data, "/f"]);
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn apply_windows_graphics_preference(
    _cmd: &mut std::process::Command,
    _java_path: &std::path::Path,
    _adapter: Option<&str>,
) {
}


#[cfg(target_os = "linux")]
use std::env;

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
