use std::io::{Read as IoRead, Write as IoWrite};
use std::net::TcpListener;
use std::time::Duration;

use once_cell::sync::Lazy;
use rand::{distributions::Alphanumeric, Rng};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

use crate::game_provider::{get_profile, save_full_profile, Profile};

fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(60))
        .connect_timeout(Duration::from_secs(15))
        .user_agent("16Launcher/1.0")
        .build()
        .unwrap_or_else(|_| Client::new())
}

// ВАЖНО: client_id должен совпадать с приложением в Azure / Microsoft.
// Значение взято из переданной ссылки авторизации.
pub const MS_CLIENT_ID: &str = "4ce834ee-3152-443c-b0b4-f266c19efd06";

pub const MS_OAUTH2_AUTH_URL: &str = "https://login.live.com/oauth20_authorize.srf";
pub const MS_OAUTH2_TOKEN_URL: &str = "https://login.live.com/oauth20_token.srf";

// Должен в точности совпадать с redirect_uri,
// зарегистрированным в Azure / Microsoft.
// Сейчас используем тот, что в переданной ссылке:
// https://login.live.com/oauth20_authorize.srf?client_id=4ce834ee-3152-443c-b0b4-f266c19efd06&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A1420&scope=XboxLive.signin%20offline_access%20openid%20profile%20email&prompt=select_account
pub const MS_REDIRECT_URI: &str = "http://localhost:1420";

// state для защиты от CSRF.
static MS_OAUTH_STATE: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

fn generate_state() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

fn store_oauth_state(state: String) {
    if let Ok(mut guard) = MS_OAUTH_STATE.lock() {
        *guard = Some(state);
    }
}

fn take_oauth_state() -> Option<String> {
    if let Ok(mut guard) = MS_OAUTH_STATE.lock() {
        guard.take()
    } else {
        None
    }
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

fn generate_ms_oauth_url(state: &str) -> String {
    let scopes = "XboxLive.signin offline_access openid profile email";
    let client_id_encoded = urlencoding::encode(MS_CLIENT_ID);
    let redirect_encoded = urlencoding::encode(MS_REDIRECT_URI);
    let scope_encoded = urlencoding::encode(scopes);
    let state_encoded = urlencoding::encode(state);

    format!(
        "{base}?client_id={client_id}&redirect_uri={redirect}&response_type=code&scope={scope}&state={state}&prompt=select_account",
        base = MS_OAUTH2_AUTH_URL,
        client_id = client_id_encoded,
        redirect = redirect_encoded,
        scope = scope_encoded,
        state = state_encoded,
    )
}

#[derive(Debug, Deserialize)]
struct MsTokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    token_type: String,
    expires_in: u64,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
}

// ------------------------ Microsoft / Minecraft (официальный аккаунт) ------------------------

#[derive(Debug, Serialize)]
struct XblUserAuthProperties {
    #[serde(rename = "AuthMethod")]
    auth_method: String,
    #[serde(rename = "SiteName")]
    site_name: String,
    #[serde(rename = "RpsTicket")]
    rps_ticket: String,
}

#[derive(Debug, Serialize)]
struct XblUserAuthRequest {
    #[serde(rename = "RelyingParty")]
    relying_party: String,
    #[serde(rename = "TokenType")]
    token_type: String,
    #[serde(rename = "Properties")]
    properties: XblUserAuthProperties,
}

#[derive(Debug, Deserialize)]
struct XblDisplayClaims {
    xui: Vec<XblXuiEntry>,
}

#[derive(Debug, Deserialize)]
struct XblXuiEntry {
    uhs: String,
}

#[derive(Debug, Deserialize)]
struct XblUserAuthResponse {
    Token: String,
    DisplayClaims: XblDisplayClaims,
}

#[derive(Debug, Serialize)]
struct XstsProperties {
    #[serde(rename = "SandboxId")]
    sandbox_id: String,
    #[serde(rename = "UserTokens")]
    user_tokens: Vec<String>,
}

