mod game_provider;
mod java_runtime;
mod ely_auth;
mod ms_auth;
mod commands;
mod discord_rpc;

use game_provider::{
    cancel_download, fetch_all_versions, fetch_forge_versions, fetch_fabric_loaders,
    fetch_neoforge_versions,
    fetch_vanilla_releases, get_game_root_dir, get_installed_fabric_profile_id,
    get_installed_quilt_profile_id, get_profile, get_profiles, get_selected_profile,
    install_fabric, install_forge, install_neoforge, install_quilt, install_version, launch_game,
    list_installed_fabric_game_versions, list_installed_quilt_game_versions, list_installed_versions,
    open_game_folder, open_profile_folder, reset_download_cancel,
    set_profile, set_selected_profile, get_settings, set_settings, get_effective_settings,
    is_game_running_now, stop_game, get_system_memory_gb, delete_item, delete_profile,
    download_modrinth_file, download_modrinth_modpack_and_import, import_mrpack, import_mrpack_as_new_profile,
    import_modpack_files, update_profile_settings, list_profile_items, rename_profile,
    add_profile_files, create_profile, get_java_settings, set_java_settings,
    validate_java_args, detect_java_runtimes, get_profile_java_settings, set_profile_java_settings,
    reset_settings_to_default, get_launcher_cache_size, clear_launcher_cache,
    set_background_image, get_background_data_uri,
    export_launcher_settings_backup, import_launcher_settings_backup,
    get_profile_play_time_seconds,
};
use commands::{list_build_files, preview_export, export_build};
use ely_auth::{
    ely_login_with_password, ely_logout, handle_oauth_callback, refresh_ely_session,
    start_ely_oauth,
};
use ms_auth::{ms_logout, start_ms_oauth};
use discord_rpc::{discord_presence_update, shutdown as discord_presence_shutdown};

#[cfg(target_os = "linux")]
fn configure_wayland_backend() {
    use std::env;
    env::set_var("WINIT_UNIX_BACKEND", "wayland");
    env::set_var("GDK_BACKEND", "wayland");
}

fn load_dotenv() {
    use std::path::Path;
    let repo_env = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env");
    let _ = dotenvy::from_path(repo_env);
    let _ = dotenvy::dotenv();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let _ = dotenvy::from_path(dir.join(".env"));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_dotenv();

    #[cfg(target_os = "linux")]
    configure_wayland_backend();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            discord_presence_update,
            fetch_all_versions,
            fetch_vanilla_releases,
            fetch_fabric_loaders,
            fetch_forge_versions,
            fetch_neoforge_versions,
            install_version,
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
            import_launcher_settings_backup
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_handle, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                discord_presence_shutdown();
            }
        });
}