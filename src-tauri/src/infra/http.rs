use std::time::Duration;

pub fn http_client(_use_proxy: bool) -> reqwest::Client {
    let _ = dotenvy::dotenv();

    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) 16Launcher/1.0 Chrome/122.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

pub fn http_client_for_binary_download_with_preferred_proxy_host(
    use_proxy: bool,
    prefer_ipv6: bool,
) -> reqwest::Client {
    let _ = (use_proxy, prefer_ipv6);
    let _ = dotenvy::dotenv();

    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
        .http1_only()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) 16Launcher/1.0 Chrome/122.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

pub fn http_client_for_binary_download(use_proxy: bool) -> reqwest::Client {
    http_client_for_binary_download_with_preferred_proxy_host(use_proxy, false)
}
