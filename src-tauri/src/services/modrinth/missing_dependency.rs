use serde::Deserialize;

use super::client::{
    modrinth_get_json, modrinth_http_client, should_filter_by_loader, MODRINTH_API_BASE,
};
use super::types::ModrinthDownloadTarget;
use super::updates::load_profile_config;
use super::{install_modrinth_targets, resolve_latest_project_targets};

#[derive(Debug, Deserialize)]
struct SearchResponse {
    #[serde(default)]
    hits: Vec<SearchHit>,
}

#[derive(Debug, Deserialize)]
struct SearchHit {
    #[serde(default)]
    slug: String,
    #[serde(default)]
    title: String,
}

fn normalize(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

// id мода из лога не всегда совпадает со slug на Modrinth
fn known_slug_alias(mod_ref: &str) -> Option<&'static str> {
    match mod_ref {
        "fabric" | "fabricapi" => Some("fabric-api"),
        _ => None,
    }
}

fn slug_candidates(mod_ref: &str) -> Vec<String> {
    let lowered = mod_ref.trim().to_lowercase();
    let mut out: Vec<String> = Vec::new();
    if let Some(alias) = known_slug_alias(&normalize(&lowered)) {
        out.push(alias.to_string());
    }
    for c in [lowered.clone(), lowered.replace('_', "-")] {
        let valid = !c.is_empty()
            && c.chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'));
        if valid && !out.contains(&c) {
            out.push(c);
        }
    }
    out
}

async fn search_exact_slug(
    client: &reqwest::Client,
    mod_ref: &str,
    game_version: &str,
    loader: &str,
) -> Result<Option<String>, String> {
    let mut facets = vec![
        vec!["project_type:mod".to_string()],
        vec![format!("versions:{game_version}")],
    ];
    if should_filter_by_loader(loader) {
        facets.push(vec![format!("categories:{loader}")]);
    }
    let facets = serde_json::to_string(&facets).map_err(|e| e.to_string())?;
    let url = format!(
        "{MODRINTH_API_BASE}/search?query={}&limit=10&facets={}",
        urlencoding::encode(mod_ref),
        urlencoding::encode(&facets)
    );
    let found: SearchResponse = modrinth_get_json(client, &url, "поиск мода").await?;
    let key = normalize(mod_ref);
    Ok(found
        .hits
        .into_iter()
        .find(|h| normalize(&h.slug) == key || normalize(&h.title) == key)
        .map(|h| h.slug))
}

async fn resolve_targets(
    client: &reqwest::Client,
    mod_ref: &str,
    game_version: &str,
    loader: &str,
) -> Result<Option<Vec<ModrinthDownloadTarget>>, String> {
    for slug in slug_candidates(mod_ref) {
        // несуществующий slug даёт HTTP 404, это не ошибка: пробуем следующий вариант
        if let Ok(Some(targets)) =
            resolve_latest_project_targets(client, &slug, game_version, loader).await
        {
            return Ok(Some(targets));
        }
    }
    match search_exact_slug(client, mod_ref, game_version, loader).await? {
        Some(slug) => resolve_latest_project_targets(client, &slug, game_version, loader).await,
        None => Ok(None),
    }
}

/// Ставит в сборку мод, которого не хватает по логу, вместе с его обязательными
/// зависимостями. Берётся только точное совпадение slug или названия на Modrinth.
#[tauri::command]
pub async fn install_missing_mod_dependency(
    profile_id: String,
    mod_ref: String,
) -> Result<Vec<ModrinthDownloadTarget>, String> {
    let mod_ref = mod_ref.trim().to_string();
    if mod_ref.is_empty() {
        return Err("Не указан мод для установки".to_string());
    }
    let cfg = load_profile_config(&profile_id)?;
    let game_version = cfg.game_version.trim().to_string();
    let loader = cfg.loader.trim().to_lowercase();

    let client = modrinth_http_client();
    let mut targets = resolve_targets(&client, &mod_ref, &game_version, &loader)
        .await?
        .ok_or_else(|| {
            format!("Мод «{mod_ref}» не найден на Modrinth для {game_version} ({loader})")
        })?;
    install_modrinth_targets("mod", &mut targets, Some(&profile_id)).await?;
    Ok(targets)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_candidates_use_alias_and_dash_variant() {
        assert_eq!(slug_candidates("fabric")[0], "fabric-api");
        assert_eq!(
            slug_candidates("Cloth_Config"),
            vec!["cloth_config".to_string(), "cloth-config".to_string()]
        );
    }

    #[test]
    fn slug_candidates_reject_unsafe_refs() {
        assert!(slug_candidates("evil/../x?y=1").is_empty());
        assert!(slug_candidates("   ").is_empty());
    }
}
