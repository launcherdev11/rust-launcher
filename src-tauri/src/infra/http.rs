use std::time::Duration;

pub fn http_client_with_timeout(user_agent: &str, timeout: Duration, connect_timeout: Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(connect_timeout)
        .user_agent(user_agent)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

pub fn http_client(use_proxy: bool) -> reqwest::Client {
    use crate::infra::proxy::{env_var_trim, normalize_proxy_host_for_url, preferred_proxy_host};
    use urlencoding::encode;

    let _ = dotenvy::dotenv();

    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) 16Launcher/1.0 Chrome/122.0.0.0 Safari/537.36");

    if use_proxy {
        let host = preferred_proxy_host(false);
        let port_str = env_var_trim("PROXY_PORT");
        let user = env_var_trim("PROXY_USER");
        let pass = env_var_trim("PROXY_PASS");

        if let (Some(host), Some(port_str)) = (host, port_str) {
            if let Ok(port) = port_str.parse::<u16>() {
                let proxy_host = normalize_proxy_host_for_url(&host);
                let proxy_url = match (user, pass) {
                    (Some(u), Some(p)) => format!(
                        "http://{}:{}@{}:{}",
                        encode(&u),
                        encode(&p),
                        proxy_host,
                        port
                    ),
                    _ => format!("http://{proxy_host}:{port}"),
                };

                if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
                    builder = builder.proxy(proxy);
                }
            }
        }
    }

    builder.build().unwrap_or_else(|_| reqwest::Client::new())
}

pub fn http_client_for_binary_download_with_preferred_proxy_host(
    use_proxy: bool,
    prefer_ipv6: bool,
) -> reqwest::Client {
    use crate::infra::proxy::{env_var_trim, normalize_proxy_host_for_url, preferred_proxy_host};
    use urlencoding::encode;

    let _ = dotenvy::dotenv();

    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
        .http1_only()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) 16Launcher/1.0 Chrome/122.0.0.0 Safari/537.36");

    if use_proxy {
        let host = preferred_proxy_host(prefer_ipv6);
        let port_str = env_var_trim("PROXY_PORT");
        let user = env_var_trim("PROXY_USER");
        let pass = env_var_trim("PROXY_PASS");

        if let (Some(host), Some(port_str)) = (host, port_str) {
            if let Ok(port) = port_str.parse::<u16>() {
                let proxy_host = normalize_proxy_host_for_url(&host);
                let proxy_url = match (user, pass) {
                    (Some(u), Some(p)) => format!(
                        "http://{}:{}@{}:{}",
                        encode(&u),
                        encode(&p),
                        proxy_host,
                        port
                    ),
                    _ => format!("http://{proxy_host}:{port}"),
                };

                if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
                    builder = builder.proxy(proxy);
                }
            }
        }
    }

    builder.build().unwrap_or_else(|_| {
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
    })
}

pub fn http_client_for_binary_download(use_proxy: bool) -> reqwest::Client {
    http_client_for_binary_download_with_preferred_proxy_host(use_proxy, false)
}

