#[cfg(target_os = "linux")]
fn set_env_if_missing(key: &str, value: &str) {
    use std::env;
    if env::var_os(key).is_none() {
        env::set_var(key, value);
    }
}

#[cfg(target_os = "linux")]
fn is_appimage() -> bool {
    use std::env;
    env::var_os("APPIMAGE").is_some() || env::var_os("APPDIR").is_some()
}

#[cfg(target_os = "linux")]
fn resolve_appimage_gio_module_dir() -> Option<std::path::PathBuf> {
    use std::env;
    use std::fs;
    use std::path::PathBuf;

    let appdir = PathBuf::from(env::var_os("APPDIR")?);

    const PREFERRED: &[&str] = &[
        "usr/lib/gio/modules",
        "usr/lib64/gio/modules",
        "usr/lib/x86_64-linux-gnu/gio/modules",
        "usr/lib/aarch64-linux-gnu/gio/modules",
        "usr/lib/arm-linux-gnueabihf/gio/modules",
        "lib/gio/modules",
        "lib64/gio/modules",
    ];

    for relative in PREFERRED {
        let candidate = appdir.join(relative);
        if candidate.is_dir() {
            return Some(candidate);
        }
    }

    for lib_root in ["usr/lib", "usr/lib64", "lib", "lib64"] {
        let root = appdir.join(lib_root);
        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let candidate = entry.path().join("gio/modules");
            if candidate.is_dir() {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(target_os = "linux")]
pub fn configure_linux_startup() {
    use std::env;
    use std::path::Path;

    set_env_if_missing("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    let xdg_session_type = env::var("XDG_SESSION_TYPE")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let has_wayland =
        env::var_os("WAYLAND_DISPLAY").is_some() || xdg_session_type == "wayland";
    let has_x11 = env::var_os("DISPLAY").is_some() || xdg_session_type == "x11";
    let has_nvidia = Path::new("/proc/driver/nvidia").exists();

    if env::var_os("GDK_BACKEND").is_none() {
        if has_nvidia && has_wayland {
            set_env_if_missing("__NV_DISABLE_EXPLICIT_SYNC", "1");
            env::set_var("GDK_BACKEND", "x11");
            eprintln!(
                "[16Launcher] NVIDIA + Wayland: GDK_BACKEND=x11 (задайте GDK_BACKEND=wayland для отмены)"
            );
        } else if has_wayland {
            env::set_var("GDK_BACKEND", "wayland,x11");
        } else if has_x11 {
            env::set_var("GDK_BACKEND", "x11,wayland");
        }
    } else if has_nvidia {
        set_env_if_missing("__NV_DISABLE_EXPLICIT_SYNC", "1");
    }

    if env::var_os("WINIT_UNIX_BACKEND").is_none() {
        if has_wayland {
            env::set_var("WINIT_UNIX_BACKEND", "wayland");
        } else if has_x11 {
            env::set_var("WINIT_UNIX_BACKEND", "x11");
        }
    }

    if is_appimage() {
        if env::var_os("GIO_MODULE_DIR").is_none() {
            if let Some(module_dir) = resolve_appimage_gio_module_dir() {
                env::set_var("GIO_MODULE_DIR", module_dir);
            } else {
                set_env_if_missing("GIO_USE_VFS", "local");
                eprintln!(
                    "[16Launcher] AppImage: bundled gio/modules не найден, GIO_USE_VFS=local"
                );
            }
        }

        set_env_if_missing("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");

        set_env_if_missing("GTK_IM_MODULE", "gtk-im-context-simple");

        if env::var_os("GST_PLUGIN_SYSTEM_PATH_1_0").is_none() {
            env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", "");
        }
    }
}

#[cfg(target_os = "linux")]
pub fn configure_linux_display_backend() {
    configure_linux_startup();
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
