use std::path::Path;
use std::time::UNIX_EPOCH;

use base64::Engine;

use super::types::{ExternalLauncherType, ImportableInstance};

#[derive(Debug, Clone, Default)]
pub struct InstanceLoaderMeta {
    pub display_name: Option<String>,
    pub loader: Option<String>,
    pub game_version: Option<String>,
    pub loader_version: Option<String>,
}

fn image_path_to_data_uri(path: &Path) -> Result<Option<String>, String> {
    let bytes = std::fs::read(path)
        .map_err(|e| format!("Не удалось прочитать иконку {}: {e}", path.display()))?;
    if bytes.is_empty() {
        return Ok(None);
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(format!("data:{mime};base64,{encoded}")))
}

fn unix_mtime(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

fn mods_dirs_for_instance(instance_dir: &Path) -> Vec<std::path::PathBuf> {
    let mut dirs = vec![
        instance_dir.join("mods"),
        instance_dir.join(".minecraft").join("mods"),
        instance_dir.join("minecraft").join("mods"),
    ];
    dirs.retain(|p| p.is_dir());
    dirs
}

fn dir_size_and_mods_count(instance_dir: &Path) -> (Option<u64>, Option<u32>) {
    let mods_dirs = mods_dirs_for_instance(instance_dir);
    if mods_dirs.is_empty() {
        return (None, None);
    }
    let mut bytes: u64 = 0;
    let mut count: u32 = 0;
    let mut stack = mods_dirs;
    while let Some(p) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&p) else {
            continue;
        };
        for e in rd.flatten() {
            let path = e.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.is_file() {
                if let Ok(m) = e.metadata() {
                    bytes = bytes.saturating_add(m.len());
                    count = count.saturating_add(1);
                }
            }
        }
    }
    (Some(bytes), Some(count))
}

