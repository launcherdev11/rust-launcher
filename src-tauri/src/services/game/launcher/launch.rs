use std::io::{BufRead, BufReader, ErrorKind};
use std::sync::atomic::Ordering;
use std::time::SystemTime;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{AppHandle, Emitter};

use crate::app::paths::{game_root_dir, libraries_dir, versions_dir};
use crate::infra::http::http_client;
use crate::models::events::{GameConsoleLinePayload, PlaytimeUpdatedPayload, EVENT_GAME_CONSOLE_LINE, EVENT_PLAYTIME_UPDATED};
use crate::services::auth::ely::{ensure_authlib_injector, refresh_ely_session_internal, ELY_CLIENT_ID};
use crate::services::game::accounts::get_profile;
use crate::services::game::arguments::resolve_arguments;
use crate::services::game::core::{
    compare_version_like, current_os_name, download_text_with_retries, fabric_library_path,
    is_probably_native_jar_path, library_applies, os_info, parse_library_coords, resolve_native_artifact,
};
use crate::services::game::console::log_to_console;
use crate::services::game::profiles::{
    add_play_time_seconds_to_profile, load_selected_instance_settings, read_selected_profile_id, selected_instance_dir,
};
use crate::services::game::runtime::{
    build_java_command, ensure_forge_ignore_list_includes_vanilla_client_jar,
    ensure_forge_safe_opens, ensure_lwjgl_fallback_for_modern_versions, ensure_library_artifacts_present_for_launch,
    ensure_ms_minecraft_session, extract_natives_jar, filter_forge_problematic_jvm_args, offline_uuid_from_username,
    remove_add_opens_for_java_under_9, resolve_client_jar_path,
};
use crate::services::game::settings as settings_service;
use crate::services::game::state::{BMCL_MAVEN_BASE, DEFAULT_DOWNLOAD_RETRIES, GAME_PROCESS_PID};
use crate::services::game::version_types::*;
use crate::services::game::versions::get_mojang_version_url;

