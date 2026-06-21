use std::time::Duration;

#[derive(Clone, Debug)]
pub struct Config {
    pub listen_addr: String,
    pub database_url: String,
    pub redis_url: String,
    pub jwt_secret: String,
    pub jwt_access_ttl: Duration,
    pub jwt_refresh_ttl: Duration,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        Ok(Self {
            listen_addr: std::env::var("API_LISTEN_ADDR")
                .unwrap_or_else(|_| "0.0.0.0:8080".into()),
            database_url: require_env("DATABASE_URL")?,
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
            jwt_secret: require_env("JWT_SECRET")?,
            jwt_access_ttl: Duration::from_secs(
                std::env::var("JWT_ACCESS_TTL_SECS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(900),
            ),
            jwt_refresh_ttl: Duration::from_secs(
                std::env::var("JWT_REFRESH_TTL_SECS")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(2_592_000), //30 days
            ),
        })
    }
}

fn require_env(key: &str) -> Result<String, String> {
    std::env::var(key).map_err(|_| format!("missing required env var: {key}"))
}
