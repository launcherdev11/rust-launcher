#[cfg(target_os = "windows")]
pub(crate) fn apply_windows_graphics_preference(
    cmd: &mut std::process::Command,
    java_path: &std::path::Path,
    adapter: Option<&str>,
) {
    let Some(adapter) = adapter.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    let lower = adapter.to_lowercase();
    let integrated = lower.contains("integrated")
        || lower.contains("uhd")
        || lower.contains("iris")
        || lower.contains("vega")
        || lower.contains("radeon graphics");
    let preference = if integrated { "1" } else { "2" };
    let path = java_path.to_string_lossy().replace('\\', "\\\\");
    let key = "HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences";
    let escaped_path = path.replace('\'', "''");
    let command = format!("New-Item -Path '{key}' -Force | Out-Null; Set-ItemProperty -Path '{key}' -Name '{escaped_path}' -Value 'GpuPreference={preference};' -Type String");
    let mut ps = std::process::Command::new("powershell");
    ps.args(["-NoProfile", "-NonInteractive", "-Command", &command]);
    crate::infra::process::hide_console(&mut ps);
    let _ = ps.status();
    cmd.env("MC16_SELECTED_GRAPHICS_ADAPTER", adapter);
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
