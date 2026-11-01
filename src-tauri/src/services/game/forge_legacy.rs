use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::infra::http::http_client_for_binary_download;
use crate::services::game::console::log_to_console;
use crate::services::game::runtime::download_file_checked;
use crate::services::game::state::CANCEL_DOWNLOAD;

const MOJANG_LIBRARIES: &str = "https://libraries.minecraft.net/";
const FORGE_MAVEN: &str = "https://maven.minecraftforge.net/";
const MAVEN_CENTRAL: &str = "https://repo1.maven.org/maven2/";

pub(crate) struct LegacyInstallProfile {
    version_info: Map<String, Value>,
    universal_entry: String,
    universal_coords: String,
}

pub(crate) fn read_legacy_install_profile(
    installer: &Path,
) -> Result<Option<LegacyInstallProfile>, String> {
    let file = std::fs::File::open(installer)
        .map_err(|e| format!("Не удалось открыть Forge installer: {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Forge installer повреждён: {e}"))?;
    let mut text = String::new();
    match archive.by_name("install_profile.json") {
        Ok(mut entry) => {
            entry
                .read_to_string(&mut text)
                .map_err(|e| format!("Не удалось прочитать install_profile.json: {e}"))?;
        }
        Err(_) => return Ok(None),
    }
    parse_legacy_install_profile(&text)
}

fn parse_legacy_install_profile(text: &str) -> Result<Option<LegacyInstallProfile>, String> {
    let root: Value = serde_json::from_str(text)
        .map_err(|e| format!("Ошибка разбора install_profile.json: {e}"))?;
    let Some(version_info) = root.get("versionInfo").and_then(Value::as_object).cloned() else {
        return Ok(None);
    };
    let install = root.get("install").and_then(Value::as_object);
    let field = |key: &str| {
        install
            .and_then(|i| i.get(key))
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| format!("В install_profile.json нет install.{key}"))
    };
    Ok(Some(LegacyInstallProfile {
        version_info,
        universal_entry: field("filePath")?,
        universal_coords: field("path")?,
    }))
}

fn maven_path(coords: &str) -> Option<String> {
    let (coords, ext) = coords.split_once('@').unwrap_or((coords, "jar"));
    let mut parts = coords.split(':');
    let group = parts.next().filter(|s| !s.is_empty())?;
    let artifact = parts.next().filter(|s| !s.is_empty())?;
    let version = parts.next().filter(|s| !s.is_empty())?;
    let classifier = parts.next().filter(|s| !s.is_empty());
    let file = match classifier {
        Some(c) => format!("{artifact}-{version}-{c}.{ext}"),
        None => format!("{artifact}-{version}.{ext}"),
    };
    Some(format!("{}/{artifact}/{version}/{file}", group.replace('.', "/")))
}

fn normalize_repo_base(url: &str) -> String {
    let mut base = url.trim().to_string();
    if let Some(rest) = base.strip_prefix("http://") {
        base = format!("https://{rest}");
    }
    base = base.replace(
        "https://files.minecraftforge.net/maven",
        FORGE_MAVEN.trim_end_matches('/'),
    );
    if !base.ends_with('/') {
        base.push('/');
    }
    base
}

fn library_sources(declared: Option<&str>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Some(url) = declared.filter(|u| !u.trim().is_empty()) {
        out.push(normalize_repo_base(url));
    }
    for base in [MOJANG_LIBRARIES, MAVEN_CENTRAL, FORGE_MAVEN] {
        if !out.iter().any(|b| b == base) {
            out.push(base.to_string());
        }
    }
    out
}

fn extract_universal(installer: &Path, entry: &str, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(installer)
        .map_err(|e| format!("Не удалось открыть Forge installer: {e}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Forge installer повреждён: {e}"))?;
    let mut src = archive
        .by_name(entry)
        .map_err(|e| format!("В установщике нет {entry}: {e}"))?;
    let mut bytes = Vec::with_capacity(src.size() as usize);
    src.read_to_end(&mut bytes)
        .map_err(|e| format!("Не удалось распаковать {entry}: {e}"))?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    }
    crate::infra::fs_atomic::write_atomic(dest, &bytes)
        .map_err(|e| format!("Не удалось записать {}: {e}", dest.display()))
}

