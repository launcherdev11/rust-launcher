use reqwest::header::USER_AGENT;

use super::types::MODRINTH_USER_AGENT;

pub const MODRINTH_API_BASE: &str = "https://api.modrinth.com/v2";

pub fn modrinth_http_client() -> reqwest::Client {
    use crate::infra::http::http_client;
    http_client(false)
}

pub async fn modrinth_get_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    url: &str,
    context: &str,
) -> Result<T, String> {
    let resp = client
        .get(url)
        .header(USER_AGENT, MODRINTH_USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("{context}: сеть: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "{context}: Modrinth HTTP {}",
            resp.status()
        ));
    }

    resp.json::<T>()
        .await
        .map_err(|e| format!("{context}: ошибка разбора JSON: {e}"))
}

pub fn project_versions_url(project_id: &str, game_version: &str, loader: &str) -> String {
    let game_versions = serde_json::to_string(&[game_version])
        .unwrap_or_else(|_| format!("[\"{game_version}\"]"));
    let mut url = format!(
        "{MODRINTH_API_BASE}/project/{project_id}/version?game_versions={}",
        urlencoding::encode(&game_versions)
    );
    if should_filter_by_loader(loader) {
        let loaders = serde_json::to_string(&[loader])
            .unwrap_or_else(|_| format!("[\"{loader}\"]"));
        url.push_str("&loaders=");
        url.push_str(&urlencoding::encode(&loaders));
    }
    url
}

pub fn should_filter_by_loader(loader: &str) -> bool {
    let l = loader.trim().to_ascii_lowercase();
    !l.is_empty() && l != "any" && l != "vanilla"
}
