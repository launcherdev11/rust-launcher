use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::auth::extract_user_id;
use crate::db::AppState;
use crate::error::ApiError;
use crate::routes::builds::{self, BuildDetailResponse, BuildRow};

#[derive(serde::Serialize)]
pub struct UserPublicProfile {
    pub user_id: String,
    pub nickname: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ely_username: Option<String>,
}

#[derive(serde::Serialize)]
struct UserBuildsResponse {
    builds: Vec<BuildRow>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/{user_id}", get(get_user_profile))
        .route("/users/{user_id}/builds", get(list_user_builds))
        .route("/users/{user_id}/builds/{build_id}", get(get_user_build))
}

pub(crate) async fn ensure_can_view_user(
    pool: &PgPool,
    viewer_id: Uuid,
    target_user_id: Uuid,
) -> Result<(), ApiError> {
    if viewer_id == target_user_id {
        return Ok(());
    }

    let is_friend = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM friends WHERE user_id = $1 AND friend_user_id = $2",
    )
    .bind(viewer_id)
    .bind(target_user_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    if is_friend > 0 {
        Ok(())
    } else {
        Err(ApiError::Unauthorized)
    }
}

async fn get_user_profile(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(target_user_id): Path<Uuid>,
) -> Result<Json<UserPublicProfile>, ApiError> {
    let viewer_id = extract_user_id(&state, &headers)?;
    ensure_can_view_user(&state.pool, viewer_id, target_user_id).await?;

    let row = sqlx::query(
        r#"
        SELECT u.id, u.nickname, ui.access_metadata->>'username' AS ely_username
        FROM users u
        LEFT JOIN user_identities ui ON ui.user_id = u.id AND ui.provider = 'ely'
        WHERE u.id = $1
        "#,
    )
    .bind(target_user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?
    .ok_or(ApiError::NotFound)?;

    Ok(Json(UserPublicProfile {
        user_id: row.get::<Uuid, _>("id").to_string(),
        nickname: row.get("nickname"),
        ely_username: row.get("ely_username"),
    }))
}

async fn list_user_builds(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(target_user_id): Path<Uuid>,
) -> Result<Json<UserBuildsResponse>, ApiError> {
    let viewer_id = extract_user_id(&state, &headers)?;
    ensure_can_view_user(&state.pool, viewer_id, target_user_id).await?;

    let builds = builds::list_build_rows_for_user(&state.pool, target_user_id).await?;
    Ok(Json(UserBuildsResponse { builds }))
}

async fn get_user_build(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path((target_user_id, build_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<BuildDetailResponse>, ApiError> {
    let viewer_id = extract_user_id(&state, &headers)?;
    ensure_can_view_user(&state.pool, viewer_id, target_user_id).await?;

    let detail = builds::get_build_detail_for_user(&state.pool, target_user_id, build_id).await?;
    Ok(Json(detail))
}
