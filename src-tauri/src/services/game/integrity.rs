use std::path::Path;

use crate::app::paths::{game_root_dir, libraries_dir, versions_dir};
use crate::infra::http::http_client;
use crate::services::game::core::{
    current_os_name, download_text_with_retries, library_applies, resolve_native_artifact,
    sha1_hex_of_bytes,
};
use crate::services::game::state::DEFAULT_DOWNLOAD_RETRIES;
use crate::services::game::version_types::{VersionDetail, VersionIntegrityCheckResult};
use crate::services::game::versions::get_mojang_version_url;

#[tauri::command]
pub async fn check_version_files_integrity(
    version_id: String,
    version_url: Option<String>,
) -> Result<VersionIntegrityCheckResult, String> {
    let root = game_root_dir()?;
    let libs_root = libraries_dir()?;
    let vers_root = versions_dir()?;
    let os_name = current_os_name();
    let version_json_path = vers_root.join(&version_id).join(format!("{version_id}.json"));

    let mut detail: VersionDetail = if let Some(ref url) = version_url {
        let client = http_client(false);
        let version_json_text =
            download_text_with_retries(&client, url, DEFAULT_DOWNLOAD_RETRIES).await?;
        serde_json::from_str(&version_json_text)
            .map_err(|e| format!("Ошибка разбора описания версии: {e}"))?
    } else if version_json_path.exists() {
        let s = tokio::fs::read_to_string(&version_json_path)
            .await
            .map_err(|e| format!("Ошибка чтения установленного version.json: {e}"))?;
        serde_json::from_str(&s)
            .map_err(|e| format!("Ошибка разбора установленного version.json: {e}"))?
    } else {
        return Err(
            "Для проверки файлов не найден локальный version.json и не передан versionUrl."
                .to_string(),
        );
    };

    let mut effective_jar_version = version_id.clone();
    if let Some(parent_id) = detail.inherits_from.clone() {
        effective_jar_version = parent_id.clone();
        let parent_json_path = vers_root.join(&parent_id).join(format!("{parent_id}.json"));
        let parent_detail: VersionDetail = if parent_json_path.exists() {
            let s = tokio::fs::read_to_string(&parent_json_path)
                .await
                .map_err(|e| format!("Ошибка чтения parent version.json: {e}"))?;
            serde_json::from_str(&s)
                .map_err(|e| format!("Ошибка разбора parent version.json: {e}"))?
        } else if version_url.is_some() {
            let url = get_mojang_version_url(&parent_id).await?;
            let client = http_client(false);
            let text = download_text_with_retries(&client, &url, DEFAULT_DOWNLOAD_RETRIES).await?;
            serde_json::from_str(&text)
                .map_err(|e| format!("Ошибка разбора parent версии: {e}"))?
        } else {
            return Err(format!(
                "Не найден parent version.json для '{}'. Переустановите версию.",
                parent_id
            ));
        };

        let mut merged_libs = parent_detail.libraries;
        merged_libs.extend(detail.libraries);
        let mut merged_args = parent_detail.arguments;
        merged_args.jvm.extend(detail.arguments.jvm);
        merged_args.game.extend(detail.arguments.game);

        detail.downloads = detail.downloads.or(parent_detail.downloads);
        detail.asset_index = detail.asset_index.or(parent_detail.asset_index);
        detail.assets = detail.assets.or(parent_detail.assets);
        detail.java_version = detail.java_version.or(parent_detail.java_version);
        detail.libraries = merged_libs;
        detail.arguments = merged_args;
    }

    let mut checked_files: u32 = 0;
    let mut missing_files: u32 = 0;
    let mut corrupted_files: u32 = 0;

    let mut check_one = |path: &Path, expected_sha1: Option<&str>| {
        checked_files = checked_files.saturating_add(1);
        if !path.exists() {
            missing_files = missing_files.saturating_add(1);
            return;
        }
        if let Some(expected) = expected_sha1 {
            let expected_lc = expected.trim().to_ascii_lowercase();
            if expected_lc.len() == 40 {
                if let Ok(actual) = std::fs::read(path).map(|bytes| sha1_hex_of_bytes(&bytes)) {
                    if actual != expected_lc {
                        corrupted_files = corrupted_files.saturating_add(1);
                    }
                } else {
                    corrupted_files = corrupted_files.saturating_add(1);
                }
            }
        }
    };

    check_one(&version_json_path, None);

    if let Some(downloads) = detail.downloads.as_ref() {
        let client_jar = root.join(format!("{effective_jar_version}.jar"));
        check_one(&client_jar, downloads.client.sha1.as_deref());
    }

    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }

        if let Some(ref artifact) = lib.downloads.artifact {
            let path = libs_root.join(&artifact.path);
            check_one(&path, artifact.sha1.as_deref());
        }

        if let Some(nat) = resolve_native_artifact(lib, os_name) {
            let path = libs_root.join(&nat.path);
            check_one(&path, nat.sha1.as_deref());
        }
    }

    let is_ok = missing_files == 0 && corrupted_files == 0;
    Ok(VersionIntegrityCheckResult {
        is_ok,
        checked_files,
        missing_files,
        corrupted_files,
    })
}
