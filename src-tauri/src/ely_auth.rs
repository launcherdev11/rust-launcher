use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use rand::{distributions::Alphanumeric, Rng};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::game_provider::{get_profile, launcher_data_dir, save_full_profile};

fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(60))
        .connect_timeout(Duration::from_secs(15))
        .user_agent("16Launcher/1.0")
        .build()
        .unwrap_or_else(|_| Client::new())
}

// Constants
pub const ELY_CLIENT_ID: &str = "16launcher4";
pub const OAUTH2_AUTH_URL: &str = "https://account.ely.by/oauth2/v1";
pub const OAUTH2_TOKEN_URL: &str = "https://account.ely.by/api/oauth2/v1/token";
pub const YGGDRASIL_AUTH_URL: &str = "https://authserver.ely.by/auth/authenticate";
pub const YGGDRASIL_REFRESH_URL: &str = "https://authserver.ely.by/auth/refresh";
pub const YGGDRASIL_VALIDATE_URL: &str = "https://authserver.ely.by/auth/validate";
pub const YGGDRASIL_INVALIDATE_URL: &str = "https://authserver.ely.by/auth/invalidate";
pub const REDIRECT_URI: &str = "http://localhost:25568/callback";
const AUTHLIB_INJECTOR_LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/yushijinhun/authlib-injector/releases/latest";

// Models
#[derive(Debug, Deserialize)]
struct GithubRelease { assets: Vec<GithubReleaseAsset> }
#[derive(Debug, Deserialize)]
struct GithubReleaseAsset { name: String, browser_download_url: String }

#[derive(Debug, Deserialize)]
pub struct OAuth2TokenResponse {
    pub access_token: String,
    #[serde(default)] pub refresh_token: Option<String>,
    pub token_type: String, pub expires_in: u64,
}

#[derive(Debug, Serialize)]
struct OAuth2TokenRequest<'a> {
    client_id: &'a str, client_secret: String, redirect_uri: &'a str,
    grant_type: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")] code: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")] refresh_token: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")] scope: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
pub struct AccountInfo {
    pub id: u64, pub uuid: String, pub username: String,
    #[serde(default)] pub email: Option<String>,
    #[serde(default)] pub preferredLanguage: Option<String>,
}

#[derive(Debug, Serialize)]
struct YggdrasilAuthRequest<'a> {
    username: &'a str, password: &'a str,
    #[serde(rename = "clientToken")] client_token: &'a str,
    #[serde(rename = "requestUser")] request_user: bool,
}

#[derive(Debug, Deserialize)]
pub struct YggdrasilProfile { pub id: String, pub name: String }
#[derive(Debug, Deserialize)]
pub struct YggdrasilUserProperty { pub name: String, pub value: String }
#[derive(Debug, Deserialize)]
pub struct YggdrasilUser {
    pub id: String, pub username: String,
    #[serde(default)] pub properties: Vec<YggdrasilUserProperty>,
}

#[derive(Debug, Deserialize)]
pub struct YggdrasilAuthResponse {
    #[serde(rename = "accessToken")] pub access_token: String,
    #[serde(rename = "clientToken")] pub client_token: String,
    #[serde(default)] pub availableProfiles: Vec<YggdrasilProfile>,
    #[serde(rename = "selectedProfile")] pub selected_profile: YggdrasilProfile,
    #[serde(default)] pub user: Option<YggdrasilUser>,
}

#[derive(Debug, Deserialize)]
struct YggdrasilError { error: String, #[serde(rename = "errorMessage")] error_message: String }

#[derive(Debug, Serialize)]
struct YggdrasilRefreshRequest<'a> {
    #[serde(rename = "accessToken")] access_token: &'a str,
    #[serde(rename = "clientToken")] client_token: &'a str,
    #[serde(rename = "requestUser")] request_user: bool,
}
#[derive(Debug, Serialize)]
struct YggdrasilValidateRequest<'a> { #[serde(rename = "accessToken")] access_token: &'a str }
#[derive(Debug, Serialize)]
struct YggdrasilInvalidateRequest<'a> {
    #[serde(rename = "accessToken")] access_token: &'a str,
    #[serde(rename = "clientToken")] client_token: &'a str,
}

