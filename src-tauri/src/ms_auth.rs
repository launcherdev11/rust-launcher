use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use rand::{distributions::Alphanumeric, Rng};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::game_provider::{get_profile, save_full_profile};

fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(60))
        .connect_timeout(Duration::from_secs(15))
        .user_agent("16Launcher/1.0")
        .build()
        .unwrap_or_else(|_| Client::new())
}

pub const MS_CLIENT_ID: &str = "4ce834ee-3152-443c-b0b4-f266c19efd06";
pub const MS_OAUTH2_AUTH_URL: &str = "https://login.live.com/oauth20_authorize.srf";
pub const MS_OAUTH2_TOKEN_URL: &str = "https://login.live.com/oauth20_token.srf";
pub const MS_REDIRECT_URI: &str = "http://localhost:1420";

static MS_OAUTH_STATE: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

fn gen_state() -> String {
    rand::thread_rng().sample_iter(&Alphanumeric).take(32).map(char::from).collect()
}

fn store_state(s: String) { if let Ok(mut g) = MS_OAUTH_STATE.lock() { *g = Some(s); } }
fn take_state() -> Option<String> { MS_OAUTH_STATE.lock().ok().and_then(|mut g| g.take()) }

fn parse_param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|p| {
        let mut s = p.splitn(2, '=');
        if let (Some(k), Some(v)) = (s.next(), s.next()) {
            if k == key { return Some(urlencoding::decode(v).ok()?.into_owned()); }
        }
        None
    })
}

fn generate_ms_oauth_url(state: &str) -> String {
    let scopes = "XboxLive.signin offline_access openid profile email";
    format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&prompt=select_account",
        MS_OAUTH2_AUTH_URL,
        urlencoding::encode(MS_CLIENT_ID),
        urlencoding::encode(MS_REDIRECT_URI),
        urlencoding::encode(scopes),
        urlencoding::encode(state)
    )
}

async fn handle_resp<T>(resp: reqwest::Response, ctx: &str) -> Result<T, String>
where T: for<'de> Deserialize<'de> {
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_else(|_| "<no body>".into());
        return Err(format!("{ctx} error {}: {}", status, text));
    }
    resp.json::<T>().await.map_err(|e| format!("Parse error {ctx}: {e}"))
}

#[derive(Debug, Deserialize)]
struct MsTokenResponse {
    access_token: String,
    #[serde(default)] refresh_token: Option<String>,
    #[serde(default)] id_token: Option<String>,
    #[serde(default)] token_type: String,
    #[serde(default)] expires_in: u64,
}

#[derive(Debug, Serialize)]
struct MsTokenRequest<'a> {
    client_id: &'a str, redirect_uri: &'a str, grant_type: &'a str, code: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")] client_secret: Option<String>,
}

#[derive(Debug, Serialize)]
struct XblProps {
    #[serde(rename = "AuthMethod")] auth_method: String,
    #[serde(rename = "SiteName")] site_name: String,
    #[serde(rename = "RpsTicket")] rps_ticket: String,
}
#[derive(Debug, Serialize)]
struct XblReq {
    #[serde(rename = "RelyingParty")] rp: String,
    #[serde(rename = "TokenType")] tt: String,
    #[serde(rename = "Properties")] props: XblProps,
}

#[derive(Debug, Deserialize)]
struct XblXui { uhs: String }
#[derive(Debug, Deserialize)]
struct XblClaims { xui: Vec<XblXui> }
#[derive(Debug, Deserialize)]
struct XblResp { Token: String, DisplayClaims: XblClaims }

#[derive(Debug, Serialize)]
struct XstsProps {
    #[serde(rename = "SandboxId")] sid: String,
    #[serde(rename = "UserTokens")] tokens: Vec<String>,
}
#[derive(Debug, Serialize)]
struct XstsReq {
    #[serde(rename = "RelyingParty")] rp: String,
    #[serde(rename = "TokenType")] tt: String,
    #[serde(rename = "Properties")] props: XstsProps,
}
#[derive(Debug, Deserialize)]
struct XstsResp { Token: String, DisplayClaims: XblClaims }

#[derive(Debug, Serialize)]
struct McLoginReq { identityToken: String }
#[derive(Debug, Deserialize)]
struct McLoginResp { access_token: String, expires_in: u64 }
#[derive(Debug, Deserialize)]
struct McProfile { id: String, name: String }

async fn exchange_code(code: String) -> Result<MsTokenResponse, String> {
    let secret = std::env::var("MS_CLIENT_SECRET").ok();
    let body = MsTokenRequest {
        client_id: MS_CLIENT_ID, redirect_uri: MS_REDIRECT_URI,
        grant_type: "authorization_code", code: &code, client_secret: secret,
    };
    let resp = http_client().post(MS_OAUTH2_TOKEN_URL).form(&body).send().await.map_err(|e| e.to_string())?;
    handle_resp(resp, "MS OAuth2 token").await
}

