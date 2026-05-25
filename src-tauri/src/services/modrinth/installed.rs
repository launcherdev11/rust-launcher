use std::collections::HashMap;
use std::path::Path;

use crate::services::game::core::sha1_hex_of_file;

use super::types::ModrinthDownloadTarget;

const PROFILE_ITEM_DISABLED_SUFFIX: &str = ".disabled";

fn profile_item_display_name(stored_name: &str) -> String {
    if stored_name.ends_with(PROFILE_ITEM_DISABLED_SUFFIX) {
        stored_name
            .strip_suffix(PROFILE_ITEM_DISABLED_SUFFIX)
            .unwrap_or(stored_name)
            .to_string()
    } else {
        stored_name.to_string()
    }
}

pub async fn index_content_dir_sha1(content_dir: &Path) -> Result<HashMap<String, String>, String> {
    let mut by_filename = HashMap::new();

    if !content_dir.is_dir() {
        return Ok(by_filename);
    }

    let mut read_dir = tokio::fs::read_dir(content_dir)
        .await
        .map_err(|e| format!("Ошибка чтения папки {:?}: {e}", content_dir))?;

    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| format!("Ошибка чтения записи в {:?}: {e}", content_dir))?
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(stored_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let display_name = profile_item_display_name(stored_name);
        let sha1 = sha1_hex_of_file(&path).await?;
        by_filename.insert(display_name, sha1);
    }

    Ok(by_filename)
}

pub fn target_already_installed(
    installed: &HashMap<String, String>,
    target: &ModrinthDownloadTarget,
) -> bool {
    let Some(existing_sha1) = installed.get(&target.filename) else {
        return false;
    };

    match target.sha1.as_ref() {
        Some(expected) => existing_sha1.eq_ignore_ascii_case(expected),
        None => true,
    }
}

pub fn mark_skipped_already_installed(
    targets: &mut [ModrinthDownloadTarget],
    installed: &HashMap<String, String>,
) {
    for target in targets.iter_mut() {
        if target_already_installed(installed, target) {
            target.skipped = true;
        }
    }
}
