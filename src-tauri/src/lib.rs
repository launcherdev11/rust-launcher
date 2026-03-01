mod game_provider;
mod java_runtime;
mod ely_auth;

use game_provider::{
    cancel_download, fetch_all_versions, fetch_forge_versions, fetch_fabric_loaders,
    fetch_vanilla_releases, get_game_root_dir, get_installed_fabric_profile_id,
    get_installed_quilt_profile_id, get_profile, install_fabric, install_forge, install_quilt,
    install_version, launch_game, list_installed_versions, open_game_folder, reset_download_cancel,
    save_avatar, set_profile,
};
use ely_auth::{
    ely_login_with_password, ely_logout, handle_oauth_callback, refresh_ely_session,
    start_ely_oauth,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            set_profile,
            save_avatar,
            start_ely_oauth,
            handle_oauth_callback,
            ely_login_with_password,
            ely_logout,
            refresh_ely_session,
            cancel_download,
            reset_download_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
