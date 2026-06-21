use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::extract_user_id;
use crate::db::AppState;
use crate::error::ApiError;

#[derive(Serialize)]
pub struct BuildRow {
    pub id: String,
    pub name: String,
    pub minecraft_version: String,
    pub loader: String,
    pub playtime_seconds: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_launch_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize)]
pub struct BuildContentRow {
    pub id: String,
    pub source: String,
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_id: Option<String>,
    #[serde(rename = "type")]
    pub content_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct BuildsListResponse {
    builds: Vec<BuildRow>,
}

#[derive(Serialize)]
pub struct BuildDetailResponse {
    pub build: BuildRow,
    pub contents: Vec<BuildContentRow>,
}

#[derive(Deserialize)]
pub struct BuildContentInput {
    pub source: String,
    pub project_id: String,
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub file_id: Option<String>,
    #[serde(rename = "type")]
    pub content_type: String,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct CreateBuildBody {
    pub name: String,
    pub minecraft_version: String,
    pub loader: String,
    #[serde(default)]
    pub contents: Vec<BuildContentInput>,
}

#[derive(Deserialize)]
pub struct UpdateBuildBody {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub minecraft_version: Option<String>,
    #[serde(default)]
    pub loader: Option<String>,
    #[serde(default)]
    pub playtime_seconds: Option<i64>,
    #[serde(default)]
    pub last_launch_at: Option<String>,
}

#[derive(Deserialize)]
pub struct ReplaceContentsBody {
    pub contents: Vec<BuildContentInput>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/builds", get(list_builds).post(create_build))
        .route(
            "/builds/{id}",
            get(get_build).patch(update_build).delete(delete_build),
        )
        .route(
            "/builds/{id}/contents",
            get(list_contents).put(replace_contents),
        )
}

fn row_to_build(row: &sqlx::postgres::PgRow) -> BuildRow {
    BuildRow {
        id: row.get::<Uuid, _>("id").to_string(),
        name: row.get("name"),
        minecraft_version: row.get("minecraft_version"),
        loader: row.get("loader"),
        playtime_seconds: row.get("playtime_seconds"),
        last_launch_at: row
            .get::<Option<DateTime<Utc>>, _>("last_launch_at")
            .map(|dt| dt.to_rfc3339()),
        created_at: row
            .get::<DateTime<Utc>, _>("created_at")
            .to_rfc3339(),
        updated_at: row
            .get::<DateTime<Utc>, _>("updated_at")
            .to_rfc3339(),
    }
}

fn row_to_content(row: &sqlx::postgres::PgRow) -> BuildContentRow {
    BuildContentRow {
        id: row.get::<Uuid, _>("id").to_string(),
        source: row.get("source"),
        project_id: row.get("project_id"),
        version_id: row.get("version_id"),
        file_id: row.get("file_id"),
        content_type: row.get("type"),
        metadata: row.get("metadata"),
    }
}

async fn ensure_build_owner(
    pool: &sqlx::PgPool,
    build_id: Uuid,
    user_id: Uuid,
) -> Result<(), ApiError> {
    let owner = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM saved_builds WHERE id = $1",
    )
    .bind(build_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    match owner {
        Some(id) if id == user_id => Ok(()),
        Some(_) => Err(ApiError::Unauthorized),
        None => Err(ApiError::NotFound),
    }
}

pub(crate) async fn list_build_rows_for_user(
    pool: &sqlx::PgPool,
    user_id: Uuid,
) -> Result<Vec<BuildRow>, ApiError> {
    let rows = sqlx::query(
        r#"
        SELECT id, name, minecraft_version, loader, playtime_seconds, last_launch_at, created_at, updated_at
        FROM saved_builds
        WHERE user_id = $1
        ORDER BY updated_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(rows.iter().map(row_to_build).collect())
}

pub(crate) async fn get_build_detail_for_user(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    build_id: Uuid,
) -> Result<BuildDetailResponse, ApiError> {
    ensure_build_owner(pool, build_id, user_id).await?;

    let row = sqlx::query(
        r#"
        SELECT id, name, minecraft_version, loader, playtime_seconds, last_launch_at, created_at, updated_at
        FROM saved_builds
        WHERE id = $1
        "#,
    )
    .bind(build_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    let content_rows = sqlx::query(
        r#"
        SELECT id, source, project_id, version_id, file_id, type, metadata
        FROM build_contents
        WHERE build_id = $1
        ORDER BY id ASC
        "#,
    )
    .bind(build_id)
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(BuildDetailResponse {
        build: row_to_build(&row),
        contents: content_rows.iter().map(row_to_content).collect(),
    })
}

fn validate_content(input: &BuildContentInput) -> Result<(), ApiError> {
    let source = input.source.trim().to_lowercase();
    if source != "modrinth" && source != "curseforge" {
        return Err(ApiError::bad_request("invalid content source"));
    }
    if input.project_id.trim().is_empty() {
        return Err(ApiError::bad_request("project_id is required"));
    }
    if input.content_type.trim().is_empty() {
        return Err(ApiError::bad_request("content type is required"));
    }
    Ok(())
}

async fn insert_contents(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    build_id: Uuid,
    contents: &[BuildContentInput],
) -> Result<(), ApiError> {
    for item in contents {
        validate_content(item)?;
        sqlx::query(
            r#"
            INSERT INTO build_contents (build_id, source, project_id, version_id, file_id, type, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
        )
        .bind(build_id)
        .bind(item.source.trim().to_lowercase())
        .bind(item.project_id.trim())
        .bind(item.version_id.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .bind(item.file_id.as_deref().map(str::trim).filter(|s| !s.is_empty()))
        .bind(item.content_type.trim())
        .bind(&item.metadata)
        .execute(&mut **tx)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    }
    Ok(())
}

async fn list_builds(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<BuildsListResponse>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;

    let rows = sqlx::query(
        r#"
        SELECT id, name, minecraft_version, loader, playtime_seconds, last_launch_at, created_at, updated_at
        FROM saved_builds
        WHERE user_id = $1
        ORDER BY updated_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    let builds = rows.iter().map(row_to_build).collect();
    Ok(Json(BuildsListResponse { builds }))
}

async fn create_build(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<CreateBuildBody>,
) -> Result<Json<BuildDetailResponse>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;

    let name = body.name.trim();
    if name.is_empty() {
        return Err(ApiError::bad_request("name is required"));
    }
    let minecraft_version = body.minecraft_version.trim();
    if minecraft_version.is_empty() {
        return Err(ApiError::bad_request("minecraft_version is required"));
    }
    let loader = body.loader.trim();
    if loader.is_empty() {
        return Err(ApiError::bad_request("loader is required"));
    }

    for item in &body.contents {
        validate_content(item)?;
    }

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let build_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO saved_builds (user_id, name, minecraft_version, loader)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(name)
    .bind(minecraft_version)
    .bind(loader)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    insert_contents(&mut tx, build_id, &body.contents).await?;

    let row = sqlx::query(
        r#"
        SELECT id, name, minecraft_version, loader, playtime_seconds, last_launch_at, created_at, updated_at
        FROM saved_builds
        WHERE id = $1
        "#,
    )
    .bind(build_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    let content_rows = sqlx::query(
        r#"
        SELECT id, source, project_id, version_id, file_id, type, metadata
        FROM build_contents
        WHERE build_id = $1
        ORDER BY id ASC
        "#,
    )
    .bind(build_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(BuildDetailResponse {
        build: row_to_build(&row),
        contents: content_rows.iter().map(row_to_content).collect(),
    }))
}

async fn get_build(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(build_id): Path<Uuid>,
) -> Result<Json<BuildDetailResponse>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;
    ensure_build_owner(&state.pool, build_id, user_id).await?;

    let row = sqlx::query(
        r#"
        SELECT id, name, minecraft_version, loader, playtime_seconds, last_launch_at, created_at, updated_at
        FROM saved_builds
        WHERE id = $1
        "#,
    )
    .bind(build_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    let content_rows = sqlx::query(
        r#"
        SELECT id, source, project_id, version_id, file_id, type, metadata
        FROM build_contents
        WHERE build_id = $1
        ORDER BY id ASC
        "#,
    )
    .bind(build_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(BuildDetailResponse {
        build: row_to_build(&row),
        contents: content_rows.iter().map(row_to_content).collect(),
    }))
}

async fn update_build(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(build_id): Path<Uuid>,
    Json(body): Json<UpdateBuildBody>,
) -> Result<Json<BuildRow>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;
    ensure_build_owner(&state.pool, build_id, user_id).await?;

    if body.name.is_none()
        && body.minecraft_version.is_none()
        && body.loader.is_none()
        && body.playtime_seconds.is_none()
        && body.last_launch_at.is_none()
    {
        return Err(ApiError::bad_request("no fields to update"));
    }

    if let Some(ref name) = body.name {
        if name.trim().is_empty() {
            return Err(ApiError::bad_request("name cannot be empty"));
        }
    }
    if let Some(ref version) = body.minecraft_version {
        if version.trim().is_empty() {
            return Err(ApiError::bad_request("minecraft_version cannot be empty"));
        }
    }
    if let Some(ref loader) = body.loader {
        if loader.trim().is_empty() {
            return Err(ApiError::bad_request("loader cannot be empty"));
        }
    }
    if let Some(playtime) = body.playtime_seconds {
        if playtime < 0 {
            return Err(ApiError::bad_request("playtime_seconds cannot be negative"));
        }
    }

    let last_launch_at = match body.last_launch_at.as_deref() {
        None => None,
        Some(raw) if raw.trim().is_empty() => Some(None),
        Some(raw) => {
            let parsed = DateTime::parse_from_rfc3339(raw.trim())
                .map_err(|_| ApiError::bad_request("invalid last_launch_at"))?
                .with_timezone(&Utc);
            Some(Some(parsed))
        }
    };

    let row = sqlx::query(
        r#"
        UPDATE saved_builds
        SET name = COALESCE($2, name),
            minecraft_version = COALESCE($3, minecraft_version),
            loader = COALESCE($4, loader),
            playtime_seconds = COALESCE($5, playtime_seconds),
            last_launch_at = CASE
                WHEN $6 THEN NULL
                WHEN $7 IS NOT NULL THEN $7
                ELSE last_launch_at
            END,
            updated_at = now()
        WHERE id = $1
        RETURNING id, name, minecraft_version, loader, playtime_seconds, last_launch_at, created_at, updated_at
        "#,
    )
    .bind(build_id)
    .bind(body.name.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(
        body.minecraft_version
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    )
    .bind(body.loader.as_deref().map(str::trim).filter(|s| !s.is_empty()))
    .bind(body.playtime_seconds)
    .bind(matches!(body.last_launch_at, Some(ref s) if s.trim().is_empty()))
    .bind(last_launch_at.flatten())
    .fetch_one(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(row_to_build(&row)))
}

async fn delete_build(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(build_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;
    ensure_build_owner(&state.pool, build_id, user_id).await?;

    let result = sqlx::query("DELETE FROM saved_builds WHERE id = $1")
        .bind(build_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(Json(serde_json::json!({ "success": true })))
}

async fn list_contents(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(build_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;
    ensure_build_owner(&state.pool, build_id, user_id).await?;

    let rows = sqlx::query(
        r#"
        SELECT id, source, project_id, version_id, file_id, type, metadata
        FROM build_contents
        WHERE build_id = $1
        ORDER BY id ASC
        "#,
    )
    .bind(build_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    let contents: Vec<BuildContentRow> = rows.iter().map(row_to_content).collect();
    Ok(Json(serde_json::json!({ "contents": contents })))
}

async fn replace_contents(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(build_id): Path<Uuid>,
    Json(body): Json<ReplaceContentsBody>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;
    ensure_build_owner(&state.pool, build_id, user_id).await?;

    for item in &body.contents {
        validate_content(item)?;
    }

    let mut tx = state
        .pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    sqlx::query("DELETE FROM build_contents WHERE build_id = $1")
        .bind(build_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    insert_contents(&mut tx, build_id, &body.contents).await?;

    sqlx::query("UPDATE saved_builds SET updated_at = now() WHERE id = $1")
        .bind(build_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let rows = sqlx::query(
        r#"
        SELECT id, source, project_id, version_id, file_id, type, metadata
        FROM build_contents
        WHERE build_id = $1
        ORDER BY id ASC
        "#,
    )
    .bind(build_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let contents: Vec<BuildContentRow> = rows.iter().map(row_to_content).collect();
    Ok(Json(serde_json::json!({ "contents": contents })))
}