fn multimc_instance_name(instance_dir: &Path) -> Option<String> {
    let cfg = instance_dir.join("instance.cfg");
    let text = std::fs::read_to_string(cfg).ok()?;
    for line in text.lines() {
        let (k, v) = line.split_once('=')?;
        if k.trim().eq_ignore_ascii_case("name") {
            let name = v.trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn multimc_instance_icon_key(instance_dir: &Path) -> Option<String> {
    let cfg = instance_dir.join("instance.cfg");
    let text = std::fs::read_to_string(cfg).ok()?;
    for line in text.lines() {
        let (k, v) = line.split_once('=')?;
        if k.trim().eq_ignore_ascii_case("iconkey") {
            let key = v.trim();
            if !key.is_empty() {
                return Some(key.to_string());
            }
        }
    }
    None
}

fn normalize_loader_name(raw: &str) -> Option<String> {
    let s = raw.trim().to_ascii_lowercase();
    if s.is_empty() {
        return None;
    }
    if s.contains("neoforge") || s == "neo" {
        return Some("neoforge".to_string());
    }
    if s.contains("fabric") {
        return Some("fabric".to_string());
    }
    if s.contains("quilt") {
        return Some("quilt".to_string());
    }
    if s.contains("forge") {
        return Some("forge".to_string());
    }
    if s.contains("vanilla") || s == "none" || s == "minecraft" {
        return Some("vanilla".to_string());
    }
    None
}

fn multimc_component_loader_and_version(instance_dir: &Path) -> InstanceLoaderMeta {
    let mmc_pack = instance_dir.join("mmc-pack.json");
    let Ok(text) = std::fs::read_to_string(mmc_pack) else {
        return InstanceLoaderMeta::default();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return InstanceLoaderMeta::default();
    };
    let components = v
        .get("components")
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default();
    let mut meta = InstanceLoaderMeta::default();
    for c in components {
        let uid = c.get("uid").and_then(|x| x.as_str()).unwrap_or("");
        let ver = c
            .get("version")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let uid_l = uid.to_ascii_lowercase();
        if uid == "net.minecraft" {
            if meta.game_version.is_none() {
                meta.game_version = ver;
            }
        } else if uid == "net.fabricmc.fabric-loader" || uid_l.contains("fabric-loader") {
            meta.loader = Some("fabric".to_string());
            meta.loader_version = ver.or(meta.loader_version);
        } else if uid == "net.minecraftforge" || uid_l.contains("minecraftforge") {
            meta.loader = Some("forge".to_string());
            meta.loader_version = ver.or(meta.loader_version);
        } else if uid == "org.quiltmc.quilt-loader" || uid_l.contains("quilt-loader") {
            meta.loader = Some("quilt".to_string());
            meta.loader_version = ver.or(meta.loader_version);
        } else if uid_l.contains("neoforged") || uid_l.contains("neoforge") {
            meta.loader = Some("neoforge".to_string());
            meta.loader_version = ver.or(meta.loader_version);
        }
    }
    meta
}

fn parse_curseforge_meta(instance_dir: &Path) -> InstanceLoaderMeta {
    let path = instance_dir.join("minecraftinstance.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return InstanceLoaderMeta::default();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return InstanceLoaderMeta::default();
    };

    let mut meta = InstanceLoaderMeta::default();
    meta.display_name = v
        .get("name")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    meta.game_version = v
        .get("gameVersion")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            v.get("baseModLoader")
                .and_then(|b| b.get("minecraftVersion"))
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        });

    if let Some(base) = v.get("baseModLoader") {
        let name = base.get("name").and_then(|x| x.as_str()).unwrap_or("");
        let forge_ver = base
            .get("forgeVersion")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        let name_l = name.to_ascii_lowercase();
        if let Some(loader) = normalize_loader_name(name) {
            meta.loader = Some(loader.clone());
            meta.loader_version = forge_ver.or_else(|| {
                name_l
                    .split('-')
                    .skip(1)
                    .find(|p| p.chars().next().is_some_and(|c| c.is_ascii_digit()))
                    .map(|s| s.to_string())
            });
        } else if !name.is_empty() {
            meta.loader = Some("forge".to_string());
            meta.loader_version = forge_ver;
        }
    }

    if meta.loader.is_none() {
        meta.loader = Some("vanilla".to_string());
    }
    meta
}

fn parse_atlauncher_meta(instance_dir: &Path) -> InstanceLoaderMeta {
    let path = instance_dir.join("instance.json");
    let Ok(text) = std::fs::read_to_string(&path).or_else(|_| {
        std::fs::read_to_string(instance_dir.join("instance.json.bak"))
    }) else {
        return InstanceLoaderMeta::default();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return InstanceLoaderMeta::default();
    };

    let mut meta = InstanceLoaderMeta::default();
    meta.display_name = v
        .pointer("/launcher/name")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("name").and_then(|x| x.as_str()))
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    meta.game_version = v
        .get("id")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty() && s.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(|s| s.to_string())
        .or_else(|| {
            v.pointer("/launcher/version/minecraft")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        })
        .or_else(|| {
            v.get("minecraftVersion")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
        });

    if let Some(loader_type) = v
        .pointer("/launcher/loaderVersion/type")
        .and_then(|x| x.as_str())
        .or_else(|| v.pointer("/loaderVersion/type").and_then(|x| x.as_str()))
    {
        meta.loader = normalize_loader_name(loader_type);
        meta.loader_version = v
            .pointer("/launcher/loaderVersion/version")
            .and_then(|x| x.as_str())
            .or_else(|| v.pointer("/loaderVersion/version").and_then(|x| x.as_str()))
            .map(|s| s.to_string());
    }

    if meta.loader.is_none() {
        meta.loader = Some("vanilla".to_string());
    }
    meta
}

