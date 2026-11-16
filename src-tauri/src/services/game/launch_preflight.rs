use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::{command, AppHandle};

use crate::app::paths::{
    game_root_dir, instance_config_path, instance_dir, instance_settings_path, versions_dir,
};
use crate::infra::disk_space::available_bytes;
use crate::infra::fs_atomic::read_to_string_with_backup;
use crate::infra::process_probe::system_memory;
use crate::models::{InstanceSettings, JavaSettings};
use crate::services::game::arguments::parse_memory_spec_to_mb;
use crate::services::game::profiles::{profile_item_is_disabled, read_instance_config};
use crate::services::game::runtime::heap_limit_mb;
use crate::services::game::settings::{effective_java_settings_for_profile, effective_settings_for_profile};
use crate::services::java::detect::detect_java_major_version;

const MB: u64 = 1024 * 1024;
const DISK_WARNING_MB: u64 = 2048;
const DISK_CRITICAL_MB: u64 = 500;
const MEMORY_BY_MOD_COUNT: [(usize, u64); 3] = [(200, 6144), (100, 4096), (50, 3072)];

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PreflightWarning {
    pub code: &'static str,
    pub critical: bool,
    pub params: BTreeMap<&'static str, String>,
}

fn warning<const N: usize>(
    code: &'static str,
    critical: bool,
    params: [(&'static str, String); N],
) -> PreflightWarning {
    PreflightWarning {
        code,
        critical,
        params: BTreeMap::from(params),
    }
}

fn disk_warning(free_mb: u64) -> Option<PreflightWarning> {
    (free_mb < DISK_WARNING_MB).then(|| {
        warning(
            "disk_low",
            free_mb < DISK_CRITICAL_MB,
            [("free", free_mb.to_string())],
        )
    })
}

fn memory_warnings(
    requested_mb: u64,
    limit_mb: Option<u64>,
    available_mb: u64,
    mods: usize,
) -> Vec<PreflightWarning> {
    let mut out = Vec::new();
    let heap_mb = limit_mb.map_or(requested_mb, |limit| requested_mb.min(limit));
    if heap_mb < requested_mb {
        out.push(warning(
            "memory_over_total",
            false,
            [("heap", requested_mb.to_string()), ("limit", heap_mb.to_string())],
        ));
    } else if limit_mb.is_some() && heap_mb > available_mb {
        out.push(warning(
            "memory_low_available",
            false,
            [("heap", heap_mb.to_string()), ("available", available_mb.to_string())],
        ));
    }
    let recommended = MEMORY_BY_MOD_COUNT
        .iter()
        .find(|(min_mods, _)| mods >= *min_mods)
        .map(|(_, mb)| *mb);
    if let Some(recommended) = recommended.filter(|mb| heap_mb < *mb) {
        out.push(warning(
            "memory_low_for_mods",
            false,
            [
                ("heap", heap_mb.to_string()),
                ("mods", mods.to_string()),
                ("recommended", recommended.to_string()),
            ],
        ));
    }
    out
}

fn java_warning(required: u8, actual: u8, uses_launchwrapper: bool) -> Option<PreflightWarning> {
    let params = [("required", required.to_string()), ("actual", actual.to_string())];
    if actual < required {
        return Some(warning("java_too_old", true, params));
    }

    if actual > required && !uses_launchwrapper {
        return Some(warning("java_newer", false, params));
    }
    None
}

fn read_version_json(versions_root: &Path, version_id: &str) -> Option<Value> {
    let dir = versions_root.join(version_id);
    [dir.join(format!("{version_id}.json")), dir.join("profile.json")]
        .iter()
        .find_map(|path| {
            let text = std::fs::read_to_string(path).ok()?;
            serde_json::from_str(&text).ok()
        })
}

struct VersionJavaRequirement {
    major: Option<u8>,
    uses_launchwrapper: bool,
}

fn parse_java_major(version: &Value) -> Option<u8> {
    let major = version.get("javaVersion")?.get("majorVersion")?.as_u64()?;
    u8::try_from(major).ok()
}

fn version_java_requirement(versions_root: &Path, version_id: &str) -> Option<VersionJavaRequirement> {
    let version = read_version_json(versions_root, version_id)?;
    let uses_launchwrapper = version.get("mainClass").and_then(Value::as_str)
        == Some("net.minecraft.launchwrapper.Launch");
    let major = parse_java_major(&version).or_else(|| {
        let parent = version.get("inheritsFrom")?.as_str()?;
        parse_java_major(&read_version_json(versions_root, parent)?)
    });
    Some(VersionJavaRequirement {
        major,
        uses_launchwrapper,
    })
}

fn check_custom_java(java: &JavaSettings, version_id: &str) -> Option<PreflightWarning> {
    let custom = java.java_path.as_deref().map(str::trim).filter(|p| !p.is_empty())?;
    let path = PathBuf::from(custom);
    if !path.exists() {
        return Some(warning("java_missing", false, [("path", custom.to_string())]));
    }
    let requirement = version_java_requirement(&versions_dir().ok()?, version_id)?;
    let actual = detect_java_major_version(&path)?;
    java_warning(requirement.major?, actual, requirement.uses_launchwrapper)
}

fn effective_heap_mb(profile_id: Option<&str>) -> u64 {
    let settings = effective_settings_for_profile(profile_id.map(str::to_string));
    let base = u64::from(settings.ram_mb.max(1024));
    profile_id
        .and_then(|id| instance_settings_path(id).ok())
        .and_then(|path| read_to_string_with_backup(&path))
        .and_then(|text| serde_json::from_str::<InstanceSettings>(&text).ok())
        .filter(|inst| inst.ram_mb.is_none())
        .and_then(|inst| inst.java_settings)
        .and_then(|java| java.xmx)
        .as_deref()
        .and_then(parse_memory_spec_to_mb)
        .map(u64::from)
        .unwrap_or(base)
}

fn enabled_mods_count(profile_id: &str) -> usize {
    let loader_has_mods = instance_config_path(profile_id)
        .and_then(|path| read_instance_config(&path))
        .map(|cfg| !cfg.loader.trim().eq_ignore_ascii_case("vanilla"))
        .unwrap_or(false);
    if !loader_has_mods {
        return 0;
    }
    let Ok(dir) = instance_dir(profile_id).map(|d| d.join("mods")) else {
        return 0;
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            entry.path().is_file() && !profile_item_is_disabled(&name) && name.to_ascii_lowercase().ends_with(".jar")
        })
        .count()
}

fn collect_warnings(app: &AppHandle, profile_id: Option<&str>, version_id: &str) -> Vec<PreflightWarning> {
    let mut out = Vec::new();

    let game_dir = profile_id
        .and_then(|id| instance_dir(id).ok())
        .or_else(|| game_root_dir().ok());
    if let Some(free) = game_dir.as_deref().and_then(available_bytes) {
        out.extend(disk_warning(free / MB));
    }

    let (total, available) = system_memory();
    let mods = profile_id.map(enabled_mods_count).unwrap_or(0);
    out.extend(memory_warnings(
        effective_heap_mb(profile_id),
        heap_limit_mb(total),
        available / MB,
        mods,
    ));

    let java = effective_java_settings_for_profile(app, profile_id.map(str::to_string));
    out.extend(check_custom_java(&java, version_id));

    out
}

#[command]
pub async fn run_launch_preflight(
    app: AppHandle,
    profile_id: Option<String>,
    version_id: String,
) -> Result<Vec<PreflightWarning>, String> {
    tokio::task::spawn_blocking(move || collect_warnings(&app, profile_id.as_deref(), &version_id))
        .await
        .map_err(|e| format!("Проверка перед запуском прервана: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(warnings: &[PreflightWarning]) -> Vec<&'static str> {
        warnings.iter().map(|w| w.code).collect()
    }

    #[test]
    fn disk_thresholds() {
        assert!(disk_warning(DISK_WARNING_MB).is_none());
        assert!(!disk_warning(DISK_WARNING_MB - 1).unwrap().critical);
        assert!(disk_warning(DISK_CRITICAL_MB - 1).unwrap().critical);
    }

    #[test]
    fn heap_above_physical_memory_wins_over_low_available() {
        let clamped = memory_warnings(8192, Some(6144), 2048, 0);
        assert_eq!(codes(&clamped), ["memory_over_total"]);
        assert_eq!(clamped[0].params["limit"], "6144");
        assert_eq!(codes(&memory_warnings(4096, Some(14336), 2048, 0)), ["memory_low_available"]);
        assert!(memory_warnings(4096, Some(14336), 8192, 0).is_empty());
    }

    #[test]
    fn unknown_memory_produces_no_memory_warning() {
        assert!(memory_warnings(4096, None, 0, 0).is_empty());
    }

    #[test]
    fn mod_count_raises_recommended_memory() {
        assert_eq!(codes(&memory_warnings(2048, Some(14336), 8192, 60)), ["memory_low_for_mods"]);
        assert!(memory_warnings(4096, Some(14336), 8192, 60).is_empty());
        let heavy = memory_warnings(4096, Some(14336), 8192, 250);
        assert_eq!(heavy[0].params["recommended"], "6144");
    }

    #[test]
    fn java_comparison() {
        assert!(java_warning(17, 8, false).unwrap().critical);
        assert_eq!(java_warning(17, 21, false).unwrap().code, "java_newer");
        assert!(java_warning(8, 17, true).is_none());
        assert!(java_warning(17, 17, false).is_none());
    }
}
