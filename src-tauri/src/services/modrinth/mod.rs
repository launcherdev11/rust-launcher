pub(crate) mod client;
mod conflicts;
mod content_metadata;
mod dependencies;
mod installed;
mod jar_compat;
pub(crate) mod types;
mod updates;

pub use types::ModrinthDownloadTarget;
pub use content_metadata::resolve_profile_item_metadata;
pub use conflicts::scan_profile_mod_jars;
pub use updates::{
    apply_profile_content_updates, check_profile_content_updates,
    check_profile_incompatible_content,
};

use std::path::PathBuf;

use client::{modrinth_get_json, modrinth_http_client, project_versions_url};
use dependencies::collect_modrinth_required_downloads;
use types::ModrinthVersion;
use futures_util::stream::{self, StreamExt};
use installed::{index_content_dir_sha1_for, mark_skipped_already_installed};

use crate::app::paths::{game_root_dir, instance_dir};
use crate::services::game::download::{modrinth_content_subdir, save_modrinth_file};

const DOWNLOAD_CONCURRENCY: usize = 12;

fn modrinth_content_dir(
    category: &str,
    profile_id: Option<&str>,
) -> Result<PathBuf, String> {
    let root = if let Some(id) = profile_id {
        instance_dir(id)?
    } else {
        game_root_dir()?
    };
    Ok(root.join(modrinth_content_subdir(category)?))
}

pub(crate) async fn resolve_latest_project_targets(
    client: &reqwest::Client,
    project_id: &str,
    game_version: &str,
    loader: &str,
) -> Result<Option<Vec<ModrinthDownloadTarget>>, String> {
    let url = project_versions_url(project_id, game_version, loader);
    let versions: Vec<ModrinthVersion> =
        modrinth_get_json(client, &url, &format!("версии проекта {project_id}")).await?;
    let Some(latest) = versions.into_iter().next() else {
        return Ok(None);
    };
    collect_modrinth_required_downloads(client, &latest.id, game_version, loader)
        .await
        .map(Some)
}

pub(crate) async fn install_modrinth_targets(
    category: &str,
    targets: &mut [ModrinthDownloadTarget],
    profile_id: Option<&str>,
) -> Result<(), String> {
    let content_dir = modrinth_content_dir(category, profile_id)?;
    let target_names: Vec<&str> = targets.iter().map(|t| t.filename.as_str()).collect();
    let installed_index = index_content_dir_sha1_for(&content_dir, &target_names).await?;
    mark_skipped_already_installed(targets, &installed_index);

    let pending: Vec<(String, String, Option<String>)> = targets
        .iter()
        .filter(|t| !t.skipped)
        .map(|t| (t.url.clone(), t.filename.clone(), t.sha1.clone()))
        .collect();
    if pending.is_empty() {
        return Ok(());
    }
    let results: Vec<Result<(), String>> = stream::iter(pending.into_iter())
        .map(|(url, filename, sha1)| async move {
            save_modrinth_file(category, &url, &filename, profile_id, sha1.as_deref()).await
        })
        .buffer_unordered(DOWNLOAD_CONCURRENCY)
        .collect()
        .await;
    results.into_iter().collect()
}

#[tauri::command]
pub async fn download_modrinth_with_dependencies(
    category: String,
    version_id: String,
    game_version: String,
    loader: String,
    profile_id: Option<String>,
) -> Result<Vec<ModrinthDownloadTarget>, String> {
    let client = modrinth_http_client();
    let mut targets =
        collect_modrinth_required_downloads(&client, &version_id, &game_version, &loader).await?;
    install_modrinth_targets(&category, &mut targets, profile_id.as_deref()).await?;
    Ok(targets)
}
