use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use once_cell::sync::Lazy;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static CLIENT: Lazy<Mutex<Option<DiscordIpcClient>>> = Lazy::new(|| Mutex::new(None));
static SESSION_START_MS: Lazy<i64> = Lazy::new(session_start_ms);

const MAX_FIELD_CHARS: usize = 128;
const DEFAULT_DISCORD_APPLICATION_ID: &str = "1485297789692022964";
const PRODUCT_NAME: &str = "16Launcher";
const DEFAULT_LARGE_IMAGE: &str = "launcher";
const DEFAULT_SMALL_IMAGE: &str = "logo";
const SITE_URL: &str = "https://16-launcher.ru";
const TELEGRAM_URL: &str = "https://t.me/of16launcher";

fn session_start_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn truncate_discord_field(s: &str) -> String {
    let t = s.trim();
    if t.chars().count() <= MAX_FIELD_CHARS {
        return t.to_string();
    }
    t.chars().take(MAX_FIELD_CHARS).collect()
}

fn application_id_from_env() -> Option<String> {
    let raw = std::env::var("DISCORD_APPLICATION_ID")
        .ok()
        .or_else(|| option_env!("DISCORD_APPLICATION_ID").map(|s| s.to_string()))
        .unwrap_or_else(|| DEFAULT_DISCORD_APPLICATION_ID.to_string());
    let t = raw.trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

fn connect_client(guard: &mut Option<DiscordIpcClient>, app_id: &str) -> bool {
    let mut c = DiscordIpcClient::new(app_id);
    match c.connect() {
        Ok(()) => {
            *guard = Some(c);
            true
        }
        Err(_) => false,
    }
}

fn large_image_key_for_tab(tab: &str) -> String {
    let key = match tab {
        "play" => "play",
        "settings" => "settings",
        "mods" => "mods",
        "modpacks" => "modpacks",
        "friends" => "friends",
        "rooms" => "rooms",
        "accounts" => "accounts",
        _ => DEFAULT_LARGE_IMAGE,
    };
    key.to_string()
}

fn small_image_key() -> Option<String> {
    std::env::var("DISCORD_RPC_SMALL_IMAGE_KEY")
        .ok()
        .or_else(|| option_env!("DISCORD_RPC_SMALL_IMAGE_KEY").map(|s| s.to_string()))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| Some(DEFAULT_SMALL_IMAGE.to_string()))
}

fn make_activity(details: &str, state: Option<&str>, tab: &str) -> activity::Activity<'static> {
    let mut assets = activity::Assets::new()
        .large_image(large_image_key_for_tab(tab))
        .large_text(PRODUCT_NAME.to_string());

    if let Some(small) = small_image_key() {
        assets = assets
            .small_image(small)
            .small_text(PRODUCT_NAME.to_string());
    }

    let buttons = vec![
        activity::Button::new("Telegram", TELEGRAM_URL),
        activity::Button::new("Site", SITE_URL),
    ];

    let mut act = activity::Activity::new()
        .details(details.to_string())
        .assets(assets)
        .buttons(buttons)
        .timestamps(activity::Timestamps::new().start(*SESSION_START_MS));

    if let Some(s) = state {
        let st = s.trim();
        if !st.is_empty() {
            act = act.state(st.to_string());
        }
    }

    act
}

fn push_activity(
    guard: &mut Option<DiscordIpcClient>,
    app_id: &str,
    details: &str,
    state: Option<&str>,
    tab: &str,
) {
    if guard.is_none() && !connect_client(guard, app_id) {
        return;
    }

    let client = match guard.as_mut() {
        Some(c) => c,
        None => return,
    };

    let act = make_activity(details, state, tab);
    if client.set_activity(act).is_err() {
        let _ = client.close();
        *guard = None;
        if connect_client(guard, app_id) {
            if let Some(c) = guard.as_mut() {
                let act2 = make_activity(details, state, tab);
                let _ = c.set_activity(act2);
            }
        }
    }
}

#[tauri::command]
pub fn discord_presence_update(details: String, state: Option<String>, tab: Option<String>) {
    let Some(app_id) = application_id_from_env() else {
        return;
    };

    let d = truncate_discord_field(&details);
    let st = state
        .as_ref()
        .map(|s| truncate_discord_field(s))
        .filter(|s| !s.is_empty());
    let tab_id = tab
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("play");

    let mut guard = match CLIENT.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    push_activity(&mut guard, &app_id, &d, st.as_deref(), tab_id);
}

pub fn shutdown() {
    let mut guard = match CLIENT.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(mut c) = guard.take() {
        let _ = c.clear_activity();
        let _ = c.close();
    }
}
