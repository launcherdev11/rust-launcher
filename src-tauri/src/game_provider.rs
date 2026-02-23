use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
        .user_agent("16Launcher/1.0")
        .build()
        .unwrap_or_else(|_| Client::new())
}

const VERSION_MANIFEST_URL: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_META_LOADERS: &str = "https://meta.fabricmc.net/v2/versions/loader";
const FABRIC_META_PROFILE: &str = "https://meta.fabricmc.net/v2/versions/loader";
const FORGE_PROMOTIONS: &str =
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const FORGE_INSTALLER_BASE: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";

pub const EVENT_DOWNLOAD_PROGRESS: &str = "download-progress";

#[derive(Debug, Deserialize)]
struct VersionManifest {
    versions: Vec<ManifestVersion>,
}

#[derive(Debug, Deserialize)]
struct ManifestVersion {
    id: String,
    #[serde(rename = "type")]
    version_type: String,
    url: String,
    #[serde(rename = "releaseTime")]
    release_time: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct VersionSummary {
    pub id: String,
    pub version_type: String,
    pub url: String,
    pub release_time: String,
}

impl From<ManifestVersion> for VersionSummary {
    fn from(v: ManifestVersion) -> Self {
        Self {
            id: v.id,
            version_type: v.version_type,
            url: v.url,
            release_time: v.release_time,
        }
    }
}


#[derive(Debug, Deserialize)]
struct VersionDetail {
    #[serde(default)]
    downloads: Option<VersionDownloads>,
    #[serde(rename = "mainClass")]
    main_class: String,
    #[serde(default)]
    libraries: Vec<Library>,
    #[serde(default)]
    arguments: VersionArguments,
    #[serde(rename = "minecraftArguments", default)]
    minecraft_arguments: Option<String>,
    #[serde(rename = "assetIndex", default)]
    asset_index: Option<AssetIndexRef>,
    #[serde(default)]
    assets: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VersionDownloads {
    client: VersionDownloadInfo,
}

#[derive(Debug, Deserialize)]
struct VersionDownloadInfo {
    url: String,
    size: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct VersionArguments {
    #[serde(default)]
    jvm: Vec<ArgumentValue>,
    #[serde(default)]
    game: Vec<ArgumentValue>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum ArgumentValue {
    String(String),
    WithRules {
        rules: Vec<ArgRule>,
        value: serde_json::Value,
    },
}

#[derive(Debug, Serialize, Deserialize)]
struct ArgRule {
    #[serde(default)]
    action: String,
    #[serde(default)]
    os: Option<OsRule>,
    #[serde(default)]
    features: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OsRule {
    name: Option<String>,
    #[serde(rename = "arch", default)]
    arch: Option<String>,
}

///инфа об ос для правил аргументов (mojang version.json)
#[derive(Debug, Clone)]
pub struct OsInfo {
    pub name: String,
    pub arch: String,
}

///флаги возможностей лаунчера для rules (is_demo_user тд)
#[derive(Debug, Clone, Default)]
pub struct GameFeatures {
    pub is_demo_user: bool,
    pub has_custom_resolution: bool,
    pub is_quick_play: bool,
}

impl GameFeatures {
    pub fn full() -> Self {
        Self {
            is_demo_user: false,
            has_custom_resolution: false,
            is_quick_play: false,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct AssetIndexRef {
    id: String,
    url: String,
    #[serde(rename = "totalSize", default)]
    total_size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct AssetIndexJson {
    #[serde(default)]
    objects: HashMap<String, AssetObject>,
}

#[derive(Debug, Deserialize)]
struct AssetObject {
    hash: String,
    size: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct Library {
    name: String,
    #[serde(default)]
    downloads: LibraryDownloads,
    #[serde(default)]
    rules: Vec<LibraryRule>,
    #[serde(default)]
    extract: Option<LibraryExtract>,
    #[serde(default)]
    natives: Option<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct LibraryDownloads {
    #[serde(default)]
    artifact: Option<LibraryArtifact>,
    #[serde(default)]
    classifiers: Option<HashMap<String, LibraryArtifact>>,
}

#[derive(Debug, Clone, Deserialize)]
struct LibraryArtifact {
    path: String,
    url: String,
    #[serde(default)]
    size: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct LibraryRule {
    action: String,
    #[serde(default)]
    os: Option<OsRule>,
}

#[derive(Debug, Clone, Deserialize)]
struct LibraryExtract {
    #[serde(default)]
    exclude: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct DownloadProgressPayload {
    pub version_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: f32,
}

//Fabric
#[derive(Debug, Deserialize)]
struct FabricLoaderInfo {
    version: String,
    #[serde(default)]
    stable: bool,
}

#[derive(Debug, Deserialize)]
struct FabricLoaderEntry {
    loader: FabricLoaderInfo,
}

#[derive(Debug, Serialize, Deserialize)]
struct FabricProfile {
    id: String,
    #[serde(rename = "inheritsFrom")]
    inherits_from: String,
    #[serde(rename = "mainClass")]
    main_class: String,
    #[serde(default)]
    arguments: VersionArguments,
    #[serde(default)]
    libraries: Vec<FabricProfileLibrary>,
}

#[derive(Debug, Serialize, Deserialize)]
struct FabricProfileLibrary {
    name: String,
    url: Option<String>,
    #[serde(default)]
    size: u64,
}

//Forge
#[derive(Debug, Deserialize)]
struct ForgePromotions {
    promos: HashMap<String, String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ForgeVersionSummary {
    pub id: String,
    pub mc_version: String,
    pub forge_build: String,
    pub installer_url: String,
}

fn game_root_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("Не удалось получить системную папку данных")?;
    Ok(base.join("16Launcher").join("game"))
}

fn launcher_data_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("Не удалось получить системную папку данных")?;
    Ok(base.join("16Launcher"))
}

fn profile_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("profile.json"))
}

//профиль и Ely
const ELY_OAUTH_AUTH: &str = "https://account.ely.by/oauth2/v1";
const ELY_OAUTH_TOKEN: &str = "https://account.ely.by/api/oauth2/v1/token";
const ELY_ACCOUNT_INFO: &str = "https://account.ely.by/api/account/v1/info";
const ELY_CLIENT_ID: &str = "16launcher3";
const AUTHLIB_INJECTOR_RELEASES: &str =
    "https://api.github.com/repos/yushijinhun/authlib-injector/releases/latest";
///порт для oauth callback http://127.0.0.1:38475/callback
const ELY_OAUTH_PORT: u16 = 38475;

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Profile {
    pub nickname: String,
    #[serde(default)]
    pub avatar_path: Option<String>,
    #[serde(default)]
    pub ely_username: Option<String>,
    #[serde(default)]
    pub ely_uuid: Option<String>,
    #[serde(default)]
    pub ely_access_token: Option<String>,
    #[serde(default)]
    pub ely_client_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ElyTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ElyAccountInfo {
    username: String,
    uuid: String,
}

#[tauri::command]
pub fn get_profile() -> Result<Profile, String> {
    let path = profile_path()?;
    if !path.exists() {
        return Ok(Profile::default());
    }
    let s = std::fs::read_to_string(&path).map_err(|e| format!("Ошибка чтения профиля: {e}"))?;
    serde_json::from_str(&s).map_err(|e| format!("Ошибка разбора профиля: {e}"))
}

#[tauri::command]
pub fn set_profile(nickname: String, avatar_path: Option<String>) -> Result<(), String> {
    let path = profile_path()?;
    let mut profile = get_profile().unwrap_or_default();
    profile.nickname = nickname;
    profile.avatar_path = avatar_path;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    }
    let s = serde_json::to_string_pretty(&profile).map_err(|e| format!("Ошибка сериализации: {e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("Не удалось сохранить профиль: {e}"))?;
    Ok(())
}

fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", url])
            .spawn()
            .map_err(|e| format!("Не удалось открыть браузер: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(url).spawn()
            .map_err(|e| format!("Не удалось открыть браузер: {e}"))?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(url).spawn()
            .map_err(|e| format!("Не удалось открыть браузер: {e}"))?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct GitHubReleaseAsset {
    #[serde(rename = "browser_download_url")]
    url: String,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    assets: Vec<GitHubReleaseAsset>,
}

async fn ensure_authlib_injector() -> Result<PathBuf, String> {
    let data_dir = launcher_data_dir()?;
    let jar_path = data_dir.join("authlib-injector.jar");
    if jar_path.exists() {
        return Ok(jar_path);
    }
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    let client = http_client();
    let release: GitHubRelease = client
        .get(AUTHLIB_INJECTOR_RELEASES)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса релиза authlib-injector: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора ответа: {e}"))?;
    let download_url = release
        .assets
        .first()
        .map(|a| a.url.as_str())
        .ok_or("Нет файла в релизе authlib-injector")?;
    let bytes = client
        .get(download_url)
        .header("Accept", "application/octet-stream")
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки authlib-injector: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения: {e}"))?;
    tokio::fs::write(&jar_path, &bytes)
        .await
        .map_err(|e| format!("Не удалось сохранить authlib-injector: {e}"))?;
    Ok(jar_path)
}

pub const EVENT_ELY_AUTH_URL: &str = "ely-auth-url";

#[tauri::command]
pub async fn ely_start_login(app: AppHandle) -> Result<Profile, String> {
    let client_secret = std::env::var("ELY_CLIENT_SECRET")
        .unwrap_or_else(|_| ELY_CLIENT_ID.to_string());

    let listener = std::net::TcpListener::bind(format!("127.0.0.1:{}", ELY_OAUTH_PORT))
        .map_err(|e| format!("Не удалось запустить локальный сервер (порт {}): {e}. Закройте другое приложение, использующее этот порт.", ELY_OAUTH_PORT))?;
    let port = ELY_OAUTH_PORT;
    let state: String = (0..16).map(|_| format!("{:02x}", rand::random::<u8>())).collect();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");
    let scopes = "account_info minecraft_server_session offline_access";
    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}",
        ELY_OAUTH_AUTH,
        ELY_CLIENT_ID,
        urlencoding::encode(&redirect_uri),
        scopes.replace(' ', "%20"),
        state
    );

    let _ = app.emit(EVENT_ELY_AUTH_URL, &auth_url);
    open_url(&auth_url)?;

    let mut code: Option<String> = None;
    if let Ok((mut stream, _)) = listener.accept() {
        use std::io::{Read, Write};
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).map_err(|e| format!("Ошибка чтения: {e}"))?;
        let request = String::from_utf8_lossy(&buf[..n]);
        if let Some(path_query) = request.lines().next().and_then(|l| l.strip_prefix("GET ")).and_then(|r| r.split_whitespace().next()) {
            if let Some(q) = path_query.strip_prefix("/callback?") {
                for part in q.split('&') {
                    if let Some(c) = part.strip_prefix("code=") {
                        code = Some(c.to_string());
                        break;
                    }
                }
            }
        }
        let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Ely.by</title></head><body><p>Авторизация успешна. Можно закрыть эту вкладку и вернуться в лаунчер.</p></body></html>";
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
    }

    let code = code.ok_or("Не получен код авторизации. Попробуйте войти снова.")?;

    let client = http_client();
    let token_resp = client
        .post(ELY_OAUTH_TOKEN)
        .form(&[
            ("client_id", ELY_CLIENT_ID),
            ("client_secret", &client_secret),
            ("redirect_uri", &redirect_uri),
            ("grant_type", "authorization_code"),
            ("code", &code),
        ])
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса токена: {e}"))?;

    if !token_resp.status().is_success() {
        let text = token_resp.text().await.unwrap_or_default();
        return Err(format!("Ошибка Ely.by при обмене кода на токен: {text}"));
    }

    let token_data: ElyTokenResponse = token_resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора ответа токена: {e}"))?;

    let client_token = format!(
        "16Launcher_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let info_resp = client
        .get(ELY_ACCOUNT_INFO)
        .header("Authorization", format!("Bearer {}", token_data.access_token))
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса профиля: {e}"))?;

    if !info_resp.status().is_success() {
        return Err("Не удалось получить данные аккаунта Ely.by.".to_string());
    }

    let info: ElyAccountInfo = info_resp.json().await.map_err(|e| format!("Ошибка разбора: {e}"))?;
    let uuid = info.uuid.replace('-', "");

    let mut profile = get_profile().unwrap_or_default();
    profile.ely_username = Some(info.username.clone());
    profile.ely_uuid = Some(uuid.clone());
    profile.ely_access_token = Some(token_data.access_token);
    profile.ely_client_token = Some(client_token);
    if profile.nickname.is_empty() {
        profile.nickname = info.username;
    }

    let path = profile_path()?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let s = serde_json::to_string_pretty(&profile).map_err(|e| format!("{e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("Не удалось сохранить профиль: {e}"))?;

    Ok(profile)
}

#[tauri::command]
pub fn save_avatar(source_path: String) -> Result<String, String> {
    let path = std::path::Path::new(&source_path);
    if !path.exists() {
        return Err("Файл не найден.".to_string());
    }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("png");
    let data_dir = launcher_data_dir()?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    let dest = data_dir.join(format!("avatar.{}", ext));
    std::fs::copy(path, &dest).map_err(|e| format!("Не удалось скопировать файл: {e}"))?;
    let dest_str = dest.to_str().ok_or("Путь не в UTF-8")?.to_string();
    let mut profile = get_profile().unwrap_or_default();
    profile.avatar_path = Some(dest_str.clone());
    let pp = profile_path()?;
    let s = serde_json::to_string_pretty(&profile).map_err(|e| format!("{e}"))?;
    std::fs::write(&pp, s).map_err(|e| format!("{e}"))?;
    Ok(dest_str)
}

#[tauri::command]
pub fn ely_logout() -> Result<Profile, String> {
    let mut profile = get_profile().unwrap_or_default();
    profile.ely_username = None;
    profile.ely_uuid = None;
    profile.ely_access_token = None;
    profile.ely_client_token = None;
    let path = profile_path()?;
    let s = serde_json::to_string_pretty(&profile).map_err(|e| format!("{e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("{e}"))?;
    Ok(profile)
}

fn libraries_dir() -> Result<PathBuf, String> {
    Ok(game_root_dir()?.join("libraries"))
}

fn versions_dir() -> Result<PathBuf, String> {
    Ok(game_root_dir()?.join("versions"))
}

fn fabric_library_path(name: &str) -> String {
    let parts: Vec<&str> = name.splitn(3, ':').collect();
    if parts.len() < 3 {
        return format!("{name}.jar");
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    format!("{group}/{artifact}/{version}/{artifact}-{version}.jar")
}

fn current_os_name() -> &'static str {
    if std::env::consts::OS == "windows" {
        "windows"
    } else if std::env::consts::OS == "macos" {
        "osx"
    } else {
        "linux"
    }
}

fn current_os_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" | "aarch64" => "x86_64",
        _ => "x86",
    }
}

fn os_info() -> OsInfo {
    OsInfo {
        name: current_os_name().to_string(),
        arch: current_os_arch().to_string(),
    }
}

fn offline_uuid_from_username(name: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    format!("OfflinePlayer:{}", name).hash(&mut hasher);
    let h = hasher.finish();
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (h >> 32) as u32,
        (h >> 16) as u16 & 0x0FFF,
        (h >> 12) as u16 & 0x0FFF,
        (h >> 48) as u16 & 0x3FFF | 0x8000,
        h & 0xFFFFFFFFFFFF
    )
}

fn argument_rule_matches(rule: &ArgRule, features: &GameFeatures, os_info: &OsInfo) -> bool {
    if let Some(ref os) = rule.os {
        if let Some(ref name) = os.name {
            if name != &os_info.name {
                return false;
            }
        }
        if let Some(ref arch) = os.arch {
            if arch != &os_info.arch {
                return false;
            }
        }
    }
    if let Some(ref rule_features) = rule.features {
        if let Some(obj) = rule_features.as_object() {
            for (key, val) in obj {
                let our = match key.as_str() {
                    "is_demo_user" => serde_json::json!(features.is_demo_user),
                    "has_custom_resolution" => serde_json::json!(features.has_custom_resolution),
                    "is_quick_play" => serde_json::json!(features.is_quick_play),
                    _ => continue,
                };
                if &our != val {
                    return false;
                }
            }
        }
    }
    true
}

fn library_applies(lib: &Library, os_name: &str) -> bool {
    if lib.rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for r in &lib.rules {
        let matches_os = r
            .os
            .as_ref()
            .and_then(|o| o.name.as_deref())
            .map(|n| n == os_name)
            .unwrap_or(true);
        if !matches_os {
            continue;
        }
        match r.action.as_str() {
            "allow" => allowed = true,
            "disallow" => return false,
            _ => {}
        }
    }
    allowed
}

pub fn resolve_arguments(
    values: &[ArgumentValue],
    features: &GameFeatures,
    os_info: &OsInfo,
) -> Vec<String> {
    let mut out = Vec::new();
    for v in values {
        match v {
            ArgumentValue::String(s) => {
                out.push(s.clone());
            }
            ArgumentValue::WithRules { rules, value } => {
                let mut allow = false;
                for r in rules {
                    if !argument_rule_matches(r, features, os_info) {
                        continue;
                    }
                    match r.action.as_str() {
                        "allow" => allow = true,
                        "disallow" => {
                            allow = false;
                            break;
                        }
                        _ => {}
                    }
                }
                if !allow {
                    continue;
                }
                match value {
                    serde_json::Value::String(s) => out.push(s.clone()),
                    serde_json::Value::Array(arr) => {
                        for it in arr {
                            if let Some(s) = it.as_str() {
                                out.push(s.to_string());
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    out
}

async fn download_file(
    client: &Client,
    url: &str,
    path: &Path,
    app: &AppHandle,
    version_id: &str,
    total_size: u64,
    offset_downloaded: u64,
) -> Result<u64, String> {
    tokio::fs::create_dir_all(path.parent().unwrap())
        .await
        .map_err(|e| format!("Не удалось создать папку: {e}"))?;

    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| format!("Не удалось создать файл: {e}"))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Сервер вернул ошибку {} для {}",
            resp.status(),
            url
        ));
    }

    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Ошибка чтения потока: {e}"))?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| format!("Ошибка записи: {e}"))?;
        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let total_done = offset_downloaded + downloaded;
            let percent = total_done as f32 / total_size as f32 * 100.0;
            let _ = app.emit(
                EVENT_DOWNLOAD_PROGRESS,
                DownloadProgressPayload {
                    version_id: version_id.to_string(),
                    downloaded: total_done,
                    total: total_size,
                    percent,
                },
            );
        }
    }
    Ok(downloaded)
}

const ASSETS_BASE_URL: &str = "https://resources.download.minecraft.net";

async fn download_assets(
    client: &Client,
    asset_index: &AssetIndexRef,
    root: &Path,
    app: &AppHandle,
    version_id: &str,
    total_size: u64,
    mut total_downloaded: u64,
) -> Result<(), String> {
    let assets_root = root.join("assets");
    let indexes_dir = assets_root.join("indexes");
    let objects_dir = assets_root.join("objects");
    tokio::fs::create_dir_all(&indexes_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку indexes: {e}"))?;
    tokio::fs::create_dir_all(&objects_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку objects: {e}"))?;

    let index_path = indexes_dir.join(format!("{}.json", asset_index.id));
    let index_json = if index_path.exists() {
        tokio::fs::read_to_string(&index_path)
            .await
            .map_err(|e| format!("Ошибка чтения индекса: {e}"))?
    } else {
        let resp = client
            .get(&asset_index.url)
            .send()
            .await
            .map_err(|e| format!("Ошибка загрузки индекса ассетов: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "Сервер вернул {} для индекса ассетов",
                resp.status()
            ));
        }
        let text = resp.text().await.map_err(|e| format!("{e}"))?;
        tokio::fs::write(&index_path, &text)
            .await
            .map_err(|e| format!("Не удалось сохранить индекс: {e}"))?;
        text
    };

    let index: AssetIndexJson = serde_json::from_str(&index_json)
        .map_err(|e| format!("Ошибка разбора индекса ассетов: {e}"))?;

    for (_path, obj) in &index.objects {
        let hash = &obj.hash;
        if hash.len() < 2 {
            continue;
        }
        let prefix = &hash[..2];
        let obj_path = objects_dir.join(prefix).join(hash);
        if obj_path.exists() {
            total_downloaded = total_downloaded.saturating_add(obj.size);
            if total_size > 0 {
                let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                let _ = app.emit(
                    EVENT_DOWNLOAD_PROGRESS,
                    DownloadProgressPayload {
                        version_id: version_id.to_string(),
                        downloaded: total_downloaded,
                        total: total_size,
                        percent,
                    },
                );
            }
            continue;
        }
        let url = format!("{ASSETS_BASE_URL}/{prefix}/{hash}");
        if let Some(parent) = obj_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Не удалось создать папку: {e}"))?;
        }
        let _ = download_file(
            client,
            &url,
            &obj_path,
            app,
            version_id,
            total_size,
            total_downloaded,
        )
        .await?;
        total_downloaded = total_downloaded.saturating_add(obj.size);
    }

    Ok(())
}

fn extract_natives_jar(jar_path: &Path, out_dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(jar_path)
        .map_err(|e| format!("Не удалось открыть jar: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Ошибка zip: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Ошибка чтения entry: {e}"))?;
        let name = entry.name().to_string();
        if name.ends_with('/') {
            continue;
        }
        if name.starts_with("META-INF/") {
            continue;
        }
        let out_path = out_dir.join(&name);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| format!("Ошибка создания папки: {e}"))?;
        } else {
            if let Some(p) = out_path.parent() {
                std::fs::create_dir_all(p).map_err(|e| format!("Ошибка создания папки: {e}"))?;
            }
            let mut out_file =
                std::fs::File::create(&out_path).map_err(|e| format!("Ошибка создания файла: {e}"))?;
            std::io::copy(&mut entry, &mut out_file).map_err(|e| format!("Ошибка копирования: {e}"))?;
        }
    }
    Ok(())
}

async fn load_all_versions() -> Result<Vec<VersionSummary>, String> {
    let client = http_client();
    let resp = client
        .get(VERSION_MANIFEST_URL)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса манифеста версий: {e}"))?;

    let manifest: VersionManifest = resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора манифеста версий: {e}"))?;

    let mut summaries: Vec<VersionSummary> =
        manifest.versions.into_iter().map(VersionSummary::from).collect();

    summaries.sort_by(|a, b| b.release_time.cmp(&a.release_time));

    Ok(summaries)
}

async fn get_mojang_version_url(version_id: &str) -> Result<String, String> {
    let client = http_client();
    let resp = client
        .get(VERSION_MANIFEST_URL)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса манифеста: {e}"))?;
    let manifest: VersionManifest = resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора манифеста: {e}"))?;
    manifest
        .versions
        .into_iter()
        .find(|v| v.id == version_id)
        .map(|v| v.url)
        .ok_or_else(|| format!("Версия {version_id} не найдена в манифесте Mojang"))
}

#[tauri::command]
pub fn get_game_root_dir() -> Result<String, String> {
    let dir = game_root_dir()?;
    dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Не удалось преобразовать путь к строке".to_string())
}

#[tauri::command]
pub async fn open_game_folder() -> Result<(), String> {
    let root = game_root_dir()?;
    std::fs::create_dir_all(&root).map_err(|e| format!("Не удалось создать папку игры: {e}"))?;
    let path_str = root
        .to_str()
        .ok_or_else(|| "Путь к папке игры не в UTF-8".to_string())?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Не удалось открыть проводник: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Не удалось открыть папку: {e}"))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Не удалось открыть папку: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn fetch_all_versions() -> Result<Vec<VersionSummary>, String> {
    load_all_versions().await
}

#[tauri::command]
pub async fn fetch_vanilla_releases() -> Result<Vec<VersionSummary>, String> {
    let mut versions = load_all_versions().await?;
    versions.retain(|v| v.version_type == "release");
    Ok(versions)
}

#[tauri::command]
pub async fn fetch_fabric_loaders(game_version: String) -> Result<Vec<String>, String> {
    let url = format!("{FABRIC_META_LOADERS}/{game_version}");
    let client = http_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса списка Fabric: {e}"))?;
    let list: Vec<FabricLoaderEntry> = resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора списка Fabric: {e}"))?;
    let versions: Vec<String> = list
        .into_iter()
        .map(|e| e.loader.version)
        .collect();
    Ok(versions)
}

#[tauri::command]
pub async fn fetch_forge_versions() -> Result<Vec<ForgeVersionSummary>, String> {
    let client = http_client();
    let resp = client
        .get(FORGE_PROMOTIONS)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса списка Forge: {e}"))?;
    let promos: ForgePromotions = resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора Forge: {e}"))?;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (key, build) in &promos.promos {
        let mc_ver = key.strip_suffix("-latest").or_else(|| key.strip_suffix("-recommended"));
        if let Some(mc) = mc_ver {
            let id = format!("{mc}-{build}");
            if seen.insert(id.clone()) {
                let installer_url = format!("{FORGE_INSTALLER_BASE}/{id}/forge-{id}-installer.jar");
                out.push(ForgeVersionSummary {
                    id: id.clone(),
                    mc_version: mc.to_string(),
                    forge_build: build.clone(),
                    installer_url,
                });
            }
        }
    }
    out.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(out)
}

#[tauri::command]
pub fn get_installed_fabric_profile_id(game_version: String) -> Result<Option<String>, String> {
    let vers_root = versions_dir()?;
    if !vers_root.exists() {
        return Ok(None);
    }
    for e in std::fs::read_dir(&vers_root).map_err(|e| format!("Ошибка чтения versions: {e}"))? {
        let e = e.map_err(|e| format!("Ошибка чтения: {e}"))?;
        let path = e.path();
        if !path.is_dir() {
            continue;
        }
        let profile_path = path.join("profile.json");
        if !profile_path.exists() {
            continue;
        }
        let s = std::fs::read_to_string(&profile_path)
            .map_err(|e| format!("Ошибка чтения profile.json: {e}"))?;
        let profile: FabricProfile = serde_json::from_str(&s)
            .map_err(|e| format!("Ошибка разбора profile.json: {e}"))?;
        if profile.inherits_from == game_version {
            let id = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            if !id.is_empty() {
                return Ok(Some(id));
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn list_installed_versions() -> Result<Vec<String>, String> {
    let root = game_root_dir()?;
    let vers_root = versions_dir()?;
    let mut ids = std::collections::HashSet::new();
    if root.exists() {
        for e in std::fs::read_dir(&root).map_err(|e| format!("Ошибка чтения папки игры: {e}"))? {
            let e = e.map_err(|e| format!("Ошибка чтения: {e}"))?;
            let name = e.file_name();
            let name = name.to_str().ok_or("Неверная кодировка имени файла")?;
            if name.ends_with(".jar") {
                let id = name.strip_suffix(".jar").unwrap_or(name);
                ids.insert(id.to_string());
            }
        }
    }
    if vers_root.exists() {
        for e in std::fs::read_dir(&vers_root).map_err(|e| format!("Ошибка чтения versions: {e}"))? {
            let e = e.map_err(|e| format!("Ошибка чтения: {e}"))?;
            let path = e.path();
            if path.is_dir() {
                let id = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if !id.is_empty()
                    && (path.join("profile.json").exists() || path.join(format!("{id}.json")).exists())
                {
                    ids.insert(id.to_string());
                }
            }
        }
    }
    let mut result: Vec<String> = ids.into_iter().collect();
    result.sort();
    Ok(result)
}

#[tauri::command]
pub async fn install_fabric(
    app: AppHandle,
    game_version: String,
    loader_version: String,
) -> Result<String, String> {
    let client = http_client();
    let profile_url = format!(
        "{FABRIC_META_PROFILE}/{game_version}/{loader_version}/profile/json"
    );
    let profile: FabricProfile = client
        .get(&profile_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки профиля Fabric: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора профиля Fabric: {e}"))?;

    let mojang_url = get_mojang_version_url(&profile.inherits_from).await?;
    let mojang_detail: VersionDetail = client
        .get(&mojang_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки версии Mojang: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора версии Mojang: {e}"))?;

    let root = game_root_dir()?;
    let libs_root = libraries_dir()?;
    let vers_root = versions_dir()?;
    tokio::fs::create_dir_all(&root).await.map_err(|e| format!("Папка игры: {e}"))?;
    tokio::fs::create_dir_all(&libs_root).await.map_err(|e| format!("Папка библиотек: {e}"))?;
    tokio::fs::create_dir_all(&vers_root).await.map_err(|e| format!("Папка версий: {e}"))?;

    let profile_id = profile.id.clone();
    let os_name = current_os_name();
    let mojang_dl = mojang_detail
        .downloads
        .as_ref()
        .ok_or("Версия Mojang без downloads")?;
    let mut total_size = mojang_dl.client.size
        + profile
            .libraries
            .iter()
            .map(|l| l.size)
            .fold(0u64, |a, b| a.saturating_add(b));
    for lib in &mojang_detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref a) = lib.downloads.artifact {
            total_size = total_size.saturating_add(a.size);
        }
        let native_classifier = match os_name {
            "windows" => "natives-windows",
            "osx" => "natives-macos",
            _ => "natives-linux",
        };
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(ref nat) = classifiers.get(native_classifier) {
                total_size = total_size.saturating_add(nat.size);
            }
        }
    }
    if let Some(ref ai) = mojang_detail.asset_index {
        if let Some(s) = ai.total_size {
            total_size = total_size.saturating_add(s);
        }
    }
    let mut total_downloaded: u64 = 0;

    let client_jar = root.join(format!("{profile_id}.jar"));
    let _ = download_file(
        &client,
        &mojang_dl.client.url,
        &client_jar,
        &app,
        &profile_id,
        total_size,
        total_downloaded,
    )
    .await?;
    total_downloaded = total_downloaded.saturating_add(mojang_dl.client.size);

    let natives_dir = vers_root.join(&profile_id).join("natives");
    tokio::fs::create_dir_all(&natives_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку natives: {e}"))?;
    let native_classifier = match os_name {
        "windows" => "natives-windows",
        "osx" => "natives-macos",
        _ => "natives-linux",
    };

    for lib in &mojang_detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref artifact) = lib.downloads.artifact {
            let path = libs_root.join(&artifact.path);
            if path.exists() {
                total_downloaded = total_downloaded.saturating_add(artifact.size);
                if total_size > 0 {
                    let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                    let _ = app.emit(
                        EVENT_DOWNLOAD_PROGRESS,
                        DownloadProgressPayload {
                            version_id: profile_id.clone(),
                            downloaded: total_downloaded,
                            total: total_size,
                            percent,
                        },
                    );
                }
                continue;
            }
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
            }
            let _ = download_file(
                &client,
                &artifact.url,
                &path,
                &app,
                &profile_id,
                total_size,
                total_downloaded,
            )
            .await?;
            total_downloaded = total_downloaded.saturating_add(artifact.size);
        }
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(nat) = classifiers.get(native_classifier) {
                let path = libs_root.join(&nat.path);
                if path.exists() {
                    total_downloaded = total_downloaded.saturating_add(nat.size);
                    if total_size > 0 {
                        let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                        let _ = app.emit(
                            EVENT_DOWNLOAD_PROGRESS,
                            DownloadProgressPayload {
                                version_id: profile_id.clone(),
                                downloaded: total_downloaded,
                                total: total_size,
                                percent,
                            },
                        );
                    }
                    let _ = extract_natives_jar(&path, &natives_dir);
                    continue;
                }
                if let Some(parent) = path.parent() {
                    tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
                }
                let _ = download_file(
                    &client,
                    &nat.url,
                    &path,
                    &app,
                    &profile_id,
                    total_size,
                    total_downloaded,
                )
                .await?;
                total_downloaded = total_downloaded.saturating_add(nat.size);
                let _ = extract_natives_jar(&path, &natives_dir);
            }
        }
    }

    let base_url = "https://maven.fabricmc.net/";
    for lib in &profile.libraries {
        let path = fabric_library_path(&lib.name);
        let url = lib
            .url
            .as_deref()
            .unwrap_or(base_url)
            .trim_end_matches('/');
        let lib_url = format!("{url}/{path}");
        let dest = libs_root.join(&path);
        if dest.exists() {
            total_downloaded = total_downloaded.saturating_add(lib.size);
            if total_size > 0 {
                let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                let _ = app.emit(
                    EVENT_DOWNLOAD_PROGRESS,
                    DownloadProgressPayload {
                        version_id: profile_id.clone(),
                        downloaded: total_downloaded,
                        total: total_size,
                        percent,
                    },
                );
            }
            continue;
        }
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
        }
        let _ = download_file(
            &client,
            &lib_url,
            &dest,
            &app,
            &profile_id,
            total_size,
            total_downloaded,
        )
        .await?;
        total_downloaded = total_downloaded.saturating_add(lib.size);
    }

    if let Some(ref asset_index) = mojang_detail.asset_index {
        download_assets(
            &client,
            asset_index,
            &root,
            &app,
            &profile_id,
            total_size,
            total_downloaded,
        )
        .await?;
    }

    let profile_dir = vers_root.join(&profile_id);
    tokio::fs::create_dir_all(&profile_dir).await.map_err(|e| format!("{e}"))?;
    let profile_path = profile_dir.join("profile.json");
    let profile_json = serde_json::to_string(&profile).map_err(|e| format!("Ошибка сериализации: {e}"))?;
    tokio::fs::write(&profile_path, profile_json)
        .await
        .map_err(|e| format!("Ошибка записи профиля: {e}"))?;

    Ok(profile_id)
}

#[tauri::command]
pub async fn install_forge(
    app: AppHandle,
    version_id: String,
    installer_url: String,
) -> Result<(), String> {
    let client = http_client();
    let root = game_root_dir()?;
    tokio::fs::create_dir_all(&root).await.map_err(|e| format!("Папка игры: {e}"))?;

    let installer_jar = root.join("forge-installer.jar");
    let resp = client
        .get(&installer_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки установщика Forge: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!(
            "Сервер вернул ошибку {} при загрузке установщика. Попробуйте другую версию Forge.",
            status
        ));
    }

    let total = resp.content_length().unwrap_or(0);
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения установщика: {e}"))?;

    if bytes.len() < 4 || &bytes[0..2] != b"PK" {
        return Err(
            "Скачанный файл не похож на JAR (возможно, страница ошибки). Попробуйте другую версию или проверьте интернет."
                .to_string(),
        );
    }

    let mut downloaded = 0u64;
    let mut file = tokio::fs::File::create(&installer_jar)
        .await
        .map_err(|e| format!("Ошибка создания файла: {e}"))?;
    tokio::io::AsyncWriteExt::write_all(&mut file, &bytes).await.map_err(|e| format!("{e}"))?;
    downloaded += bytes.len() as u64;
    if total > 0 {
        let _ = app.emit(
            EVENT_DOWNLOAD_PROGRESS,
            DownloadProgressPayload {
                version_id: version_id.clone(),
                downloaded,
                total,
                percent: downloaded as f32 / total as f32 * 100.0,
            },
        );
    }

    let root_str = root.to_str().ok_or("Путь к папке игры не в UTF-8")?;
    let status = std::process::Command::new("java")
        .args([
            "-jar",
            installer_jar.to_str().unwrap(),
            "--installClient",
            root_str,
        ])
        .current_dir(&root)
        .status()
        .map_err(|e| format!("Не удалось запустить установщик Forge (нужна Java): {e}"))?;

    let _ = std::fs::remove_file(&installer_jar);

    if !status.success() {
        return Err("Установщик Forge завершился с ошибкой.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn install_version(
    app: AppHandle,
    version_id: String,
    version_url: String,
) -> Result<(), String> {
    let client = http_client();
    let os_name = current_os_name();

    let resp = client
        .get(&version_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки описания версии: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Сервер вернул ошибку {} при запросе описания версии. Проверьте интернет и выбранную версию.",
            resp.status()
        ));
    }

    let version_json_text = resp
        .text()
        .await
        .map_err(|e| format!("Ошибка чтения ответа: {e}"))?;

    let detail: VersionDetail = serde_json::from_str(&version_json_text)
        .map_err(|e| format!("Ошибка разбора описания версии: {e}"))?;

    let downloads = detail
        .downloads
        .as_ref()
        .ok_or("Описание версии не содержит downloads (не ванильная версия)")?;

    let root = game_root_dir()?;
    let libs_root = libraries_dir()?;
    let vers_root = versions_dir()?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("Не удалось создать папку игры: {e}"))?;
    tokio::fs::create_dir_all(&libs_root)
        .await
        .map_err(|e| format!("Не удалось создать папку библиотек: {e}"))?;
    tokio::fs::create_dir_all(&vers_root)
        .await
        .map_err(|e| format!("Не удалось создать папку версий: {e}"))?;

    let client_size = downloads.client.size;
    let mut total_size = client_size;
    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref a) = lib.downloads.artifact {
            total_size = total_size.saturating_add(a.size);
        }
        let native_classifier = match os_name {
            "windows" => "natives-windows",
            "osx" => "natives-macos",
            _ => "natives-linux",
        };
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(ref nat) = classifiers.get(native_classifier) {
                total_size = total_size.saturating_add(nat.size);
            }
        }
    }
    if let Some(ref ai) = detail.asset_index {
        if let Some(s) = ai.total_size {
            total_size = total_size.saturating_add(s);
        }
    }

    let mut total_downloaded: u64 = 0;

    //jar
    let client_jar = root.join(format!("{version_id}.jar"));
    let _ = download_file(
        &client,
        &downloads.client.url,
        &client_jar,
        &app,
        &version_id,
        total_size,
        total_downloaded,
    )
    .await?;
    total_downloaded = total_downloaded.saturating_add(downloads.client.size);

    //библиотеки
    let natives_dir = vers_root.join(&version_id).join("natives");
    tokio::fs::create_dir_all(&natives_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку natives: {e}"))?;

    let native_classifier = match os_name {
        "windows" => "natives-windows",
        "osx" => "natives-macos",
        _ => "natives-linux",
    };

    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref artifact) = lib.downloads.artifact {
            let path = libs_root.join(&artifact.path);
            if path.exists() {
                total_downloaded = total_downloaded.saturating_add(artifact.size);
                if total_size > 0 {
                    let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                    let _ = app.emit(
                        EVENT_DOWNLOAD_PROGRESS,
                        DownloadProgressPayload {
                            version_id: version_id.clone(),
                            downloaded: total_downloaded,
                            total: total_size,
                            percent,
                        },
                    );
                }
                continue;
            }
            let _ = download_file(
                &client,
                &artifact.url,
                &path,
                &app,
                &version_id,
                total_size,
                total_downloaded,
            )
            .await?;
            total_downloaded = total_downloaded.saturating_add(artifact.size);
        }
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(nat) = classifiers.get(native_classifier) {
                let path = libs_root.join(&nat.path);
                if path.exists() {
                    total_downloaded = total_downloaded.saturating_add(nat.size);
                    if total_size > 0 {
                        let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                        let _ = app.emit(
                            EVENT_DOWNLOAD_PROGRESS,
                            DownloadProgressPayload {
                                version_id: version_id.clone(),
                                downloaded: total_downloaded,
                                total: total_size,
                                percent,
                            },
                        );
                    }
                    let _ = extract_natives_jar(&path, &natives_dir);
                    continue;
                }
                let _ = download_file(
                    &client,
                    &nat.url,
                    &path,
                    &app,
                    &version_id,
                    total_size,
                    total_downloaded,
                )
                .await?;
                total_downloaded = total_downloaded.saturating_add(nat.size);
                let _ = extract_natives_jar(&path, &natives_dir);
            }
        }
    }

