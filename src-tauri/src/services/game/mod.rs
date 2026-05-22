pub mod accounts;
pub mod arguments;
pub mod cache;
pub mod console;
pub mod core;
pub mod download;
pub mod files;
pub mod install;
pub mod integrity;
pub mod launcher;
pub mod runtime;
pub mod profiles;
pub mod settings;
pub mod state;
pub mod version_types;
pub mod versions;

pub use accounts::{
    add_launcher_account, get_profile, list_launcher_accounts, remove_launcher_account,
    set_profile, switch_launcher_account,
};
pub use cache::{clear_launcher_cache, get_launcher_cache_size};
pub use download::{
    download_modrinth_file, download_modrinth_modpack_and_import, import_modpack_files, import_mrpack,
    import_mrpack_as_new_profile,
};
pub use files::{get_game_root_dir, open_game_folder, open_profile_folder};
pub use install::{
    install_fabric, install_forge, install_neoforge, install_quilt, install_version,
};
pub use integrity::check_version_files_integrity;
pub use launcher::{
    cancel_download, is_game_running_now, launch_game, reset_download_cancel, stop_game,
};
pub use profiles::{
    add_profile_files, create_profile, delete_item, delete_profile, get_profile_play_time_seconds, get_profiles,
    get_selected_profile, list_profile_items, rename_profile, set_selected_profile, update_profile_settings,
};
pub use settings::{
    detect_java_runtimes, get_effective_settings, get_java_settings,
    get_profile_java_settings, get_settings, get_system_memory_gb, reset_settings_to_default,
    set_java_settings, set_profile_java_settings, set_settings, validate_java_args,
};
pub use versions::{
    fetch_all_versions, fetch_fabric_loaders, fetch_forge_versions, fetch_neoforge_versions, fetch_vanilla_releases,
    get_installed_fabric_profile_id, get_installed_quilt_profile_id, list_installed_fabric_game_versions,
    list_installed_quilt_game_versions, list_installed_versions,
};

pub use crate::services::storage::backup::{
    export_launcher_settings_backup, import_launcher_settings_backup,
};
