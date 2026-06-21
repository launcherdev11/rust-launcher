use axum::{extract::State, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::auth::extract_user_id;
use crate::db::AppState;
use crate::error::ApiError;

#[derive(Deserialize)]
pub struct LinkIdentityBody {
    pub provider: String,
    pub provider_uuid: String,
    #[serde(default)]
    pub provider_username: Option<String>,
}

#[derive(Serialize)]
struct LinkIdentityResponse {
    success: bool,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/identities/link", post(link_identity))
}

async fn link_identity(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<LinkIdentityBody>,
) -> Result<Json<LinkIdentityResponse>, ApiError> {
    let user_id = extract_user_id(&state, &headers)?;

    let provider = body.provider.trim().to_lowercase();
    if provider != "ely" && provider != "minecraft" {
        return Err(ApiError::bad_request("unsupported provider"));
    }

    let provider_user_id = body
        .provider_uuid
        .trim()
        .to_lowercase()
        .replace('-', "");
    if provider_user_id.is_empty() {
        return Err(ApiError::bad_request("provider_uuid is empty"));
    }

    let metadata = body.provider_username.as_ref().map(|name| {
        serde_json::json!({ "username": name.trim() })
    });

    let existing = sqlx::query(
        "SELECT user_id FROM user_identities WHERE provider = $1 AND provider_user_id = $2",
    )
    .bind(&provider)
    .bind(&provider_user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    if let Some(row) = existing {
        let owner: Uuid = row.get("user_id");
        if owner != user_id {
            return Err(ApiError::Conflict(
                "identity already linked to another user".into(),
            ));
        }
        sqlx::query(
            r#"
            UPDATE user_identities
            SET access_metadata = COALESCE($3, access_metadata)
            WHERE provider = $1 AND provider_user_id = $2 AND user_id = $4
            "#,
        )
        .bind(&provider)
        .bind(&provider_user_id)
        .bind(metadata)
        .bind(user_id)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    } else {
        sqlx::query(
            r#"
            INSERT INTO user_identities (user_id, provider, provider_user_id, access_metadata)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(user_id)
        .bind(&provider)
        .bind(&provider_user_id)
        .bind(metadata)
        .execute(&state.pool)
        .await
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    }

    Ok(Json(LinkIdentityResponse { success: true }))
}