    if let Some(ref asset_index) = detail.asset_index {
        download_assets(
            &client,
            asset_index,
            &root,
            &app,
            &version_id,
            total_size,
            total_downloaded,
        )
        .await?;
    }

    //сохранение json версий
    let version_json_path = vers_root.join(&version_id).join(format!("{version_id}.json"));
    if let Some(parent) = version_json_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    tokio::fs::write(&version_json_path, &version_json_text)
        .await
        .map_err(|e| format!("Не удалось сохранить описание версии: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn launch_game(
    version_id: String,
    version_url: Option<String>,
) -> Result<(), String> {
    let root = game_root_dir()?;
    let libs_root = libraries_dir()?;
    let vers_root = versions_dir()?;

    let (detail, is_fabric) = if let Some(ref url) = version_url {
        let client = http_client();
        let resp = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Ошибка загрузки описания версии: {e}"))?;
        let d: VersionDetail = resp
            .json()
            .await
            .map_err(|e| format!("Ошибка разбора описания версии: {e}"))?;
        (d, false)
    } else {
        let version_json = vers_root.join(&version_id).join(format!("{version_id}.json"));
        let profile_path = vers_root.join(&version_id).join("profile.json");
        if version_json.exists() {
            let s = tokio::fs::read_to_string(&version_json)
                .await
                .map_err(|e| format!("Ошибка чтения version.json: {e}"))?;
            let d: VersionDetail = serde_json::from_str(&s)
                .map_err(|e| format!("Ошибка разбора version.json: {e}"))?;
            (d, false)
        } else if profile_path.exists() {
            let s = tokio::fs::read_to_string(&profile_path)
                .await
                .map_err(|e| format!("Ошибка чтения profile.json: {e}"))?;
            let profile: FabricProfile = serde_json::from_str(&s)
                .map_err(|e| format!("Ошибка разбора profile.json: {e}"))?;
            let mojang_url = get_mojang_version_url(&profile.inherits_from).await?;
            let client = http_client();
            let mojang_detail: VersionDetail = client
                .get(&mojang_url)
                .send()
                .await
                .map_err(|e| format!("Ошибка загрузки версии Mojang: {e}"))?
                .json()
                .await
                .map_err(|e| format!("Ошибка разбора: {e}"))?;
            let mut detail = VersionDetail {
                downloads: None,
                main_class: profile.main_class,
                libraries: mojang_detail.libraries.clone(),
                arguments: VersionArguments {
                    jvm: profile.arguments.jvm,
                    game: mojang_detail.arguments.game,
                },
                minecraft_arguments: mojang_detail.minecraft_arguments,
                asset_index: mojang_detail.asset_index,
                assets: mojang_detail.assets.clone(),
            };
            for lib in &profile.libraries {
                let path = fabric_library_path(&lib.name);
                detail.libraries.push(Library {
                    name: lib.name.clone(),
                    downloads: LibraryDownloads {
                        artifact: Some(LibraryArtifact {
                            path: path.clone(),
                            url: format!("https://maven.fabricmc.net/{path}"),
                            size: lib.size,
                        }),
                        classifiers: None,
                    },
                    rules: vec![],
                    extract: None,
                    natives: None,
                });
            }
            (detail, true)
        } else {
            return Err("Версия не установлена или не найдена. Сначала установите.".to_string());
        }
    };

    let jar_path = root.join(format!("{version_id}.jar"));
    if detail.downloads.is_some() && !jar_path.exists() {
        return Err("Версия не установлена. Сначала нажмите «Установить».".to_string());
    }

    let os_name = current_os_name();
    let os_info = os_info();
    let features = GameFeatures::full();

    let _native_classifier = match os_name {
        "windows" => "natives-windows",
        "osx" => "natives-macos",
        _ => "natives-linux",
    };

    let mut classpath = Vec::new();
    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref a) = lib.downloads.artifact {
            classpath.push(libs_root.join(&a.path));
        }
    }
    if detail.downloads.is_some() || jar_path.exists() {
        classpath.push(jar_path.clone());
    }