#[derive(Debug, Serialize)]
struct XstsAuthRequest {
    #[serde(rename = "RelyingParty")]
    relying_party: String,
    #[serde(rename = "TokenType")]
    token_type: String,
    #[serde(rename = "Properties")]
    properties: XstsProperties,
}

#[derive(Debug, Deserialize)]
struct XstsAuthResponse {
    Token: String,
    DisplayClaims: XblDisplayClaims,
}

#[derive(Debug, Serialize)]
struct McLoginWithXboxRequest {
    identityToken: String,
}

#[derive(Debug, Deserialize)]
struct McLoginWithXboxResponse {
    access_token: String,
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct McProfile {
    id: String,
    name: String,
}

#[derive(Debug, Serialize)]
struct MsTokenRequest<'a> {
    client_id: &'a str,
    redirect_uri: &'a str,
    grant_type: &'a str,
    code: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    client_secret: Option<String>,
}

async fn exchange_code_for_token(code: String) -> Result<MsTokenResponse, String> {
    let client_secret = std::env::var("MS_CLIENT_SECRET").ok();
    let body = MsTokenRequest {
        client_id: MS_CLIENT_ID,
        redirect_uri: MS_REDIRECT_URI,
        grant_type: "authorization_code",
        code: &code,
        client_secret,
    };

    let client = http_client();
    let resp = client
        .post(MS_OAUTH2_TOKEN_URL)
        .form(&body)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса к Microsoft OAuth2 token: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!(
            "Microsoft вернул ошибку при обмене кода на токен: {} — {}",
            status, text
        ));
    }

    resp.json::<MsTokenResponse>()
        .await
        .map_err(|e| format!("Ошибка разбора ответа Microsoft OAuth2: {e}"))
}

/// Полная цепочка обмена Microsoft токена на Minecraft токен и профиль.
/// Возвращает (никнейм, uuid, minecraft_access_token).
pub async fn exchange_to_minecraft_token(ms_token: &str) -> Result<(String, String, String), String> {
    let client = http_client();

    // 1. Входим в Xbox Live с MSA токеном
    let xbl_req = XblUserAuthRequest {
        relying_party: "http://auth.xboxlive.com".to_string(),
        token_type: "JWT".to_string(),
        properties: XblUserAuthProperties {
            auth_method: "RPS".to_string(),
            site_name: "user.auth.xboxlive.com".to_string(),
            rps_ticket: format!("d={}", ms_token),
        },
    };

    let xbl_resp = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&xbl_req)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса Xbox Live user/authenticate: {e}"))?;

    if !xbl_resp.status().is_success() {
        let status = xbl_resp.status();
        let text = xbl_resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!(
            "Xbox Live user/authenticate вернул ошибку {}: {}",
            status, text
        ));
    }

    let xbl_body: XblUserAuthResponse = xbl_resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора ответа Xbox Live user/authenticate: {e}"))?;

    let xbl_token = xbl_body.Token;
    let uhs = xbl_body
        .DisplayClaims
        .xui
        .get(0)
        .map(|x| x.uhs.clone())
        .ok_or_else(|| "Xbox Live ответ не содержит DisplayClaims.xui[0].uhs".to_string())?;

    // 2. Получаем XSTS токен
    let xsts_req = XstsAuthRequest {
        relying_party: "rp://api.minecraftservices.com/".to_string(),
        token_type: "JWT".to_string(),
        properties: XstsProperties {
            sandbox_id: "RETAIL".to_string(),
            user_tokens: vec![xbl_token],
        },
    };

    let xsts_resp = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&xsts_req)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса XSTS authorize: {e}"))?;

    if !xsts_resp.status().is_success() {
        let status = xsts_resp.status();
        let text = xsts_resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!("XSTS authorize вернул ошибку {}: {}", status, text));
    }

    let xsts_body: XstsAuthResponse = xsts_resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора ответа XSTS authorize: {e}"))?;

    let xsts_token = xsts_body.Token;

    // 3. Логинимся в Minecraft Services
    let identity_token = format!("XBL3.0 x={};{}", uhs, xsts_token);
    let mc_login_req = McLoginWithXboxRequest {
        identityToken: identity_token,
    };

    let mc_login_resp = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&mc_login_req)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса Minecraft login_with_xbox: {e}"))?;

    if !mc_login_resp.status().is_success() {
        let status = mc_login_resp.status();
        let text = mc_login_resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!(
            "Minecraft login_with_xbox вернул ошибку {}: {}",
            status, text
        ));
    }

    let mc_login_body: McLoginWithXboxResponse = mc_login_resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора ответа Minecraft login_with_xbox: {e}"))?;

    let mc_access_token = mc_login_body.access_token;

    // 4. Получаем Minecraft профиль
    let mc_profile_resp = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&mc_access_token)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса Minecraft profile: {e}"))?;

    if !mc_profile_resp.status().is_success() {
        let status = mc_profile_resp.status();
        let text = mc_profile_resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!(
            "Minecraft profile вернул ошибку {}: {}",
            status, text
        ));
    }

    let mc_profile: McProfile = mc_profile_resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора ответа Minecraft profile: {e}"))?;

    Ok((mc_profile.name, mc_profile.id, mc_access_token))
}

