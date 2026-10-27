use std::time::Duration;

use once_cell::sync::Lazy;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) 16Launcher/1.0 Chrome/122.0.0.0 Safari/537.36";

fn base_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .tcp_keepalive(Duration::from_secs(30))
        .pool_idle_timeout(Duration::from_secs(30))
        .user_agent(USER_AGENT)
}

static SHARED_CLIENT: Lazy<reqwest::Client> =
    Lazy::new(|| base_builder().build().unwrap_or_else(|_| reqwest::Client::new()));

static BINARY_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    base_builder()
        .http1_only()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

pub fn http_client(_use_proxy: bool) -> reqwest::Client {
    SHARED_CLIENT.clone()
}

pub fn http_client_for_binary_download_with_preferred_proxy_host(
    use_proxy: bool,
    prefer_ipv6: bool,
) -> reqwest::Client {
    let _ = (use_proxy, prefer_ipv6);
    BINARY_CLIENT.clone()
}

pub fn http_client_for_binary_download(use_proxy: bool) -> reqwest::Client {
    http_client_for_binary_download_with_preferred_proxy_host(use_proxy, false)
}
