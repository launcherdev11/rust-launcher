use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::extract_user_id;
use crate::db::AppState;
use crate::error::ApiError;

#[derive(Serialize)]
pub struct FriendRow {
    pub user_id: String,
    pub nickname: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ely_username: Option<String>,
}

#[derive(Serialize)]
pub struct IncomingRequestRow {
    pub request_id: String,
    pub from_user_id: String,
    pub from_nickname: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_ely_username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Serialize)]
struct FriendsListResponse {
    friends: Vec<FriendRow>,
}

#[derive(Serialize)]
struct RequestsListResponse {
    incoming_requests: Vec<IncomingRequestRow>,
}

#[derive(Deserialize)]
pub struct SendRequestBody {
    pub to_nickname: String,
}

#[derive(Serialize)]
struct SendRequestResponse {
    success: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    already_exists: bool,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/friends", get(list_friends))
        .route("/friends/requests", get(list_requests).post(send_request))
        .route("/friends/requests/{id}/accept", post(accept_request))
        .route("/friends/requests/{id}/reject", post(reject_request))
}

async fn list_friends(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<FriendsListResponse>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;

    let rows = sqlx::query(
        r#"
        SELECT f.friend_user_id AS user_id,
               u.nickname,
               ui.access_metadata->>'username' AS ely_username
        FROM friends f
        JOIN users u ON u.id = f.friend_user_id
        LEFT JOIN user_identities ui
            ON ui.user_id = f.friend_user_id AND ui.provider = 'ely'
        WHERE f.user_id = $1
        ORDER BY u.nickname ASC
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    let friends = rows
        .into_iter()
        .map(|row| FriendRow {
            user_id: row.get::<Uuid, _>("user_id").to_string(),
            nickname: row.get("nickname"),
            ely_username: row.get("ely_username"),
        })
        .collect();

    Ok(Json(FriendsListResponse { friends }))
}

async fn list_requests(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<RequestsListResponse>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;

    let rows = sqlx::query(
        r#"
        SELECT fr.id AS request_id,
               fr.from_user_id,
               u.nickname AS from_nickname,
               ui.access_metadata->>'username' AS from_ely_username,
               fr.created_at
        FROM friend_requests fr
        JOIN users u ON u.id = fr.from_user_id
        LEFT JOIN user_identities ui
            ON ui.user_id = fr.from_user_id AND ui.provider = 'ely'
        WHERE fr.to_user_id = $1 AND fr.status = 'pending'
        ORDER BY fr.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    let incoming_requests = rows
        .into_iter()
        .map(|row| IncomingRequestRow {
            request_id: row.get::<Uuid, _>("request_id").to_string(),
            from_user_id: row.get::<Uuid, _>("from_user_id").to_string(),
            from_nickname: row.get("from_nickname"),
            from_ely_username: row.get("from_ely_username"),
            created_at: row
                .get::<Option<chrono::DateTime<chrono::Utc>>, _>("created_at")
                .map(|dt| dt.to_rfc3339()),
        })
        .collect();

    Ok(Json(RequestsListResponse { incoming_requests }))
}

async fn send_request(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<SendRequestBody>,
) -> Result<Json<SendRequestResponse>, ApiError> {
    let from_user_id = extract_user_id(&state, &headers)?;
    let to_nick = body.to_nickname.trim();
    if to_nick.len() < 3 {
        return Err(ApiError::bad_request("nickname too short"));
    }

    let to_row = sqlx::query("SELECT id FROM users WHERE lower(nickname) = lower($1)")
        .bind(to_nick)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .ok_or(ApiError::NotFound)?;

    let to_user_id: Uuid = to_row.get("id");
    if to_user_id == from_user_id {
        return Err(ApiError::bad_request("cannot add yourself"));
    }

    let already_friends = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM friends WHERE user_id = $1 AND friend_user_id = $2",
    )
    .bind(from_user_id)
    .bind(to_user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    if already_friends > 0 {
        return Ok(Json(SendRequestResponse {
            success: true,
            already_exists: true,
        }));
    }

    let pending = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM friend_requests
        WHERE status = 'pending'
          AND ((from_user_id = $1 AND to_user_id = $2)
            OR (from_user_id = $2 AND to_user_id = $1))
        "#,
    )
    .bind(from_user_id)
    .bind(to_user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    if pending > 0 {
        return Ok(Json(SendRequestResponse {
            success: true,
            already_exists: true,
        }));
    }

    sqlx::query(
        r#"
        INSERT INTO friend_requests (from_user_id, to_user_id, status)
        VALUES ($1, $2, 'pending')
        "#,
    )
    .bind(from_user_id)
    .bind(to_user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(SendRequestResponse {
        success: true,
        already_exists: false,
    }))
}

async fn accept_request(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(request_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;

    let row = sqlx::query(
        r#"
        SELECT from_user_id, to_user_id, status
        FROM friend_requests
        WHERE id = $1
        "#,
    )
    .bind(request_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?
    .ok_or(ApiError::NotFound)?;

    let from_user_id: Uuid = row.get("from_user_id");
    let to_user_id: Uuid = row.get("to_user_id");
    let status: String = row.get("status");

    if to_user_id != user_id {
        return Err(ApiError::Unauthorized);
    }
    if status != "pending" {
        return Err(ApiError::Conflict("request is not pending".into()));
    }

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    sqlx::query(
        "UPDATE friend_requests SET status = 'accepted', updated_at = now() WHERE id = $1",
    )
    .bind(request_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    for (a, b) in [(from_user_id, to_user_id), (to_user_id, from_user_id)] {
        sqlx::query(
            r#"
            INSERT INTO friends (user_id, friend_user_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(a)
        .bind(b)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    }

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(serde_json::json!({ "success": true })))
}

async fn reject_request(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(request_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;

    let result = sqlx::query(
        r#"
        UPDATE friend_requests
        SET status = 'rejected', updated_at = now()
        WHERE id = $1 AND to_user_id = $2 AND status = 'pending'
        "#,
    )
    .bind(request_id)
    .bind(user_id)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(Json(serde_json::json!({ "success": true })))
}
