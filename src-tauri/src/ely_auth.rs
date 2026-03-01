use std::net::TcpListener;
use std::io::{Read as IoRead, Write as IoWrite};
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use rand::{distributions::Alphanumeric, Rng};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::game_provider::{get_profile, launcher_data_dir, profile_path, Profile};

fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(60))
        .connect_timeout(Duration::from_secs(15))
        .user_agent("16Launcher/1.0")
        .build()
        .unwrap_or_else(|_| Client::new())
}

pub const ELY_CLIENT_ID: &str = "16launcher4";

pub const OAUTH2_AUTH_URL: &str = "https://account.ely.by/oauth2/v1";
pub const OAUTH2_TOKEN_URL: &str = "https://account.ely.by/api/oauth2/v1/token";

pub const YGGDRASIL_AUTH_URL: &str = "https://authserver.ely.by/auth/authenticate";
pub const YGGDRASIL_REFRESH_URL: &str = "https://authserver.ely.by/auth/refresh";
pub const YGGDRASIL_VALIDATE_URL: &str = "https://authserver.ely.by/auth/validate";
pub const YGGDRASIL_INVALIDATE_URL: &str = "https://authserver.ely.by/auth/invalidate";

pub const REDIRECT_URI: &str = "http://localhost:25568/callback";

// Ссылка на проект authlib-injector (GitHub)
const AUTHLIB_INJECTOR_GITHUB_URL: &str = "https://github.com/yushijinhun/authlib-injector";
const AUTHLIB_INJECTOR_LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/yushijinhun/authlib-injector/releases/latest";

#[derive(Debug, Deserialize)]
struct GithubRelease {
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
}

async fn download_authlib_injector_jar_bytes() -> Result<Vec<u8>, String> {
    let client = http_client();

    let release_resp = client
        .get(AUTHLIB_INJECTOR_LATEST_RELEASE_API)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса GitHub API latest release: {e}"))?;

    if !release_resp.status().is_success() {
        let status = release_resp.status();
        let text = release_resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!(
            "GitHub API вернул ошибку {} при запросе latest release: {}",
            status, text
        ));
    }

    let release: GithubRelease = release_resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора ответа GitHub API latest release: {e}"))?;

    let asset = release
        .assets
        .into_iter()
        .find(|a| {
            let name = a.name.to_ascii_lowercase();
            name.ends_with(".jar") && name.contains("authlib-injector")
        })
        .ok_or("В latest release не найден jar-файл authlib-injector".to_string())?;

    let jar_resp = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки authlib-injector.jar из GitHub: {e}"))?;

    if !jar_resp.status().is_success() {
        let status = jar_resp.status();
        let text = jar_resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!(
            "Не удалось скачать authlib-injector.jar ({}): {}",
            status, text
        ));
    }

    let bytes = jar_resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения тела authlib-injector.jar: {e}"))?;

    Ok(bytes.to_vec())
}

static OAUTH_STATE: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

fn get_client_secret() -> Result<String, String> {
    std::env::var("ELY_CLIENT_SECRET").map_err(|_| {
        "Переменная окружения ELY_CLIENT_SECRET не установлена, а Ely.by OAuth2 требует client_secret"
            .to_string()
    })
}

#[derive(Debug, Deserialize)]
pub struct OAuth2TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    pub token_type: String,
    pub expires_in: u64,
}

#[derive(Debug, Serialize)]
struct OAuth2TokenRequest<'a> {
    client_id: &'a str,
    client_secret: String,
    redirect_uri: &'a str,
    grant_type: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    refresh_token: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scope: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
pub struct AccountInfo {
    pub id: u64,
    pub uuid: String,
    pub username: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub preferredLanguage: Option<String>,
}

#[derive(Debug, Serialize)]
struct YggdrasilAuthRequest<'a> {
    username: &'a str,
    password: &'a str,
    #[serde(rename = "clientToken")]
    client_token: &'a str,
    #[serde(rename = "requestUser")]
    request_user: bool,
}

