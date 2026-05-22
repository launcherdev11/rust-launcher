use rand::distributions::Alphanumeric;
use rand::Rng;
use tauri::command;

use crate::app::paths::{launcher_accounts_path, profile_path};
use crate::models::launcher_account::{
    LauncherAccountEntry, LauncherAccountSummary, LauncherAccountsStore, Profile,
};

fn new_launcher_account_id() -> String {
    format!(
        "la_{}",
        rand::thread_rng()
            .sample_iter(&Alphanumeric)
            .take(16)
            .map(char::from)
            .collect::<String>()
    )
}

pub fn read_profile_from_disk() -> Result<Profile, String> {
    let path = profile_path()?;
    if !path.exists() {
        return Ok(Profile::default());
    }
    let s = std::fs::read_to_string(&path).map_err(|e| format!("Ошибка чтения профиля: {e}"))?;
    serde_json::from_str(&s).map_err(|e| format!("Ошибка разбора профиля: {e}"))
}

fn save_accounts_store(store: &LauncherAccountsStore) -> Result<(), String> {
    let path = launcher_accounts_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    }
    let s = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Ошибка сериализации accounts.json: {e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("Не удалось сохранить accounts.json: {e}"))?;
    Ok(())
}

fn load_accounts_store() -> Result<LauncherAccountsStore, String> {
    let path = launcher_accounts_path()?;
    if path.exists() {
        let s =
            std::fs::read_to_string(&path).map_err(|e| format!("Ошибка чтения accounts.json: {e}"))?;
        return serde_json::from_str(&s).map_err(|e| format!("Ошибка разбора accounts.json: {e}"));
    }

    let profile = read_profile_from_disk()?;
    let id = new_launcher_account_id();
    let store = LauncherAccountsStore {
        active_id: Some(id.clone()),
        accounts: vec![LauncherAccountEntry { id, profile }],
    };
    save_accounts_store(&store)?;
    Ok(store)
}

fn normalize_account_uuid(s: &str) -> String {
    s.trim().to_lowercase().replace('-', "")
}

fn find_account_by_online_identity(store: &LauncherAccountsStore, profile: &Profile) -> Option<usize> {
    if let Some(u) = profile.mc_uuid.as_ref() {
        if !u.trim().is_empty() {
            let n = normalize_account_uuid(u);
            return store.accounts.iter().position(|a| {
                a.profile
                    .mc_uuid
                    .as_ref()
                    .map(|x| normalize_account_uuid(x))
                    == Some(n.clone())
            });
        }
    }
    if let Some(u) = profile.ely_uuid.as_ref() {
        if !u.trim().is_empty() {
            let n = normalize_account_uuid(u);
            return store.accounts.iter().position(|a| {
                a.profile
                    .ely_uuid
                    .as_ref()
                    .map(|x| normalize_account_uuid(x))
                    == Some(n.clone())
            });
        }
    }
    None
}

fn launcher_account_label(p: &Profile) -> String {
    if let Some(u) = p.mc_username.as_ref() {
        let t = u.trim();
        if !t.is_empty() {
            return t.to_string();
        }
    }
    if let Some(u) = p.ely_username.as_ref() {
        let t = u.trim();
        if !t.is_empty() {
            return t.to_string();
        }
    }
    let n = p.nickname.trim();
    if !n.is_empty() {
        return n.to_string();
    }
    "—".to_string()
}

fn launcher_account_kind(p: &Profile) -> &'static str {
    let has_mc = p.mc_uuid.as_ref().is_some_and(|s| !s.trim().is_empty());
    let has_ms = p.ms_access_token.is_some() || p.ms_id_token.is_some();
    if has_mc && has_ms {
        return "microsoft";
    }
    if p.ely_uuid.as_ref().is_some_and(|s| !s.trim().is_empty()) {
        return "ely";
    }
    "offline"
}