// State
static OAUTH_STATE: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

// Helpers
fn get_client_secret() -> Result<String, String> {
    std::env::var("ELY_CLIENT_SECRET")
        .or_else(|_| option_env!("ELY_CLIENT_SECRET").map(String::from).ok_or(()))
        .map(|s| s.trim().to_string())
        .and_then(|s| if s.is_empty() { Err(()) } else { Ok(s) })
        .map_err(|_| "Секрет Ely.by OAuth2 не задан: добавьте ELY_CLIENT_SECRET в .env или переменные окружения.".to_string())
}

fn gen_random_str(len: usize) -> String {
    rand::thread_rng().sample_iter(&Alphanumeric).take(len).map(char::from).collect()
}

async fn handle_resp<T>(resp: reqwest::Response, err_ctx: &str) -> Result<T, String>
where T: for<'de> Deserialize<'de> {
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_else(|_| "<no body>".into());
        return Err(format!("{err_ctx}: {} — {}", status, text));
    }
    resp.json::<T>().await.map_err(|e| format!("Ошибка парсинга {err_ctx}: {e}"))
}

async fn download_authlib_injector_jar_bytes() -> Result<Vec<u8>, String> {
    let client = http_client();
    let release: GithubRelease = handle_resp(
        client.get(AUTHLIB_INJECTOR_LATEST_RELEASE_API).send().await.map_err(|e| e.to_string())?,
        "GitHub API latest release"
    ).await?;

    let asset = release.assets.into_iter()
        .find(|a| { let n = a.name.to_ascii_lowercase(); n.ends_with(".jar") && n.contains("authlib-injector") })
        .ok_or("В релизе не найден authlib-injector.jar")?;

    let jar_resp = client.get(&asset.browser_download_url).send().await.map_err(|e| e.to_string())?;
    let bytes = jar_resp.bytes().await.map_err(|e| e.to_string())?.to_vec();
    Ok(bytes)
}

// Public API Implementation

pub fn generate_oauth2_url(state: &str) -> String {
    let scopes = "minecraft_server_session account_info offline_access";
    format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}",
        OAUTH2_AUTH_URL,
        urlencoding::encode(ELY_CLIENT_ID),
        urlencoding::encode(REDIRECT_URI),
        urlencoding::encode(scopes),
        urlencoding::encode(state)
    )
}

async fn oauth2_token_request(grant_type: &str, code: Option<&str>, refresh: Option<&str>) -> Result<OAuth2TokenResponse, String> {
    let client_secret = get_client_secret()?;
    let body = OAuth2TokenRequest {
        client_id: ELY_CLIENT_ID, client_secret, redirect_uri: REDIRECT_URI,
        grant_type, code, refresh_token: refresh,
        scope: if grant_type == "refresh_token" { Some("minecraft_server_session account_info offline_access") } else { None },
    };
    let resp = http_client().post(OAUTH2_TOKEN_URL).form(&body).send().await.map_err(|e| e.to_string())?;
    handle_resp(resp, "Ely.by OAuth2 token").await
}

pub async fn exchange_code_for_token(code: String) -> Result<OAuth2TokenResponse, String> {
    oauth2_token_request("authorization_code", Some(&code), None).await
}

pub async fn refresh_oauth2_token(refresh_token: &str) -> Result<OAuth2TokenResponse, String> {
    oauth2_token_request("refresh_token", None, Some(refresh_token)).await
}

pub async fn fetch_account_info(access_token: &str) -> Result<AccountInfo, String> {
    let resp = http_client()
        .get("https://account.ely.by/api/account/v1/info")
        .bearer_auth(access_token)
        .send().await.map_err(|e| e.to_string())?;
    handle_resp(resp, "Ely.by account info").await
}