#[derive(Debug, Deserialize)]
pub struct YggdrasilProfile {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct YggdrasilUserProperty {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct YggdrasilUser {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub properties: Vec<YggdrasilUserProperty>,
}

#[derive(Debug, Deserialize)]
pub struct YggdrasilAuthResponse {
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "clientToken")]
    pub client_token: String,
    #[serde(default)]
    pub availableProfiles: Vec<YggdrasilProfile>,
    #[serde(rename = "selectedProfile")]
    pub selected_profile: YggdrasilProfile,
    #[serde(default)]
    pub user: Option<YggdrasilUser>,
}

#[derive(Debug, Deserialize)]
struct YggdrasilError {
    error: String,
    #[serde(rename = "errorMessage")]
    error_message: String,
}

#[derive(Debug, Serialize)]
struct YggdrasilRefreshRequest<'a> {
    #[serde(rename = "accessToken")]
    access_token: &'a str,
    #[serde(rename = "clientToken")]
    client_token: &'a str,
    #[serde(rename = "requestUser")]
    request_user: bool,
}

#[derive(Debug, Serialize)]
struct YggdrasilValidateRequest<'a> {
    #[serde(rename = "accessToken")]
    access_token: &'a str,
}

#[derive(Debug, Serialize)]
struct YggdrasilInvalidateRequest<'a> {
    #[serde(rename = "accessToken")]
    access_token: &'a str,
    #[serde(rename = "clientToken")]
    client_token: &'a str,
}

pub fn generate_oauth2_url(state: &str) -> String {
    let scopes = "minecraft_server_session account_info offline_access";
    let client_id_encoded = urlencoding::encode(ELY_CLIENT_ID);
    let redirect_encoded = urlencoding::encode(REDIRECT_URI);
    let scope_encoded = urlencoding::encode(scopes);
    let state_encoded = urlencoding::encode(state);

    format!(
        "{base}?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope={scope}&state={state}",
        base = OAUTH2_AUTH_URL,
        client_id = client_id_encoded,
        redirect = redirect_encoded,
        scope = scope_encoded,
        state = state_encoded,
    )
}

pub async fn exchange_code_for_token(code: String) -> Result<OAuth2TokenResponse, String> {
    let client_secret = get_client_secret()?;
    let body = OAuth2TokenRequest {
        client_id: ELY_CLIENT_ID,
        client_secret,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
        code: Some(&code),
        refresh_token: None,
        scope: None,
    };

    let client = http_client();
    let resp = client
        .post(OAUTH2_TOKEN_URL)
        .form(&body)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса к Ely.by OAuth2 token: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!(
            "Ely.by вернул ошибку при обмене кода на токен: {} — {}",
            status, text
        ));
    }

    resp.json::<OAuth2TokenResponse>()
        .await
        .map_err(|e| format!("Ошибка разбора ответа Ely.by OAuth2: {e}"))
}

pub async fn refresh_oauth2_token(refresh_token: &str) -> Result<OAuth2TokenResponse, String> {
    let client_secret = get_client_secret()?;
    let scopes = "minecraft_server_session account_info offline_access";

    let body = OAuth2TokenRequest {
        client_id: ELY_CLIENT_ID,
        client_secret,
        redirect_uri: REDIRECT_URI,
        grant_type: "refresh_token",
        code: None,
        refresh_token: Some(refresh_token),
        scope: Some(scopes),
    };

    let client = http_client();
    let resp = client
        .post(OAUTH2_TOKEN_URL)
        .form(&body)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса обновления OAuth2 токена Ely.by: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!(
            "Ely.by вернул ошибку при обновлении OAuth2 токена: {} — {}",
            status, text
        ));
    }

    resp.json::<OAuth2TokenResponse>()
        .await
        .map_err(|e| format!("Ошибка разбора ответа Ely.by OAuth2 refresh: {e}"))
}