    let classpath_str = classpath
        .iter()
        .map(|p| p.to_str().unwrap_or(""))
        .collect::<Vec<_>>()
        .join(if os_name == "windows" { ";" } else { ":" });

    let game_dir_str = root.to_str().ok_or("Путь к папке игры не в UTF-8")?;
    let natives_dir = versions_dir()?.join(&version_id).join("natives");
    std::fs::create_dir_all(&natives_dir)
        .map_err(|e| format!("Не удалось создать папку natives при запуске: {e}"))?;
    let native_classifier = match os_name {
        "windows" => "natives-windows",
        "osx" => "natives-macos",
        _ => "natives-linux",
    };
    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(nat) = classifiers.get(native_classifier) {
                let path = libs_root.join(&nat.path);
                if path.exists() {
                    let _ = extract_natives_jar(&path, &natives_dir);
                }
            }
        }
    }
    let natives_str = natives_dir.to_str().unwrap_or("");
    let assets_root = root.join("assets");
    let assets_str = assets_root.to_str().unwrap_or("");
    let _ = std::fs::create_dir_all(&assets_root);

    let profile = get_profile().unwrap_or_default();
    let is_offline = profile
        .ely_access_token
        .as_deref()
        .map(|s| s.is_empty() || s == "0")
        .unwrap_or(true);

