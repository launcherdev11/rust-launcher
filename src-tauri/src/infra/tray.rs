use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager,
};

use crate::services::game::settings::load_settings_from_disk;
use crate::services::rpc::shutdown as discord_presence_shutdown;

const TRAY_ID: &str = "main";

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
    Menu::with_items(app, &[&show_i, &quit_i])
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
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
            _ => {}
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