pub async fn yggdrasil_authenticate(username: &str, password: &str, client_token: &str) -> Result<YggdrasilAuthResponse, String> {
    let resp = http_client()
        .post(YGGDRASIL_AUTH_URL)
        .json(&YggdrasilAuthRequest { username, password, client_token, request_user: true })
        .send().await.map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        return handle_resp(resp, "Ely.by authenticate").await;
    }
    
    let text = resp.text().await.unwrap_or_else(|_| "<no body>".into());
    if let Ok(err) = serde_json::from_str::<YggdrasilError>(&text) {
        if err.error == "ForbiddenOperationException" && err.error_message.contains("two factor") {
            return Err("ELYBY_2FA_REQUIRED".into());
        }
        return Err(format!("Ошибка Ely.by: {} — {}", err.error, err.error_message));
    }
    Err(format!("Ely.by authenticate error {}: {}", resp.status(), text))
}

pub async fn yggdrasil_refresh(access_token: &str, client_token: &str) -> Result<YggdrasilAuthResponse, String> {
    let resp = http_client()
        .post(YGGDRASIL_REFRESH_URL)
        .json(&YggdrasilRefreshRequest { access_token, client_token, request_user: true })
        .send().await.map_err(|e| e.to_string())?;
    handle_resp(resp, "Ely.by refresh").await
}

pub async fn yggdrasil_validate(access_token: &str) -> Result<bool, String> {
    let resp = http_client()
        .post(YGGDRASIL_VALIDATE_URL)
        .json(&YggdrasilValidateRequest { access_token })
        .send().await.map_err(|e| e.to_string())?;
    
    if resp.status().is_success() { return Ok(true); }
    if resp.status().as_u16() == 400 || resp.status().as_u16() == 401 { return Ok(false); }
    
    let text = resp.text().await.unwrap_or_else(|_| "<no body>".into());
    Err(format!("Ely.by validate error {}: {}", resp.status(), text))
}

pub async fn yggdrasil_invalidate(access_token: &str, client_token: &str) -> Result<(), String> {
    let resp = http_client()
        .post(YGGDRASIL_INVALIDATE_URL)
        .json(&YggdrasilInvalidateRequest { access_token, client_token })
        .send().await.map_err(|e| e.to_string())?;
    
    if resp.status().is_success() { return Ok(()); }
    let text = resp.text().await.unwrap_or_else(|_| "<no body>".into());
    Err(format!("Ely.by invalidate error {}: {}", resp.status(), text))
}

fn store_oauth_state(state: String) {
    if let Ok(mut g) = OAUTH_STATE.lock() { *g = Some(state); }
}
fn take_oauth_state() -> Option<String> {
    OAUTH_STATE.lock().ok().and_then(|mut g| g.take())
}

pub async fn ensure_authlib_injector() -> Result<std::path::PathBuf, String> {
    let base = launcher_data_dir()?;
    let dir = base.join("authlib");
    let jar_path = dir.join("authlib-injector.jar");

    if jar_path.exists() {
        let ok = std::fs::File::open(&jar_path)
            .and_then(|mut f| { let mut sig = [0u8; 2]; f.read_exact(&mut sig)?; Ok(sig == *b"PK") })
            .unwrap_or(false);
        if ok { return Ok(jar_path); }
        let _ = std::fs::remove_file(&jar_path);
    }

    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let bytes = download_authlib_injector_jar_bytes().await?;
    if bytes.len() < 2 || &bytes[..2] != b"PK" {
        return Err("Скачанный файл не является valid JAR (PK signature missing).".into());
    }
    tokio::fs::write(&jar_path, &bytes).await.map_err(|e| e.to_string())?;
    Ok(jar_path)
}