fn parse_gdlauncher_meta(instance_dir: &Path) -> InstanceLoaderMeta {
    let path = instance_dir.join("config.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return InstanceLoaderMeta::default();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return InstanceLoaderMeta::default();
    };

    let mut meta = InstanceLoaderMeta::default();
    meta.display_name = v
        .get("name")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    if let Some(loader) = v.get("loader") {
        meta.game_version = loader
            .get("mcVersion")
            .and_then(|x| x.as_str())
            .or_else(|| loader.get("minecraftVersion").and_then(|x| x.as_str()))
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        meta.loader = loader
            .get("loaderType")
            .and_then(|x| x.as_str())
            .and_then(normalize_loader_name)
            .or_else(|| {
                loader
                    .get("loaderType")
                    .and_then(|x| x.as_i64())
                    .and_then(|n| match n {
                        0 => Some("vanilla".to_string()),
                        1 => Some("forge".to_string()),
                        2 => Some("fabric".to_string()),
                        3 => Some("quilt".to_string()),
                        4 => Some("neoforge".to_string()),
                        _ => None,
                    })
            });
        meta.loader_version = loader
            .get("loaderVersion")
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
    }

    if meta.game_version.is_none() {
        meta.game_version = v
            .get("modpack")
            .and_then(|m| m.get("minecraft"))
            .and_then(|x| x.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
    }

    if meta.loader.is_none() {
        meta.loader = Some("vanilla".to_string());
    }
    meta
}

pub fn read_instance_loader_meta(
    launcher_type: ExternalLauncherType,
    instance_dir: &Path,
) -> InstanceLoaderMeta {
    let mut meta = match launcher_type {
        ExternalLauncherType::PrismLauncher | ExternalLauncherType::MultiMC => {
            let mut m = multimc_component_loader_and_version(instance_dir);
            m.display_name = multimc_instance_name(instance_dir);
            m
        }
        ExternalLauncherType::CurseForge => parse_curseforge_meta(instance_dir),
        ExternalLauncherType::ATLauncher => parse_atlauncher_meta(instance_dir),
        ExternalLauncherType::GDLauncher => parse_gdlauncher_meta(instance_dir),
        ExternalLauncherType::Auto | ExternalLauncherType::Unknown => {
            let curse = parse_curseforge_meta(instance_dir);
            if curse.game_version.is_some() || curse.display_name.is_some() {
                curse
            } else {
                let at = parse_atlauncher_meta(instance_dir);
                if at.game_version.is_some() || at.display_name.is_some() {
                    at
                } else {
                    let gd = parse_gdlauncher_meta(instance_dir);
                    if gd.game_version.is_some() || gd.display_name.is_some() {
                        gd
                    } else {
                        let mut m = multimc_component_loader_and_version(instance_dir);
                        m.display_name = multimc_instance_name(instance_dir);
                        m
                    }
                }
            }
        }
    };

    if meta.display_name.is_none() {
        meta.display_name = multimc_instance_name(instance_dir);
    }
    meta
}

fn icon_file_from_key(launcher_root: &Path, icon_key: &str) -> Option<std::path::PathBuf> {
    let icons_dir = launcher_root.join("icons");
    if !icons_dir.is_dir() {
        return None;
    }
    let candidates =
        ["png", "jpg", "jpeg", "webp", "gif"].map(|ext| icons_dir.join(format!("{icon_key}.{ext}")));
    for p in candidates {
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn multimc_icon(instance_dir: &Path, launcher_root: Option<&Path>) -> (Option<String>, Option<String>) {
    let icon_png = instance_dir.join("icon.png");
    if icon_png.is_file() {
        let icon_path = icon_png.to_str().map(|s| s.to_string());
        let data_uri = image_path_to_data_uri(&icon_png).ok().flatten();
        return (icon_path, data_uri);
    }

    for sub in ["minecraft", ".minecraft"] {
        let nested_icon = instance_dir.join(sub).join("icon.png");
        if nested_icon.is_file() {
            let icon_path = nested_icon.to_str().map(|s| s.to_string());
            let data_uri = image_path_to_data_uri(&nested_icon).ok().flatten();
            return (icon_path, data_uri);
        }
    }

    if let (Some(root), Some(key)) = (launcher_root, multimc_instance_icon_key(instance_dir)) {
        if let Some(p) = icon_file_from_key(root, &key) {
            let icon_path = p.to_str().map(|s| s.to_string());
            let data_uri = image_path_to_data_uri(&p).ok().flatten();
            return (icon_path, data_uri);
        }
    }

    (None, None)
}

pub fn scan_multimc_like_instances(
    launcher_type: ExternalLauncherType,
    launcher_root: Option<&Path>,
    instances_dir: &Path,
) -> Result<Vec<ImportableInstance>, String> {
    if !instances_dir.is_dir() {
        return Err("Папка instances не найдена".to_string());
    }

    let mut out: Vec<ImportableInstance> = Vec::new();
    let rd = std::fs::read_dir(instances_dir)
        .map_err(|e| format!("Не удалось прочитать папку instances: {e}"))?;
    for entry in rd {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }

        if !p.join("instance.cfg").is_file() && !p.join("mmc-pack.json").is_file() {
            continue;
        }

        let folder_name = entry.file_name().to_string_lossy().to_string();
        let meta = read_instance_loader_meta(launcher_type, &p);
        let display = meta
            .display_name
            .clone()
            .unwrap_or_else(|| folder_name.clone());
        let (approx_size_bytes, mods_count) = dir_size_and_mods_count(&p);
        let (icon_path, icon_data_uri) = multimc_icon(&p, launcher_root);

        out.push(ImportableInstance {
            id: folder_name,
            launcher_type,
            path: p.to_str().unwrap_or_default().to_string(),
            display_name: display,
            loader: meta.loader,
            game_version: meta.game_version,
            icon_path,
            icon_data_uri,
            approx_size_bytes,
            mods_count,
            last_modified: unix_mtime(&p),
        });
    }

    out.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));
    Ok(out)
}

