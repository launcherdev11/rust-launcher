use tauri::Manager;

mod app;
mod commands;
mod infra;
mod java_runtime;
mod mrpack_open;
mod profile_launch;
mod models;
mod services;

use services::background::{get_background_data_uri, set_background_image};
use services::game::{
    add_launcher_account, add_profile_files, cancel_download, check_version_files_integrity,
    clear_launcher_cache, create_build_preset_from_profile, create_profile, delete_build_preset,
    delete_item, delete_profile, detect_java_runtimes, get_build_preset_icon_data_uri,
    list_build_presets, save_build_preset,
    download_modrinth_file, download_modrinth_modpack_and_import, export_launcher_settings_backup,
    default_external_launcher_path, list_importable_instances, import_selected_external_instance,
    fetch_all_versions, fetch_fabric_loaders, fetch_forge_builds_for_game, fetch_forge_versions,
    fetch_neoforge_builds_for_game, fetch_neoforge_versions, fetch_quilt_loaders,
    delete_minecraft_installation, fetch_vanilla_releases, fetch_versions_for_loader,
    get_effective_settings, get_game_root_dir, get_version_install_details,
    get_installed_fabric_profile_id, get_installed_quilt_profile_id, get_java_settings, get_profile,
    get_profile_icon_data_uri, get_profile_java_settings, get_profile_play_time_seconds, get_profiles,
    get_selected_profile,
    get_settings, get_system_memory_gb, get_launcher_cache_size, import_custom_version,
    import_launcher_settings_backup, import_modpack_files, import_mrpack, import_mrpack_as_new_profile,
    install_fabric, install_forge, install_local_version, install_neoforge, install_quilt, install_version,
    is_game_running_now,
    launch_game, list_installed_fabric_game_versions, list_installed_quilt_game_versions,
    list_installed_versions, list_launcher_accounts, list_profile_items,     open_game_folder,
    open_profile_folder, delete_screenshot, get_screenshot_data_uri, get_screenshot_thumbnail,
    list_screenshots, open_screenshot, open_screenshots_folder, remove_launcher_account,
    rename_profile,
    reset_download_cancel,
    reset_settings_to_default, set_java_settings, set_profile, set_profile_item_enabled,
    set_profile_java_settings, set_selected_profile, set_settings, stop_game, switch_launcher_account,
    update_profile_settings,
    validate_java_args,
};
use services::auth::{
    ely_login_with_password, ely_logout, handle_oauth_callback, ms_logout, refresh_ely_session,
    start_ely_oauth, start_ms_oauth,
};
use services::curseforge::{
    curseforge_get_mod_files, curseforge_list_minecraft_versions, curseforge_search_mods,
    download_curseforge_file,
};
use services::modrinth::{
    apply_profile_content_updates, check_profile_content_updates,
    download_modrinth_with_dependencies, resolve_modrinth_required_dependencies,
};
use services::rpc::{discord_presence_update, shutdown as discord_presence_shutdown};
use commands::{export_build, get_ely_avatar, list_build_files, preview_export};
use mrpack_open::take_pending_mrpack_open;
use profile_launch::{
    extract_profile_launch_from_os_args, pending_profile_launch_new, stash_argv_profile_launch_if_any,
    emit_profile_launch_request,
    take_pending_profile_launch,
};
use services::shortcuts::create_profile_desktop_shortcut;

#[tauri::command]
fn get_launcher_logs_file() -> String {
    std::fs::read_to_string("launcher.log")
        .unwrap_or_else(|_| "Логи пусты или файл не найден".to_string())
}

#[tauri::command]
fn get_launcher_logs() -> String {
    std::fs::read_to_string("launcher.log").unwrap_or_else(|_| "Логи пусты".to_string())
}

fn load_dotenv() {
    app::env::load_dotenv_files();
    crate::services::game::runtime::load_project_env_for_runtime();
}