async fn handle_oauth_callback_internal(app: &AppHandle, code: String, state: String) -> Result<(), String> {
    let saved = take_oauth_state().ok_or("OAuth2 state не найден")?;
    if saved != state { return Err("Некорректный state".into()); }

    let token = exchange_code_for_token(code).await?;
    let account = fetch_account_info(&token.access_token).await?;

    let mut profile = get_profile().unwrap_or_default();
    profile.ely_username = Some(account.username.clone());
    profile.ely_uuid = Some(account.uuid.replace('-', ""));
    profile.ely_access_token = Some(token.access_token);
    profile.ely_refresh_token = token.refresh_token;
    profile.ely_client_token.get_or_insert_with(|| gen_random_str(32));
    
    // Clear MS/MC fields
    profile.ms_access_token = None; profile.ms_refresh_token = None; profile.ms_id_token = None;
    profile.mc_uuid = None; profile.mc_username = None; profile.mc_access_token = None;

    save_full_profile(&profile).map_err(|e| e.to_string())?;
    let _ = app.emit("ely-login-complete", profile);
    Ok(())
}

fn parse_query_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let mut split = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (split.next(), split.next()) {
            if k == key { return Some(urlencoding::decode(v).ok()?.into_owned()); }
        }
        None
    })
}

fn html_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c { '<' => out.push_str("&lt;"), '>' => out.push_str("&gt;"), '&' => out.push_str("&amp;"), '"' => out.push_str("&quot;"), _ => out.push(c) }
    }
    out
}

async fn write_html(stream: &mut tokio::net::TcpStream, title: &str, body: &str) {
    let page = format!("<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>{}</title></head><body>{}</body></html>", html_escape(title), body);
    let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", page.len(), page);
    let _ = stream.write_all(resp.as_bytes()).await;
}

async fn try_process_oauth_connection(app: &AppHandle, mut stream: tokio::net::TcpStream) -> Result<bool, String> {
    let mut buf = vec![0u8; 8192];
    let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
    if n == 0 { return Ok(false); }

    let req = String::from_utf8_lossy(&buf[..n]);
    let first_line = req.lines().next().ok_or("Bad Request")?;
    
    if !first_line.starts_with("GET ") { 
        let _ = stream.write_all(b"HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n").await;
        return Ok(false);
    }

    let path_part = first_line.strip_prefix("GET ").and_then(|s| s.split(' ').next()).ok_or("Bad Path")?;
    let query = path_part.split('?').nth(1).ok_or("No Query")?;

    if let Some(err) = parse_query_param(query, "error") {
        let desc = parse_query_param(query, "error_description").unwrap_or_default();
        let msg = format!("Ely.by: {err} — {desc}");
        let _ = app.emit("ely-login-failed", msg.clone());
        write_html(&mut stream, "Error", &format!("<h3>Ошибка</h3><p>{}</p>", html_escape(&msg))).await;
        return Ok(true);
    }

    let code = parse_query_param(query, "code").ok_or("No code")?;
    let state = parse_query_param(query, "state").ok_or("No state")?;

    match handle_oauth_callback_internal(app, code, state).await {
        Ok(_) => write_html(&mut stream, "Success", "<h3>Авторизация завершена.</h3>").await,
        Err(e) => {
            eprintln!("[ElyAuth] Callback error: {e}");
            let _ = app.emit("ely-login-failed", e.clone());
            write_html(&mut stream, "Error", &format!("<h3>Ошибка входа</h3><p>{}</p>", html_escape(&e))).await;
        }
    }
    Ok(true)
}

