const DEFAULT_PLATFORM_API_BASE: &str = "https://api.16-launcher.ru";

pub fn platform_api_base() -> String {
    crate::app::env::load_dotenv_files();

    std::env::var("PLATFORM_API_BASE_URL")
        .or_else(|_| std::env::var("VITE_API_BASE_URL"))
        .ok()
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_PLATFORM_API_BASE.to_string())
}

pub fn curseforge_api_base() -> String {
    format!("{}/integrations/curseforge/v1", platform_api_base())
}

pub fn platform_proxy_fetch_url(target: &str) -> String {
    format!(
        "{}/integrations/proxy/fetch?url={}",
        platform_api_base(),
        urlencoding::encode(target)
    )
}

pub fn ely_oauth_token_url() -> String {
    format!("{}/integrations/ely/oauth/token", platform_api_base())
}
