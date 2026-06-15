#[cfg(target_os = "linux")]
use std::collections::HashSet;

#[cfg(target_os = "linux")]
use std::sync::Mutex;

#[cfg(target_os = "linux")]
use once_cell::sync::Lazy;

#[cfg(target_os = "linux")]
use tauri::{App, AppHandle, Manager, WebviewWindow};

#[cfg(target_os = "linux")]
static CONFIGURED_WEBVIEWS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

#[cfg(target_os = "linux")]
fn linux_allow_webkit_gpu() -> bool {
    use std::env;

    env::var("MC16LAUNCHER_WEBKIT_GPU")
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized == "1" || normalized == "true" || normalized == "yes"
        })
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
pub fn disable_webview_hardware_acceleration(window: &WebviewWindow) {
    use webkit2gtk::prelude::*;
    use webkit2gtk::HardwareAccelerationPolicy;

    let label = window.label().to_string();
    let result = window.with_webview(|webview| {
        if let Some(settings) = webview.inner().settings() {
            settings.set_hardware_acceleration_policy(HardwareAccelerationPolicy::Never);
            settings.set_enable_webaudio(false);
            settings.set_enable_mediasource(false);
            settings.set_enable_media_stream(false);
            eprintln!(
                "[16Launcher] WebKitGTK: hardware acceleration disabled ({label})"
            );
        }
    });

    if let Err(error) = result {
        eprintln!(
            "[16Launcher] WebKitGTK: failed to disable hardware acceleration for {label}: {error}"
        );
    }
}

#[cfg(target_os = "linux")]
pub fn configure_app_webviews(app: &App) {
    if linux_allow_webkit_gpu() {
        eprintln!("[16Launcher] WebKitGTK: GPU left enabled (MC16LAUNCHER_WEBKIT_GPU=1)");
        return;
    }

    ensure_linux_webview_policies(app.handle());
}

#[cfg(target_os = "linux")]
pub fn ensure_linux_webview_policies(app: &AppHandle) {
    if linux_allow_webkit_gpu() {
        return;
    }

    let mut configured = match CONFIGURED_WEBVIEWS.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    for (label, window) in app.webview_windows() {
        if configured.contains(&label) {
            continue;
        }
        disable_webview_hardware_acceleration(&window);
        configured.insert(label);
    }
}

#[cfg(not(target_os = "linux"))]
pub fn configure_app_webviews(_app: &tauri::App) {}

#[cfg(not(target_os = "linux"))]
pub fn ensure_linux_webview_policies(_app: &tauri::AppHandle) {}
