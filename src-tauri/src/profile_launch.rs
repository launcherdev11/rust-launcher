use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub const LAUNCH_PROFILE_ARG: &str = "--launch-profile";

#[derive(Clone)]
pub struct PendingProfileLaunch(pub Arc<Mutex<Option<String>>>);

#[derive(Clone, Serialize)]
pub struct ProfileLaunchEventPayload {
    pub profile_id: String,
}

pub fn pending_profile_launch_new() -> PendingProfileLaunch {
    PendingProfileLaunch(Arc::new(Mutex::new(None)))
}

fn stash_profile_id(pending: &PendingProfileLaunch, profile_id: String) {
    if profile_id.trim().is_empty() {
        return;
    }
    if let Ok(mut g) = pending.0.lock() {
        *g = Some(profile_id);
    }
}

pub fn profile_id_from_cli_arg(arg: &str) -> Option<String> {
    let s = arg.trim();
    if let Some(rest) = s.strip_prefix(LAUNCH_PROFILE_ARG) {
        let id = rest.strip_prefix('=').unwrap_or(rest).trim();
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }
    None
}

pub fn first_profile_launch_from_cli_args(args: impl IntoIterator<Item = String>) -> Option<String> {
    let args: Vec<String> = args.into_iter().collect();
    let mut i = 0;
    while i < args.len() {
        if let Some(id) = profile_id_from_cli_arg(&args[i]) {
            return Some(id);
        }
        if args[i] == LAUNCH_PROFILE_ARG {
            if let Some(next) = args.get(i + 1) {
                let id = next.trim();
                if !id.is_empty() && !id.starts_with('-') {
                    return Some(id.to_string());
                }
            }
        }
        i += 1;
    }
    None
}

pub fn stash_argv_profile_launch_if_any(pending: &PendingProfileLaunch) {
    if let Some(id) = first_profile_launch_from_cli_args(std::env::args().skip(1)) {
        stash_profile_id(pending, id);
    }
}

pub fn extract_profile_launch_from_os_args(args: &[String]) -> Option<String> {
    first_profile_launch_from_cli_args(args.iter().cloned())
}

pub fn emit_profile_launch_request(app: &AppHandle, profile_id: String) {
    let _ = app.emit(
        "profile-launch-request",
        ProfileLaunchEventPayload { profile_id },
    );
}

#[tauri::command]
pub fn take_pending_profile_launch(pending: State<'_, PendingProfileLaunch>) -> Option<String> {
    pending
        .inner()
        .0
        .lock()
        .ok()
        .and_then(|mut g| g.take())
}
