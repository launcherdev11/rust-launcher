use serde::{Deserialize, Serialize};

use crate::app::paths::{game_root_dir, instance_dir};
use crate::infra::http::{http_client, http_client_for_binary_download};

const CF_API_BASE: &str = "https://api.curseforge.com/v1";
const MINECRAFT_GAME_ID: u32 = 432;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurseforgeModHit {
    pub id: u32,
    pub slug: String,
    pub name: String,
    pub summary: String,
    pub download_count: u64,
    pub thumbnail_url: Option<String>,
    pub author: String,
    pub class_id: u32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurseforgeSearchResult {
    pub hits: Vec<CurseforgeModHit>,
    pub index: u32,
    pub page_size: u32,
    pub total_count: u32,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CurseforgeFileHit {
    pub id: u32,
    pub display_name: String,
    pub file_name: String,
    pub download_url: Option<String>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub file_date: String,
}

#[derive(Debug, Deserialize)]
struct CfApiResponse<T> {
    data: T,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfPagination {
    #[serde(default)]
    total_count: u32,
    #[serde(default)]
    index: u32,
    #[serde(default)]
    page_size: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfSearchModsResponse {
    data: Vec<CfMod>,
    pagination: CfPagination,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfMod {
    id: u32,
    slug: String,
    name: String,
    summary: String,
    download_count: u64,
    class_id: u32,
    authors: Vec<CfAuthor>,
    logo: Option<CfLogo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfAuthor {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfLogo {
    thumbnail_url: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfModFilesResponse {
    data: Vec<CfFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfFile {
    id: u32,
    display_name: String,
    file_name: String,
    download_url: Option<String>,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    sortable_game_versions: Vec<CfSortableGameVersion>,
    file_date: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfSortableGameVersion {
    #[serde(default)]
    game_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfMinecraftVersion {
    version: String,
}

fn curseforge_api_key() -> Result<String, String> {
    std::env::var("CURSEFORGE_API_KEY")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            option_env!("CURSEFORGE_API_KEY")
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        })
        .ok_or_else(|| {
            "CURSEFORGE_API_KEY не задан. Добавьте ключ API CurseForge в файл .env (значения с символом $ укажите в одинарных кавычках).".to_string()
        })
}

fn class_id_for_content_type(content_type: &str) -> Result<u32, String> {
    match content_type {
        "mod" => Ok(6),
        "resourcepack" => Ok(12),
        "shader" => Ok(6552),
        "modpack" => Ok(4471),
        other => Err(format!(
            "Неизвестный тип контента CurseForge: {other}. Ожидается mod, resourcepack, shader или modpack."
        )),
    }
}

fn loaders_from_filename(file_name: &str) -> Vec<String> {
    let n = file_name.to_lowercase();
    let mut out = Vec::new();
    if n.contains("neoforge") {
        out.push("neoforge".to_string());
    } else if n.contains("forge") {
        out.push("forge".to_string());
    }
    if n.contains("fabric") {
        out.push("fabric".to_string());
    }
    if n.contains("quilt") {
        out.push("quilt".to_string());
    }
    out
}

fn is_minecraft_release_version(version: &str) -> bool {
    let mut parts = version.split('.');
    let major = parts.next();
    let minor = parts.next();
    major == Some("1") && minor.is_some_and(|m| m.chars().all(|c| c.is_ascii_digit()))
}

fn mod_loader_type(loader: &str) -> Option<u8> {
    match loader {
        "forge" => Some(1),
        "fabric" => Some(4),
        "quilt" => Some(5),
        "neoforge" => Some(6),
        _ => None,
    }
}

fn cf_client() -> Result<reqwest::Client, String> {
    Ok(http_client(false))
}

async fn cf_get_json<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    path_and_query: &str,
) -> Result<T, String> {
    let api_key = curseforge_api_key()?;
    let url = format!("{CF_API_BASE}{path_and_query}");
    let resp = client
        .get(&url)
        .header("x-api-key", api_key)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса CurseForge API: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        let detail = if body.is_empty() {
            String::new()
        } else {
            format!(": {body}")
        };
        let hint = if status.as_u16() == 403
            && body.contains("API Key")
        {
            " Проверьте CURSEFORGE_API_KEY в .env: ключ CurseForge начинается с $2a$ — оберните значение в одинарные кавычки, чтобы dotenv не обрезал его."
        } else {
            ""
        };
        return Err(format!(
            "CurseForge API вернул ошибку {status}{detail}{hint}"
        ));
    }

    resp.json::<T>()
        .await
        .map_err(|e| format!("Ошибка разбора ответа CurseForge API: {e}"))
}

#[tauri::command]
pub async fn curseforge_list_minecraft_versions() -> Result<Vec<String>, String> {
    let client = cf_client()?;
    let body: CfApiResponse<Vec<CfMinecraftVersion>> =
        cf_get_json(&client, "/minecraft/version").await?;
    let versions: Vec<String> = body
        .data
        .into_iter()
        .map(|v| v.version)
        .filter(|v| is_minecraft_release_version(v))
        .collect();
    Ok(versions)
}

#[tauri::command]
pub async fn curseforge_search_mods(
    content_type: String,
    search_filter: String,
    game_version: String,
    loader: String,
    index: u32,
    page_size: u32,
) -> Result<CurseforgeSearchResult, String> {
    let class_id = class_id_for_content_type(&content_type)?;
    let page_size = page_size.clamp(1, 50);

    let mut query = vec![
        format!("gameId={MINECRAFT_GAME_ID}"),
        format!("classId={class_id}"),
        format!("index={index}"),
        format!("pageSize={page_size}"),
        "sortField=6".to_string(),
        "sortOrder=desc".to_string(),
    ];

    let trimmed = search_filter.trim();
    if !trimmed.is_empty() {
        query.push(format!("searchFilter={}", urlencoding::encode(trimmed)));
    }
    if !game_version.trim().is_empty() {
        query.push(format!(
            "gameVersion={}",
            urlencoding::encode(game_version.trim())
        ));
    }
    if content_type == "mod" {
        if let Some(loader_type) = mod_loader_type(&loader) {
            if !game_version.trim().is_empty() {
                query.push(format!("modLoaderType={loader_type}"));
            }
        }
    }

    let path = format!("/mods/search?{}", query.join("&"));
    let client = cf_client()?;
    let body: CfSearchModsResponse = cf_get_json(&client, &path).await?;

    let hits = body
        .data
        .into_iter()
        .map(|m| {
            let author = m
                .authors
                .first()
                .map(|a| a.name.clone())
                .unwrap_or_else(|| "Unknown".to_string());
            let thumbnail_url = m
                .logo
                .as_ref()
                .and_then(|l| l.thumbnail_url.clone().or_else(|| l.url.clone()));
            CurseforgeModHit {
                id: m.id,
                slug: m.slug,
                name: m.name,
                summary: m.summary,
                download_count: m.download_count,
                thumbnail_url,
                author,
                class_id: m.class_id,
            }
        })
        .collect();

    Ok(CurseforgeSearchResult {
        hits,
        index: body.pagination.index,
        page_size: body.pagination.page_size,
        total_count: body.pagination.total_count,
    })
}

#[tauri::command]
pub async fn curseforge_get_mod_files(
    mod_id: u32,
    game_version: String,
    loader: String,
) -> Result<Vec<CurseforgeFileHit>, String> {
    let mut query = vec![format!("pageSize=50")];
    if !game_version.trim().is_empty() {
        query.push(format!(
            "gameVersion={}",
            urlencoding::encode(game_version.trim())
        ));
    }
    if let Some(loader_type) = mod_loader_type(&loader) {
        if !game_version.trim().is_empty() {
            query.push(format!("modLoaderType={loader_type}"));
        }
    }

    let path = format!("/mods/{mod_id}/files?{}", query.join("&"));
    let client = cf_client()?;
    let body: CfModFilesResponse = cf_get_json(&client, &path).await?;

    let mut files: Vec<CurseforgeFileHit> = body
        .data
        .into_iter()
        .map(|f| {
            let loaders = loaders_from_filename(&f.file_name);
            CurseforgeFileHit {
                id: f.id,
                display_name: f.display_name,
                file_name: f.file_name,
                download_url: f.download_url,
                game_versions: if f.game_versions.is_empty() {
                    f.sortable_game_versions
                        .into_iter()
                        .filter_map(|v| v.game_version)
                        .collect()
                } else {
                    f.game_versions
                },
                loaders,
                file_date: f.file_date,
            }
        })
        .collect();

    files.sort_by(|a, b| b.file_date.cmp(&a.file_date));
    Ok(files)
}

async fn curseforge_resolve_download_url(mod_id: u32, file_id: u32) -> Result<String, String> {
    let client = cf_client()?;
    let path = format!("/mods/{mod_id}/files/{file_id}/download-url");
    let body: CfApiResponse<String> = cf_get_json(&client, &path).await?;
    let url = body.data.trim().to_string();
    if url.is_empty() {
        return Err("CurseForge не вернул ссылку на скачивание.".to_string());
    }
    Ok(url)
}

#[tauri::command]
pub async fn download_curseforge_file(
    mod_id: u32,
    file_id: u32,
    category: String,
    filename: String,
    profile_id: Option<String>,
) -> Result<(), String> {
    let root = if let Some(ref id) = profile_id {
        instance_dir(id)?
    } else {
        game_root_dir()?
    };
    let subdir = match category.as_str() {
        "mod" | "mods" => "mods",
        "resourcepack" | "resourcepacks" => "resourcepacks",
        "shader" | "shaderpack" | "shaderpacks" => "shaderpacks",
        "modpack" | "modpacks" => "modpacks",
        other => {
            return Err(format!(
                "Неизвестный тип контента CurseForge: {other}. Ожидается mod, resourcepack, shader или modpack."
            ))
        }
    };

    let target_dir = root.join(subdir);
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку '{subdir}': {e}"))?;

    let dest_path = target_dir.join(&filename);

    let url = curseforge_resolve_download_url(mod_id, file_id).await?;

    let client = http_client_for_binary_download(false);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки файла CurseForge: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Сервер CurseForge вернул ошибку {} при скачивании файла.",
            resp.status()
        ));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения тела ответа CurseForge: {e}"))?;

    tokio::fs::write(&dest_path, &bytes)
        .await
        .map_err(|e| format!("Не удалось сохранить файл в {:?}: {e}", dest_path))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn project_dotenv_curseforge_key_is_well_formed() {
        let env_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.env");
        if !env_path.is_file() {
            return;
        }
        std::env::remove_var("CURSEFORGE_API_KEY");
        dotenvy::from_path_override(&env_path).expect("load project .env");
        let key = std::env::var("CURSEFORGE_API_KEY").expect("CURSEFORGE_API_KEY in .env");
        assert!(
            key.starts_with("$2a$10$"),
            "ключ должен начинаться с $2a$10$ (без кавычек в значении)"
        );
        assert!(
            key.len() >= 50,
            "ключ слишком короткий ({} символов) — проверьте кавычки в .env",
            key.len()
        );
        std::env::remove_var("CURSEFORGE_API_KEY");
    }

    #[test]
    fn dotenv_preserves_curseforge_key_with_dollar_signs() {
        let dir = std::env::temp_dir().join(format!("cf_dotenv_{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let path = dir.join(".env");
        let raw_key = "$2a$10$abcdefghijklmnopqrstuvwxyz0123456789abcd";
        std::fs::write(
            &path,
            format!("CURSEFORGE_API_KEY='{raw_key}'\n"),
        )
        .expect("write env");
        std::env::remove_var("CURSEFORGE_API_KEY");
        dotenvy::from_path_override(&path).expect("load env");
        let loaded = std::env::var("CURSEFORGE_API_KEY").expect("var");
        assert_eq!(loaded, raw_key);
        std::env::remove_var("CURSEFORGE_API_KEY");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn deserializes_curseforge_file_camel_case() {
        let json = r#"{
            "id": 1,
            "displayName": "JEI 1.20.1",
            "fileName": "jei.jar",
            "downloadUrl": "https://edge.forgecdn.net/files/1/2/jei.jar",
            "gameVersions": ["1.20.1"],
            "fileDate": "2024-01-01T00:00:00Z"
        }"#;
        let file: CfFile = serde_json::from_str(json).expect("parse file");
        assert_eq!(file.display_name, "JEI 1.20.1");
        assert_eq!(
            file.download_url.as_deref(),
            Some("https://edge.forgecdn.net/files/1/2/jei.jar")
        );
    }
}
