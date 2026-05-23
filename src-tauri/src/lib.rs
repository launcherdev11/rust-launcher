use tauri::Manager;

mod mrpack_open;
mod java_runtime;
mod commands;

mod app;
mod infra;
mod models;
mod services;

use services::background::{get_background_data_uri, set_background_image};
use services::game::{
    add_launcher_account, add_profile_files, cancel_download, check_version_files_integrity,
    clear_launcher_cache, create_profile, delete_item, delete_profile, detect_java_runtimes,
    download_modrinth_file, download_modrinth_modpack_and_import, export_launcher_settings_backup,
    fetch_all_versions, fetch_fabric_loaders, fetch_forge_builds_for_game, fetch_forge_versions,
    fetch_neoforge_builds_for_game, fetch_neoforge_versions, fetch_quilt_loaders,
    fetch_vanilla_releases, fetch_versions_for_loader, get_effective_settings, get_game_root_dir,
    get_installed_fabric_profile_id, get_installed_quilt_profile_id, get_java_settings, get_profile,
    get_profile_java_settings, get_profile_play_time_seconds, get_profiles, get_selected_profile,
    get_settings, get_system_memory_gb, get_launcher_cache_size, import_custom_version,
    import_launcher_settings_backup, import_modpack_files, import_mrpack, import_mrpack_as_new_profile,
    install_fabric, install_forge, install_local_version, install_neoforge, install_quilt, install_version,
    is_game_running_now,
    launch_game, list_installed_fabric_game_versions, list_installed_quilt_game_versions,
    list_installed_versions, list_launcher_accounts, list_profile_items, open_game_folder,
    open_profile_folder, remove_launcher_account, rename_profile, reset_download_cancel,
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
use services::rpc::{discord_presence_update, shutdown as discord_presence_shutdown};
use commands::{export_build, get_ely_avatar, list_build_files, preview_export};
use mrpack_open::take_pending_mrpack_open;

fn load_dotenv() {
    app::env::load_dotenv_files();
    crate::services::game::runtime::load_project_env_for_runtime();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_dotenv();

    #[cfg(target_os = "linux")]
    infra::platform::configure_linux_display_backend();
    #[cfg(target_os = "windows")]
    infra::platform::configure_windows_webview_memory();

    let pending_mrpack = mrpack_open::pending_mrpack_new();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(pending_mrpack.clone());

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(p) = mrpack_open::extract_mrpack_from_os_args(&args) {
                mrpack_open::emit_mrpack_open_request(&app, p.to_string_lossy().to_string());
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .setup({
            let pending = pending_mrpack.clone();
            move |_app| {
                mrpack_open::stash_argv_mrpack_if_any(&pending);
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
            open_game_folder,
            open_profile_folder,
            get_profile,
            get_profiles,
            get_profile_play_time_seconds,
            create_profile,
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
            download_modrinth_modpack_and_import,
            curseforge_search_mods,
            curseforge_get_mod_files,
            curseforge_list_minecraft_versions,
            download_curseforge_file,
            import_mrpack,
            import_mrpack_as_new_profile,
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
            take_pending_mrpack_open
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
