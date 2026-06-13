use std::env;

pub fn env_var_trim(key: &str) -> Option<String> {
    let runtime = env::var(key)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    if runtime.is_some() {
        return runtime;
    }

    let compile_time = match key {
        "PROXY_HOST" => option_env!("PROXY_HOST"),
        "PROXY_PORT" => option_env!("PROXY_PORT"),
        "PROXY_HOSTS" => option_env!("PROXY_HOSTS"),
        "PROXY_HOST_FORGE_IPV6" => option_env!("PROXY_HOST_FORGE_IPV6"),
        "PROXY_USER" => option_env!("PROXY_USER"),
        "PROXY_PASS" => option_env!("PROXY_PASS"),
        _ => return None,
    };

    compile_time
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

pub fn parse_proxy_hosts_csv(raw: &str) -> Vec<String> {
    raw.split([',', ';'])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub fn is_ipv6_host_literal(raw: &str) -> bool {
    let candidate = raw.trim().trim_start_matches('[').trim_end_matches(']');
    candidate.contains(':')
}

pub fn normalize_proxy_host_for_url(raw: &str) -> String {
    let host = raw.trim();
    if is_ipv6_host_literal(host) && !host.starts_with('[') && !host.ends_with(']') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

pub fn preferred_proxy_host(prefer_ipv6: bool) -> Option<String> {
    let mut candidates: Vec<String> = Vec::new();
    if prefer_ipv6 {
        if let Some(v) = env_var_trim("PROXY_HOST_FORGE_IPV6") {
            candidates.push(v);
        }
    }
    if let Some(v) = env_var_trim("PROXY_HOST") {
        candidates.push(v);
    }
    if let Some(v) = env_var_trim("PROXY_HOSTS") {
        candidates.extend(parse_proxy_hosts_csv(&v));
    }

    if prefer_ipv6 {
        if let Some(found) = candidates.iter().find(|h| is_ipv6_host_literal(h)) {
            return Some(found.clone());
        }
    }
    candidates.into_iter().find(|h| !h.trim().is_empty())
}