const ELY_AUTHLIB_INJECTOR_TARGET: &str = "ely.by";
#[tauri::command]
pub async fn launch_game(
    app: AppHandle,
    version_id: String,
    version_url: Option<String>,
) -> Result<(), String> {
    GAME_PROCESS_PID.store(0, Ordering::SeqCst);

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
    let features = GameFeatures::full();

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
        // Fabric пишет remapped jars в .fabric/remappedJars и не всегда создаёт дерево папок сам.
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
                    let _ = extract_natives_jar(&path, &natives_dir);
                }
            }
        }
        if let Some(nat) = resolve_native_artifact(lib, os_name) {
            let path = libs_root.join(&nat.path);
            if path.exists() {
                let _ = extract_natives_jar(&path, &natives_dir);
            }
        }
    }
    let mut has_natives_files = false;
    if let Ok(entries) = std::fs::read_dir(&natives_dir) {
        for entry in entries {
            if let Ok(entry) = entry {
                let p = entry.path();
                if p.is_file() {
                    has_natives_files = true;
                    break;
                }
                if p.is_dir() {
                    if std::fs::read_dir(&p).map(|mut it| it.next().is_some()).unwrap_or(false) {
                        has_natives_files = true;
                        break;
                    }
                }
            }
        }
    }
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
                        let _ = extract_natives_jar(&path, &natives_dir);
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
                let _ = extract_natives_jar(&path, &natives_dir);
            }
        }
    }
    let lwjgl_in_cp: Vec<String> = classpath
        .iter()
        .filter_map(|p| {
            let s = p.to_string_lossy().replace('\\', "/");
            if s.contains("/org/lwjgl/") {
                Some(s)
            } else {
                None
            }
        })
        .collect();
    log_to_console(&app, &format!("[Launch] LWJGL в classpath: {}", lwjgl_in_cp.join(" | ")));
    log_to_console(
        &app,
        &format!("[Launch] LWJGL natives dir: {}", natives_dir.display()),
    );
    let natives_str = natives_dir.to_str().unwrap_or("");
    let assets_root = root.join("assets");
    let assets_str = assets_root.to_str().unwrap_or("");
    let _ = std::fs::create_dir_all(&assets_root);

    if let Err(e) = refresh_ely_session_internal().await {
        return Err(e);
    }

    let profile = get_profile().unwrap_or_default();

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
        if let (Some(mc_name), Some(mc_uuid), Some(mc_access_token)) = (
            profile.mc_username.as_ref(),
            profile.mc_uuid.as_ref(),
            profile.mc_access_token.as_ref(),
        ) {
            if !mc_access_token.is_empty() {
                auth_name = mc_name.clone();
                auth_uuid = if mc_uuid.contains('-') {
                    mc_uuid.clone()
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
                    mc_uuid.clone()
                };
                auth_token = mc_access_token.clone();
                user_type = "msa".to_string();
                auth_is_mojang = true;
                auth_uuid_nodash = auth_uuid.replace('-', "");
                legacy_session = format!("token:{}:{}", auth_token, auth_uuid_nodash);
            }
        }
    }

    if !has_valid_ely_session
        && profile
        .mc_access_token
        .as_deref()
        .filter(|s| !s.is_empty())
        .is_none()
        && profile.ms_access_token.is_some()
    {
        if let Ok(Some((mc_name, mc_uuid, mc_access_token))) = ensure_ms_minecraft_session().await {
            auth_name = mc_name;
            if mc_uuid.contains('-') {
                auth_uuid = mc_uuid;
            } else if mc_uuid.len() == 32 {
                auth_uuid = format!(
                    "{}-{}-{}-{}-{}",
                    &mc_uuid[0..8],
                    &mc_uuid[8..12],
                    &mc_uuid[12..16],
                    &mc_uuid[16..20],
                    &mc_uuid[20..32]
                );
            } else {
                auth_uuid = mc_uuid;
            }
            auth_token = mc_access_token;
            user_type = "msa".to_string();
            //is_offline = false;
            auth_is_mojang = true;
            auth_uuid_nodash = auth_uuid.replace('-', "");
            legacy_session = format!("token:{}:{}", auth_token, auth_uuid_nodash);
        }
    }

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
        let mut major = jv.major_version;
        let mut component = jv.component.clone();
        if is_forge && !is_neoforge && major >= 21 {
            eprintln!(
                "[Launch] Forge: используем Java 17 вместо {} (обход бага Nashorn/ASM в Java 21)",
                major
            );
            major = 17;
            component = "java-runtime-gamma".to_string();
        }
        (major, component)
    } else {
        if is_forge && !is_neoforge {
            eprintln!("[Launch] Forge без java_version в manifest: используем Java 17");
            (17, "java-runtime-gamma".to_string())
        } else {
            (8, "jre-legacy".to_string())
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
            base.extend(
                resolve_arguments(&detail.arguments.jvm, &features, &os_info)
                    .into_iter()
                    .map(|s| replace(&s)),
            );
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

    if !features.is_quick_play {
        let mut filtered = Vec::with_capacity(game_args.len());
        let mut i = 0;
        while i < game_args.len() {
            let arg = &game_args[i];
            let is_quick_flag = matches!(
                arg.as_str(),
                "--quickPlayPath"
                    | "--quickPlaySingleplayer"
                    | "--quickPlayMultiplayer"
                    | "--quickPlayRealms"
            );
            if is_quick_flag {
                i += 1;
                if i < game_args.len() {
                    i += 1;
                }
                continue;
            } else {
                filtered.push(arg.clone());
                i += 1;
            }
        }
        game_args = filtered;
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
        if is_forge {
            Some(default_java_path)
        } else {
            None
        },
    )?;
    #[cfg(unix)]
    {
        if let Err(e) = crate::java_runtime::ensure_executable(&java_path) {
            eprintln!("[Launch] Warning: Failed to set execute permission for {}: {}", java_path.display(), e);
        } else {
            //Opt()
            //eprintln!("[Launch] Verified/Fixed execute permission for {}", java_path.display());
        }
    }
    if auth_token != "offline" && !auth_token.is_empty() && !auth_is_mojang {
        match ensure_authlib_injector().await {
            Ok(path) => {
                let agent_path = path.to_string_lossy().replace('\\', "/");
                eprintln!(
                    "[ElyAuth] Используется authlib-injector: {}",
                    agent_path
                );
                jvm_args.insert(
                    0,
                    format!("-javaagent:{}={}", agent_path, ELY_AUTHLIB_INJECTOR_TARGET),
                );
            }
            Err(e) => {
                eprintln!("[ElyAuth] Не удалось подготовить authlib-injector: {e}");
            }
        }
    }

    let removed_for_log = if is_forge {
        let (filtered, removed) = filter_forge_problematic_jvm_args(std::mem::take(&mut jvm_args));
        jvm_args = filtered;
        removed
    } else {
        Vec::new()
    };

    eprintln!("[Launch] Forge: {}, Java: {}", is_forge, java_path.display());
    eprintln!("[Launch] JVM args (final): {:?}", jvm_args);
    if !removed_for_log.is_empty() {
        eprintln!(
            "[Launch] Forge: удалены проблемные JVM args: {:?}",
            removed_for_log
        );
    }
    eprintln!("[Launch] Game args: {:?}", game_args);

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

    let mut cmd = std::process::Command::new(&java_path);
    cmd.args(&jvm_args)
        .arg(&detail.main_class)
        .args(&game_args)
        .current_dir(game_dir_str)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "linux")]
    crate::services::game::runtime::apply_linux_display_env(&mut cmd);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

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
    GAME_PROCESS_PID.store(child.id() as u64, Ordering::SeqCst);

    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
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

    if let Some(profile_id) = playtime_profile_id {
        let started_at = play_start_time;
        let mut child_for_wait = child;
        let app_clone_for_playtime = app.clone();
        std::thread::spawn(move || {
            let _ = child_for_wait.wait();
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
        });
    }

    if settings.close_launcher_on_game_start {
        app.exit(0);
    }

    Ok(())
}
