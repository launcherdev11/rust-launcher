use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};

use crate::profile_launch::emit_profile_launch_request;
use crate::services::game::settings::load_settings_from_disk;
use crate::services::rpc::shutdown as discord_presence_shutdown;

const TRAY_ID: &str = "main";
const PROFILE_ITEM_PREFIX: &str = "profile:";

pub const TRAY_MENU_LABEL: &str = "tray-menu";
const TRAY_MENU_OPEN_EVENT: &str = "tray-menu-open";
const TRAY_MENU_REFRESH_EVENT: &str = "tray-menu-refresh";

const USE_NATIVE_MENU: bool = cfg!(target_os = "linux");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayProfile {
    pub profile_id: String,
    pub name: String,
    #[serde(default)]
    pub game_version: String,
    #[serde(default)]
    pub loader: String,
}

#[derive(Default)]
struct TrayProfiles {
    title: String,
    profiles: Vec<TrayProfile>,
}

static TRAY_PROFILES: Mutex<TrayProfiles> = Mutex::new(TrayProfiles {
    title: String::new(),
    profiles: Vec::new(),
});

static TRAY_MENU_ANCHOR: Mutex<Option<(f64, f64)>> = Mutex::new(None);

static TRAY_MENU_HIDDEN_AT: Mutex<Option<Instant>> = Mutex::new(None);

fn menu_labels(lang: &str) -> (&'static str, &'static str) {
    match lang {
        "en" => ("Show", "Quit"),
        "de" => ("Anzeigen", "Beenden"),
        "es" => ("Mostrar", "Salir"),
        _ => ("Показать", "Выход"),
    }
}

fn build_tray_menu(app: &AppHandle, lang: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let (show_label, quit_label) = menu_labels(lang);
    let show_i = MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;

    let mut profile_items: Vec<MenuItem<tauri::Wry>> = Vec::new();
    let mut header = None;
    {
        let state = TRAY_PROFILES.lock().unwrap_or_else(|e| e.into_inner());
        if !state.profiles.is_empty() {
            header = Some(MenuItem::with_id(app, "profiles-header", &state.title, false, None::<&str>)?);
            for profile in &state.profiles {
                profile_items.push(MenuItem::with_id(
                    app,
                    format!("{PROFILE_ITEM_PREFIX}{}", profile.profile_id),
                    &profile.name,
                    true,
                    None::<&str>,
                )?);
            }
        }
    }
    let separator = PredefinedMenuItem::separator(app)?;

    let mut items: Vec<&dyn IsMenuItem<tauri::Wry>> = Vec::new();
    if let Some(header) = &header {
        items.push(header);
        for item in &profile_items {
            items.push(item);
        }
        items.push(&separator);
    }
    items.push(&show_i);
    items.push(&quit_i);
    Menu::with_items(app, &items)
}

#[tauri::command]
pub fn update_tray_profiles(app: AppHandle, title: String, profiles: Vec<TrayProfile>) {
    {
        let mut state = TRAY_PROFILES.lock().unwrap_or_else(|e| e.into_inner());
        state.title = title;
        state.profiles = profiles;
    }
    if !USE_NATIVE_MENU {
        let _ = app.emit_to(TRAY_MENU_LABEL, TRAY_MENU_REFRESH_EVENT, ());
        return;
    }
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let lang = load_settings_from_disk().interface_language;
    if let Ok(menu) = build_tray_menu(&app, &lang) {
        let _ = tray.set_menu(Some(menu));
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayMenuState {
    title: String,
    profiles: Vec<TrayProfile>,
    language: String,
}

#[tauri::command]
pub fn tray_menu_state() -> TrayMenuState {
    let state = TRAY_PROFILES.lock().unwrap_or_else(|e| e.into_inner());
    TrayMenuState {
        title: state.title.clone(),
        profiles: state.profiles.clone(),
        language: load_settings_from_disk().interface_language,
    }
}

#[tauri::command]
pub fn tray_menu_fit(app: AppHandle, width: f64, height: f64, show: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window(TRAY_MENU_LABEL) else {
        return Ok(());
    };
    if !show && !window.is_visible().unwrap_or(false) {
        return Ok(());
    }
    let Some((ax, ay)) = *TRAY_MENU_ANCHOR.lock().unwrap_or_else(|e| e.into_inner()) else {
        return Ok(());
    };

    let monitor = app
        .monitor_from_point(ax, ay)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());
    let scale = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let w = (width * scale).round().max(1.0);
    let h = (height * scale).round().max(1.0);

    let mut x = ax - w;
    let mut y = ay - h;
    if let Some(monitor) = &monitor {
        let area = monitor.work_area();
        let left = area.position.x as f64;
        let top = area.position.y as f64;
        let right = left + area.size.width as f64;
        let bottom = top + area.size.height as f64;
        if x < left {
            x = ax;
        }
        if y < top {
            y = ay;
        }
        x = x.min(right - w).max(left);
        y = y.min(bottom - h).max(top);
    }

    window
        .set_size(PhysicalSize::new(w as u32, h as u32))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
        .map_err(|e| e.to_string())?;
    if show {
        let _ = window.show();
        let _ = window.set_focus();
    }
    Ok(())
}

fn hide_tray_menu(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(TRAY_MENU_LABEL) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
            *TRAY_MENU_HIDDEN_AT.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
        }
    }
}

