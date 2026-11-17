use std::collections::HashSet;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

use futures_util::stream::{self, StreamExt};
use serde::Deserialize;
use tauri::AppHandle;

use crate::infra::http::http_client_for_binary_download;
use crate::services::game::console::log_to_console;
use crate::services::game::runtime::download_file_checked;
use crate::services::game::state::{CANCEL_DOWNLOAD, DEFAULT_DOWNLOAD_RETRIES};

const PREFETCH_CONCURRENCY: usize = 8;

#[derive(Deserialize)]
struct InstallerJson {
    #[serde(default)]
    libraries: Vec<InstallerLibrary>,
}

#[derive(Deserialize)]
struct InstallerLibrary {
    #[serde(default)]
    downloads: Option<InstallerDownloads>,
}

#[derive(Deserialize)]
struct InstallerDownloads {
    #[serde(default)]
    artifact: Option<InstallerArtifact>,
}

#[derive(Deserialize)]
struct InstallerArtifact {
    #[serde(default)]
    path: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    sha1: Option<String>,
    #[serde(default)]
    size: u64,
}

struct PrefetchItem {
    url: String,
    path: PathBuf,
    sha1: Option<String>,
    size: u64,
}

fn is_safe_relative(rel: &str) -> bool {
    let path = Path::new(rel);
    !rel.contains(':')
        && path
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

fn collect_items(installer: &Path, libs_root: &Path) -> Result<Vec<PrefetchItem>, String> {
    let file = std::fs::File::open(installer)
        .map_err(|e| format!("Не удалось открыть installer: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Installer повреждён: {e}"))?;

    let mut items = Vec::new();
    let mut seen = HashSet::new();
    for name in ["install_profile.json", "version.json"] {
        let mut text = String::new();
        match archive.by_name(name) {
            Ok(mut entry) => {
                if entry.read_to_string(&mut text).is_err() {
                    continue;
                }
            }
            Err(_) => continue,
        }
        let Ok(parsed) = serde_json::from_str::<InstallerJson>(&text) else {
            continue;
        };
        for lib in parsed.libraries {
            let Some(artifact) = lib.downloads.and_then(|d| d.artifact) else {
                continue;
            };
            let url = artifact.url.trim();
            let rel = artifact.path.trim();
            if !url.starts_with("https://") && !url.starts_with("http://") {
                continue;
            }
            if rel.is_empty() || !is_safe_relative(rel) || !seen.insert(rel.to_string()) {
                continue;
            }
            items.push(PrefetchItem {
                url: url.to_string(),
                path: libs_root.join(rel),
                sha1: artifact.sha1.filter(|s| !s.trim().is_empty()),
                size: artifact.size,
            });
        }
    }

    items.retain(|item| {
        let Ok(rel) = item.path.strip_prefix(libs_root) else {
            return true;
        };
        let rel = rel.to_string_lossy().replace('\\', "/");
        archive.by_name(&format!("maven/{rel}")).is_err()
    });
    Ok(items)
}

pub(crate) async fn prefetch_installer_libraries(
    app: &AppHandle,
    installer: &Path,
    libs_root: &Path,
    version_id: &str,
) {
    let probe_installer = installer.to_path_buf();
    let probe_libs = libs_root.to_path_buf();
    let items = match tokio::task::spawn_blocking(move || collect_items(&probe_installer, &probe_libs)).await {
        Ok(Ok(items)) => items,
        Ok(Err(e)) => {
            log_to_console(app, &format!("[Forge] Предзагрузка библиотек пропущена: {e}"));
            return;
        }
        Err(e) => {
            log_to_console(app, &format!("[Forge] Предзагрузка библиотек пропущена: {e}"));
            return;
        }
    };
    if items.is_empty() {
        return;
    }

    log_to_console(
        app,
        &format!("[Forge] Предзагрузка библиотек установщика: {}", items.len()),
    );

    let client = http_client_for_binary_download(false);
    let total_size: u64 = items.iter().map(|i| i.size).sum();
    let total_done = Arc::new(AtomicU64::new(0));
    let failed = Arc::new(AtomicUsize::new(0));

    stream::iter(items)
        .for_each_concurrent(PREFETCH_CONCURRENCY, |item| {
            let client = client.clone();
            let total_done = total_done.clone();
            let failed = failed.clone();
            async move {
                if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
                    return;
                }
                if let Err(e) = download_file_checked(
                    &client,
                    &item.url,
                    &item.path,
                    item.sha1,
                    app,
                    version_id,
                    total_size,
                    total_done,
                    DEFAULT_DOWNLOAD_RETRIES,
                )
                .await
                {
                    failed.fetch_add(1, Ordering::SeqCst);
                    log_to_console(app, &format!("[Forge] Не удалось скачать {}: {e}", item.url));
                }
            }
        })
        .await;

    let failed = failed.load(Ordering::SeqCst);
    if failed > 0 {
        log_to_console(
            app,
            &format!("[Forge] Не скачано библиотек: {failed}, установщик попробует сам"),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::is_safe_relative;

    #[test]
    fn rejects_paths_outside_libraries() {
        assert!(is_safe_relative("net/neoforged/neoforge/21.1.1/neoforge-21.1.1-universal.jar"));
        assert!(!is_safe_relative("../evil.jar"));
        assert!(!is_safe_relative("/etc/passwd"));
        assert!(!is_safe_relative("C:/Windows/evil.jar"));
    }
}
