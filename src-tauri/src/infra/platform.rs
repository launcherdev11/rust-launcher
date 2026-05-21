#[cfg(target_os = "linux")]
pub fn configure_linux_display_backend() {
    use std::env;
    fn set_env_if_missing(key: &str, value: &str) {
        if env::var_os(key).is_none() {
            env::set_var(key, value);
        }
    }

    let xdg_session_type = env::var("XDG_SESSION_TYPE")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let has_wayland = env::var_os("WAYLAND_DISPLAY").is_some() || xdg_session_type == "wayland";
    let has_x11 = env::var_os("DISPLAY").is_some() || xdg_session_type == "x11";

    if env::var_os("WINIT_UNIX_BACKEND").is_none() {
        if has_wayland {
            env::set_var("WINIT_UNIX_BACKEND", "wayland");
        } else if has_x11 {
            env::set_var("WINIT_UNIX_BACKEND", "x11");
        }
    }

    if env::var_os("GDK_BACKEND").is_none() {
        if has_wayland {
            env::set_var("GDK_BACKEND", "wayland,x11");
        } else if has_x11 {
            env::set_var("GDK_BACKEND", "x11,wayland");
        }
    }

    set_env_if_missing("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    let is_appimage = env::var_os("APPIMAGE").is_some() || env::var_os("APPDIR").is_some();
    if is_appimage {
        set_env_if_missing("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");
        set_env_if_missing("WEBKIT_FORCE_SANDBOX", "0");
    }
}

#[cfg(target_os = "windows")]
pub fn configure_windows_webview_memory() {
    use std::env;

    if env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none() {
        env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--renderer-process-limit=2 --process-per-site --js-flags=--max-old-space-size=192 --disk-cache-size=33554432 --media-cache-size=8388608",
        );
    }
}

