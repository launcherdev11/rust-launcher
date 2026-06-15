use tauri::{AppHandle, Emitter};

use crate::models::plugin::{PostLaunchEventPayload, PreLaunchEventPayload, PreLaunchHookFile};
use crate::services::game::arguments::filter_launcher_owned_jvm_args;
use crate::services::plugins::registry::{
    clear_launch_overrides, enabled_plugins_with_manifest, take_all_launch_overrides,
};

pub const EVENT_PLUGIN_PRE_LAUNCH: &str = "plugin:pre-launch";
pub const EVENT_PLUGIN_POST_LAUNCH: &str = "plugin:post-launch";
pub const EVENT_PLUGIN_LAUNCHER_READY: &str = "plugin:launcher-ready";

fn matches_filter(filter: &Option<Vec<String>>, value: &str) -> bool {
    match filter {
        None => true,
        Some(list) if list.is_empty() => true,
        Some(list) => list.iter().any(|v| v == value),
    }
}

fn read_pre_launch_hook_file(plugin_dir: &std::path::Path) -> Option<PreLaunchHookFile> {
    let path = plugin_dir.join("hooks").join("pre_launch.json");
    if !path.is_file() {
        return None;
    }
    let text = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&text).ok()
}

fn filter_safe_jvm_args(args: &[String]) -> Vec<String> {
    filter_launcher_owned_jvm_args(args.to_vec())
}

pub fn apply_pre_launch_hooks(
    app: &AppHandle,
    jvm_args: &mut Vec<String>,
    game_args: &mut Vec<String>,
    profile_id: Option<&str>,
    version_id: &str,
) {
    let plugins = match enabled_plugins_with_manifest() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[Plugins] Ошибка загрузки плагинов для pre-launch: {e}");
            return;
        }
    };

    let overrides = take_all_launch_overrides();

    for (manifest, dir) in &plugins {
        if !manifest.hooks.iter().any(|h| h == "pre_launch") {
            continue;
        }

        if let Some(hook) = read_pre_launch_hook_file(dir) {
            if !matches_filter(&hook.profile_filter, profile_id.unwrap_or("")) {
                continue;
            }
            if !matches_filter(&hook.version_filter, version_id) {
                continue;
            }

            if manifest.permissions.iter().any(|p| p == "modify_jvm_args") {
                jvm_args.extend(filter_safe_jvm_args(&hook.jvm_args_append));
            }
            if manifest.permissions.iter().any(|p| p == "modify_game_args") {
                game_args.extend(hook.game_args_append.clone());
            }
        }

        if let Some(runtime) = overrides.get(&manifest.id) {
            if manifest.permissions.iter().any(|p| p == "modify_jvm_args") {
                jvm_args.extend(filter_safe_jvm_args(&runtime.jvm_args_append));
            }
            if manifest.permissions.iter().any(|p| p == "modify_game_args") {
                game_args.extend(runtime.game_args_append.clone());
            }
        }
    }

    let payload = PreLaunchEventPayload {
        profile_id: profile_id.map(|s| s.to_string()),
        version_id: version_id.to_string(),
        jvm_args: jvm_args.clone(),
        game_args: game_args.clone(),
    };
    let _ = app.emit(EVENT_PLUGIN_PRE_LAUNCH, payload);
}

pub fn emit_post_launch(
    app: &AppHandle,
    profile_id: Option<&str>,
    version_id: &str,
    pid: u32,
) {
    clear_launch_overrides();

    let plugins = match enabled_plugins_with_manifest() {
        Ok(p) => p,
        Err(_) => Vec::new(),
    };

    let has_hook = plugins
        .iter()
        .any(|(m, _)| m.hooks.iter().any(|h| h == "post_launch"));

    if has_hook {
        let payload = PostLaunchEventPayload {
            profile_id: profile_id.map(|s| s.to_string()),
            version_id: version_id.to_string(),
            pid,
        };
        let _ = app.emit(EVENT_PLUGIN_POST_LAUNCH, payload);
    }
}

pub fn emit_launcher_ready(app: &AppHandle) {
    let plugins = match enabled_plugins_with_manifest() {
        Ok(p) => p,
        Err(_) => Vec::new(),
    };

    let has_hook = plugins
        .iter()
        .any(|(m, _)| m.hooks.iter().any(|h| h == "launcher_ready"));

    if has_hook {
        let _ = app.emit(EVENT_PLUGIN_LAUNCHER_READY, ());
    }
}