pub(crate) async fn install_legacy_forge(
    app: &AppHandle,
    profile: LegacyInstallProfile,
    installer: &Path,
    version_id: &str,
    mc_version: &str,
    libs_root: &Path,
    vers_root: &Path,
) -> Result<(), String> {
    log_to_console(
        app,
        "[Forge] Старый формат установщика: ставим клиент из install_profile.json",
    );

    let universal_path = maven_path(&profile.universal_coords)
        .ok_or_else(|| format!("Некорректный install.path: {}", profile.universal_coords))?;
    {
        let installer = installer.to_path_buf();
        let entry = profile.universal_entry.clone();
        let dest = libs_root.join(&universal_path);
        tokio::task::spawn_blocking(move || extract_universal(&installer, &entry, &dest))
            .await
            .map_err(|e| format!("Ошибка распаковки Forge: {e}"))??;
    }

    let mut info = profile.version_info;
    let full_json = info.get("inheritsFrom").and_then(Value::as_str).is_none();
    info.insert("id".into(), Value::String(version_id.to_string()));
    if full_json {
        info.insert("inheritsFrom".into(), Value::String(mc_version.to_string()));
    }
    info.entry("jar")
        .or_insert_with(|| Value::String(mc_version.to_string()));

    let client = http_client_for_binary_download(false);
    let total_done = Arc::new(AtomicU64::new(0));
    let source_libs = info
        .get("libraries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut libraries = Vec::with_capacity(source_libs.len());

    for lib in source_libs {
        let Some(obj) = lib.as_object() else { continue };
        let Some(name) = obj.get("name").and_then(Value::as_str) else { continue };
        if obj.get("clientreq").and_then(Value::as_bool) == Some(false) {
            continue;
        }
        if obj.contains_key("downloads") {
            libraries.push(lib.clone());
            continue;
        }
        
        if obj.contains_key("natives") {
            continue;
        }
        let Some(path) = maven_path(name) else { continue };
        let dest = libs_root.join(&path);

        let url = if path == universal_path {
            let universal = maven_path(&format!("{}:universal", profile.universal_coords))
                .unwrap_or_else(|| path.clone());
            format!("{FORGE_MAVEN}{universal}")
        } else {
            let mut errors = Vec::new();
            let mut found = None;
            for base in library_sources(obj.get("url").and_then(Value::as_str)) {
                let url = format!("{base}{path}");
                match download_file_checked(
                    &client,
                    &url,
                    &dest,
                    None,
                    app,
                    version_id,
                    0,
                    total_done.clone(),
                    2,
                )
                .await
                {
                    Ok(_) => {
                        found = Some(url);
                        break;
                    }
                    Err(e) => {
                        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
                            return Err(e);
                        }
                        errors.push(e);
                    }
                }
            }
            found.ok_or_else(|| {
                format!("Не удалось скачать библиотеку {name}: {}", errors.join("; "))
            })?
        };

        let size = tokio::fs::metadata(&dest).await.map(|m| m.len()).unwrap_or(0);
        libraries.push(json!({
            "name": name,
            "downloads": { "artifact": { "path": path, "url": url, "size": size } }
        }));
    }
    info.insert("libraries".into(), Value::Array(libraries));

    let version_dir = vers_root.join(version_id);
    tokio::fs::create_dir_all(&version_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку версии: {e}"))?;
    let text = serde_json::to_string_pretty(&Value::Object(info))
        .map_err(|e| format!("Не удалось собрать JSON версии: {e}"))?;
    crate::infra::fs_atomic::write_atomic(
        &version_dir.join(format!("{version_id}.json")),
        text.as_bytes(),
    )
    .map_err(|e| format!("Не удалось записать JSON версии: {e}"))?;

    log_to_console(app, &format!("[Forge] Установлено: {version_id}"));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maven_path_handles_classifier_and_ext() {
        assert_eq!(
            maven_path("net.minecraftforge:forge:1.7.10-10.13.4.1614-1.7.10").as_deref(),
            Some("net/minecraftforge/forge/1.7.10-10.13.4.1614-1.7.10/forge-1.7.10-10.13.4.1614-1.7.10.jar")
        );
        assert_eq!(
            maven_path("org.lwjgl:lwjgl-platform:2.9.1:natives-windows").as_deref(),
            Some("org/lwjgl/lwjgl-platform/2.9.1/lwjgl-platform-2.9.1-natives-windows.jar")
        );
        assert_eq!(maven_path("a:b:1@zip").as_deref(), Some("a/b/1/b-1.zip"));
        assert!(maven_path("broken").is_none());
    }

    #[test]
    fn forge_repo_is_rewritten_and_fallbacks_follow() {
        let sources = library_sources(Some("http://files.minecraftforge.net/maven/"));
        assert_eq!(sources[0], FORGE_MAVEN);
        assert_eq!(sources.len(), 3);
        assert_eq!(library_sources(None)[0], MOJANG_LIBRARIES);
    }

    #[test]
    fn detects_legacy_profile_only() {
        let legacy = r#"{
            "install": { "path": "net.minecraftforge:forge:1.7.10-10.13.4.1614-1.7.10",
                         "filePath": "forge-1.7.10-10.13.4.1614-1.7.10-universal.jar" },
            "versionInfo": { "id": "x", "mainClass": "net.minecraft.launchwrapper.Launch", "libraries": [] }
        }"#;
        let parsed = parse_legacy_install_profile(legacy).unwrap().unwrap();
        assert_eq!(parsed.universal_entry, "forge-1.7.10-10.13.4.1614-1.7.10-universal.jar");

        let modern = r#"{ "spec": 1, "version": "1.20.1-forge-47.2.0", "libraries": [] }"#;
        assert!(parse_legacy_install_profile(modern).unwrap().is_none());
    }
}
