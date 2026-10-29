use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::stream::{FuturesUnordered, StreamExt};
use tokio::sync::Mutex;

pub const OFFLINE_ERR: &str = "Нет подключения к интернету";

const PROBE_URLS: &[&str] = &[
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
    "https://api.16-launcher.ru/",
    "https://bmclapi2.bangbang93.com/",
];
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
const ONLINE_TTL_MS: u64 = 30_000;
const OFFLINE_TTL_MS: u64 = 5_000;

static LAST_ONLINE: AtomicBool = AtomicBool::new(true);
static LAST_CHECKED_MS: AtomicU64 = AtomicU64::new(0);
static PROBE_LOCK: Mutex<()> = Mutex::const_new(());

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn cached() -> Option<bool> {
    let checked = LAST_CHECKED_MS.load(Ordering::SeqCst);
    if checked == 0 {
        return None;
    }
    let online = LAST_ONLINE.load(Ordering::SeqCst);
    let ttl = if online { ONLINE_TTL_MS } else { OFFLINE_TTL_MS };
    (now_ms().saturating_sub(checked) < ttl).then_some(online)
}

async fn probe() -> bool {
    let client = super::http::http_client(false);
    let mut attempts: FuturesUnordered<_> = PROBE_URLS
        .iter()
        .map(|url| {
            let request = client.head(*url).timeout(PROBE_TIMEOUT).send();
            async move { request.await.is_ok() }
        })
        .collect();
    while let Some(ok) = attempts.next().await {
        if ok {
            return true;
        }
    }
    false
}

pub async fn is_online() -> bool {
    if let Some(online) = cached() {
        return online;
    }
    let _guard = PROBE_LOCK.lock().await;
    if let Some(online) = cached() {
        return online;
    }
    let online = probe().await;
    LAST_ONLINE.store(online, Ordering::SeqCst);
    LAST_CHECKED_MS.store(now_ms(), Ordering::SeqCst);
    if !online {
        eprintln!("[Network] Сеть недоступна, работаем офлайн");
    }
    online
}