#[tauri::command]
pub fn tray_menu_action(app: AppHandle, action: String, profile_id: Option<String>) {
    hide_tray_menu(&app);
    match action.as_str() {
        "launch" => {
            if let Some(profile_id) = profile_id.filter(|id| !id.is_empty()) {
                emit_profile_launch_request(&app, profile_id);
                show_main_window(&app);
            }
        }
        "show" => show_main_window(&app),
        "quit" => {
            discord_presence_shutdown();
            app.exit(0);
        }
        _ => {}
    }
}

fn open_tray_menu(app: &AppHandle, position: PhysicalPosition<f64>) {
    let recently_hidden = TRAY_MENU_HIDDEN_AT
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some_and(|at| at.elapsed() < Duration::from_millis(250));
    if recently_hidden {
        return;
    }
    *TRAY_MENU_ANCHOR.lock().unwrap_or_else(|e| e.into_inner()) = Some((position.x, position.y));

    if let Some(window) = app.get_webview_window(TRAY_MENU_LABEL) {
        if window.is_visible().unwrap_or(false) {
            hide_tray_menu(app);
        } else {
            let _ = app.emit_to(TRAY_MENU_LABEL, TRAY_MENU_OPEN_EVENT, ());
        }
        return;
    }

    let builder = WebviewWindowBuilder::new(app, TRAY_MENU_LABEL, WebviewUrl::App("index.html".into()))
        .title("16Launcher")
        .inner_size(304.0, 360.0)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .focused(true);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);

    match builder.build() {
        Ok(window) => {
            let handle = app.clone();
            window.on_window_event(move |event| match event {
                WindowEvent::Focused(false) => hide_tray_menu(&handle),
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    hide_tray_menu(&handle);
                }
                _ => {}
            });
        }
        Err(e) => eprintln!("[16Launcher] tray menu window: {e}"),
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        crate::infra::window_idle::sync(app);
    }
}

pub fn setup_tray(app: &App) -> tauri::Result<()> {
    let settings = load_settings_from_disk();

    let Some(icon) = app.default_window_icon().cloned() else {
        eprintln!("[16Launcher] tray: default window icon missing");
        return Ok(());
    };

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .show_menu_on_left_click(false)
        .tooltip("16Launcher")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                discord_presence_shutdown();
                app.exit(0);
            }
            id => {
                if let Some(profile_id) = id.strip_prefix(PROFILE_ITEM_PREFIX) {
                    emit_profile_launch_request(app, profile_id.to_string());
                    show_main_window(app);
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state: MouseButtonState::Up,
                position,
                ..
            } = event
            {
                match button {
                    MouseButton::Left => {
                        hide_tray_menu(tray.app_handle());
                        show_main_window(tray.app_handle());
                    }
                    MouseButton::Right if !USE_NATIVE_MENU => {
                        open_tray_menu(tray.app_handle(), position);
                    }
                    _ => {}
                }
            }
        });
    if USE_NATIVE_MENU {
        let menu = build_tray_menu(app.handle(), &settings.interface_language)?;
        builder = builder.menu(&menu);
    }
    let tray = builder.build(app)?;

    let _ = tray.set_visible(settings.minimize_to_tray_on_close);
    Ok(())
}

pub fn sync_tray_from_settings(app: &AppHandle, minimize_to_tray: bool, lang: &str) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };

    if USE_NATIVE_MENU {
        if let Ok(menu) = build_tray_menu(app, lang) {
            let _ = tray.set_menu(Some(menu));
        }
    } else {
        let _ = app.emit_to(TRAY_MENU_LABEL, TRAY_MENU_REFRESH_EVENT, ());
    }

    let _ = tray.set_visible(minimize_to_tray);
    if !minimize_to_tray {
        hide_tray_menu(app);
        show_main_window(app);
    }
}
