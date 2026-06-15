use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Duration;

use reqwest::Client;
use sha1::{Digest, Sha1};

use crate::services::game::state::CANCEL_DOWNLOAD;
use crate::services::game::version_types::{Library, LibraryArtifact, LibraryDownloads, OsInfo};

pub(crate) fn fabric_intermediary_library(game_version: &str) -> Library {
    let name = format!("net.fabricmc:intermediary:{game_version}");
    let path = fabric_library_path(&name);
    Library {
        name,
        downloads: LibraryDownloads {
            artifact: Some(LibraryArtifact {
                path: path.clone(),
                url: format!("https://maven.fabricmc.net/{path}"),
                sha1: None,
                size: 0,
            }),
            classifiers: None,
        },
        rules: vec![],
        extract: None,
        natives: None,
    }
}

pub(crate) fn ensure_fabric_intermediary_library(libraries: &mut Vec<Library>, game_version: &str) {
    let token = format!("net.fabricmc:intermediary:{game_version}");
    if libraries.iter().any(|l| l.name == token) {
        return;
    }
    libraries.push(fabric_intermediary_library(game_version));
}

pub(crate) fn fabric_library_path(name: &str) -> String {
    let parts: Vec<&str> = name.splitn(3, ':').collect();
    if parts.len() < 3 {
        return format!("{name}.jar");
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    format!("{group}/{artifact}/{version}/{artifact}-{version}.jar")
}

pub(crate) fn current_os_name() -> &'static str {
    if std::env::consts::OS == "windows" {
        "windows"
    } else if std::env::consts::OS == "macos" {
        "osx"
    } else {
        "linux"
    }
}

pub(crate) fn current_os_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" | "aarch64" => "x86_64",
        _ => "x86",
    }
}

pub(crate) fn os_info() -> OsInfo {
    OsInfo {
        name: current_os_name().to_string(),
        arch: current_os_arch().to_string(),
    }
}

pub(crate) async fn download_text_with_retries(client: &Client, url: &str, retries: usize) -> Result<String, String> {
    let mut attempt: usize = 0;
    loop {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            return Err("Загрузка отменена пользователем".to_string());
        }
        let resp = client.get(url).send().await;
        match resp {
            Ok(r) => {
                let status = r.status();
                if status.is_success() {
                    return r.text().await.map_err(|e| format!("Ошибка чтения ответа: {e}"));
                }
                let should_retry = status.as_u16() == 404
                    || status.as_u16() == 408
                    || status.as_u16() == 429
                    || status.is_server_error();
                if !should_retry || attempt + 1 >= retries {
                    let body = r.text().await.unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
                    return Err(format!("HTTP {} для {}: {}", status, url, body));
                }
            }
            Err(e) => {
                if attempt + 1 >= retries {
                    return Err(format!("Ошибка запроса {url}: {e}"));
                }
            }
        }
        let delay_ms = (1000u64).saturating_mul(2u64.saturating_pow(attempt.min(6) as u32));
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        attempt += 1;
    }
}

pub(crate) fn sha1_hex_of_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(bytes);
    let out = hasher.finalize();
    format!("{:x}", out)
}

pub(crate) async fn sha1_hex_of_file(path: &Path) -> Result<String, String> {
    let data = tokio::fs::read(path)
        .await
        .map_err(|e| {
            format!(
                "Не удалось прочитать файл '{}' для SHA1: {e}",
                path.display()
            )
        })?;
    Ok(sha1_hex_of_bytes(&data))
}

pub(crate) async fn try_fetch_remote_sha1(client: &Client, url: &str) -> Option<String> {
    let sha1_url = format!("{url}.sha1");
    let text = download_text_with_retries(client, &sha1_url, 2).await.ok()?;
    let s = text.trim();
    if s.len() >= 40 {
        Some(s[..40].to_ascii_lowercase())
    } else {
        None
    }
}
pub(crate) fn library_applies(lib: &Library, os_name: &str) -> bool {
    if lib.rules.is_empty() {
        return true;
    }
    let current_arch = std::env::consts::ARCH;
    let mut allowed = false;
    for r in &lib.rules {
        if let Some(rule_os) = r.os.as_ref() {
            if let Some(name) = rule_os.name.as_deref() {
                if name != os_name {
                    continue;
                }
            }
            if let Some(arch) = rule_os.arch.as_deref() {
                if !current_arch.contains(arch) {
                    continue;
                }
            }
        }
        match r.action.as_str() {
            "allow" => allowed = true,
            "disallow" => return false,
            _ => {}
        }
    }
    allowed
}

pub(crate) fn parse_library_coords(name: &str) -> Option<(&str, &str, &str)> {
    let mut parts = name.splitn(3, ':');
    let group = parts.next()?;
    let artifact = parts.next()?;
    let version = parts.next()?;
    if group.is_empty() || artifact.is_empty() || version.is_empty() {
        return None;
    }
    Some((group, artifact, version))
}

pub(crate) fn compare_version_like(a: &str, b: &str) -> std::cmp::Ordering {
    let av = a
        .split(|c: char| !(c.is_ascii_alphanumeric()))
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>();
    let bv = b
        .split(|c: char| !(c.is_ascii_alphanumeric()))
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>();
    let n = av.len().max(bv.len());
    for i in 0..n {
        let aa = av.get(i).copied().unwrap_or("0");
        let bb = bv.get(i).copied().unwrap_or("0");
        let ord = match (aa.parse::<u64>(), bb.parse::<u64>()) {
            (Ok(na), Ok(nb)) => na.cmp(&nb),
            _ => aa.cmp(bb),
        };
        if ord != std::cmp::Ordering::Equal {
            return ord;
        }
    }
    std::cmp::Ordering::Equal
}

pub(crate) fn native_classifier_candidates(lib: &Library, os_name: &str) -> Vec<String> {
    let mut out = Vec::<String>::new();
    let is_64 = std::env::consts::ARCH == "x86_64";
    let base = match os_name {
        "windows" => "natives-windows",
        "osx" => "natives-macos",
        _ => "natives-linux",
    };
    out.push(base.to_string());
    if os_name == "windows" {
        if is_64 {
            out.push("natives-windows-64".to_string());
            out.push("natives-windows-x86_64".to_string());
        } else {
            out.push("natives-windows-32".to_string());
            out.push("natives-windows-x86".to_string());
        }
    }
    if let Some(map) = &lib.natives {
        if let Some(value) = map.get(os_name).and_then(|v| v.as_str()) {
            let replaced = value.replace("${arch}", if is_64 { "64" } else { "32" });
            out.push(replaced);
        }
    }
    out.sort();
    out.dedup();
    out
}

pub(crate) fn is_probably_native_jar_path(rel_path: &str) -> bool {
    let p = rel_path.replace('\\', "/").to_ascii_lowercase();
    p.ends_with(".jar") && p.contains("-natives-")
}

pub(crate) fn resolve_native_artifact<'a>(lib: &'a Library, os_name: &str) -> Option<&'a LibraryArtifact> {
    let classifiers = lib.downloads.classifiers.as_ref()?;
    for key in native_classifier_candidates(lib, os_name) {
        if let Some(artifact) = classifiers.get(&key) {
            return Some(artifact);
        }
    }
    None
}