pub async fn exchange_to_minecraft_token(ms_token: &str) -> Result<(String, String, String), String> {
    let client = http_client();

    let xbl_req = XblReq {
        rp: "http://auth.xboxlive.com".into(), tt: "JWT".into(),
        props: XblProps { auth_method: "RPS".into(), site_name: "user.auth.xboxlive.com".into(), rps_ticket: format!("d={}", ms_token) },
    };
    let xbl: XblResp = handle_resp(
        client.post("https://user.auth.xboxlive.com/user/authenticate").json(&xbl_req).send().await.map_err(|e| e.to_string())?,
        "XBL authenticate"
    ).await?;
    
    let uhs = xbl.DisplayClaims.xui.first().ok_or("No UHS in XBL response")?.uhs.clone();
    let xbl_token = xbl.Token;

    let xsts_req = XstsReq {
        rp: "rp://api.minecraftservices.com/".into(), tt: "JWT".into(),
        props: XstsProps { sid: "RETAIL".into(), tokens: vec![xbl_token] },
    };
    let xsts: XstsResp = handle_resp(
        client.post("https://xsts.auth.xboxlive.com/xsts/authorize").json(&xsts_req).send().await.map_err(|e| e.to_string())?,
        "XSTS authorize"
    ).await?;

    let identity = format!("XBL3.0 x={};{}", uhs, xsts.Token);

    let mc_login: McLoginResp = handle_resp(
        client.post("https://api.minecraftservices.com/authentication/login_with_xbox")
            .json(&McLoginReq { identityToken: identity }).send().await.map_err(|e| e.to_string())?,
        "MC login_with_xbox"
    ).await?;

    let mc_prof: McProfile = handle_resp(
        client.get("https://api.minecraftservices.com/minecraft/profile")
            .bearer_auth(&mc_login.access_token).send().await.map_err(|e| e.to_string())?,
        "MC profile"
    ).await?;

    Ok((mc_prof.name, mc_prof.id, mc_login.access_token))
}

async fn handle_callback_internal(app: &AppHandle, code: String, state: String) -> Result<(), String> {
    if take_state().as_ref() != Some(&state) { return Err("Invalid state".into()); }

    let token = exchange_code(code).await?;
    let mut profile = get_profile().unwrap_or_default();
    
    profile.ms_access_token = Some(token.access_token.clone());
    profile.ms_refresh_token = token.refresh_token;
    profile.ms_id_token = token.id_token;

    match exchange_to_minecraft_token(&token.access_token).await {
        Ok((name, uuid, acc)) => {
            profile.mc_username = Some(name);
            profile.mc_uuid = Some(uuid);
            profile.mc_access_token = Some(acc);
        }
        Err(e) => eprintln!("[MsAuth] MC token error: {e}"),
    }

    save_full_profile(&profile)?;
    let _ = app.emit("ms-login-complete", profile);
    Ok(())
}

fn run_server(app: AppHandle) -> Result<(), String> {
    let listener = TcpListener::bind("127.0.0.1:1420").map_err(|e| e.to_string())?;
    let (mut stream, _) = listener.accept().map_err(|e| e.to_string())?;
    
    let mut buf = [0u8; 2048];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    let req = String::from_utf8_lossy(&buf[..n]);
    
    if let Some(line) = req.lines().next() {
        if let Some(rest) = line.strip_prefix("GET ") {
            if let Some(path) = rest.split(' ').next() {
                if let Some(query) = path.split('?').nth(1) {
                    if let (Some(code), Some(state)) = (parse_param(query, "code"), parse_param(query, "state")) {
                        let app_c = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = handle_callback_internal(&app_c, code, state).await;
                        });
                        
                        let resp = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body><h3>Вход через Microsoft завершён.</h3></body></html>";
                        let _ = stream.write_all(resp.as_bytes());
                        return Ok(());
                    }
                }
            }
        }
    }
    
    let err_resp = "HTTP/1.1 400 Bad Request\r\n\r\nInvalid request";
    let _ = stream.write_all(err_resp.as_bytes());
    Ok(())
}

#[tauri::command]
pub async fn start_ms_oauth(app: AppHandle) -> Result<String, String> {
    let state = gen_state();
    store_state(state.clone());
    let url = generate_ms_oauth_url(&state);
    
    let app_c = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = run_server(app_c) {
            eprintln!("[MsAuth] Server error: {e}");
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