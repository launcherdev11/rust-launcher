use std::sync::Mutex;

use serde::Deserialize;
use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager,
};

use crate::profile_launch::emit_profile_launch_request;
use crate::services::game::settings::load_settings_from_disk;
use crate::services::rpc::shutdown as discord_presence_shutdown;

const TRAY_ID: &str = "main";
const PROFILE_ITEM_PREFIX: &str = "profile:";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayProfile {
    pub profile_id: String,
    pub name: String,
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
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let lang = load_settings_from_disk().interface_language;
    if let Ok(menu) = build_tray_menu(&app, &lang) {
        let _ = tray.set_menu(Some(menu));
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
    let menu = build_tray_menu(app.handle(), &settings.interface_language)?;

    let Some(icon) = app.default_window_icon().cloned() else {
        eprintln!("[16Launcher] tray: default window icon missing");
        return Ok(());
    };

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
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
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    let _ = tray.set_visible(settings.minimize_to_tray_on_close);
    Ok(())
}

pub fn sync_tray_from_settings(app: &AppHandle, minimize_to_tray: bool, lang: &str) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };

    if let Ok(menu) = build_tray_menu(app, lang) {
        let _ = tray.set_menu(Some(menu));
    }

    let _ = tray.set_visible(minimize_to_tray);

    if !minimize_to_tray {
        show_main_window(app);
    }
}
