pub mod accounts;
pub mod arguments;
pub mod build_presets;
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
pub mod external_import;
pub mod screenshots;
pub mod settings;
pub mod state;
pub mod version_types;
pub mod version_remove;
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
    install_fabric, install_forge, install_local_version, install_neoforge, install_quilt,
    install_version,
};
pub use integrity::check_version_files_integrity;
pub use launcher::{
    cancel_download, is_game_running_now, launch_game, reset_download_cancel, stop_game,
};
pub use build_presets::{
    create_build_preset_from_profile, delete_build_preset, get_build_preset_icon_data_uri,
    list_build_presets, save_build_preset,
};
pub use profiles::{
    add_profile_files, change_profile_version, create_profile, delete_item, delete_profile,
    get_profile_icon_data_uri, get_profile_play_time_seconds, get_profiles, get_selected_profile,
    list_profile_items, merge_profile_cloud_stats, rename_profile, set_profile_icon_from_file,
    set_profile_item_enabled, set_selected_profile, update_profile_settings,
};
pub use external_import::{
    default_external_launcher_path,
    import_selected_external_instance,
    list_importable_instances,
};
pub use screenshots::{
    delete_screenshot, get_screenshot_data_uri, get_screenshot_thumbnail, list_screenshots,
    open_screenshot, open_screenshots_folder,
};
pub use settings::{
    detect_java_runtimes, get_effective_settings, get_java_settings,
    get_profile_java_settings, get_settings, get_system_memory_gb, reset_settings_to_default,
    set_java_settings, set_profile_java_settings, set_settings, validate_java_args,
};
pub use version_remove::{delete_minecraft_installation, get_version_install_details};
pub use versions::{
    fetch_all_versions, fetch_fabric_loaders, fetch_forge_builds_for_game, fetch_forge_versions,
    fetch_neoforge_builds_for_game, fetch_neoforge_versions, fetch_quilt_loaders,
    fetch_vanilla_releases, fetch_versions_for_loader, get_installed_fabric_profile_id,
    get_installed_quilt_profile_id, import_custom_version, list_installed_fabric_game_versions,
    list_installed_quilt_game_versions, list_installed_versions,
};

pub use crate::services::storage::backup::{
    export_launcher_settings_backup, import_launcher_settings_backup,
};
