use std::path::PathBuf;

use sysinfo::System;

use crate::models::{InstanceSettings, JavaSettings, Settings};
use crate::services::game::arguments::{
    format_mb_to_spec, parse_memory_spec_to_mb, replace_basic_placeholders,
};
use crate::services::java as java_service;

pub(crate) use crate::services::game::arguments::{
    ensure_forge_ignore_list_includes_vanilla_client_jar, ensure_forge_safe_opens,
    filter_forge_problematic_jvm_args, remove_add_opens_for_java_under_9,
};

pub(crate) fn build_java_command(
    default_java_path: PathBuf,
    settings: &Settings,
    instance_settings_for_launch: Option<&InstanceSettings>,
    java_settings: &JavaSettings,
    game_dir_str: &str,
    natives_str: &str,
    assets_str: &str,
    version_id: &str,
    classpath_str: &str,
    mut jvm_args: Vec<String>,
    force_java_path: Option<PathBuf>,
) -> Result<(PathBuf, Vec<String>), String> {
    let mut java_path = if let Some(forced) = force_java_path {
        forced
    } else if let Some(custom) = java_settings
        .java_path
        .as_ref()
        .and_then(|s| if s.trim().is_empty() { None } else { Some(s) })
    {
        PathBuf::from(custom)
    } else {
        default_java_path
    };

    #[cfg(target_os = "windows")]
    if settings.show_console_on_launch {
        if let Some(parent) = java_path.parent() {
            let candidate = parent.join("java.exe");
            if candidate.exists() {
                java_path = candidate;
            }
        }
    }

    if let Some(java_major) = java_service::detect::detect_java_major_version(&java_path) {
        if java_major < 9 {
            let mut filtered: Vec<String> = Vec::with_capacity(jvm_args.len());
            let mut i = 0usize;
            while i < jvm_args.len() {
                if jvm_args[i] == "--add-opens" {
                    i += 2;
                    continue;
                }
                if jvm_args[i].starts_with("--add-opens=") {
                    i += 1;
                    continue;
                }
                filtered.push(jvm_args[i].clone());
                i += 1;
            }
            jvm_args = filtered;
        }
    }

    let base_ram_mb = settings.ram_mb.max(1024);
    let mut xms_mb = (base_ram_mb / 2).max(512);
    let mut xmx_mb = base_ram_mb;

    if let Some(ref xms_str) = java_settings.xms {
        if let Some(mb) = parse_memory_spec_to_mb(xms_str) {
            xms_mb = mb;
        }
    }
    if let Some(ref xmx_str) = java_settings.xmx {
        if let Some(mb) = parse_memory_spec_to_mb(xmx_str) {
            xmx_mb = mb;
        }
    }

    if xms_mb > xmx_mb {
        std::mem::swap(&mut xms_mb, &mut xmx_mb);
    }

    let mut sys = System::new_all();
    sys.refresh_memory();
    let total_mb: u64 = sys.total_memory() / 1024;
    if total_mb > 0 {
        let reserve_mb: u64 = 2048;
        let hard_max = total_mb.saturating_sub(reserve_mb).max(1024);
        if (xmx_mb as u64) > hard_max {
            xmx_mb = hard_max as u32;
            if xms_mb > xmx_mb {
                xms_mb = xmx_mb;
            }
        }
    }

    let xms_flag = format!("-Xms{}", format_mb_to_spec(xms_mb));
    let xmx_flag = format!("-Xmx{}", format_mb_to_spec(xmx_mb));

    jvm_args.retain(|a| !a.starts_with("-Xms") && !a.starts_with("-Xmx"));
    jvm_args.insert(0, xmx_flag.clone());
    jvm_args.insert(0, xms_flag.clone());

    let replace_basic = |s: &str| -> String {
        replace_basic_placeholders(s, classpath_str, natives_str, game_dir_str, assets_str, version_id)
    };

    let filter_tokens = |tokens: Vec<String>| -> Vec<String> {
        const FORBIDDEN_PREFIXES: &[&str] = &["-agentlib:", "-agentpath:", "-Xrun", "-Xdebug"];
        let mut out = Vec::new();
        let mut i = 0;
        while i < tokens.len() {
            let a = tokens[i].trim().to_string();
            if a.is_empty() {
                i += 1;
                continue;
            }

            if FORBIDDEN_PREFIXES.iter().any(|p| a.starts_with(p)) {
                eprintln!("[JavaSettings] Запрещённый флаг пропущен: {}", a);
                i += 1;
                continue;
            }

            if a == "-p" || a == "--module-path" {
                eprintln!("[JavaSettings] Флаг модулей игнорирован: {}", a);
                i += 1;
                if i < tokens.len() {
                    i += 1;
                }
                continue;
            }

            if a == "-cp" || a == "-classpath" {
                eprintln!("[JavaSettings] Пользовательский -cp/-classpath игнорирован (обязательный classpath задаётся лаунчером).");
                i += 1;
                if i < tokens.len() {
                    i += 1;
                }
                continue;
            }
            if a == "-Djava.library.path" {
                eprintln!("[JavaSettings] Пользовательский -Djava.library.path игнорирован (обязательный natives задаётся лаунчером).");
                i += 1;
                if i < tokens.len() {
                    i += 1;
                }
                continue;
            }
            if a.starts_with("-Djava.library.path=") {
                eprintln!("[JavaSettings] Пользовательский -Djava.library.path=... игнорирован (обязательный natives задаётся лаунчером).");
                i += 1;
                continue;
            }

            out.push(replace_basic(&a));
            i += 1;
        }
        out
    };

    if let Some(inst) = instance_settings_for_launch {
        if let Some(extra) = &inst.jvm_args {
            let parts: Vec<String> = extra.split_whitespace().map(|s| s.to_string()).collect();
            jvm_args.extend(filter_tokens(parts));
        }
    }

    if java_settings.use_custom_jvm_args {
        if let Some(extra) = &java_settings.jvm_args {
            let parts: Vec<String> = extra.split_whitespace().map(|s| s.to_string()).collect();
            jvm_args.extend(filter_tokens(parts));
        }
    }

    if java_settings.prefer_ipv6_network {
        jvm_args.push("-Djava.net.preferIPv4Stack=false".to_string());
        jvm_args.push("-Djava.net.preferIPv6Addresses=true".to_string());
    }

    Ok((java_path, jvm_args))
}