async fn run_local_oauth_server_async(app: AppHandle) {
    let l4 = match TcpListener::bind("127.0.0.1:25568").await {
        Ok(l) => l,
        Err(e) => {
            let msg = format!("Порт 25568 занят: {e}");
            eprintln!("[ElyAuth] {msg}");
            let _ = app.emit("ely-login-failed", msg);
            return;
        }
    };
    let l6 = TcpListener::bind("[::1]:25568").await.ok();
    let max_wait = Duration::from_secs(600);
    let start = tokio::time::Instant::now();

    loop {
        if start.elapsed() >= max_wait {
            let _ = app.emit("ely-login-failed", "Время ожидания истекло.");
            return;
        }
        let remaining = max_wait - start.elapsed();
        
        let accept_fut = async {
            match &l6 {
                Some(l6) => tokio::select! { r = l4.accept() => r, r = l6.accept() => r },
                None => l4.accept().await,
            }
        };

        match tokio::time::timeout(remaining, accept_fut).await {
            Err(_) => { let _ = app.emit("ely-login-failed", "Таймаут"); return; }
            Ok(Err(e)) => { eprintln!("[ElyAuth] Accept: {e}"); continue; }
            Ok(Ok((stream, _))) => {
                if let Err(e) = try_process_oauth_connection(&app, stream).await {
                    eprintln!("[ElyAuth] Process: {e}");
                } else { return; } // Success or handled failure, stop server
            }
        }
    }
}

fn run_local_oauth_server(app: AppHandle) {
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(run_local_oauth_server_async(app));
    });
}

#[tauri::command]
pub async fn start_ely_oauth(app: AppHandle) -> Result<String, String> {
    let state = gen_random_str(32);
    store_oauth_state(state.clone());
    let app_clone = app.clone();
    run_local_oauth_server(app_clone);
    Ok(generate_oauth2_url(&state))
}

#[tauri::command]
pub async fn handle_oauth_callback(app: AppHandle, code: String, state: String) -> Result<(), String> {
    handle_oauth_callback_internal(&app, code, state).await
}

#[tauri::command]
pub async fn ely_login_with_password(username: String, password: String, totp_token: Option<String>) -> Result<(), String> {
    let mut profile = get_profile().unwrap_or_default();
    let pwd = if let Some(t) = totp_token { if !t.is_empty() { format!("{password}:{t}") } else { password } } else { password };
    let client_token = profile.ely_client_token.clone().unwrap_or_else(|| gen_random_str(32));
    
    let resp = yggdrasil_authenticate(&username, &pwd, &client_token).await?;

    profile.ely_username = Some(resp.selected_profile.name.clone());
    profile.ely_uuid = Some(resp.selected_profile.id.clone());
    profile.ely_access_token = Some(resp.access_token);
    profile.ely_client_token = Some(resp.client_token);
    profile.ms_access_token = None; profile.ms_refresh_token = None; profile.ms_id_token = None;
    profile.mc_uuid = None; profile.mc_username = None; profile.mc_access_token = None;

    save_full_profile(&profile).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn ely_logout() -> Result<(), String> {
    let mut profile = get_profile().unwrap_or_default();
    if let (Some(acc), Some(cli)) = (profile.ely_access_token.clone(), profile.ely_client_token.clone()) {
        let _ = yggdrasil_invalidate(&acc, &cli).await;
    }
    profile.ely_username = None; profile.ely_uuid = None;
    profile.ely_access_token = None; profile.ely_client_token = None; profile.ely_refresh_token = None;
    save_full_profile(&profile).map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn refresh_ely_session_internal() -> Result<(), String> {
    let mut profile = get_profile().unwrap_or_default();
    let access = profile.ely_access_token.clone().filter(|t| !t.is_empty());
    if access.is_none() { return Ok(()); }
    
    if yggdrasil_validate(&access.unwrap()).await? { return Ok(()); }

    let refresh = profile.ely_refresh_token.clone().filter(|t| !t.is_empty())
        .ok_or_else(|| {
            profile.ely_access_token = None;
            let _ = save_full_profile(&profile);
            "Сессия истекла, войдите заново."
        })?;

    let token_resp = refresh_oauth2_token(&refresh).await?;
    profile.ely_access_token = Some(token_resp.access_token);
    if let Some(new_ref) = token_resp.refresh_token { profile.ely_refresh_token = Some(new_ref); }
    
    save_full_profile(&profile).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn refresh_ely_session() -> Result<(), String> {
    refresh_ely_session_internal().await
}