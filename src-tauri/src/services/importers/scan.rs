use std::path::Path;
use std::time::UNIX_EPOCH;

use base64::Engine;

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

use super::types::{ExternalLauncherType, ImportableInstance};

fn unix_mtime(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

fn dir_size_and_mods_count(instance_dir: &Path) -> (Option<u64>, Option<u32>) {
    let mods_dir = instance_dir.join("mods");
    if !mods_dir.is_dir() {
        return (None, None);
    }
    let mut bytes: u64 = 0;
    let mut count: u32 = 0;
    let mut stack = vec![mods_dir];
    while let Some(p) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&p) else { continue };
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

fn multimc_component_loader_and_version(instance_dir: &Path) -> (Option<String>, Option<String>) {
    let mmc_pack = instance_dir.join("mmc-pack.json");
    if let Ok(text) = std::fs::read_to_string(mmc_pack) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            let components = v.get("components").and_then(|c| c.as_array()).cloned().unwrap_or_default();
            let mut game_version: Option<String> = None;
            let mut loader: Option<String> = None;
            for c in components {
                let uid = c.get("uid").and_then(|x| x.as_str()).unwrap_or("");
                let ver = c.get("version").and_then(|x| x.as_str()).map(|s| s.to_string());
                match uid {
                    "net.minecraft" => {
                        if game_version.is_none() {
                            game_version = ver;
                        }
                    }
                    "net.fabricmc.fabric-loader" => loader = Some("fabric".to_string()),
                    "net.minecraftforge" => loader = Some("forge".to_string()),
                    "org.quiltmc.quilt-loader" => loader = Some("quilt".to_string()),
                    "net.neoforged" => loader = Some("neoforge".to_string()),
                    _ => {}
                }
            }
            return (loader, game_version);
        }
    }
    (None, None)
}

fn icon_file_from_key(launcher_root: &Path, icon_key: &str) -> Option<std::path::PathBuf> {
    let icons_dir = launcher_root.join("icons");
    if !icons_dir.is_dir() {
        return None;
    }
    let candidates = ["png", "jpg", "jpeg", "webp", "gif"].map(|ext| icons_dir.join(format!("{icon_key}.{ext}")));
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
        let display = multimc_instance_name(&p).unwrap_or_else(|| folder_name.clone());
        let (loader, game_version) = multimc_component_loader_and_version(&p);
        let (approx_size_bytes, mods_count) = dir_size_and_mods_count(&p);
        let (icon_path, icon_data_uri) = multimc_icon(&p, launcher_root);

        out.push(ImportableInstance {
            id: folder_name,
            launcher_type,
            path: p.to_str().unwrap_or_default().to_string(),
            display_name: display,
            loader,
            game_version,
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
            display_name: folder_name,
            loader: None,
            game_version: None,
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
            scan_multimc_like_instances(ExternalLauncherType::PrismLauncher, None, &instances).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].display_name, "My Profile");
        assert_eq!(list[0].game_version.as_deref(), Some("1.20.1"));

        let _ = fs::remove_dir_all(&root);
    }
}

