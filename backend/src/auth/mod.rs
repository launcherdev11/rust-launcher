use axum::http::HeaderMap;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::config::Config;
use crate::db::AppState;
use crate::error::ApiError;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct AccessClaims {
    pub sub: String,
    pub exp: i64,
    pub typ: String,
}

pub fn hash_refresh_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn sign_access_token(config: &Config, user_id: Uuid) -> Result<String, ApiError> {
    let exp = (Utc::now()
        + Duration::from_std(config.jwt_access_ttl)
            .map_err(|e| ApiError::Internal(e.to_string()))?)
    .timestamp();

    let claims = AccessClaims {
        sub: user_id.to_string(),
        exp,
        typ: "access".into(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(|e| ApiError::Internal(e.to_string()))
}

pub fn extract_user_id(state: &AppState, headers: &HeaderMap) -> Result<Uuid, ApiError> {
    let auth = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or(ApiError::Unauthorized)?;

    let token = auth
        .strip_prefix("Bearer ")
        .ok_or(ApiError::Unauthorized)?;

    let data = decode::<AccessClaims>(
        token,
        &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ApiError::Unauthorized)?;

    Uuid::parse_str(&data.claims.sub).map_err(|_| ApiError::Unauthorized)
}
