use crate::services::game::version_types::{ArgRule, ArgumentValue, GameFeatures, OsInfo};

pub(crate) fn parse_memory_spec_to_mb(raw: &str) -> Option<u32> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let (num_part, suffix) = s
        .chars()
        .partition::<String, _>(|c| c.is_ascii_digit());
    if num_part.is_empty() {
        return None;
    }
    let value: u64 = num_part.parse().ok()?;
    let mb = match suffix.to_ascii_lowercase().as_str() {
        "g" | "gb" => value.saturating_mul(1024),
        "m" | "mb" | "" => value,
        _ => return None,
    };
    if mb == 0 || mb > u32::MAX as u64 {
        return None;
    }
    Some(mb as u32)
}

pub(crate) fn format_mb_to_spec(mb: u32) -> String {
    if mb % 1024 == 0 {
        format!("{}G", mb / 1024)
    } else {
        format!("{mb}M")
    }
}

fn feature_flag_enabled(features: &GameFeatures, key: &str) -> bool {
    match key {
        "is_demo_user" => features.is_demo_user,
        "has_custom_resolution" => features.has_custom_resolution,
        "has_quick_plays_support" => features.has_quick_plays_support,
        "is_quick_play_singleplayer" => features.is_quick_play_singleplayer,
        "is_quick_play_multiplayer" => features.is_quick_play_multiplayer,
        "is_quick_play_realms" => features.is_quick_play_realms,
        "is_quick_play" => {
            features.is_quick_play
                || features.is_quick_play_multiplayer
                || features.is_quick_play_singleplayer
                || features.is_quick_play_realms
        }
        // Unknown keys are NOT enabled. Skipping them (`continue`) used to make
        // Mojang rules for is_quick_play_singleplayer/multiplayer/realms always
        // match, leaking --quickPlaySingleplayer + ${quickPlaySingleplayer}
        // into argv → "Could not find world with the provided identifier".
        _ => false,
    }
}

pub(crate) fn argument_rule_matches(rule: &ArgRule, features: &GameFeatures, os_info: &OsInfo) -> bool {
    if let Some(ref os) = rule.os {
        if let Some(ref name) = os.name {
            if name != &os_info.name {
                return false;
            }
        }
        if let Some(ref arch) = os.arch {
            if arch != &os_info.arch {
                return false;
            }
        }
    }
    if let Some(ref rule_features) = rule.features {
        if let Some(obj) = rule_features.as_object() {
            for (key, val) in obj {
                let Some(expected) = val.as_bool() else {
                    continue;
                };
                if feature_flag_enabled(features, key) != expected {
                    return false;
                }
            }
        }
    }
    true
}

/// Remove `--quickPlay*` flags (and their values) plus leftover `${quickPlay*}` placeholders.
pub(crate) fn strip_quick_play_game_args(args: Vec<String>) -> Vec<String> {
    let mut filtered = Vec::with_capacity(args.len());
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        let is_quick_flag = matches!(
            arg.as_str(),
            "--quickPlayPath"
                | "--quickPlaySingleplayer"
                | "--quickPlayMultiplayer"
                | "--quickPlayRealms"
        );
        if is_quick_flag {
            i += 1;
            if i < args.len() && !args[i].starts_with("--") {
                i += 1;
            }
            continue;
        }
        if arg.starts_with("${quickPlay") {
            i += 1;
            continue;
        }
        filtered.push(arg.clone());
        i += 1;
    }
    filtered
}

/// Remove legacy `--server` / `--port` pairs (pre-1.20 join flags).
pub(crate) fn strip_legacy_server_args(args: Vec<String>) -> Vec<String> {
    let mut filtered = Vec::with_capacity(args.len());
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--server" || arg == "--port" {
            i += 1;
            if i < args.len() && !args[i].starts_with("--") {
                i += 1;
            }
            continue;
        }
        filtered.push(arg.clone());
        i += 1;
    }
    filtered
}

