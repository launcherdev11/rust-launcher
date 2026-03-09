mod game_provider;
mod java_runtime;
mod ely_auth;
mod ms_auth;

#[allow(unused_imports)]
use tauri_plugin_updater::UpdaterExt;

use game_provider::{
    cancel_download, fetch_all_versions, fetch_forge_versions, fetch_fabric_loaders,
    fetch_vanilla_releases, get_game_root_dir, get_installed_fabric_profile_id,
    get_installed_quilt_profile_id, get_profile, get_profiles, get_selected_profile,
    install_fabric, install_forge, install_quilt, install_version, launch_game,
    list_installed_versions, open_game_folder, reset_download_cancel, save_avatar,
    set_profile, set_selected_profile, get_settings, set_settings, get_effective_settings,
    is_game_running_now, get_system_memory_gb, delete_item, delete_profile,
    download_modrinth_file, import_mrpack, import_mrpack_as_new_profile,
    import_modpack_files, update_profile_settings, list_profile_items, rename_profile,
    add_profile_files, create_profile, get_java_settings, set_java_settings,
    validate_java_args, detect_java_runtimes,
};
use ely_auth::{
    ely_login_with_password, ely_logout, handle_oauth_callback, refresh_ely_session,
    start_ely_oauth,
};
use ms_auth::{ms_logout, start_ms_oauth};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Временно отключаем плагин updater, так как он требует настройки ключей в tauri.conf.json
        // .plugin(tauri_plugin_updater::Builder::new().build()) 
        .setup(|app| {
            // Логика проверки обновлений временно отключена для успешного запуска в dev-режиме
            /*
            let handle = app.handle();
            let settings = game_provider::load_settings_from_disk();
            if settings.check_updates_on_start {
                tauri::async_runtime::block_on(async {
                    if let Ok(updater) = handle.updater_builder().build() {
                        let _ = updater.check().await;
                    }
                });
            }
            */
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_all_versions,
            fetch_vanilla_releases,
            fetch_fabric_loaders,
            fetch_forge_versions,
            install_version,
            install_fabric,
            install_quilt,
            install_forge,
            get_game_root_dir,
            launch_game,
            list_installed_versions,
            get_installed_fabric_profile_id,
            get_installed_quilt_profile_id,
            open_game_folder,
            get_profile,
            get_profiles,
            create_profile,
            set_profile,
            set_selected_profile,
            save_avatar,
            get_settings,
            set_settings,
            get_effective_settings,
            is_game_running_now,
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
            import_mrpack,
            import_mrpack_as_new_profile,
            update_profile_settings,
            delete_item,
            list_profile_items,
            rename_profile,
            add_profile_files,
            import_modpack_files,
            delete_profile,
            get_java_settings,
            set_java_settings,
            validate_java_args,
            detect_java_runtimes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}