#[cfg(target_os = "linux")]
pub fn linux_startup_init() {
    infra::platform::configure_linux_startup();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_dotenv();

    #[cfg(target_os = "windows")]
    infra::platform::configure_windows_webview_memory();

    let pending_mrpack = mrpack_open::pending_mrpack_new();
    let pending_profile_launch = pending_profile_launch_new();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(pending_mrpack.clone())
        .manage(pending_profile_launch.clone());

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(p) = mrpack_open::extract_mrpack_from_os_args(&args) {
                mrpack_open::emit_mrpack_open_request(&app, p.to_string_lossy().to_string());
            }
            if let Some(profile_id) = extract_profile_launch_from_os_args(&args) {
                emit_profile_launch_request(&app, profile_id);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .setup({
            let pending_mrpack = pending_mrpack.clone();
            let pending_launch = pending_profile_launch.clone();
            move |app| {
                mrpack_open::stash_argv_mrpack_if_any(&pending_mrpack);
                stash_argv_profile_launch_if_any(&pending_launch);
                if let Err(e) = app::paths::ensure_game_data_layout() {
                    eprintln!("[16Launcher] game data migration: {e}");
                }
                infra::window_icon::apply_launcher_icon_to_main_window(app);
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            discord_presence_update,
            fetch_all_versions,
            fetch_versions_for_loader,
            check_version_files_integrity,
            fetch_vanilla_releases,
            fetch_fabric_loaders,
            fetch_quilt_loaders,
            import_custom_version,
            fetch_forge_versions,
            fetch_forge_builds_for_game,
            fetch_neoforge_versions,
            fetch_neoforge_builds_for_game,
            install_version,
            install_local_version,
            install_fabric,
            install_quilt,
            install_forge,
            install_neoforge,
            get_game_root_dir,
            launch_game,
            list_installed_versions,
            get_installed_fabric_profile_id,
            get_installed_quilt_profile_id,
            list_installed_fabric_game_versions,
            list_installed_quilt_game_versions,
            get_version_install_details,
            delete_minecraft_installation,
            open_game_folder,
            open_profile_folder,
            get_profile,
            get_profiles,
            get_profile_icon_data_uri,
            get_profile_play_time_seconds,
            create_profile,
            list_build_presets,
            save_build_preset,
            delete_build_preset,
            create_build_preset_from_profile,
            get_build_preset_icon_data_uri,
            set_profile,
            get_selected_profile,
            set_selected_profile,
            get_settings,
            set_settings,
            get_effective_settings,
            is_game_running_now,
            stop_game,
            get_system_memory_gb,
            start_ely_oauth,
            handle_oauth_callback,
            ely_login_with_password,
            ely_logout,
            refresh_ely_session,
            start_ms_oauth,
            ms_logout,
            cancel_download,
            reset_download_cancel,
            download_modrinth_file,
            download_modrinth_with_dependencies,
            resolve_modrinth_required_dependencies,
            check_profile_content_updates,
            apply_profile_content_updates,
            download_modrinth_modpack_and_import,
            curseforge_search_mods,
            curseforge_get_mod_files,
            curseforge_list_minecraft_versions,
            download_curseforge_file,
            import_mrpack,
            import_mrpack_as_new_profile,
            default_external_launcher_path,
            list_importable_instances,
            import_selected_external_instance,
            update_profile_settings,
            delete_item,
            list_profile_items,
            set_profile_item_enabled,
            rename_profile,
            add_profile_files,
            import_modpack_files,
            delete_profile,
            get_java_settings,
            set_java_settings,
            get_profile_java_settings,
            set_profile_java_settings,
            validate_java_args,
            detect_java_runtimes,
            list_build_files,
            preview_export,
            export_build,
            reset_settings_to_default,
            get_launcher_cache_size,
            clear_launcher_cache,
            set_background_image,
            get_background_data_uri,
            export_launcher_settings_backup,
            import_launcher_settings_backup,
            list_launcher_accounts,
            switch_launcher_account,
            remove_launcher_account,
            add_launcher_account,
            get_ely_avatar,
            take_pending_mrpack_open,
            take_pending_profile_launch,
            create_profile_desktop_shortcut,
            get_launcher_logs_file,
            list_screenshots,
            get_screenshot_data_uri,
            get_screenshot_thumbnail,
            delete_screenshot,
            open_screenshots_folder,
            open_screenshot,
            get_launcher_logs
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = &event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if mrpack_open::is_mrpack_path(&path) {
                            if let Some(pending) = app_handle.try_state::<mrpack_open::PendingMrpackArc>()
                            {
                                mrpack_open::stash_mrpack_path(&pending, &path);
                            }
                            mrpack_open::emit_mrpack_open_request(
                                &app_handle,
                                path.to_string_lossy().to_string(),
                            );
                        }
                    }
                }
            }

            match event {
                tauri::RunEvent::WindowEvent { label, event, .. } => {
                    if label == "main" && matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                        discord_presence_shutdown();
                        app_handle.exit(0);
                    }
                }
                tauri::RunEvent::Exit => {
                    discord_presence_shutdown();
                }
                _ => {}
            }
        });
}
// bebe