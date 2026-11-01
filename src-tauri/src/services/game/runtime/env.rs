#[cfg(target_os = "windows")]
pub(crate) fn apply_windows_graphics_preference(
    cmd: &mut std::process::Command,
    java_path: &std::path::Path,
    adapter: Option<&str>,
) {
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_QUERY_VALUE, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    const KEY: &str = "Software\\Microsoft\\DirectX\\UserGpuPreferences";
    let value_name = HSTRING::from(java_path.as_os_str());

    let preference = match adapter.map(str::trim).filter(|value| !value.is_empty()) {
        Some(adapter) => {
            let lower = adapter.to_lowercase();
            let integrated = lower.contains("integrated")
                || lower.contains("uhd")
                || lower.contains("iris")
                || lower.contains("vega")
                || lower.contains("radeon graphics");
            cmd.env("MC16_SELECTED_GRAPHICS_ADAPTER", adapter);
            Some(if integrated { "1" } else { "2" })
        }
        None => None,
    };

    let mut key = HKEY::default();
    let opened = unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &HSTRING::from(KEY),
            None,
            None,
            REG_OPTION_NON_VOLATILE,
            KEY_QUERY_VALUE | KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
    };
    if opened.is_err() {
        return;
    }

    let exists = || unsafe { RegQueryValueExW(key, &value_name, None, None, None, None) }.is_ok();
    // без явного выбора не трогаем то, что пользователь задал в настройках Windows
    let preference = match preference {
        Some(p) => Some(p),
        None if exists() => None,
        None => Some("2"),
    };

    if let Some(preference) = preference {
        let data: Vec<u8> = format!("GpuPreference={preference};")
            .encode_utf16()
            .chain(std::iter::once(0))
            .flat_map(u16::to_le_bytes)
            .collect();
        let _ = unsafe { RegSetValueExW(key, &value_name, None, REG_SZ, Some(&data)) };
    }
    let _ = unsafe { RegCloseKey(key) };
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