pub async fn fetch_account_info(access_token: &str) -> Result<AccountInfo, String> {
    let client = http_client();
    let resp = client
        .get("https://account.ely.by/api/account/v1/info")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса Ely.by account info: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!(
            "Ely.by вернул ошибку при запросе account info: {} — {}",
            status, text
        ));
    }

    resp.json::<AccountInfo>()
        .await
        .map_err(|e| format!("Ошибка разбора ответа Ely.by account info: {e}"))
}

pub async fn yggdrasil_authenticate(
    username: &str,
    password: &str,
    client_token: &str,
) -> Result<YggdrasilAuthResponse, String> {
    let req_body = YggdrasilAuthRequest {
        username,
        password,
        client_token,
        request_user: true,
    };

    let client = http_client();
    let resp = client
        .post(YGGDRASIL_AUTH_URL)
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса Ely.by /auth/authenticate: {e}"))?;

    if resp.status().is_success() {
        return resp
            .json::<YggdrasilAuthResponse>()
            .await
            .map_err(|e| format!("Ошибка разбора ответа Ely.by authenticate: {e}"));
    }

    let status = resp.status();
    let text = resp
        .text()
        .await
        .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());

    if let Ok(err) = serde_json::from_str::<YggdrasilError>(&text) {
        if err.error == "ForbiddenOperationException"
            && err.error_message == "Account protected with two factor auth."
        {
            return Err("ELYBY_2FA_REQUIRED".to_string());
        }
        return Err(format!(
            "Ошибка Ely.by: {} — {}",
            err.error, err.error_message
        ));
    }

    Err(format!(
        "Ely.by вернул ошибку {} при authenticate: {}",
        status, text
    ))
}

pub async fn yggdrasil_refresh(
    access_token: &str,
    client_token: &str,
) -> Result<YggdrasilAuthResponse, String> {
    let req_body = YggdrasilRefreshRequest {
        access_token,
        client_token,
        request_user: true,
    };

    let client = http_client();
    let resp = client
        .post(YGGDRASIL_REFRESH_URL)
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса Ely.by /auth/refresh: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!(
            "Ely.by вернул ошибку {} при refresh: {}",
            status, text
        ));
    }

    resp.json::<YggdrasilAuthResponse>()
        .await
        .map_err(|e| format!("Ошибка разбора ответа Ely.by refresh: {e}"))
}

pub async fn yggdrasil_validate(access_token: &str) -> Result<bool, String> {
    let req_body = YggdrasilValidateRequest { access_token };

    let client = http_client();
    let resp = client
        .post(YGGDRASIL_VALIDATE_URL)
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса Ely.by /auth/validate: {e}"))?;

    if resp.status().is_success() {
        return Ok(true);
    }

    if resp.status().as_u16() == 400 || resp.status().as_u16() == 401 {
        return Ok(false);
    }

    let status = resp.status();
    let text = resp
        .text()
        .await
        .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
    Err(format!(
        "Неожиданная ошибка Ely.by validate ({}): {}",
        status,
        text
    ))
}

pub async fn yggdrasil_invalidate(access_token: &str, client_token: &str) -> Result<(), String> {
    let req_body = YggdrasilInvalidateRequest {
        access_token,
        client_token,
    };

    let client = http_client();
    let resp = client
        .post(YGGDRASIL_INVALIDATE_URL)
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса Ely.by /auth/invalidate: {e}"))?;

    if resp.status().is_success() {
        return Ok(());
    }

    let status = resp.status();
    let text = resp
        .text()
        .await
        .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
    Err(format!(
        "Ely.by вернул ошибку {} при invalidate: {}",
        status, text
    ))
}

fn generate_state() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

fn generate_client_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

fn store_oauth_state(state: String) {
    if let Ok(mut guard) = OAUTH_STATE.lock() {
        *guard = Some(state);
    }
}

fn take_oauth_state() -> Option<String> {
    if let Ok(mut guard) = OAUTH_STATE.lock() {
        guard.take()
    } else {
        None
    }
}

