use std::io::{BufRead, BufReader, ErrorKind};
use std::sync::atomic::Ordering;
use std::time::SystemTime;

use tauri::{AppHandle, Emitter};

use crate::app::paths::{game_root_dir, launcher_data_dir, libraries_dir, versions_dir};
use crate::infra::http::http_client;
use crate::infra::process::hide_console;
use crate::models::events::{
    GameConsoleLinePayload, GameProcessExitedPayload, LastPlayedUpdatedPayload, PlaytimeUpdatedPayload,
    EVENT_GAME_CONSOLE_LINE, EVENT_GAME_PROCESS_EXITED, EVENT_LAST_PLAYED_UPDATED, EVENT_PLAYTIME_UPDATED,
};
use crate::services::game::console_filter::is_game_console_line_important;
use crate::services::auth::ely::{ensure_authlib_injector, refresh_ely_session_internal, ELY_CLIENT_ID};
use crate::services::game::accounts::{get_profile, save_full_profile};
use crate::services::game::arguments::{
    resolve_arguments, strip_legacy_server_args, strip_quick_play_game_args,
};
use crate::services::game::core::{
    compare_version_like, current_os_name, download_text_with_retries, ensure_fabric_intermediary_library,
    fabric_library_path,
    is_probably_native_jar_path, library_applies, os_info, parse_library_coords, resolve_native_artifact,
};
use crate::services::game::console::log_to_console;
use crate::services::game::profiles::{
    add_play_time_seconds_to_profile, load_selected_instance_settings, read_selected_profile_id,
    record_profile_last_played, selected_instance_dir,
};
use crate::services::game::runtime::{
    build_java_command, ensure_forge_ignore_list_includes_vanilla_client_jar,
    ensure_forge_safe_opens, ensure_lwjgl_fallback_for_modern_versions, ensure_library_artifacts_present_for_launch,
    ensure_ms_minecraft_session, extract_natives_jar, filter_forge_problematic_jvm_args,
    filter_launcher_owned_jvm_args, natives_dir_has_files,
    offline_uuid_from_username, remove_add_opens_for_java_under_9, resolve_client_jar_path,
    resolve_natives_dir_for_launch, fallback_java_runtime_for_mc_version, resolve_natives_extract_dir,
    forge_java_runtime_for_mc_version,
};
use crate::services::game::launcher::process::{is_external_minecraft_running, is_our_game_process_alive};
use crate::services::game::settings as settings_service;
use crate::services::game::state::{BMCL_MAVEN_BASE, DEFAULT_DOWNLOAD_RETRIES, GAME_PROCESS_PID};
use crate::services::game::version_types::*;
use crate::services::game::versions::get_mojang_version_url;

const ELY_AUTHLIB_INJECTOR_TARGET: &str = "ely.by";

const FRIEND_WORLD_OFFLINE_ERR: &str = "Войти в мир друга нельзя в офлайн-режиме. Войдите через Microsoft или Ely на вкладке Аккаунты.";

fn format_game_args_for_dump(args: &[String]) -> String {
    let mut lines = Vec::with_capacity(args.len());
    let mut i = 0usize;
    while i < args.len() {
        let a = &args[i];
        let redact_next = matches!(
            a.as_str(),
            "--accessToken" | "--session" | "--sessionId" | "--userProperties"
        );
        lines.push(format!("  {a}"));
        if redact_next && i + 1 < args.len() && !args[i + 1].starts_with('-') {
            let val = &args[i + 1];
            let has = !val.is_empty() && val != "offline" && val != "0";
            lines.push(format!("  <redacted has_value={has}>"));
            i += 2;
            continue;
        }
        if a.starts_with("token:") {
            lines.pop();
            lines.push("  <redacted session-token>".to_string());
        }
        i += 1;
    }
    lines.join("\n")
}

fn write_launch_auth_dump(
    game_dir: &std::path::Path,
    version_id: &str,
    server_address: &Option<String>,
    auth_mode: &str,
    user_type: &str,
    has_access_token: bool,
    authlib_injector: bool,
    note: &str,
) {
    let dump = format!(
        "version_id={version_id}\nserver_address={server_address:?}\nauth_mode={auth_mode}\nuser_type={user_type}\nhas_access_token={has_access_token}\nauthlib_injector={authlib_injector}\nnote={note}\n"
    );
    let mut dump_paths = vec![game_dir.join("mc16-last-launch-args.txt")];
    if let Ok(data) = launcher_data_dir() {
        dump_paths.push(data.join("mc16-last-launch-args.txt"));
    }
    if let Ok(root) = game_root_dir() {
        let p = root.join("mc16-last-launch-args.txt");
        if !dump_paths.contains(&p) {
            dump_paths.push(p);
        }
    }
    for dump_path in &dump_paths {
        if let Err(e) = std::fs::write(dump_path, &dump) {
            eprintln!("[Launch] failed to write {}: {e}", dump_path.display());
        }
    }
}

fn apply_ms_session(
    auth_name: &mut String,
    auth_uuid: &mut String,
    auth_token: &mut String,
    user_type: &mut String,
    auth_is_mojang: &mut bool,
    auth_uuid_nodash: &mut String,
    legacy_session: &mut String,
    mc_name: String,
    mc_uuid: String,
    mc_access_token: String,
) {
    *auth_name = mc_name;
    *auth_uuid = if mc_uuid.contains('-') {
        mc_uuid
    } else if mc_uuid.len() == 32 {
        format!(
            "{}-{}-{}-{}-{}",
            &mc_uuid[0..8],
            &mc_uuid[8..12],
            &mc_uuid[12..16],
            &mc_uuid[16..20],
            &mc_uuid[20..32]
        )
    } else {
        mc_uuid
    };
    *auth_token = mc_access_token;
    *user_type = "msa".to_string();
    *auth_is_mojang = true;
    *auth_uuid_nodash = auth_uuid.replace('-', "");
    *legacy_session = format!("token:{}:{}", auth_token, auth_uuid_nodash);
}

