#![allow(dead_code, non_snake_case)]

use serde::{Deserialize, Serialize};

use crate::services::game::accounts::read_profile_from_disk;
use crate::infra::http::http_client;
#[derive(Debug, Serialize)]
pub(crate) struct XblUserAuthProperties {
    #[serde(rename = "AuthMethod")]
    auth_method: String,
    #[serde(rename = "SiteName")]
    site_name: String,
    #[serde(rename = "RpsTicket")]
    rps_ticket: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct XblUserAuthRequest {
    #[serde(rename = "RelyingParty")]
    relying_party: String,
    #[serde(rename = "TokenType")]
    token_type: String,
    #[serde(rename = "Properties")]
    properties: XblUserAuthProperties,
}

#[derive(Debug, Deserialize)]
pub(crate) struct XblDisplayClaims {
    xui: Vec<XblXuiEntry>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct XblXuiEntry {
    uhs: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct XblUserAuthResponse {
    Token: String,
    DisplayClaims: XblDisplayClaims,
}

#[derive(Debug, Serialize)]
pub(crate) struct XstsProperties {
    #[serde(rename = "SandboxId")]
    sandbox_id: String,
    #[serde(rename = "UserTokens")]
    user_tokens: Vec<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct XstsAuthRequest {
    #[serde(rename = "RelyingParty")]
    relying_party: String,
    #[serde(rename = "TokenType")]
    token_type: String,
    #[serde(rename = "Properties")]
    properties: XstsProperties,
}

#[derive(Debug, Deserialize)]
pub(crate) struct XstsAuthResponse {
    Token: String,
    DisplayClaims: XblDisplayClaims,
}

#[derive(Debug, Serialize)]
pub(crate) struct McLoginWithXboxRequest {
    identityToken: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct McLoginWithXboxResponse {
    access_token: String,
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct McProfile {
    id: String,
    name: String,
}


pub(crate) async fn ensure_ms_minecraft_session() -> Result<Option<(String, String, String)>, String> {
    let profile = read_profile_from_disk().unwrap_or_default();
    let msa_token = match profile.ms_access_token.clone() {
        Some(t) if !t.is_empty() => t,
        _ => return Ok(None),
    };

    let client = http_client(false);

    let xbl_req = XblUserAuthRequest {
        relying_party: "http://auth.xboxlive.com".to_string(),
        token_type: "JWT".to_string(),
        properties: XblUserAuthProperties {
            auth_method: "RPS".to_string(),
            site_name: "user.auth.xboxlive.com".to_string(),
            rps_ticket: format!("d={}", msa_token),
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

    let identity_token = format!("XBL3.0 x={};{}", uhs, xsts_token);
    let mc_login_req = McLoginWithXboxRequest { identityToken: identity_token };

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

    Ok(Some((mc_profile.name, mc_profile.id, mc_access_token)))
}
