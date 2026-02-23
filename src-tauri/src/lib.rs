mod game_provider;

use game_provider::{
    ely_logout, ely_start_login, fetch_all_versions, fetch_forge_versions, fetch_fabric_loaders,
    fetch_vanilla_releases, get_game_root_dir, get_installed_fabric_profile_id, get_profile,
    install_forge, install_fabric, install_version, launch_game, list_installed_versions,
    open_game_folder, save_avatar, set_profile,
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
            install_forge,
            get_game_root_dir,
            launch_game,
            list_installed_versions,
            get_installed_fabric_profile_id,
            open_game_folder,
            get_profile,
            set_profile,
            save_avatar,
            ely_start_login,
            ely_logout
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
