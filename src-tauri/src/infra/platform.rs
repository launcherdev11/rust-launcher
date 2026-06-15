#[cfg(target_os = "linux")]

fn set_env_if_missing(key: &str, value: &str) {

    use std::env;

    if env::var_os(key).is_none() {

        env::set_var(key, value);

    }

}



#[cfg(target_os = "linux")]

fn prepend_path_list_env(key: &str, prepend: &[std::path::PathBuf]) {

    use std::env;

    use std::ffi::OsString;

    use std::path::PathBuf;



    if prepend.is_empty() {

        return;

    }



    let mut parts: Vec<OsString> = prepend.iter().map(|p| p.as_os_str().to_os_string()).collect();

    if let Ok(existing) = env::var(key) {

        parts.extend(

            existing

                .split(':')

                .filter(|segment| !segment.is_empty())

                .map(OsString::from),

        );

    }



    let merged = parts

        .iter()

        .map(|p| p.to_string_lossy())

        .collect::<Vec<_>>()

        .join(":");

    env::set_var(key, merged);

}



#[cfg(target_os = "linux")]

fn is_appimage() -> bool {

    use std::env;

    env::var_os("APPIMAGE").is_some() || env::var_os("APPDIR").is_some()

}



#[cfg(target_os = "linux")]

fn appimage_root() -> Option<std::path::PathBuf> {

    use std::env;

    use std::path::PathBuf;

    if let Some(appdir) = env::var_os("APPDIR") {

        return Some(PathBuf::from(appdir));

    }

    if let Some(appimage) = env::var_os("APPIMAGE") {

        let path = PathBuf::from(appimage);

        return path.parent().map(|p| p.to_path_buf());

    }

    None

}



#[cfg(target_os = "linux")]

fn resolve_appimage_gio_module_dir() -> Option<std::path::PathBuf> {

    use std::fs;

    use std::path::PathBuf;



    let appdir = appimage_root()?;



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

fn resolve_appimage_lib_dirs() -> Vec<std::path::PathBuf> {

    use std::path::PathBuf;



    let appdir = match appimage_root() {

        Some(dir) => dir,

        None => return Vec::new(),

    };



    let mut dirs = Vec::new();

    let mut push_dir = |relative: &str| {

        let candidate = appdir.join(relative);

        if candidate.is_dir() {

            dirs.push(candidate);

        }

    };



    push_dir("usr/lib");

    push_dir("usr/lib64");

    push_dir("usr/lib/x86_64-linux-gnu");

    push_dir("usr/lib/aarch64-linux-gnu");

    push_dir("usr/lib/arm-linux-gnueabihf");

    push_dir("lib");

    push_dir("lib64");



    dirs.sort();

    dirs.dedup();

    dirs

}



#[cfg(target_os = "linux")]

fn resolve_appimage_gstreamer_plugin_dir() -> Option<std::path::PathBuf> {

    use std::path::PathBuf;



    let appdir = appimage_root()?;



    const PREFERRED: &[&str] = &[

        "usr/lib/x86_64-linux-gnu/gstreamer-1.0",

        "usr/lib/aarch64-linux-gnu/gstreamer-1.0",

        "usr/lib/gstreamer-1.0",

        "usr/lib64/gstreamer-1.0",

        "lib/gstreamer-1.0",

    ];



    for relative in PREFERRED {

        let candidate = appdir.join(relative);

        if candidate.is_dir() {

            return Some(candidate);

        }

    }



    None

}



#[cfg(target_os = "linux")]

fn configure_appimage_runtime() {

    use std::env;



    let lib_dirs = resolve_appimage_lib_dirs();

    prepend_path_list_env("LD_LIBRARY_PATH", &lib_dirs);



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



    if let Some(gst_plugins) = resolve_appimage_gstreamer_plugin_dir() {

        env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", &gst_plugins);

    }

    configure_webkit_stability();

    set_env_if_missing("GTK_IM_MODULE", "gtk-im-context-simple");

}



#[cfg(target_os = "linux")]

fn has_amd_gpu() -> bool {

    use std::fs;

    use std::path::Path;



    let drm = Path::new("/sys/class/drm");

    let entries = match fs::read_dir(drm) {

        Ok(entries) => entries,

        Err(_) => return false,

    };



    for entry in entries.flatten() {

        let vendor_path = entry.path().join("device/vendor");

        if let Ok(vendor) = fs::read_to_string(vendor_path) {

            let normalized = vendor.trim().to_ascii_lowercase();

            if normalized == "0x1002" || normalized == "0x1022" {

                return true;

            }

        }

    }



    false

}



#[cfg(target_os = "linux")]

fn linux_allow_native_wayland() -> bool {

    use std::env;



    env::var("MC16LAUNCHER_ALLOW_WAYLAND")

        .map(|value| {

            let normalized = value.trim().to_ascii_lowercase();

            normalized == "1" || normalized == "true" || normalized == "yes"

        })

        .unwrap_or(false)

}



fn configure_webkit_stability() {

    use std::env;



    // WebKitGTK on Wayland/Hyprland often aborts in the GPU compositor path (DMA-BUF / gallium).

    // Always set these: Hyprland sessions often pre-export conflicting values.

    env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");

    env::set_var("WEBKIT_USE_SINGLE_WEB_PROCESS", "1");

    env::set_var("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1");

}



#[cfg(target_os = "linux")]

pub fn configure_linux_startup() {

    use std::env;

    use std::path::Path;



    configure_webkit_stability();



    let xdg_session_type = env::var("XDG_SESSION_TYPE")

        .unwrap_or_default()

        .to_ascii_lowercase();

    let has_wayland =

        env::var_os("WAYLAND_DISPLAY").is_some() || xdg_session_type == "wayland";

    let has_x11 = env::var_os("DISPLAY").is_some() || xdg_session_type == "x11";

    let has_nvidia = Path::new("/proc/driver/nvidia").exists();

    let has_amd = has_amd_gpu();

    let prefer_x11_for_webview =

        has_wayland && (has_nvidia || has_amd) && !linux_allow_native_wayland();



    if prefer_x11_for_webview {

        if has_nvidia {

            set_env_if_missing("__NV_DISABLE_EXPLICIT_SYNC", "1");

        }

        env::set_var("GDK_BACKEND", "x11");

        env::set_var("WINIT_UNIX_BACKEND", "x11");

        eprintln!(

            "[16Launcher] Wayland + {}: GDK_BACKEND=x11 (MC16LAUNCHER_ALLOW_WAYLAND=1 для нативного Wayland)",

            if has_nvidia { "NVIDIA" } else { "AMD" }

        );

    } else if env::var_os("GDK_BACKEND").is_none() {

        if has_wayland {

            env::set_var("GDK_BACKEND", "x11,wayland");

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

        configure_appimage_runtime();

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


