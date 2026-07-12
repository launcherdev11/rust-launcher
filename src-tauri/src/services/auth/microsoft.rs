#![allow(dead_code, non_snake_case)]



use std::io::{Read, Write};

use std::net::TcpListener;

use std::sync::Mutex;

use std::time::Duration;



use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

use once_cell::sync::Lazy;

use rand::{distributions::Alphanumeric, Rng};

use reqwest::Client;

use serde::{Deserialize, Serialize};

use sha2::{Digest, Sha256};

use tauri::{AppHandle, Emitter};



use crate::services::auth::ms_redirect::{self, RedirectLanguage};

use crate::services::game::accounts::{get_profile, save_full_profile};

use crate::services::game::settings::load_settings_from_disk;



const OAUTH_LISTEN_TIMEOUT_SECS: u64 = 300;

const OAUTH_READ_TIMEOUT_SECS: u64 = 30;



fn http_client() -> Client {

    Client::builder()

        .timeout(Duration::from_secs(60))

        .connect_timeout(Duration::from_secs(15))

        .user_agent("16Launcher/1.0")

        .build()

        .unwrap_or_else(|_| Client::new())

}



pub const MS_CLIENT_ID: &str = "d528e572-5d2c-44b8-8b9d-cbea5faec878";

pub const MS_OAUTH2_AUTH_URL: &str = "https://login.live.com/oauth20_authorize.srf";

pub const MS_OAUTH2_TOKEN_URL: &str = "https://login.live.com/oauth20_token.srf";

pub const MS_REDIRECT_URI: &str = "http://localhost:1420";



struct OAuthSession {

    state: String,

    code_verifier: String,

    language: RedirectLanguage,

}



static MS_OAUTH_SESSION: Lazy<Mutex<Option<OAuthSession>>> = Lazy::new(|| Mutex::new(None));



fn gen_random_str(len: usize) -> String {

    rand::thread_rng()

        .sample_iter(&Alphanumeric)

        .take(len)

        .map(char::from)

        .collect()

}



fn gen_pkce_verifier() -> String {

    gen_random_str(64)

}



fn pkce_challenge(verifier: &str) -> String {

    let hash = Sha256::digest(verifier.as_bytes());

    URL_SAFE_NO_PAD.encode(hash)

}



fn store_session(session: OAuthSession) {

    if let Ok(mut guard) = MS_OAUTH_SESSION.lock() {

        *guard = Some(session);

    }

}



fn take_session() -> Option<OAuthSession> {

    MS_OAUTH_SESSION.lock().ok().and_then(|mut guard| guard.take())

}



fn resolve_language(language: Option<String>) -> RedirectLanguage {

    language

        .map(|code| RedirectLanguage::from_code(&code))

        .unwrap_or_else(|| {

            let settings_lang = load_settings_from_disk().interface_language;

            RedirectLanguage::from_code(&settings_lang)

        })

}



fn parse_param(query: &str, key: &str) -> Option<String> {

    query.split('&').find_map(|part| {

        let mut split = part.splitn(2, '=');

        let param_key = split.next()?;

        if param_key != key {

            return None;

        }

        let value = split.next()?;

        Some(urlencoding::decode(value).ok()?.into_owned())

    })

}



fn generate_ms_oauth_url(state: &str, code_challenge: &str) -> String {

    let scopes = "XboxLive.signin offline_access openid profile email";

    format!(

        "{}?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256&prompt=select_account",

        MS_OAUTH2_AUTH_URL,

        urlencoding::encode(MS_CLIENT_ID),

        urlencoding::encode(MS_REDIRECT_URI),

        urlencoding::encode(scopes),

        urlencoding::encode(state),

        urlencoding::encode(code_challenge),

    )

}



async fn handle_resp<T>(resp: reqwest::Response, ctx: &str) -> Result<T, String>

where

    T: for<'de> Deserialize<'de>,

{

    if !resp.status().is_success() {

        let status = resp.status();

        let text = resp.text().await.unwrap_or_else(|_| "<no body>".into());

        return Err(format!("{ctx} error {status}: {text}"));

    }

    resp.json::<T>()

        .await

        .map_err(|e| format!("Parse error {ctx}: {e}"))

}



#[derive(Debug, Deserialize)]

struct MsTokenResponse {

    access_token: String,

    #[serde(default)]

    refresh_token: Option<String>,

    #[serde(default)]

    id_token: Option<String>,

    #[serde(default)]

    token_type: String,

    #[serde(default)]

    expires_in: u64,

}



#[derive(Debug, Serialize)]