    let auth_name = profile
        .ely_username
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            if profile.nickname.is_empty() {
                "Player"
            } else {
                profile.nickname.as_str()
            }
        });
    let auth_uuid = profile
        .ely_uuid
        .as_deref()
        .map(|u| {
            if u.contains('-') {
                u.to_string()
            } else {
                format!("{}-{}-{}-{}-{}", &u[0..8], &u[8..12], &u[12..16], &u[16..20], &u[20..32])
            }
        })
        .unwrap_or_else(|| {
            if is_offline {
                offline_uuid_from_username(auth_name)
            } else {
                "00000000-0000-0000-0000-000000000000".to_string()
            }
        });
    let auth_token = profile
        .ely_access_token
        .as_deref()
        .filter(|s| !s.is_empty() && *s != "0")
        .unwrap_or("offline");
    let user_type = if is_offline { "legacy" } else { "msa" };

    let replace = |s: &str| -> String {
        s.replace("${game_directory}", game_dir_str)
            .replace("${gameDir}", game_dir_str)
            .replace("${natives_directory}", natives_str)
            .replace("${classpath}", &classpath_str)
            .replace("${assets_root}", assets_str)
            .replace("${assets_index_name}", detail.assets.as_deref().unwrap_or(""))
            .replace("${version_name}", &version_id)
            .replace("${auth_player_name}", auth_name)
            .replace("${auth_uuid}", &auth_uuid)
            .replace("${auth_access_token}", auth_token)
            .replace("${clientid}", ELY_CLIENT_ID)
            .replace("${auth_xuid}", "")
            .replace("${user_type}", user_type)
            .replace("${version_type}", "release")
            .replace("${is_demo_user}", "false")
            .replace("${launcher_name}", "16Launcher")
            .replace("${launcher_version}", "1.0.4")
    };

    let mut jvm_args = if detail.arguments.game.is_empty() && detail.minecraft_arguments.is_some() {
        vec![
            "-Xms1G".to_string(),
            "-Xmx2G".to_string(),
            "-Djava.library.path=".to_string() + natives_str,
            "-cp".to_string(),
            classpath_str.clone(),
        ]
    } else if is_fabric {
        let mut base = vec![
            "-Xms1G".to_string(),
            "-Xmx2G".to_string(),
            "-Djava.library.path=".to_string() + natives_str,
            "-cp".to_string(),
            classpath_str.clone(),
        ];
        base.extend(
            resolve_arguments(&detail.arguments.jvm, &features, &os_info)
                .into_iter()
                .map(|s| replace(&s)),
        );
        base
    } else {
        resolve_arguments(&detail.arguments.jvm, &features, &os_info)
            .into_iter()
            .map(|s| replace(&s))
            .collect::<Vec<_>>()
    };

    if auth_token != "offline" && !auth_token.is_empty() {
        if let Ok(path) = ensure_authlib_injector().await {
            let agent_path = path.to_string_lossy().replace('\\', "/");
            jvm_args.insert(0, format!("-javaagent:{}=ely.by", agent_path));
        }
    }

    let mut game_args = if let Some(ref legacy) = detail.minecraft_arguments {
        legacy.split_whitespace().map(|s| replace(s).to_string()).collect::<Vec<_>>()
    } else {
        resolve_arguments(&detail.arguments.game, &features, &os_info)
            .into_iter()
            .map(|s| replace(&s))
            .collect::<Vec<_>>()
    };

    if !features.is_demo_user {
        game_args.retain(|a| a != "--demo");
    }

    if !features.is_quick_play {
        let mut filtered = Vec::with_capacity(game_args.len());
        let mut i = 0;
        while i < game_args.len() {
            let arg = &game_args[i];
            let is_quick_flag = matches!(
                arg.as_str(),
                "--quickPlayPath"
                    | "--quickPlaySingleplayer"
                    | "--quickPlayMultiplayer"
                    | "--quickPlayRealms"
            );
            if is_quick_flag {
                i += 1;
                if i < game_args.len() {
                    i += 1;
                }
                continue;
            } else {
                filtered.push(arg.clone());
                i += 1;
            }
        }
        game_args = filtered;
    }

    eprintln!("[Launch] JVM args: {:?}", jvm_args);
    eprintln!("[Launch] Game args: {:?}", game_args);

    let _jar_path_str = jar_path.to_str().ok_or("Путь к jar не в UTF-8")?;

    let mut cmd = std::process::Command::new("java");
    cmd.args(&jvm_args)
        .arg(&detail.main_class)
        .args(&game_args)
        .current_dir(game_dir_str);

    cmd.spawn()
        .map_err(|e| format!("Не удалось запустить игру (установите Java): {e}"))?;

    Ok(())
}