fn split_server_address(addr: &str) -> (String, String) {
    if let Some((host, port)) = addr.rsplit_once(':') {
        if !host.is_empty() && port.chars().all(|c| c.is_ascii_digit()) {
            return (host.to_string(), port.to_string());
        }
    }
    (addr.to_string(), "25565".to_string())
}

fn version_supports_quick_play_multiplayer(version_id: &str, jar_version: &str) -> bool {
    fn major_minor(v: &str) -> Option<(u32, u32)> {
        let mut parts = v.trim().split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next().unwrap_or("0").parse().ok()?;
        Some((major, minor))
    }
    for candidate in [jar_version, version_id] {
        let head = candidate.split('-').next().unwrap_or(candidate);
        if let Some((major, minor)) = major_minor(head) {
            return major > 1 || (major == 1 && minor >= 20);
        }
    }
    false
}

#[tauri::command]
pub async fn launch_game(
    app: AppHandle,
    version_id: String,
    version_url: Option<String>,
    server_address: Option<String>,
) -> Result<(), String> {
    let root = game_root_dir()?;
    let libs_root = libraries_dir()?;
    let vers_root = versions_dir()?;
    let playtime_profile_id = read_selected_profile_id();
    let game_dir = selected_instance_dir().unwrap_or_else(|| root.clone());

    let (mut detail, is_fabric) = if let Some(ref url) = version_url {
        let client = http_client(false);
        let text = download_text_with_retries(&client, url, DEFAULT_DOWNLOAD_RETRIES).await?;
        let d: VersionDetail = serde_json::from_str(&text)
            .map_err(|e| format!("Ошибка разбора описания версии: {e}"))?;
        (d, false)
    } else {
        let version_json = vers_root.join(&version_id).join(format!("{version_id}.json"));
        let profile_path = vers_root.join(&version_id).join("profile.json");
        if version_json.exists() {
            let s = tokio::fs::read_to_string(&version_json)
                .await
                .map_err(|e| format!("Ошибка чтения version.json: {e}"))?;
            let d: VersionDetail = serde_json::from_str(&s)
                .map_err(|e| format!("Ошибка разбора version.json: {e}"))?;
            (d, false)
        } else if profile_path.exists() {
            let s = tokio::fs::read_to_string(&profile_path)
                .await
                .map_err(|e| format!("Ошибка чтения profile.json: {e}"))?;
            let profile: FabricProfile = serde_json::from_str(&s)
                .map_err(|e| format!("Ошибка разбора profile.json: {e}"))?;
            let mojang_url = get_mojang_version_url(&profile.inherits_from).await?;
            let client = http_client(false);
            let mojang_text = download_text_with_retries(&client, &mojang_url, DEFAULT_DOWNLOAD_RETRIES).await?;
            let mojang_detail: VersionDetail = serde_json::from_str(&mojang_text)
                .map_err(|e| format!("Ошибка разбора: {e}"))?;
            let mut detail = VersionDetail {
                downloads: None,
                inherits_from: Some(profile.inherits_from.clone()),
                main_class: profile.main_class,
                libraries: Vec::new(),
                arguments: VersionArguments {
                    jvm: profile.arguments.jvm,
                    game: Vec::new(),
                },
                minecraft_arguments: None,
                asset_index: mojang_detail.asset_index,
                assets: mojang_detail.assets.clone(),
                java_version: mojang_detail.java_version.clone(),
            };
            for lib in &profile.libraries {
                let path = fabric_library_path(&lib.name);
                detail.libraries.push(Library {
                    name: lib.name.clone(),
                    downloads: LibraryDownloads {
                        artifact: Some(LibraryArtifact {
                            path: path.clone(),
                            url: format!("https://maven.fabricmc.net/{path}"),
                            sha1: None,
                            size: lib.size,
                        }),
                        classifiers: None,
                    },
                    rules: vec![],
                    extract: None,
                    natives: None,
                });
            }
            ensure_fabric_intermediary_library(&mut detail.libraries, &profile.inherits_from);
            (detail, true)
        } else {
            return Err("Версия не установлена или не найдена. Сначала установите.".to_string());
        }
    };

        let mut effective_jar_version = version_id.clone();
    if let Some(parent_id) = detail.inherits_from.clone() {
        effective_jar_version = parent_id.clone();
        let parent_json_path = vers_root.join(&parent_id).join(format!("{parent_id}.json"));
        let parent_detail: VersionDetail = if parent_json_path.exists() {
            let s = tokio::fs::read_to_string(&parent_json_path)
                .await
                .map_err(|e| format!("Ошибка чтения parent version.json: {e}"))?;
            serde_json::from_str(&s).map_err(|e| format!("Ошибка разбора parent version.json: {e}"))?
        } else {
                let url = get_mojang_version_url(&parent_id).await?;
            let client = http_client(false);
            let text = download_text_with_retries(&client, &url, DEFAULT_DOWNLOAD_RETRIES).await?;
                serde_json::from_str(&text)
                .map_err(|e| format!("Ошибка разбора parent версии: {e}"))?
        };

        let mut merged_libs = parent_detail.libraries.clone();
        merged_libs.extend(detail.libraries.clone());
        let mut merged_args = parent_detail.arguments.clone();
        merged_args.jvm.extend(detail.arguments.jvm.clone());
        merged_args.game.extend(detail.arguments.game.clone());

        detail.downloads = parent_detail.downloads;
        detail.asset_index = detail.asset_index.clone().or(parent_detail.asset_index);
        detail.assets = detail.assets.clone().or(parent_detail.assets);
        detail.java_version = detail.java_version.clone().or(parent_detail.java_version);
        detail.libraries = merged_libs;
        detail.arguments = merged_args;
    }

    let inherits_for_jar = detail.inherits_from.as_deref();
    let jar_path = resolve_client_jar_path(&root, &vers_root, &version_id, inherits_for_jar)
        .unwrap_or_else(|| root.join(format!("{effective_jar_version}.jar")));
    if detail.downloads.is_some() && !jar_path.is_file() {
        return Err("Версия не установлена. Сначала нажмите «Установить».".to_string());
    }
    if is_fabric && !jar_path.is_file() {
        let base = inherits_for_jar.unwrap_or(&version_id);
        return Err(format!(
            "Не найден client.jar для Fabric (ожидался «{base}.jar» или «{version_id}.jar» в папке игры). Переустановите версию."
        ));
    }

    let os_name = current_os_name();
    let os_info = os_info();
    let join_address = server_address
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    eprintln!(
        "[Launch] server_address(raw)={:?} join_address={:?}",
        server_address, join_address
    );

    let features = if join_address.is_some()
        && version_supports_quick_play_multiplayer(&version_id, &effective_jar_version)
    {
        GameFeatures::for_multiplayer_join()
    } else {
        GameFeatures::full()
    };

    let is_forge = is_forge_profile(&version_id, &detail.main_class, &detail.libraries);
    ensure_library_artifacts_present_for_launch(
        &app,
        &version_id,
        &libs_root,
        &detail.libraries,
        os_name,
    )
    .await?;

    let mut classpath = Vec::new();
    let mut seen_paths = std::collections::HashSet::<String>::new();
    let mut ga_to_index = std::collections::HashMap::<String, usize>::new();
    let mut ga_to_version = std::collections::HashMap::<String, String>::new();
    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref a) = lib.downloads.artifact {
            if is_probably_native_jar_path(&a.path) {
                continue;
            }
            let path = libs_root.join(&a.path);
            let key = path.to_str().unwrap_or("").replace('\\', "/");
            let ga_key = {
                let mut parts = lib.name.split(':');
                match (parts.next(), parts.next()) {
                    (Some(group), Some(artifact)) if !group.is_empty() && !artifact.is_empty() => {
                        Some(format!("{group}:{artifact}"))
                    }
                    _ => None,
                }
            };
            if let Some(ga_key) = ga_key {
                if let Some(idx) = ga_to_index.get(&ga_key).copied() {
                    if seen_paths.insert(key) {
                        let current_version = ga_to_version.get(&ga_key).cloned().unwrap_or_default();
                        let new_version = parse_library_coords(&lib.name)
                            .map(|(_, _, v)| v.to_string())
                            .unwrap_or_default();
                        let should_replace = if ga_key.starts_with("org.lwjgl:") {
                            compare_version_like(&new_version, &current_version)
                                != std::cmp::Ordering::Less
                        } else {
                            true
                        };
                        if should_replace {
                            classpath[idx] = path;
                            if !new_version.is_empty() {
                                ga_to_version.insert(ga_key.clone(), new_version);
                            }
                        }
                    }
                } else if seen_paths.insert(key.clone()) {
                    if let Some((_, _, version)) = parse_library_coords(&lib.name) {
                        ga_to_version.insert(ga_key.clone(), version.to_string());
                    }
                    ga_to_index.insert(ga_key, classpath.len());
                    classpath.push(path);
                }
            } else if seen_paths.insert(key) {
                classpath.push(path);
            }
        }
    }
    if detail.downloads.is_some() || jar_path.is_file() {
        let jar_key = jar_path.to_str().unwrap_or("").replace('\\', "/");
        if seen_paths.insert(jar_key) {
            classpath.push(jar_path.clone());
        }
    }
    ensure_lwjgl_fallback_for_modern_versions(
        &app,
        &effective_jar_version,
        &libs_root,
        &mut classpath,
        &mut seen_paths,
        os_name,
    )
    .await?;

    let classpath_str = classpath
        .iter()
        .map(|p| p.to_str().unwrap_or(""))
        .collect::<Vec<_>>()
        .join(if os_name == "windows" { ";" } else { ":" });

    let game_dir_str = game_dir
        .to_str()
        .ok_or("Путь к папке игры не в UTF-8")?;
    if let Err(e) = std::fs::create_dir_all(&game_dir) {
        return Err(format!(
            "Не удалось создать папку сборки/игры: {} — {e}",
            game_dir.display()
        ));
    }
    if is_fabric {
        let remapped_root = game_dir.join(".fabric").join("remappedJars");
        if let Err(e) = std::fs::create_dir_all(&remapped_root) {
            return Err(format!(
                "Не удалось подготовить папки Fabric (remappedJars): {} — {e}",
                remapped_root.display()
            ));
        }
    }
    let natives_dir = vers_root.join(&version_id).join("natives");
    std::fs::create_dir_all(&natives_dir)
        .map_err(|e| format!("Не удалось создать папку natives при запуске: {e}"))?;
    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(a) = &lib.downloads.artifact {
            if is_probably_native_jar_path(&a.path) {
                let path = libs_root.join(&a.path);
                if path.exists() {
                    let out_dir =
                        resolve_natives_extract_dir(&natives_dir, &version_id, &lib.name, &a.path);
                    let _ = extract_natives_jar(&path, &out_dir);
                }
            }
        }
        if let Some(nat) = resolve_native_artifact(lib, os_name) {
            let path = libs_root.join(&nat.path);
            if path.exists() {
                let out_dir =
                    resolve_natives_extract_dir(&natives_dir, &version_id, &lib.name, &nat.path);
                let _ = extract_natives_jar(&path, &out_dir);
            }
        }
    }
    let mut has_natives_files = natives_dir_has_files(&natives_dir);
    if !has_natives_files {
        let client = http_client(false);
        for lib in &detail.libraries {
            if !library_applies(lib, os_name) {
                continue;
            }
            if let Some(a) = &lib.downloads.artifact {
                if is_probably_native_jar_path(&a.path) {
                    let path = libs_root.join(&a.path);
                    if path.exists() {
                        let out_dir = resolve_natives_extract_dir(
                            &natives_dir,
                            &version_id,
                            &lib.name,
                            &a.path,
                        );
                        let _ = extract_natives_jar(&path, &out_dir);
                    }
                }
            }
            if let Some(nat) = resolve_native_artifact(lib, os_name) {
                let path = libs_root.join(&nat.path);
                if !path.exists() {
                    if let Some(parent) = path.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| {
                            format!("Не удалось создать папку для natives '{}': {e}", parent.display())
                        })?;
                    }
                    let nat_url = format!("{}/{}", BMCL_MAVEN_BASE, nat.path);
                    let mut resp = client
                        .get(&nat_url)
                        .send()
                        .await
                        .map_err(|e| format!("Ошибка загрузки natives '{}': {e}", nat.path))?;
                    if !resp.status().is_success() {
                        return Err(format!(
                            "Сервер вернул ошибку {} при загрузке natives '{}'",
                            resp.status(),
                            nat_url
                        ));
                    }
                    let mut file = std::fs::File::create(&path)
                        .map_err(|e| format!("Ошибка создания файла natives '{}': {e}", path.display()))?;
                    while let Some(chunk) = resp
                        .chunk()
                        .await
                        .map_err(|e| format!("Ошибка чтения потока natives '{}': {e}", nat_url))?
                    {
                        use std::io::Write;
                        file.write_all(&chunk)
                            .map_err(|e| format!("Ошибка записи файла natives '{}': {e}", path.display()))?;
                    }
                }
                let out_dir =
                    resolve_natives_extract_dir(&natives_dir, &version_id, &lib.name, &nat.path);
                let _ = extract_natives_jar(&path, &out_dir);
            }
        }
        has_natives_files = natives_dir_has_files(&natives_dir);
    }
    let natives_dir = if has_natives_files {
        natives_dir
    } else {
        resolve_natives_dir_for_launch(&vers_root, &version_id, detail.inherits_from.as_deref())
    };
    let natives_str = natives_dir.to_str().unwrap_or("");
    let assets_root = root.join("assets");
    let assets_str = assets_root.to_str().unwrap_or("");
    let _ = std::fs::create_dir_all(&assets_root);

    if let Err(e) = refresh_ely_session_internal().await {
        return Err(e);
    }

    let profile = get_profile().unwrap_or_default();
    let is_friend_world_join = server_address
        .as_ref()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    let is_offline = profile
        .ely_access_token
        .as_deref()
        .map(|s| s.is_empty() || s == "0")
        .unwrap_or(true);
    let mut auth_name: String = profile
        .ely_username
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            if profile.nickname.is_empty() {
                "Player".to_string()
            } else {
                profile.nickname.clone()
            }
        });
    let mut auth_uuid: String = profile
        .ely_uuid
        .as_deref()
        .map(|u| {
            if u.contains('-') {
                u.to_string()
            } else {
                format!("{}-{}-{}-{}-{}", &u[0..8], &u[8..12], &u[12..16], &u[16..20], &u[20..32])
            }
        })
        .unwrap_or_else(|| {
            if is_offline {
                offline_uuid_from_username(&auth_name)
            } else {
                "00000000-0000-0000-0000-000000000000".to_string()
            }
        });
    let mut auth_token: String = profile
        .ely_access_token
        .as_deref()
        .filter(|s| !s.is_empty() && *s != "0")
        .unwrap_or("offline")
        .to_string();
    let mut user_type: String = if is_offline {
        "legacy".to_string()
    } else {
        "mojang".to_string()
    };
    let mut auth_is_mojang = false;
    let mut auth_uuid_nodash: String = auth_uuid.replace('-', "");
    let mut legacy_session: String = if is_offline {
        "offline".to_string()
    } else {
        format!("token:{}:{}", auth_token, auth_uuid_nodash)
    };

    let has_valid_ely_session = !is_offline
        && profile
            .ely_access_token
            .as_deref()
            .map(|s| !s.is_empty() && s != "0")
            .unwrap_or(false)
        && profile
            .ely_uuid
            .as_deref()
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);

    if !has_valid_ely_session {
        let has_ms_token = profile
            .ms_access_token
            .as_deref()
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        let has_ms_refresh = profile
            .ms_refresh_token
            .as_deref()
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        let has_cached_mc = profile
            .mc_access_token
            .as_deref()
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        let should_refresh_ms =
            (has_ms_token || has_ms_refresh) && (is_friend_world_join || !has_cached_mc);

        if should_refresh_ms {
            match ensure_ms_minecraft_session().await {
                Ok(Some((mc_name, mc_uuid, mc_access_token))) => {
                    if let Ok(mut p) = get_profile() {
                        p.mc_username = Some(mc_name.clone());
                        p.mc_uuid = Some(mc_uuid.clone());
                        p.mc_access_token = Some(mc_access_token.clone());
                        let _ = save_full_profile(&p);
                    }
                    apply_ms_session(
                        &mut auth_name,
                        &mut auth_uuid,
                        &mut auth_token,
                        &mut user_type,
                        &mut auth_is_mojang,
                        &mut auth_uuid_nodash,
                        &mut legacy_session,
                        mc_name,
                        mc_uuid,
                        mc_access_token,
                    );
                }
                Ok(None) => {}
                Err(e) => {
                    eprintln!("[Launch] ensure_ms_minecraft_session: {e}");
                    if is_friend_world_join {
                        write_launch_auth_dump(
                            &game_dir,
                            &version_id,
                            &server_address,
                            "microsoft",
                            "msa",
                            false,
                            false,
                            "friend_world_ms_refresh_failed_try_cache",
                        );
                    }
                }
            }
        }

        if !auth_is_mojang {
            if let (Some(mc_name), Some(mc_uuid), Some(mc_access_token)) = (
                profile.mc_username.as_ref(),
                profile.mc_uuid.as_ref(),
                profile.mc_access_token.as_ref(),
            ) {
                if !mc_access_token.is_empty() {
                    apply_ms_session(
                        &mut auth_name,
                        &mut auth_uuid,
                        &mut auth_token,
                        &mut user_type,
                        &mut auth_is_mojang,
                        &mut auth_uuid_nodash,
                        &mut legacy_session,
                        mc_name.clone(),
                        mc_uuid.clone(),
                        mc_access_token.clone(),
                    );
                }
            }
        }

        if is_friend_world_join && !auth_is_mojang && should_refresh_ms {
            write_launch_auth_dump(
                &game_dir,
                &version_id,
                &server_address,
                "microsoft",
                "msa",
                false,
                false,
                "blocked_friend_world_ms_refresh_failed",
            );
            return Err(
                "Не удалось обновить сессию Microsoft для входа в мир друга. \
                 Войдите снова через Microsoft на вкладке Аккаунты."
                    .to_string(),
            );
        }
    }

    let auth_mode: &str = if auth_is_mojang {
        "microsoft"
    } else if auth_token != "offline" && !auth_token.is_empty() {
        "ely"
    } else {
        "offline"
    };
    let has_access_token = auth_token != "offline" && !auth_token.is_empty();

    if is_friend_world_join && auth_mode == "offline" {
        write_launch_auth_dump(
            &game_dir,
            &version_id,
            &server_address,
            auth_mode,
            &user_type,
            has_access_token,
            false,
            "blocked_friend_world_offline",
        );
        return Err(FRIEND_WORLD_OFFLINE_ERR.to_string());
    }

    let mut authlib_injector_path: Option<std::path::PathBuf> = None;
    if has_access_token && !auth_is_mojang {
        match ensure_authlib_injector().await {
            Ok(path) => {
                eprintln!(
                    "[ElyAuth] Используется authlib-injector: {}",
                    path.to_string_lossy().replace('\\', "/")
                );
                authlib_injector_path = Some(path);
            }
            Err(e) => {
                if is_friend_world_join {
                    write_launch_auth_dump(
                        &game_dir,
                        &version_id,
                        &server_address,
                        auth_mode,
                        &user_type,
                        has_access_token,
                        false,
                        "blocked_friend_world_authlib_missing",
                    );
                    return Err(format!(
                        "Для Ely при входе в мир друга нужен authlib-injector: {e}"
                    ));
                }
                eprintln!("[ElyAuth] Не удалось подготовить authlib-injector: {e}");
            }
        }
    }
    let authlib_injector = authlib_injector_path.is_some();

    let libs_dir_str = libs_root
        .to_str()
        .ok_or("Путь к папке libraries не в UTF-8")?;
    let classpath_sep = if os_name == "windows" { ";" } else { ":" };

    let is_neoforge = version_id.to_ascii_lowercase().contains("neoforge")
        || detail
            .libraries
            .iter()
            .any(|l| l.name.to_ascii_lowercase().contains("net.neoforged:"));
    let (java_major, java_component) = if let Some(ref jv) = detail.java_version {
        (jv.major_version, jv.component.clone())
    } else {
        if is_forge && !is_neoforge {
            let (major, component) = forge_java_runtime_for_mc_version(&effective_jar_version);
            eprintln!(
                "[Launch] Forge без java_version в manifest: используем Java {major} ({component})"
            );
            (major, component.to_string())
        } else if is_fabric {
            let (major, component) = fallback_java_runtime_for_mc_version(&effective_jar_version);
            eprintln!(
                "[Launch] Fabric без java_version в manifest: используем Java {major} ({component})"
            );
            (major, component.to_string())
        } else {
            let (major, component) = fallback_java_runtime_for_mc_version(&effective_jar_version);
            eprintln!(
                "[Launch] Без java_version в manifest: используем Java {major} ({component})"
            );
            (major, component.to_string())
        }
    };
    let default_java_path =
        crate::java_runtime::ensure_java_runtime(java_major, &java_component).await?;
    eprintln!(
        "[Launch] Java: {} (runtime {} {})",
        default_java_path.display(),
        java_major,
        java_component
    );

    let settings = settings_service::effective_settings_for_launch();
    let instance_settings_for_launch =
        load_selected_instance_settings()
            .ok()
            .flatten()
            .map(|(_, s)| s);

    let quick_play_log = game_dir
        .join("quickPlay")
        .join("mc16-log.json")
        .to_string_lossy()
        .replace('\\', "/");
    if join_address.is_some() {
        let _ = std::fs::create_dir_all(game_dir.join("quickPlay"));
    }

    let replace = |s: &str| -> String {
        s.replace("${game_directory}", game_dir_str)
            .replace("${gameDir}", game_dir_str)
            .replace("${natives}", natives_str)
            .replace("${natives_directory}", natives_str)
            .replace("${classpath}", &classpath_str)
            .replace("${library_directory}", libs_dir_str)
            .replace("${classpath_separator}", classpath_sep)
            .replace("${assetsDir}", assets_str)
            .replace("${assets_root}", assets_str)
            .replace("${assets_index_name}", detail.assets.as_deref().unwrap_or(""))
            .replace("${version_name}", &version_id)
            .replace("${version}", &version_id)
            .replace("${auth_player_name}", &auth_name)
            .replace("${auth_uuid}", &auth_uuid)
            .replace("${auth_access_token}", &auth_token)
            .replace("${username}", &auth_name)
            .replace("${userName}", &auth_name)
            .replace("${uuid}", &auth_uuid_nodash)
            .replace("${accessToken}", &auth_token)
            .replace("${userType}", &user_type)
            .replace("${auth_session}", &legacy_session)
            .replace("${session}", &legacy_session)
            .replace("${sessionId}", &legacy_session)
            .replace("${clientid}", ELY_CLIENT_ID)
            .replace("${auth_xuid}", "")
            .replace("${user_type}", &user_type)
            .replace("${version_type}", "release")
            .replace("${is_demo_user}", "false")
            .replace("${launcher_name}", "16Launcher")
            .replace("${launcher_version}", "2.0.0")
            .replace(
                "${quickPlayPath}",
                if join_address.is_some() {
                    quick_play_log.as_str()
                } else {
                    ""
                },
            )
            .replace("${quickPlaySingleplayer}", "")
            .replace(
                "${quickPlayMultiplayer}",
                join_address.as_deref().unwrap_or(""),
            )
            .replace("${quickPlayRealms}", "")
    };

    let mut jvm_args: Vec<String> =
        if detail.arguments.game.is_empty() && detail.minecraft_arguments.is_some() {
            vec![
                "-Djava.library.path=".to_string() + natives_str,
                "-cp".to_string(),
                classpath_str.clone(),
            ]
        } else if is_fabric {
            let game_jar = jar_path.to_str().unwrap_or("").replace('\\', "/");
            let mut base = vec![
                format!("-Dfabric.gameJarPath={game_jar}"),
                "-Djava.library.path=".to_string() + natives_str,
                "-cp".to_string(),
                classpath_str.clone(),
            ];
            base.extend(filter_launcher_owned_jvm_args(
                resolve_arguments(&detail.arguments.jvm, &features, &os_info)
                    .into_iter()
                    .map(|s| replace(&s))
                    .collect(),
            ));
            base
        } else {
            resolve_arguments(&detail.arguments.jvm, &features, &os_info)
                .into_iter()
                .map(|s| replace(&s))
                .collect::<Vec<String>>()
        };

    if is_forge {
        ensure_forge_ignore_list_includes_vanilla_client_jar(&mut jvm_args, &effective_jar_version);
    }

    let mut jvm_args = if is_forge {
        filter_forge_problematic_jvm_args(jvm_args).0
    } else {
        jvm_args
    };

    let supports_add_opens = java_major >= 9;
    if !supports_add_opens {
        jvm_args = remove_add_opens_for_java_under_9(jvm_args);
    }
    if is_forge && supports_add_opens {
        ensure_forge_safe_opens(&mut jvm_args);
    }

    let mut game_args: Vec<String> = if let Some(ref legacy) = detail.minecraft_arguments {
        legacy
            .split_whitespace()
            .map(|s| replace(s).to_string())
            .collect::<Vec<String>>()
    } else {
        resolve_arguments(&detail.arguments.game, &features, &os_info)
            .into_iter()
            .map(|s| replace(&s))
            .collect::<Vec<String>>()
    };

    let mut applied_resolution = false;
    if let Some(inst) = &instance_settings_for_launch {
        if let (Some(w), Some(h)) = (inst.resolution_width, inst.resolution_height) {
            game_args.push("--width".to_string());
            game_args.push(w.to_string());
            game_args.push("--height".to_string());
            game_args.push(h.to_string());
            applied_resolution = true;
        }
    }
    if !applied_resolution {
        if let (Some(w), Some(h)) = (settings.resolution_width, settings.resolution_height) {
            game_args.push("--width".to_string());
            game_args.push(w.to_string());
            game_args.push("--height".to_string());
            game_args.push(h.to_string());
        }
    }

    if !features.is_demo_user {
        game_args.retain(|a| a != "--demo");
    }
    game_args = strip_quick_play_game_args(game_args);
    game_args = strip_legacy_server_args(game_args);

    if let Some(addr) = &join_address {
        let use_quick_play = version_supports_quick_play_multiplayer(&version_id, &effective_jar_version);
        if use_quick_play {
            game_args.push("--quickPlayPath".to_string());
            game_args.push(quick_play_log.clone());
            game_args.push("--quickPlayMultiplayer".to_string());
            game_args.push(addr.clone());
        }

        let (host, port) = split_server_address(addr);
        game_args.push("--server".to_string());
        game_args.push(host);
        game_args.push("--port".to_string());
        game_args.push(port);
    }

    {
        let mut join_argv = Vec::new();
        let mut i = 0usize;
        while i < game_args.len() {
            let a = &game_args[i];
            if matches!(
                a.as_str(),
                "--quickPlayPath"
                    | "--quickPlaySingleplayer"
                    | "--quickPlayMultiplayer"
                    | "--quickPlayRealms"
                    | "--server"
                    | "--port"
            ) {
                join_argv.push(a.clone());
                if i + 1 < game_args.len() && !game_args[i + 1].starts_with("--") {
                    join_argv.push(game_args[i + 1].clone());
                    i += 2;
                    continue;
                }
            } else if a.starts_with("${quickPlay") {
                join_argv.push(a.clone());
            }
            i += 1;
        }
        eprintln!("[Launch] join quick-play/server args: {join_argv:?}");
        eprintln!(
            "[Launch] auth_mode={auth_mode} user_type={user_type} has_access_token={has_access_token} authlib_injector={authlib_injector}"
        );
        let dump = format!(
            "version_id={version_id}\nserver_address={server_address:?}\njoin_address={join_address:?}\ngame_dir={game_dir_str}\nauth_mode={auth_mode}\nuser_type={user_type}\nhas_access_token={has_access_token}\nauthlib_injector={authlib_injector}\nfeatures.has_quick_plays_support={}\nfeatures.is_quick_play_multiplayer={}\nfeatures.is_quick_play_singleplayer={}\n\ngame_args:\n{}\n",
            features.has_quick_plays_support,
            features.is_quick_play_multiplayer,
            features.is_quick_play_singleplayer,
            format_game_args_for_dump(&game_args),
        );

        let mut dump_paths = vec![game_dir.join("mc16-last-launch-args.txt")];
        if let Ok(data) = launcher_data_dir() {
            dump_paths.push(data.join("mc16-last-launch-args.txt"));
        }
        if let Ok(root) = game_root_dir() {
            let p = root.join("mc16-last-launch-args.txt");
            if !dump_paths.contains(&p) {
                dump_paths.push(p);
            }
        }
        for dump_path in &dump_paths {
            if let Err(e) = std::fs::write(dump_path, &dump) {
                eprintln!(
                    "[Launch] failed to write {}: {e}",
                    dump_path.display()
                );
            } else {
                eprintln!(
                    "[Launch] wrote argv dump → {}",
                    dump_path.display()
                );
            }
        }
        let dump_path = dump_paths
            .last()
            .cloned()
            .unwrap_or_else(|| game_dir.join("mc16-last-launch-args.txt"));
        let has_sp = game_args.iter().any(|a| a == "--quickPlaySingleplayer");
        let has_mp = game_args.iter().any(|a| a == "--quickPlayMultiplayer");
        let has_server = game_args.iter().any(|a| a == "--server");
        let has_placeholder = game_args.iter().any(|a| a.starts_with("${quickPlay"));
        if has_sp || has_placeholder {
            return Err(format!(
                "Внутренняя ошибка запуска: в argv остался singleplayer/placeholder quick-play \
                 (sp={has_sp}, placeholder={has_placeholder}). Смотрите {}",
                dump_path.display()
            ));
        }
        if join_address.is_some() && !has_mp && !has_server {
            return Err(format!(
                "Внутренняя ошибка запуска: нет --quickPlayMultiplayer/--server при join. Смотрите {}",
                dump_path.display()
            ));
        }
    }

    let mut java_settings = instance_settings_for_launch
        .as_ref()
        .and_then(|s| s.java_settings.clone())
        .unwrap_or_else(|| settings_service::load_java_settings(&app));

    let profile_has_own_java_settings = instance_settings_for_launch
        .as_ref()
        .and_then(|s| s.java_settings.as_ref())
        .is_some();
    let profile_ram_mb_in_file = instance_settings_for_launch
        .as_ref()
        .and_then(|s| s.ram_mb)
        .is_some();

    if profile_ram_mb_in_file {
        java_settings.xms = None;
        java_settings.xmx = None;
    } else if !profile_has_own_java_settings {
        java_settings.xms = None;
        java_settings.xmx = None;
    }

    let has_custom_java = java_settings
        .java_path
        .as_ref()
        .is_some_and(|s| !s.trim().is_empty());
    let (java_path, mut jvm_args) = build_java_command(
        default_java_path.clone(),
        &settings,
        instance_settings_for_launch.as_ref(),
        &java_settings,
        game_dir_str,
        natives_str,
        assets_str,
        &version_id,
        &classpath_str,
        jvm_args,
        if (is_forge || is_fabric) && !has_custom_java {
            Some(default_java_path)
        } else {
            None
        },
    )?;

    if let Some(actual_java_major) =
        crate::services::java::detect::detect_java_major_version(&java_path)
    {
        if actual_java_major < java_major {
            return Err(format!(
                "Для Minecraft {effective_jar_version} нужна Java {java_major}, а для запуска выбрана Java {actual_java_major}. \
                 Проверьте путь к Java в настройках — для Fabric/Forge используется встроенная Java Mojang."
            ));
        }
    }
    #[cfg(unix)]
    {
        if let Err(e) = crate::java_runtime::ensure_executable(&java_path) {
            eprintln!("[Launch] Warning: Failed to set execute permission for {}: {}", java_path.display(), e);
        } else {
            //Opt()
            //eprintln!("[Launch] Verified/Fixed execute permission for {}", java_path.display());
        }
    }
    if let Some(path) = &authlib_injector_path {
        let agent_path = path.to_string_lossy().replace('\\', "/");
        jvm_args.insert(
            0,
            format!("-javaagent:{}={}", agent_path, ELY_AUTHLIB_INJECTOR_TARGET),
        );
    }

    let removed_for_log = if is_forge {
        let (filtered, removed) = filter_forge_problematic_jvm_args(std::mem::take(&mut jvm_args));
        jvm_args = filtered;
        removed
    } else {
        Vec::new()
    };

    eprintln!("[Launch] Forge: {}, Java: {}", is_forge, java_path.display());
    if !removed_for_log.is_empty() {
        eprintln!(
            "[Launch] Forge: удалены проблемные JVM args: {:?}",
            removed_for_log
        );
    }
    log_to_console(
        &app,
        &format!("[Launch] Запуск {} ({})", version_id, java_path.display()),
    );

    let _jar_path_str = jar_path.to_str().ok_or("Путь к jar не в UTF-8")?;

    if let Err(e) = std::fs::metadata(&java_path) {
        if e.kind() == ErrorKind::PermissionDenied {
            return Err(format!(
                "Нет доступа к Java (os error 13): {}. Добавьте в исключения антивируса или запустите от имени администратора.",
                java_path.display()
            ));
        }
        return Err(format!("Java не найдена или недоступна: {} — {e}", java_path.display()));
    }
    if let Err(e) = std::fs::metadata(&game_dir_str) {
        if e.kind() == ErrorKind::PermissionDenied {
            return Err(format!(
                "Нет доступа к папке игры (os error 13): {}. Перенесите игру в доступную папку или выдайте разрешения приложению.",
                game_dir_str
            ));
        }
        return Err(format!("Папка игры недоступна: {} — {e}", game_dir_str));
    }

    if is_our_game_process_alive() {
        return Err(
            "Игра уже запущена из этого лаунчера. Сначала остановите её.".to_string(),
        );
    }
    GAME_PROCESS_PID.store(0, Ordering::SeqCst);

    if is_external_minecraft_running() {
        return Err(
            "Minecraft уже запущен (другой лаунчер или другой экземпляр). Закройте игру и попробуйте снова.".to_string(),
        );
    }

    let mut cmd = std::process::Command::new(&java_path);
    cmd.args(&jvm_args)
        .arg(&detail.main_class)
        .args(&game_args)
        .current_dir(game_dir_str)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "linux")]
    crate::services::game::runtime::apply_linux_display_env(&mut cmd);
    hide_console(&mut cmd);

    let play_start_time = SystemTime::now();

    let mut child = cmd.spawn().map_err(|e| {

        if e.kind() == ErrorKind::PermissionDenied {
            format!(
                "Отказано в доступе (os error 13). Java: {}, рабочая папка: {}",
                java_path.display(),
                game_dir_str
            )
        } else {
            format!("Не удалось запустить игру (установите Java): {e}")
        }
    })?;
    let spawned_pid = child.id();
    GAME_PROCESS_PID.store(spawned_pid as u64, Ordering::SeqCst);
    eprintln!("[Launch] PID: {spawned_pid}");

    if let Some(ref profile_id) = playtime_profile_id {
        if let Ok(last_played_at) = record_profile_last_played(profile_id) {
            if last_played_at > 0 {
                let payload = LastPlayedUpdatedPayload {
                    profile_id: profile_id.clone(),
                    last_played_at,
                };
                let _ = app.emit(EVENT_LAST_PLAYED_UPDATED, payload);
            }
        }
    }

    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        if !is_game_console_line_important(&text, "stdout") {
                            continue;
                        }
                        let payload = GameConsoleLinePayload {
                            line: text,
                            source: "stdout".to_string(),
                        };
                        let _ = app_clone.emit(EVENT_GAME_CONSOLE_LINE, payload);
                    }
                    Err(_) => break,
                }
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        if !is_game_console_line_important(&text, "stderr") {
                            continue;
                        }
                        let payload = GameConsoleLinePayload {
                            line: text,
                            source: "stderr".to_string(),
                        };
                        let _ = app_clone.emit(EVENT_GAME_CONSOLE_LINE, payload);
                    }
                    Err(_) => break,
                }
            }
        });
    }

    let profile_id_for_playtime = playtime_profile_id;
    let started_at = play_start_time;
    let app_clone_for_playtime = app.clone();
    std::thread::spawn(move || {
        let exit_code = child
            .wait()
            .ok()
            .and_then(|status| status.code());
        GAME_PROCESS_PID.store(0, Ordering::SeqCst);

        let _ = app_clone_for_playtime.emit(
            EVENT_GAME_PROCESS_EXITED,
            GameProcessExitedPayload { exit_code },
        );

        if let Some(profile_id) = profile_id_for_playtime {
            let delta_secs = started_at
                .elapsed()
                .map(|d| d.as_secs())
                .unwrap_or(0);
            if delta_secs > 0 {
                if add_play_time_seconds_to_profile(&profile_id, delta_secs).is_ok() {
                    let payload = PlaytimeUpdatedPayload {
                        profile_id,
                        delta_seconds: delta_secs,
                    };
                    let _ = app_clone_for_playtime.emit(
                        EVENT_PLAYTIME_UPDATED,
                        payload,
                    );
                }
            }
        }
    });

    if settings.close_launcher_on_game_start && join_address.is_none() {
        app.exit(0);
    }

    Ok(())
}