struct MsTokenRequest<'a> {

    client_id: &'a str,

    redirect_uri: &'a str,

    grant_type: &'a str,

    code: &'a str,

    code_verifier: &'a str,

    #[serde(skip_serializing_if = "Option::is_none")]

    client_secret: Option<String>,

}



#[derive(Debug, Serialize)]

struct XblProps {

    #[serde(rename = "AuthMethod")]

    auth_method: String,

    #[serde(rename = "SiteName")]

    site_name: String,

    #[serde(rename = "RpsTicket")]

    rps_ticket: String,

}

#[derive(Debug, Serialize)]

struct XblReq {

    #[serde(rename = "RelyingParty")]

    rp: String,

    #[serde(rename = "TokenType")]

    tt: String,

    #[serde(rename = "Properties")]

    props: XblProps,

}



#[derive(Debug, Deserialize)]

struct XblXui {

    uhs: String,

}

#[derive(Debug, Deserialize)]

struct XblClaims {

    xui: Vec<XblXui>,

}

#[derive(Debug, Deserialize)]

struct XblResp {

    Token: String,

    DisplayClaims: XblClaims,

}



#[derive(Debug, Serialize)]

struct XstsProps {

    #[serde(rename = "SandboxId")]

    sid: String,

    #[serde(rename = "UserTokens")]

    tokens: Vec<String>,

}

#[derive(Debug, Serialize)]

struct XstsReq {

    #[serde(rename = "RelyingParty")]

    rp: String,

    #[serde(rename = "TokenType")]

    tt: String,

    #[serde(rename = "Properties")]

    props: XstsProps,

}

#[derive(Debug, Deserialize)]

struct XstsResp {

    Token: String,

    DisplayClaims: XblClaims,

}



#[derive(Debug, Serialize)]

struct McLoginReq {

    identityToken: String,

}

#[derive(Debug, Deserialize)]

struct McLoginResp {

    access_token: String,

    expires_in: u64,

}

#[derive(Debug, Deserialize)]

struct McProfile {

    id: String,

    name: String,

}



async fn exchange_code(code: String, code_verifier: &str) -> Result<MsTokenResponse, String> {

    let secret = std::env::var("MS_CLIENT_SECRET").ok().filter(|s| !s.trim().is_empty());

    let body = MsTokenRequest {

        client_id: MS_CLIENT_ID,

        redirect_uri: MS_REDIRECT_URI,

        grant_type: "authorization_code",

        code: &code,

        code_verifier,

        client_secret: secret,

    };

    let resp = http_client()

        .post(MS_OAUTH2_TOKEN_URL)

        .form(&body)

        .send()

        .await

        .map_err(|e| e.to_string())?;

    handle_resp(resp, "MS OAuth2 token").await

}



pub async fn exchange_to_minecraft_token(ms_token: &str) -> Result<(String, String, String), String> {

    let client = http_client();



    let xbl_req = XblReq {

        rp: "http://auth.xboxlive.com".into(),

        tt: "JWT".into(),

        props: XblProps {

            auth_method: "RPS".into(),

            site_name: "user.auth.xboxlive.com".into(),

            rps_ticket: format!("d={ms_token}"),

        },

    };

    let xbl: XblResp = handle_resp(

        client

            .post("https://user.auth.xboxlive.com/user/authenticate")

            .json(&xbl_req)

            .send()

            .await

            .map_err(|e| e.to_string())?,

        "XBL authenticate",

    )

    .await?;



    let uhs = xbl

        .DisplayClaims

        .xui

        .first()

        .ok_or("No UHS in XBL response")?

        .uhs

        .clone();

    let xbl_token = xbl.Token;



    let xsts_req = XstsReq {

        rp: "rp://api.minecraftservices.com/".into(),

        tt: "JWT".into(),

        props: XstsProps {

            sid: "RETAIL".into(),

            tokens: vec![xbl_token],

        },

    };

    let xsts: XstsResp = handle_resp(

        client

            .post("https://xsts.auth.xboxlive.com/xsts/authorize")

            .json(&xsts_req)

            .send()

            .await

            .map_err(|e| e.to_string())?,

        "XSTS authorize",

    )

    .await?;



    let identity = format!("XBL3.0 x={uhs};{}", xsts.Token);



    let mc_login: McLoginResp = handle_resp(

        client

            .post("https://api.minecraftservices.com/authentication/login_with_xbox")

            .json(&McLoginReq {

                identityToken: identity,

            })

            .send()

            .await

            .map_err(|e| e.to_string())?,

        "MC login_with_xbox",

    )

    .await?;



    let mc_prof: McProfile = handle_resp(

        client

            .get("https://api.minecraftservices.com/minecraft/profile")

            .bearer_auth(&mc_login.access_token)

            .send()

            .await

            .map_err(|e| e.to_string())?,

        "MC profile",

    )

    .await?;



    Ok((mc_prof.name, mc_prof.id, mc_login.access_token))

}



