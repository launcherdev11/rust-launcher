use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use once_cell::sync::Lazy;
use std::sync::Mutex;

static CLIENT: Lazy<Mutex<Option<DiscordIpcClient>>> = Lazy::new(|| Mutex::new(None));

const MAX_FIELD_CHARS: usize = 128;

fn truncate_discord_field(s: &str) -> String {
    let t = s.trim();
    if t.chars().count() <= MAX_FIELD_CHARS {
        return t.to_string();
    }
    t.chars().take(MAX_FIELD_CHARS).collect()
}

fn application_id_from_env() -> Option<String> {
    let raw = std::env::var("DISCORD_APPLICATION_ID").ok()?;
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

fn make_activity<'a>(details: &'a str, state: Option<&'a str>) -> activity::Activity<'a> {
    let mut act = activity::Activity::new().details(details);
    if let Some(s) = state {
        let st = s.trim();
        if !st.is_empty() {
            act = act.state(st);
        }
    }
    if let Ok(key) = std::env::var("DISCORD_RPC_LARGE_IMAGE_KEY") {
        let k = key.trim();
        if !k.is_empty() {
            act = act.assets(activity::Assets::new().large_image(k.to_string()));
        }
    }
    act
}

#[tauri::command]
pub fn discord_presence_update(details: String, state: Option<String>) {
    let Some(app_id) = application_id_from_env() else {
        return;
    };

    let d = truncate_discord_field(&details);
    let st = state
        .as_ref()
        .map(|s| truncate_discord_field(s))
        .filter(|s| !s.is_empty());

    let mut guard = match CLIENT.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };

    if guard.is_none() {
        if !connect_client(&mut guard, &app_id) {
            return;
        }
    }

    let client = match guard.as_mut() {
        Some(c) => c,
        None => return,
    };

    let act = make_activity(&d, st.as_deref());
    if client.set_activity(act).is_err() {
        let _ = client.close();
        *guard = None;
        if connect_client(&mut guard, &app_id) {
            if let Some(c) = guard.as_mut() {
                let act2 = make_activity(&d, st.as_deref());
                let _ = c.set_activity(act2);
            }
        }
    }
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