pub async fn ensure_authlib_injector() -> Result<std::path::PathBuf, String> {
    let base = launcher_data_dir()?;
    let dir = base.join("authlib");
    let jar_path = dir.join("authlib-injector.jar");

    if jar_path.exists() {
        // Проверяем, что это реально JAR (zip), а не HTML/ошибка/обрывок
        let ok = std::fs::File::open(&jar_path)
            .and_then(|mut f| {
                let mut sig = [0u8; 2];
                f.read_exact(&mut sig)?;
                Ok(sig == *b"PK")
            })
            .unwrap_or(false);
        if ok {
            return Ok(jar_path);
        }
        let _ = std::fs::remove_file(&jar_path);
    }

    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Не удалось создать папку для authlib-injector: {e}"))?;

    let bytes = download_authlib_injector_jar_bytes().await?;
    if bytes.len() < 2 || &bytes[..2] != b"PK" {
        return Err(format!(
            "Скачанный authlib-injector не похож на JAR (ожидался zip с сигнатурой PK). Проект: {}",
            AUTHLIB_INJECTOR_GITHUB_URL
        ));
    }

    tokio::fs::write(&jar_path, &bytes)
        .await
        .map_err(|e| format!("Не удалось сохранить authlib-injector: {e}"))?;

    Ok(jar_path)
}

async fn handle_oauth_callback_internal(
    app: &AppHandle,
    code: String,
    state: String,
) -> Result<(), String> {
    let saved_state = take_oauth_state().ok_or("OAuth2 state не найден или устарел")?;
    if saved_state != state {
        return Err("Некорректный параметр state в ответе Ely.by".to_string());
    }

    let token = exchange_code_for_token(code).await?;
    let account = fetch_account_info(&token.access_token).await?;

    let mut profile = get_profile().unwrap_or_default();
    profile.ely_username = Some(account.username);
    profile.ely_uuid = Some(account.uuid.replace('-', ""));
    profile.ely_access_token = Some(token.access_token);
    if let Some(r) = token.refresh_token {
        profile.ely_refresh_token = Some(r);
    }
    if profile.ely_client_token.is_none() {
        profile.ely_client_token = Some(generate_client_token());
    }

    let path = profile_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку профиля: {e}"))?;
    }
    let s = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("Ошибка сериализации профиля: {e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("Не удалось сохранить профиль: {e}"))?;

    let _ = app.emit("ely-login-complete", profile);

    Ok(())
}

fn parse_query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut split = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (split.next(), split.next()) {
            if k == key {
                return Some(urlencoding::decode(v).ok()?.into_owned());
            }
        }
    }
    None
}