async fn handle_ms_oauth_callback_internal(
    app: &AppHandle,
    code: String,
    state: String,
) -> Result<(), String> {
    let saved_state = take_oauth_state().ok_or("OAuth2 state не найден или устарел")?;
    if saved_state != state {
        return Err("Некорректный параметр state в ответе Microsoft".to_string());
    }

    let token = exchange_code_for_token(code).await?;

    let mut profile = get_profile().unwrap_or_default();
    profile.ms_access_token = Some(token.access_token.clone());
    if let Some(r) = token.refresh_token {
        profile.ms_refresh_token = Some(r);
    }
    if let Some(id) = token.id_token {
        profile.ms_id_token = Some(id);
    }

    // Пытаемся сразу получить официальный Minecraft‑токен и профиль
    match exchange_to_minecraft_token(&token.access_token).await {
        Ok((mc_name, mc_uuid, mc_access_token)) => {
            profile.mc_username = Some(mc_name);
            profile.mc_uuid = Some(mc_uuid);
            profile.mc_access_token = Some(mc_access_token);
        }
        Err(e) => {
            eprintln!("[MsAuth] Не удалось получить Minecraft токен/профиль: {e}");
        }
    }

    save_full_profile(&profile)?;

    let _ = app.emit("ms-login-complete", profile);

    Ok(())
}

fn run_local_ms_oauth_server(app: AppHandle) -> Result<(), String> {
    // Слушаем тот же порт, который указан в MS_REDIRECT_URI.
    let listener = TcpListener::bind("127.0.0.1:1420")
        .map_err(|e| format!("Не удалось запустить локальный HTTP-сервер Microsoft OAuth2: {e}"))?;

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
                                if let Err(e) = handle_ms_oauth_callback_internal(
                                    &app_clone,
                                    code_clone,
                                    state_clone,
                                )
                                .await
                                {
                                    eprintln!("[MsAuth] Ошибка обработки OAuth2 callback: {e}");
                                }
                            });

                            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><body><h3>Вход через Microsoft завершён, вернитесь в лаунчер.</h3></body></html>";
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
pub async fn start_ms_oauth(app: AppHandle) -> Result<String, String> {
    let state = generate_state();
    store_oauth_state(state.clone());

    let url = generate_ms_oauth_url(&state);

    let app_clone = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = run_local_ms_oauth_server(app_clone) {
            eprintln!("[MsAuth] Локальный OAuth2 сервер завершился с ошибкой: {e}");
        }
    });

    Ok(url)
}

#[tauri::command]
pub async fn ms_logout() -> Result<(), String> {
    let mut profile = get_profile().unwrap_or_default();
    profile.ms_access_token = None;
    profile.ms_refresh_token = None;
    profile.ms_id_token = None;
    profile.mc_access_token = None;
    profile.mc_uuid = None;
    profile.mc_username = None;
    save_full_profile(&profile)?;
    Ok(())
}

