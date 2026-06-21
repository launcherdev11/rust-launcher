use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{Duration, Utc};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::{extract_user_id, hash_refresh_token, sign_access_token};
use crate::db::AppState;
use crate::error::ApiError;

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub nickname: String,
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub login: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Deserialize)]
pub struct UpdateMeRequest {
    pub nickname: String,
}

#[derive(Serialize)]
pub struct AuthTokensResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub token_type: &'static str,
    pub expires_in: u64,
}

#[derive(Serialize)]
pub struct MeResponse {
    pub id: String,
    pub nickname: String,
    pub email: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/refresh", post(refresh))
        .route("/me", get(me).patch(update_me))
}

async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<AuthTokensResponse>, ApiError> {
    validate_register(&body)?;

    let password_hash = hash_password(&body.password)?;
    let user_id = Uuid::new_v4();

    let row = sqlx::query(
        r#"
        INSERT INTO users (id, nickname, email, password_hash)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(body.nickname.trim())
    .bind(body.email.trim().to_lowercase())
    .bind(password_hash)
    .fetch_one(&state.pool)
    .await
    .map_err(map_user_insert_error)?;

    let id: Uuid = row.get("id");
    issue_tokens(&state, id).await.map(Json)
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthTokensResponse>, ApiError> {
    if body.password.len() < 8 {
        return Err(ApiError::bad_request("password too short"));
    }

    let login = body.login.trim();
    let row = sqlx::query(
        r#"
        SELECT id, password_hash
        FROM users
        WHERE lower(email) = lower($1) OR lower(nickname) = lower($1)
        LIMIT 1
        "#,
    )
    .bind(login)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?
    .ok_or(ApiError::Unauthorized)?;

    let stored_hash: Option<String> = row.get("password_hash");
    let stored_hash = stored_hash.ok_or(ApiError::Unauthorized)?;
    verify_password(&body.password, &stored_hash)?;

    let user_id: Uuid = row.get("id");
    issue_tokens(&state, user_id).await.map(Json)
}

async fn refresh(
    State(state): State<AppState>,
    Json(body): Json<RefreshRequest>,
) -> Result<Json<AuthTokensResponse>, ApiError> {
    let refresh_hash = hash_refresh_token(&body.refresh_token);

    let row = sqlx::query(
        r#"
        SELECT id, user_id, expires_at, revoked_at
        FROM user_sessions
        WHERE refresh_token_hash = $1
        "#,
    )
    .bind(refresh_hash)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?
    .ok_or(ApiError::Unauthorized)?;

    let session_id: Uuid = row.get("id");
    let user_id: Uuid = row.get("user_id");
    let expires_at: chrono::DateTime<Utc> = row.get("expires_at");
    let revoked_at: Option<chrono::DateTime<Utc>> = row.get("revoked_at");

    if revoked_at.is_some() || expires_at < Utc::now() {
        return Err(ApiError::Unauthorized);
    }

    sqlx::query("UPDATE user_sessions SET revoked_at = now() WHERE id = $1")
        .bind(session_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    issue_tokens(&state, user_id).await.map(Json)
}

async fn logout(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;

    sqlx::query(
        r#"
        UPDATE user_sessions
        SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL
        "#,
    )
    .bind(user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(serde_json::json!({ "success": true })))
}

async fn me(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<MeResponse>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;
    load_me(&state, user_id).await.map(Json)
}

async fn update_me(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<UpdateMeRequest>,
) -> Result<Json<MeResponse>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;
    let nickname = body.nickname.trim();
    if nickname.len() < 3 {
        return Err(ApiError::bad_request("nickname too short"));
    }

    sqlx::query("UPDATE users SET nickname = $1, updated_at = now() WHERE id = $2")
        .bind(nickname)
        .bind(user_id)
        .execute(&state.pool)
        .await
        .map_err(map_user_insert_error)?;

    load_me(&state, user_id).await.map(Json)
}

async fn load_me(state: &AppState, user_id: Uuid) -> Result<MeResponse, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, nickname, email
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?
    .ok_or(ApiError::NotFound)?;

    Ok(MeResponse {
        id: row.get::<Uuid, _>("id").to_string(),
        nickname: row.get("nickname"),
        email: row.get("email"),
    })
}

fn validate_register(body: &RegisterRequest) -> Result<(), ApiError> {
    if body.nickname.trim().len() < 3 {
        return Err(ApiError::bad_request("nickname too short"));
    }
    if !body.email.contains('@') {
        return Err(ApiError::bad_request("invalid email"));
    }
    if body.password.len() < 8 {
        return Err(ApiError::bad_request("password too short"));
    }
    Ok(())
}

fn hash_password(password: &str) -> Result<String, ApiError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| ApiError::Internal(e.to_string()))
}

fn verify_password(password: &str, stored_hash: &str) -> Result<(), ApiError> {
    let parsed = PasswordHash::new(stored_hash).map_err(|_| ApiError::Unauthorized)?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .map_err(|_| ApiError::Unauthorized)
}

async fn issue_tokens(state: &AppState, user_id: Uuid) -> Result<AuthTokensResponse, ApiError> {
    let access_token = sign_access_token(&state.config, user_id)?;
    let refresh_token = Uuid::new_v4().to_string();
    let refresh_hash = hash_refresh_token(&refresh_token);

    let expires_at = Utc::now()
        + Duration::from_std(state.config.jwt_refresh_ttl)
            .map_err(|e| ApiError::Internal(e.to_string()))?;

    sqlx::query(
        r#"
        INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(user_id)
    .bind(refresh_hash)
    .bind(expires_at)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(AuthTokensResponse {
        access_token,
        refresh_token,
        token_type: "Bearer",
        expires_in: state.config.jwt_access_ttl.as_secs(),
    })
}

fn map_user_insert_error(err: sqlx::Error) -> ApiError {
    if let sqlx::Error::Database(db) = &err {
        if db.constraint() == Some("users_email_key") {
            return ApiError::Conflict("email already registered".into());
        }
        if db.constraint() == Some("users_nickname_key") {
            return ApiError::Conflict("nickname already taken".into());
        }
    }
    ApiError::Internal(err.to_string())
}