fn run_local_oauth_server(app: AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:25568")
        .map_err(|e| format!("Не удалось запустить локальный HTTP-сервер OAuth2: {e}"))?;

    if let Ok((mut stream, _)) = listener.accept() {
        let mut buffer = [0u8; 2048];
        let n = stream
            .read(&mut buffer)
            .map_err(|e| format!("Ошибка чтения HTTP-запроса от браузера: {e}"))?;
        let req = String::from_utf8_lossy(&buffer[..n]);
        let mut lines = req.lines();
        if let Some(first_line) = lines.next() {
            if let Some(rest) = first_line.strip_prefix("GET ") {
                if let Some(idx) = rest.find(' ') {
                    let path = &rest[..idx];
                    if let Some(qidx) = path.find('?') {
                        let query = &path[qidx + 1..];
                        if let (Some(code), Some(state)) = (
                            parse_query_param(query, "code"),
                            parse_query_param(query, "state"),
                        ) {
                            let app_clone = app.clone();
                            let code_clone = code.clone();
                            let state_clone = state.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) =
                                    handle_oauth_callback_internal(&app_clone, code_clone, state_clone).await
                                {
                                    eprintln!("[ElyAuth] Ошибка обработки OAuth2 callback: {e}");
                                }
                            });

                            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><body><h3>Авторизация завершена, вернитесь в лаунчер.</h3></body></html>";
                            let _ = stream.write_all(response.as_bytes());
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn start_ely_oauth(app: AppHandle) -> Result<String, String> {
    let state = generate_state();
    store_oauth_state(state.clone());

    let url = generate_oauth2_url(&state);

    let app_clone = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = run_local_oauth_server(app_clone) {
            eprintln!("[ElyAuth] Локальный OAuth2 сервер завершился с ошибкой: {e}");
        }
    });

    Ok(url)
}

#[tauri::command]
pub async fn handle_oauth_callback(
    app: AppHandle,
    code: String,
    state: String,
) -> Result<(), String> {
    handle_oauth_callback_internal(&app, code, state).await
}

#[tauri::command]
pub async fn ely_login_with_password(
    username: String,
    password: String,
    totp_token: Option<String>,
) -> Result<(), String> {
    let mut profile = get_profile().unwrap_or_default();
    let mut password_full = password;
    if let Some(token) = totp_token {
        if !token.is_empty() {
            password_full = format!("{password_full}:{token}");
        }
    }

    let client_token = profile
        .ely_client_token
        .clone()
        .unwrap_or_else(generate_client_token);

    let resp = yggdrasil_authenticate(&username, &password_full, &client_token).await?;

    profile.ely_username = Some(resp.selected_profile.name.clone());
    profile.ely_uuid = Some(resp.selected_profile.id.clone());
    profile.ely_access_token = Some(resp.access_token);
    profile.ely_client_token = Some(resp.client_token);

    let path = profile_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку профиля: {e}"))?;
    }
    let s = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("Ошибка сериализации профиля: {e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("Не удалось сохранить профиль: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn ely_logout() -> Result<(), String> {
    let mut profile = get_profile().unwrap_or_default();

    if let (Some(access), Some(client)) = (
        profile.ely_access_token.clone(),
        profile.ely_client_token.clone(),
    ) {
        let _ = yggdrasil_invalidate(&access, &client).await;
    }

    profile.ely_username = None;
    profile.ely_uuid = None;
    profile.ely_access_token = None;
    profile.ely_client_token = None;
    profile.ely_refresh_token = None;

    let path = profile_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку профиля: {e}"))?;
    }
    let s = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("Ошибка сериализации профиля: {e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("Не удалось сохранить профиль: {e}"))?;

    Ok(())
}

pub async fn refresh_ely_session_internal() -> Result<(), String> {
    let mut profile = get_profile().unwrap_or_default();
    let access_token = match profile.ely_access_token.clone() {
        Some(t) if !t.is_empty() => t,
        _ => return Ok(()),
    };

    if yggdrasil_validate(&access_token).await? {
        return Ok(());
    }

    let refresh_token = match profile.ely_refresh_token.clone() {
        Some(t) if !t.is_empty() => t,
        _ => {
            profile.ely_access_token = None;
            let path = profile_path()?;
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Не удалось создать папку профиля: {e}"))?;
            }
            let s = serde_json::to_string_pretty(&profile)
                .map_err(|e| format!("Ошибка сериализации профиля: {e}"))?;
            std::fs::write(&path, s).map_err(|e| format!("Не удалось сохранить профиль: {e}"))?;
            return Err("Сессия Ely.by истекла, войдите заново.".to_string());
        }
    };

    let token_resp = refresh_oauth2_token(&refresh_token).await?;
    profile.ely_access_token = Some(token_resp.access_token.clone());
    if let Some(new_refresh) = token_resp.refresh_token {
        profile.ely_refresh_token = Some(new_refresh);
    }

    let path = profile_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку профиля: {e}"))?;
    }
    let s = serde_json::to_string_pretty(&profile)
        .map_err(|e| format!("Ошибка сериализации профиля: {e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("Не удалось сохранить профиль: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn refresh_ely_session() -> Result<(), String> {
    refresh_ely_session_internal().await
}

