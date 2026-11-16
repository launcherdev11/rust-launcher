use std::collections::HashMap;
use std::path::Path;

use futures_util::stream::{self, StreamExt};
use reqwest::header::USER_AGENT;

use crate::infra::api_base::curseforge_api_base;
use crate::services::game::download::fetch_verified;
use crate::services::modrinth::client::{modrinth_http_client, MODRINTH_API_BASE};
use crate::services::modrinth::types::{ModrinthVersion, MODRINTH_USER_AGENT};

use super::SyncFile;

const MINECRAFT_GAME_ID: u32 = 432;
const BATCH: usize = 96;
const DOWNLOAD_CONCURRENCY: usize = 6;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfHash {
    value: String,
    algo: u32,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfFile {
    download_url: Option<String>,
    #[serde(default)]
    hashes: Vec<CfHash>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfMatch {
    file: CfFile,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfMatches {
    #[serde(default)]
    exact_matches: Vec<CfMatch>,
}

#[derive(serde::Deserialize)]
struct CfResponse {
    data: CfMatches,
}

async fn modrinth_urls(hashes: &[String]) -> HashMap<String, String> {
    let client = modrinth_http_client();
    let mut out = HashMap::new();
    for chunk in hashes.chunks(BATCH) {
        let body = serde_json::json!({ "hashes": chunk, "algorithm": "sha1" });
        let Ok(resp) = client
            .post(format!("{MODRINTH_API_BASE}/version_files"))
            .header(USER_AGENT, MODRINTH_USER_AGENT)
            .json(&body)
            .send()
            .await
        else {
            continue;
        };
        let Ok(map) = resp.json::<HashMap<String, ModrinthVersion>>().await else {
            continue;
        };
        for (sha1, version) in map {
            let file = version
                .files
                .iter()
                .find(|f| f.sha1_hex().as_deref() == Some(sha1.as_str()));
            if let Some(file) = file {
                out.insert(sha1, file.url.clone());
            }
        }
    }
    out
}

async fn curseforge_urls(files: &[&SyncFile]) -> HashMap<String, String> {
    let by_fingerprint: HashMap<u32, &SyncFile> = files
        .iter()
        .filter_map(|f| f.fingerprint.map(|fp| (fp, *f)))
        .collect();
    if by_fingerprint.is_empty() {
        return HashMap::new();
    }
    let client = crate::infra::http::http_client(false);
    let body = serde_json::json!({ "fingerprints": by_fingerprint.keys().collect::<Vec<_>>() });
    let Ok(resp) = client
        .post(format!("{}/fingerprints/{MINECRAFT_GAME_ID}", curseforge_api_base()))
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
    else {
        return HashMap::new();
    };
    let Ok(parsed) = resp.json::<CfResponse>().await else {
        return HashMap::new();
    };
    let wanted: HashMap<&str, &SyncFile> = files.iter().map(|f| (f.sha1.as_str(), *f)).collect();
    let mut out = HashMap::new();
    for m in parsed.data.exact_matches {
        let Some(url) = m.file.download_url.filter(|u| u.starts_with("https://")) else {
            continue;
        };
        let sha1 = m
            .file
            .hashes
            .iter()
            .find(|h| h.algo == 1)
            .map(|h| h.value.to_ascii_lowercase());
        if let Some(file) = sha1.as_deref().and_then(|s| wanted.get(s)) {
            out.insert(file.sha1.clone(), url);
        }
    }
    out
}

pub(super) async fn fetch_from_platforms(stage: &Path, files: &[SyncFile]) -> Vec<String> {
    if files.is_empty() {
        return Vec::new();
    }
    let hashes: Vec<String> = files.iter().map(|f| f.sha1.clone()).collect();
    let mut urls = modrinth_urls(&hashes).await;
    let rest: Vec<&SyncFile> = files.iter().filter(|f| !urls.contains_key(&f.sha1)).collect();
    urls.extend(curseforge_urls(&rest).await);

    let jobs: Vec<(String, String, String)> = files
        .iter()
        .filter_map(|f| urls.get(&f.sha1).map(|url| (f.path.clone(), f.sha1.clone(), url.clone())))
        .collect();
    let client = crate::infra::http::http_client(false);
    let stage = stage.to_path_buf();
    stream::iter(jobs)
        .map(move |(path, sha1, url)| {
            let client = client.clone();
            let dest = stage.join(&path);
            async move {
                fetch_verified(&client, &[url], &dest, Some(&sha1), None)
                    .await
                    .ok()
                    .map(|_| path)
            }
        })
        .buffer_unordered(DOWNLOAD_CONCURRENCY)
        .filter_map(|r| async move { r })
        .collect()
        .await
}
