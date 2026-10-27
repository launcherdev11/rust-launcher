use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;

use once_cell::sync::Lazy;

const BMCL_ROOT: &str = "https://bmclapi2.bangbang93.com";

const DEMOTE_AFTER_FAILURES: u32 = 2;

const REWRITES: &[(&str, &str)] = &[
    ("https://piston-meta.mojang.com", ""),
    ("https://launchermeta.mojang.com", ""),
    ("https://piston-data.mojang.com", ""),
    ("https://launcher.mojang.com", ""),
    ("https://libraries.minecraft.net", "/libraries"),
    ("https://resources.download.minecraft.net", "/assets"),
    ("https://maven.minecraftforge.net", "/maven"),
    ("https://files.minecraftforge.net/maven", "/maven"),
    ("https://maven.neoforged.net/releases", "/maven"),
    ("https://maven.fabricmc.net", "/maven"),
    ("https://meta.fabricmc.net", "/fabric-meta"),
    ("https://maven.quiltmc.org/repository/release", "/maven"),
    ("https://meta.quiltmc.org", "/quilt-meta"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DownloadSource {
    Auto,
    Official,
    Mirror,
}

impl DownloadSource {
    pub(crate) fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "official" => Self::Official,
            "mirror" => Self::Mirror,
            _ => Self::Auto,
        }
    }

    fn to_u8(self) -> u8 {
        match self {
            Self::Auto => 1,
            Self::Official => 2,
            Self::Mirror => 3,
        }
    }

    fn from_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(Self::Auto),
            2 => Some(Self::Official),
            3 => Some(Self::Mirror),
            _ => None,
        }
    }
}

static SOURCE: AtomicU8 = AtomicU8::new(0);

static HOST_FAILURES: Lazy<Mutex<HashMap<String, u32>>> = Lazy::new(|| Mutex::new(HashMap::new()));

pub(crate) fn set_download_source(raw: &str) {
    SOURCE.store(DownloadSource::parse(raw).to_u8(), Ordering::SeqCst);
}

fn current_source() -> DownloadSource {
    if let Some(src) = DownloadSource::from_u8(SOURCE.load(Ordering::SeqCst)) {
        return src;
    }
    let settings = crate::services::game::settings::load_settings_from_disk();
    let src = DownloadSource::parse(&settings.download_source);
    SOURCE.store(src.to_u8(), Ordering::SeqCst);
    src
}

fn host_key(url: &str) -> Option<String> {
    let rest = url.split_once("://")?.1;
    let host = rest.split(['/', '?', '#']).next()?;
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

pub(crate) fn mirror_url(url: &str) -> Option<String> {
    let url = url.trim();
    let normalized;
    let url = if let Some(rest) = url.strip_prefix("http://") {
        normalized = format!("https://{rest}");
        normalized.as_str()
    } else {
        url
    };
    for (official, path) in REWRITES {
        let Some(rest) = url.strip_prefix(official) else {
            continue;
        };
        if !(rest.is_empty() || rest.starts_with('/') || rest.starts_with('?')) {
            continue;
        }
        return Some(format!("{BMCL_ROOT}{path}{rest}"));
    }
    None
}

fn order_for(source: DownloadSource, official_demoted: bool) -> [bool; 2] {
    match source {
        DownloadSource::Mirror => [true, false],
        DownloadSource::Official => [false, false],
        DownloadSource::Auto => [official_demoted, !official_demoted],
    }
}

pub(crate) fn candidates(url: &str) -> Vec<String> {
    let Some(mirror) = mirror_url(url) else {
        return vec![url.to_string()];
    };
    let source = current_source();
    if source == DownloadSource::Official {
        return vec![url.to_string()];
    }
    let demoted = host_key(url)
        .and_then(|h| HOST_FAILURES.lock().ok().map(|m| m.get(&h).copied().unwrap_or(0)))
        .is_some_and(|n| n >= DEMOTE_AFTER_FAILURES);
    if order_for(source, demoted)[0] {
        vec![mirror, url.to_string()]
    } else {
        vec![url.to_string(), mirror]
    }
}

pub(crate) fn note_failure(url: &str) {
    if mirror_url(url).is_none() {
        return;
    }
    if let (Some(host), Ok(mut map)) = (host_key(url), HOST_FAILURES.lock()) {
        *map.entry(host).or_insert(0) += 1;
    }
}

pub(crate) fn note_success(url: &str) {
    if mirror_url(url).is_none() {
        return;
    }
    if let (Some(host), Ok(mut map)) = (host_key(url), HOST_FAILURES.lock()) {
        map.remove(&host);
    }
}

pub(crate) const LOCAL_ERROR: u16 = 0;

pub(crate) fn worth_trying_next(status: Option<u16>) -> bool {
    !matches!(status, Some(LOCAL_ERROR) | Some(404) | Some(410))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_known_hosts() {
        assert_eq!(
            mirror_url("https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar").as_deref(),
            Some("https://bmclapi2.bangbang93.com/libraries/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar")
        );
        assert_eq!(
            mirror_url("https://resources.download.minecraft.net/ab/abcdef").as_deref(),
            Some("https://bmclapi2.bangbang93.com/assets/ab/abcdef")
        );
        assert_eq!(
            mirror_url("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json").as_deref(),
            Some("https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json")
        );
        assert_eq!(
            mirror_url("https://maven.neoforged.net/releases/net/neoforged/neoforge/x.jar").as_deref(),
            Some("https://bmclapi2.bangbang93.com/maven/net/neoforged/neoforge/x.jar")
        );
        assert_eq!(
            mirror_url("http://launcher.mojang.com/v1/objects/x/client.jar").as_deref(),
            Some("https://bmclapi2.bangbang93.com/v1/objects/x/client.jar")
        );
    }

    #[test]
    fn ignores_foreign_and_lookalike_hosts() {
        assert!(mirror_url("https://cdn.modrinth.com/data/x.jar").is_none());
        assert!(mirror_url("https://libraries.minecraft.net.evil.com/x.jar").is_none());
        assert!(mirror_url("https://maven.fabricmc.network/x").is_none());
    }

    #[test]
    fn order_follows_source_and_health() {
        assert_eq!(order_for(DownloadSource::Mirror, false)[0], true);
        assert_eq!(order_for(DownloadSource::Auto, false)[0], false);
        assert_eq!(order_for(DownloadSource::Auto, true)[0], true);
    }

    #[test]
    fn not_found_stops_fallback() {
        assert!(!worth_trying_next(Some(404)));
        assert!(worth_trying_next(Some(403)));
        assert!(worth_trying_next(Some(503)));
        assert!(worth_trying_next(None));
        assert!(!worth_trying_next(Some(LOCAL_ERROR)));
    }
}