fn upsert_launcher_accounts_store(profile: &Profile) -> Result<(), String> {
    let mut store = load_accounts_store()?;
    if let Some(idx) = find_account_by_online_identity(&store, profile) {
        store.accounts[idx].profile = profile.clone();
        store.active_id = Some(store.accounts[idx].id.clone());
    } else {
        let has_online_identity = profile.mc_uuid.as_ref().is_some_and(|s| !s.trim().is_empty())
            || profile.ely_uuid.as_ref().is_some_and(|s| !s.trim().is_empty());
        if has_online_identity {
            let id = new_launcher_account_id();
            store.accounts.push(LauncherAccountEntry {
                id: id.clone(),
                profile: profile.clone(),
            });
            store.active_id = Some(id);
        } else if let Some(ref aid) = store.active_id {
            if let Some(idx) = store.accounts.iter().position(|a| &a.id == aid) {
                store.accounts[idx].profile = profile.clone();
            } else {
                let id = new_launcher_account_id();
                store.accounts.push(LauncherAccountEntry {
                    id: id.clone(),
                    profile: profile.clone(),
                });
                store.active_id = Some(id);
            }
        } else {
            let id = new_launcher_account_id();
            store.accounts.push(LauncherAccountEntry {
                id: id.clone(),
                profile: profile.clone(),
            });
            store.active_id = Some(id);
        }
    }
    save_accounts_store(&store)
}

pub fn persist_profile_json(profile: &Profile) -> Result<(), String> {
    let path = profile_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    }
    let s =
        serde_json::to_string_pretty(profile).map_err(|e| format!("Ошибка сериализации: {e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("Не удалось сохранить профиль: {e}"))?;
    Ok(())
}

pub fn save_full_profile(profile: &Profile) -> Result<(), String> {
    persist_profile_json(profile)?;
    upsert_launcher_accounts_store(profile)?;
    Ok(())
}

#[command]
pub fn get_profile() -> Result<Profile, String> {
    if !launcher_accounts_path()?.exists() {
        let _ = load_accounts_store()?;
    }
    read_profile_from_disk()
}

#[command]
pub fn set_profile(nickname: String) -> Result<(), String> {
    let mut profile = get_profile()?;
    profile.nickname = nickname;
    save_full_profile(&profile)?;
    Ok(())
}

#[command]
pub fn list_launcher_accounts() -> Result<Vec<LauncherAccountSummary>, String> {
    let store = load_accounts_store()?;
    let active = store.active_id.as_deref();
    let mut out: Vec<LauncherAccountSummary> = store
        .accounts
        .iter()
        .map(|a| LauncherAccountSummary {
            id: a.id.clone(),
            label: launcher_account_label(&a.profile),
            kind: launcher_account_kind(&a.profile).to_string(),
            is_active: active == Some(a.id.as_str()),
        })
        .collect();
    out.sort_by(|x, y| {
        let ak = match x.kind.as_str() {
            "microsoft" => 0,
            "ely" => 1,
            _ => 2,
        };
        let bk = match y.kind.as_str() {
            "microsoft" => 0,
            "ely" => 1,
            _ => 2,
        };
        ak.cmp(&bk).then(x.label.to_lowercase().cmp(&y.label.to_lowercase()))
    });
    Ok(out)
}

#[command]
pub fn switch_launcher_account(account_id: String) -> Result<(), String> {
    let mut store = load_accounts_store()?;
    let p = store
        .accounts
        .iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| "Аккаунт не найден.".to_string())?
        .profile
        .clone();
    store.active_id = Some(account_id);
    save_accounts_store(&store)?;
    persist_profile_json(&p)?;
    Ok(())
}

#[command]
pub fn remove_launcher_account(account_id: String) -> Result<(), String> {
    let mut store = load_accounts_store()?;
    let before = store.accounts.len();
    store.accounts.retain(|a| a.id != account_id);
    if store.accounts.len() == before {
        return Err("Аккаунт не найден.".to_string());
    }
    let was_active = store.active_id.as_deref() == Some(account_id.as_str());
    if was_active {
        store.active_id = store.accounts.first().map(|a| a.id.clone());
        if let Some(ref aid) = store.active_id {
            let p = store
                .accounts
                .iter()
                .find(|a| &a.id == aid)
                .map(|a| a.profile.clone())
                .unwrap_or_default();
            persist_profile_json(&p)?;
        } else {
            persist_profile_json(&Profile::default())?;
        }
    }
    save_accounts_store(&store)?;
    Ok(())
}

#[command]
pub fn add_launcher_account(nickname: Option<String>) -> Result<(), String> {
    let mut store = load_accounts_store()?;
    let idx = store.accounts.len() + 1;
    let nick = match nickname {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => format!("Player {}", idx),
    };
    let id = new_launcher_account_id();
    let profile = Profile {
        nickname: nick,
        ..Default::default()
    };
    store.accounts.push(LauncherAccountEntry {
        id: id.clone(),
        profile: profile.clone(),
    });
    store.active_id = Some(id);
    save_accounts_store(&store)?;
    persist_profile_json(&profile)?;
    Ok(())
}
