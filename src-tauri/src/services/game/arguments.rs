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
                let our = match key.as_str() {
                    "is_demo_user" => serde_json::json!(features.is_demo_user),
                    "has_custom_resolution" => serde_json::json!(features.has_custom_resolution),
                    "is_quick_play" => serde_json::json!(features.is_quick_play),
                    _ => continue,
                };
                if &our != val {
                    return false;
                }
            }
        }
    }
    true
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