async fn handle_callback_internal(
    app: &AppHandle,
    code: String,
    code_verifier: String,
) -> Result<(), String> {

    let token = exchange_code(code, &code_verifier).await?;

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



fn html_http_response(status_line: &str, body: &str) -> Vec<u8> {
    let header = format!(
        "{status_line}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'\r\n\r\n",
        body.len()
    );
    let mut out = header.into_bytes();
    out.extend_from_slice(body.as_bytes());
    out
}



fn session_language() -> RedirectLanguage {
    MS_OAUTH_SESSION
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|session| session.language))
        .unwrap_or(RedirectLanguage::Ru)
}

fn validate_callback_state(state: &str) -> Option<OAuthSession> {

    let session = take_session()?;

    if session.state != state {

        eprintln!("[MsAuth] OAuth state mismatch — possible CSRF attempt");

        return None;

    }

    Some(session)

}



fn run_server(app: AppHandle) -> Result<(), String> {

    let listener = TcpListener::bind("127.0.0.1:1420").map_err(|e| e.to_string())?;

    listener

        .set_nonblocking(true)

        .map_err(|e| format!("Failed to configure OAuth listener: {e}"))?;



    let deadline = std::time::Instant::now() + Duration::from_secs(OAUTH_LISTEN_TIMEOUT_SECS);

    let (mut stream, peer_addr) = loop {

        if std::time::Instant::now() >= deadline {

            return Err("OAuth callback timeout".into());

        }

        match listener.accept() {

            Ok(pair) => break pair,

            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {

                std::thread::sleep(Duration::from_millis(100));

            }

            Err(e) => return Err(e.to_string()),

        }

    };



    if !peer_addr.ip().is_loopback() {

        eprintln!("[MsAuth] Rejected non-local OAuth callback from {peer_addr}");

        return Err("Rejected non-local callback".into());

    }



    stream

        .set_read_timeout(Some(Duration::from_secs(OAUTH_READ_TIMEOUT_SECS)))

        .map_err(|e| e.to_string())?;



    let mut buf = [0u8; 4096];

    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;

    let req = String::from_utf8_lossy(&buf[..n]);



    let mut response_lang = session_language();
    let mut response_body = ms_redirect::error_html(response_lang);
    let mut response_status = "HTTP/1.1 400 Bad Request";

    if let Some(line) = req.lines().next() {
        if let Some(rest) = line.strip_prefix("GET ") {
            if let Some(path) = rest.split(' ').next() {
                if let Some(query) = path.split('?').nth(1) {
                    let callback_state = parse_param(query, "state");

                    if parse_param(query, "error").is_some() {
                        if let Some(state) = callback_state.as_deref() {
                            if let Some(session) = validate_callback_state(state) {
                                response_lang = session.language;
                            }
                        }
                        response_body = ms_redirect::error_html(response_lang);
                    } else if let (Some(code), Some(state)) =
                        (parse_param(query, "code"), callback_state)
                    {
                        if let Some(session) = validate_callback_state(&state) {
                            response_lang = session.language;
                            response_status = "HTTP/1.1 200 OK";
                            response_body = ms_redirect::success_html(response_lang);

                            let app_c = app.clone();
                            let verifier = session.code_verifier;
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) =
                                    handle_callback_internal(&app_c, code, verifier).await
                                {
                                    eprintln!("[MsAuth] Callback processing error: {e}");
                                }
                            });
                        } else {
                            eprintln!("[MsAuth] Invalid or expired OAuth state");
                            response_body = ms_redirect::error_html(response_lang);
                        }
                    }
                }
            }
        }
    }



    let resp = html_http_response(response_status, &response_body);

    let _ = stream.write_all(&resp);

    Ok(())

}



#[tauri::command]

pub async fn start_ms_oauth(app: AppHandle, language: Option<String>) -> Result<String, String> {

    let state = gen_random_str(32);

    let code_verifier = gen_pkce_verifier();

    let code_challenge = pkce_challenge(&code_verifier);

    let redirect_lang = resolve_language(language);



    store_session(OAuthSession {

        state: state.clone(),

        code_verifier,

        language: redirect_lang,

    });



    let url = generate_ms_oauth_url(&state, &code_challenge);



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