pub fn resolve_arguments(
    values: &[ArgumentValue],
    features: &GameFeatures,
    os_info: &OsInfo,
) -> Vec<String> {
    let mut out = Vec::new();
    for v in values {
        match v {
            ArgumentValue::String(s) => {
                out.push(s.clone());
            }
            ArgumentValue::WithRules { rules, value } => {
                let mut allow = false;
                for r in rules {
                    if !argument_rule_matches(r, features, os_info) {
                        continue;
                    }
                    match r.action.as_str() {
                        "allow" => allow = true,
                        "disallow" => {
                            allow = false;
                            break;
                        }
                        _ => {}
                    }
                }
                if !allow {
                    continue;
                }
                match value {
                    serde_json::Value::String(s) => out.push(s.clone()),
                    serde_json::Value::Array(arr) => {
                        for it in arr {
                            if let Some(s) = it.as_str() {
                                out.push(s.to_string());
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    out
}

pub(crate) fn replace_basic_placeholders(
    s: &str,
    classpath_str: &str,
    natives_str: &str,
    game_dir_str: &str,
    assets_str: &str,
    version_id: &str,
) -> String {
    s.replace("${classpath}", classpath_str)
        .replace("${natives}", natives_str)
        .replace("${gameDir}", game_dir_str)
        .replace("${assetsDir}", assets_str)
        .replace("${version}", version_id)
}

fn extract_module_from_add_exports_opens_value(s: &str) -> &str {
    let before_eq = s.split('=').next().unwrap_or(s).trim();
    before_eq.split('/').next().unwrap_or(before_eq)
}

fn is_problematic_module(module: &str) -> bool {
    let m = extract_module_from_add_exports_opens_value(module);
    m.starts_with("cpw.mods.")
        || m.starts_with("org.objectweb.asm")
        || m.starts_with("org.openjdk.nashorn")
}

pub(crate) fn filter_forge_problematic_jvm_args(args: Vec<String>) -> (Vec<String>, Vec<String>) {
    let mut filtered = Vec::with_capacity(args.len());
    let mut removed = Vec::new();
    let mut i = 0usize;

    while i < args.len() {
        let skip = if args[i] == "--add-exports" || args[i] == "--add-opens" {
            if i + 1 < args.len() && is_problematic_module(&args[i + 1]) {
                removed.push(format!("{} {}", args[i], args[i + 1]));
                true
            } else {
                false
            }
        } else if args[i].starts_with("--add-exports=") || args[i].starts_with("--add-opens=") {
            let value = args[i].split('=').nth(1).unwrap_or("");
            if is_problematic_module(value) {
                removed.push(args[i].clone());
                true
            } else {
                false
            }
        } else {
            false
        };

        if skip {
            if (args[i] == "--add-exports" || args[i] == "--add-opens") && i + 1 < args.len() {
                i += 2;
            } else {
                i += 1;
            }
        } else {
            filtered.push(args[i].clone());
            i += 1;
        }
    }

    (filtered, removed)
}

pub(crate) fn ensure_forge_ignore_list_includes_vanilla_client_jar(jvm_args: &mut Vec<String>, mc_version: &str) {
    let token = format!("{mc_version}.jar");
    for arg in jvm_args.iter_mut() {
        if let Some(val) = arg.strip_prefix("-DignoreList=") {
            if val.split(',').any(|s| s == token) {
                return;
            }
            *arg = format!("-DignoreList={val},{token}");
            return;
        }
    }
}

pub(crate) fn ensure_forge_safe_opens(args: &mut Vec<String>) {
    let has_invoke = args.iter().any(|s| {
        s.contains("java.lang.invoke=ALL-UNNAMED") || s.contains("java.base/java.lang.invoke=ALL-UNNAMED")
    });
    if !has_invoke {
        args.push("--add-opens".to_string());
        args.push("java.base/java.lang.invoke=ALL-UNNAMED".to_string());
    }

    let has_jar = args.iter().any(|s| s.contains("java.base/java.util.jar=ALL-UNNAMED"));
    if !has_jar {
        args.push("--add-opens".to_string());
        args.push("java.base/java.util.jar=ALL-UNNAMED".to_string());
    }
}

pub(crate) fn remove_add_opens_for_java_under_9(args: Vec<String>) -> Vec<String> {
    let mut filtered = Vec::with_capacity(args.len());
    let mut i = 0usize;
    while i < args.len() {
        if args[i] == "--add-opens" {
            i += 2;
            continue;
        }
        if args[i].starts_with("--add-opens=") {
            i += 1;
            continue;
        }
        filtered.push(args[i].clone());
        i += 1;
    }
    filtered
}

pub(crate) fn filter_launcher_owned_jvm_args(args: Vec<String>) -> Vec<String> {
    let mut filtered = Vec::with_capacity(args.len());
    let mut i = 0usize;
    while i < args.len() {
        let arg = &args[i];
        if arg == "-cp" || arg == "-classpath" {
            i += 2;
            continue;
        }
        if arg == "-Djava.library.path" {
            i += 2;
            continue;
        }
        if arg.starts_with("-Djava.library.path=") {
            i += 1;
            continue;
        }
        filtered.push(arg.clone());
        i += 1;
    }
    filtered
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::game::version_types::{ArgRule, ArgumentValue, GameFeatures, OsInfo};

    fn os_windows() -> OsInfo {
        OsInfo {
            name: "windows".into(),
            arch: "x86_64".into(),
        }
    }

    fn allow_feature(key: &str, value: bool) -> ArgRule {
        ArgRule {
            action: "allow".into(),
            os: None,
            features: Some(serde_json::json!({ key: value })),
        }
    }

    #[test]
    fn unknown_quick_play_features_do_not_match_when_disabled() {
        let features = GameFeatures::full();
        let os = os_windows();
        assert!(!argument_rule_matches(
            &allow_feature("is_quick_play_singleplayer", true),
            &features,
            &os
        ));
        assert!(!argument_rule_matches(
            &allow_feature("is_quick_play_multiplayer", true),
            &features,
            &os
        ));
        assert!(!argument_rule_matches(
            &allow_feature("has_quick_plays_support", true),
            &features,
            &os
        ));
    }

    #[test]
    fn multiplayer_join_features_only_enable_mp_quick_play() {
        let features = GameFeatures::for_multiplayer_join();
        let os = os_windows();
        assert!(argument_rule_matches(
            &allow_feature("is_quick_play_multiplayer", true),
            &features,
            &os
        ));
        assert!(argument_rule_matches(
            &allow_feature("has_quick_plays_support", true),
            &features,
            &os
        ));
        assert!(!argument_rule_matches(
            &allow_feature("is_quick_play_singleplayer", true),
            &features,
            &os
        ));
        assert!(!argument_rule_matches(
            &allow_feature("is_quick_play_realms", true),
            &features,
            &os
        ));
    }

    #[test]
    fn resolve_skips_singleplayer_quick_play_by_default() {
        let values = vec![
            ArgumentValue::String("--username".into()),
            ArgumentValue::WithRules {
                rules: vec![allow_feature("is_quick_play_singleplayer", true)],
                value: serde_json::json!(["--quickPlaySingleplayer", "${quickPlaySingleplayer}"]),
            },
            ArgumentValue::WithRules {
                rules: vec![allow_feature("is_quick_play_multiplayer", true)],
                value: serde_json::json!(["--quickPlayMultiplayer", "${quickPlayMultiplayer}"]),
            },
        ];
        let out = resolve_arguments(&values, &GameFeatures::full(), &os_windows());
        assert_eq!(out, vec!["--username"]);

        let out_mp = resolve_arguments(
            &values,
            &GameFeatures::for_multiplayer_join(),
            &os_windows(),
        );
        assert_eq!(
            out_mp,
            vec![
                "--username".to_string(),
                "--quickPlayMultiplayer".to_string(),
                "${quickPlayMultiplayer}".to_string(),
            ]
        );
    }

    #[test]
    fn strip_removes_all_quick_play_modes_and_placeholders() {
        let args = vec![
            "--username".into(),
            "--quickPlayPath".into(),
            "${quickPlayPath}".into(),
            "--quickPlaySingleplayer".into(),
            "${quickPlaySingleplayer}".into(),
            "--quickPlayMultiplayer".into(),
            "127.0.0.1:25565".into(),
            "${quickPlayRealms}".into(),
            "--version".into(),
        ];
        let out = strip_quick_play_game_args(args);
        assert_eq!(out, vec!["--username", "--version"]);
    }
}