fn looks_like_minecraft_instance_dir(dir: &Path) -> bool {
    dir.join("mods").is_dir()
        || dir.join(".minecraft").is_dir()
        || dir.join("minecraftinstance.json").is_file()
        || dir.join("manifest.json").is_file()
        || dir.join("instance.cfg").is_file()
        || dir.join("mmc-pack.json").is_file()
        || dir.join("instance.json").is_file()
        || dir.join("config.json").is_file()
}

pub fn scan_generic_instances(
    launcher_type: ExternalLauncherType,
    instances_dir: &Path,
) -> Result<Vec<ImportableInstance>, String> {
    if !instances_dir.is_dir() {
        return Err("Папка instances не найдена".to_string());
    }

    let mut out: Vec<ImportableInstance> = Vec::new();
    let rd = std::fs::read_dir(instances_dir)
        .map_err(|e| format!("Не удалось прочитать папку instances: {e}"))?;
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        if !looks_like_minecraft_instance_dir(&p) {
            continue;
        }

        let folder_name = entry.file_name().to_string_lossy().to_string();
        let meta = read_instance_loader_meta(launcher_type, &p);
        let (approx_size_bytes, mods_count) = dir_size_and_mods_count(&p);
        let mut icon_path: Option<String> = None;
        let mut icon_data_uri: Option<String> = None;
        for candidate in [
            p.join("icon.png"),
            p.join("minecraft").join("icon.png"),
            p.join(".minecraft").join("icon.png"),
        ] {
            if candidate.is_file() {
                icon_path = candidate.to_str().map(|s| s.to_string());
                icon_data_uri = image_path_to_data_uri(&candidate).ok().flatten();
                if icon_path.is_some() {
                    break;
                }
            }
        }

        out.push(ImportableInstance {
            id: folder_name.clone(),
            launcher_type,
            path: p.to_str().unwrap_or_default().to_string(),
            display_name: meta.display_name.unwrap_or(folder_name),
            loader: meta.loader,
            game_version: meta.game_version,
            icon_path,
            icon_data_uri,
            approx_size_bytes,
            mods_count,
            last_modified: unix_mtime(&p),
        });
    }

    out.sort_by(|a, b| a.display_name.to_lowercase().cmp(&b.display_name.to_lowercase()));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn unique_tmp_dir(name: &str) -> PathBuf {
        let mut base = std::env::temp_dir();
        base.push(format!(
            "mc16launcher-test-{}-{}",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        base
    }

    #[test]
    fn scan_multimc_like_finds_instance_cfg() {
        let root = unique_tmp_dir("scan-multimc");
        let instances = root.join("instances");
        let inst_dir = instances.join("TestInstance");
        fs::create_dir_all(&inst_dir).unwrap();
        fs::write(inst_dir.join("instance.cfg"), "name=My Profile\n").unwrap();
        fs::write(
            inst_dir.join("mmc-pack.json"),
            r#"{"components":[{"uid":"net.minecraft","version":"1.20.1"},{"uid":"net.fabricmc.fabric-loader","version":"0.15.0"}]}"#,
        )
        .unwrap();

        let list =
            scan_multimc_like_instances(ExternalLauncherType::PrismLauncher, None, &instances)
                .unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].display_name, "My Profile");
        assert_eq!(list[0].game_version.as_deref(), Some("1.20.1"));
        assert_eq!(list[0].loader.as_deref(), Some("fabric"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn scan_curseforge_reads_minecraftinstance_json() {
        let root = unique_tmp_dir("scan-curse");
        let instances = root.join("Instances");
        let inst_dir = instances.join("CoolPack");
        fs::create_dir_all(inst_dir.join("mods")).unwrap();
        fs::write(
            inst_dir.join("minecraftinstance.json"),
            r#"{"name":"Cool Pack","gameVersion":"1.20.1","baseModLoader":{"name":"forge-47.2.0","minecraftVersion":"1.20.1","forgeVersion":"47.2.0"}}"#,
        )
        .unwrap();

        let list = scan_generic_instances(ExternalLauncherType::CurseForge, &instances).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].display_name, "Cool Pack");
        assert_eq!(list[0].game_version.as_deref(), Some("1.20.1"));
        assert_eq!(list[0].loader.as_deref(), Some("forge"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn mods_count_includes_nested_minecraft_mods() {
        let root = unique_tmp_dir("mods-nested");
        let mods = root.join(".minecraft").join("mods");
        fs::create_dir_all(&mods).unwrap();
        fs::write(mods.join("a.jar"), b"x").unwrap();
        let (bytes, count) = dir_size_and_mods_count(&root);
        assert_eq!(count, Some(1));
        assert_eq!(bytes, Some(1));
        let _ = fs::remove_dir_all(&root);
    }
}
