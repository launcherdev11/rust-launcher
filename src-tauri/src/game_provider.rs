use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use rand::distributions::Alphanumeric;
use rand::Rng;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sysinfo::{ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager};
use std::env;

use crate::ely_auth::{ensure_authlib_injector, refresh_ely_session_internal, ELY_CLIENT_ID};

fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
        .user_agent("16Launcher/1.0")
        .build()
        .unwrap_or_else(|_| Client::new())
}

const VERSION_MANIFEST_URL: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_META_LOADERS: &str = "https://meta.fabricmc.net/v2/versions/loader";
const FABRIC_META_PROFILE: &str = "https://meta.fabricmc.net/v2/versions/loader";
const FORGE_PROMOTIONS: &str =
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const FORGE_INSTALLER_BASE: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";

pub const EVENT_DOWNLOAD_PROGRESS: &str = "download-progress";
static CANCEL_DOWNLOAD: AtomicBool = AtomicBool::new(false);

pub const EVENT_GAME_CONSOLE_LINE: &str = "game-console-line";

pub const EVENT_MRPACK_IMPORT_PROGRESS: &str = "mrpack-import-progress";


#[derive(Debug, Serialize)]
struct XblUserAuthProperties {
    #[serde(rename = "AuthMethod")]
    auth_method: String,
    #[serde(rename = "SiteName")]
    site_name: String,
    #[serde(rename = "RpsTicket")]
    rps_ticket: String,
}

#[derive(Debug, Serialize)]
struct XblUserAuthRequest {
    #[serde(rename = "RelyingParty")]
    relying_party: String,
    #[serde(rename = "TokenType")]
    token_type: String,
    #[serde(rename = "Properties")]
    properties: XblUserAuthProperties,
}

#[derive(Debug, Deserialize)]
struct XblDisplayClaims {
    xui: Vec<XblXuiEntry>,
}

#[derive(Debug, Deserialize)]
struct XblXuiEntry {
    uhs: String,
}

#[derive(Debug, Deserialize)]
struct XblUserAuthResponse {
    Token: String,
    DisplayClaims: XblDisplayClaims,
}

#[derive(Debug, Serialize)]
struct XstsProperties {
    #[serde(rename = "SandboxId")]
    sandbox_id: String,
    #[serde(rename = "UserTokens")]
    user_tokens: Vec<String>,
}

#[derive(Debug, Serialize)]
struct XstsAuthRequest {
    #[serde(rename = "RelyingParty")]
    relying_party: String,
    #[serde(rename = "TokenType")]
    token_type: String,
    #[serde(rename = "Properties")]
    properties: XstsProperties,
}

#[derive(Debug, Deserialize)]
struct XstsAuthResponse {
    Token: String,
    DisplayClaims: XblDisplayClaims,
}

#[derive(Debug, Serialize)]
struct McLoginWithXboxRequest {
    identityToken: String,
}

#[derive(Debug, Deserialize)]
struct McLoginWithXboxResponse {
    access_token: String,
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct McProfile {
    id: String,
    name: String,
}


async fn ensure_ms_minecraft_session() -> Result<Option<(String, String, String)>, String> {
    let profile = get_profile().unwrap_or_default();
    let msa_token = match profile.ms_access_token.clone() {
        Some(t) if !t.is_empty() => t,
        _ => return Ok(None),
    };

    let client = http_client();

    let xbl_req = XblUserAuthRequest {
        relying_party: "http://auth.xboxlive.com".to_string(),
        token_type: "JWT".to_string(),
        properties: XblUserAuthProperties {
            auth_method: "RPS".to_string(),
            site_name: "user.auth.xboxlive.com".to_string(),
            rps_ticket: format!("d={}", msa_token),
        },
    };

    let xbl_resp = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&xbl_req)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса Xbox Live user/authenticate: {e}"))?;

    if !xbl_resp.status().is_success() {
        let status = xbl_resp.status();
        let text = xbl_resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!(
            "Xbox Live user/authenticate вернул ошибку {}: {}",
            status, text
        ));
    }

    let xbl_body: XblUserAuthResponse = xbl_resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора ответа Xbox Live user/authenticate: {e}"))?;

    let xbl_token = xbl_body.Token;
    let uhs = xbl_body
        .DisplayClaims
        .xui
        .get(0)
        .map(|x| x.uhs.clone())
        .ok_or_else(|| "Xbox Live ответ не содержит DisplayClaims.xui[0].uhs".to_string())?;

    let xsts_req = XstsAuthRequest {
        relying_party: "rp://api.minecraftservices.com/".to_string(),
        token_type: "JWT".to_string(),
        properties: XstsProperties {
            sandbox_id: "RETAIL".to_string(),
            user_tokens: vec![xbl_token],
        },
    };

    let xsts_resp = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&xsts_req)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса XSTS authorize: {e}"))?;

    if !xsts_resp.status().is_success() {
        let status = xsts_resp.status();
        let text = xsts_resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!("XSTS authorize вернул ошибку {}: {}", status, text));
    }

    let xsts_body: XstsAuthResponse = xsts_resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора ответа XSTS authorize: {e}"))?;

    let xsts_token = xsts_body.Token;

    let identity_token = format!("XBL3.0 x={};{}", uhs, xsts_token);
    let mc_login_req = McLoginWithXboxRequest { identityToken: identity_token };

    let mc_login_resp = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&mc_login_req)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса Minecraft login_with_xbox: {e}"))?;

    if !mc_login_resp.status().is_success() {
        let status = mc_login_resp.status();
        let text = mc_login_resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!(
            "Minecraft login_with_xbox вернул ошибку {}: {}",
            status, text
        ));
    }

    let mc_login_body: McLoginWithXboxResponse = mc_login_resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора ответа Minecraft login_with_xbox: {e}"))?;

    let mc_access_token = mc_login_body.access_token;

    let mc_profile_resp = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&mc_access_token)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса Minecraft profile: {e}"))?;

    if !mc_profile_resp.status().is_success() {
        let status = mc_profile_resp.status();
        let text = mc_profile_resp
            .text()
            .await
            .unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
        return Err(format!(
            "Minecraft profile вернул ошибку {}: {}",
            status, text
        ));
    }

    let mc_profile: McProfile = mc_profile_resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора ответа Minecraft profile: {e}"))?;

    Ok(Some((mc_profile.name, mc_profile.id, mc_access_token)))
}

#[derive(Debug, Serialize, Clone)]
pub struct MrpackImportProgressPayload {
    pub phase: String,
    pub current: Option<u32>,
    pub total: Option<u32>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct GameConsoleLinePayload {
    pub line: String,
    pub source: String,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct JavaSettings {
    pub use_custom_jvm_args: bool,
    ///явный путь к java/javaw.по дефолту офиц runtime Mojang.
    pub java_path: Option<String>,
    ///мин. объем памяти xms (1G\1024M).
    pub xms: Option<String>,
    ///макс объем памяти xmx (4G\4096M).
    pub xmx: Option<String>,
    ///доп JVM аргументы
    pub jvm_args: Option<String>,
    ///имя пресета ("balanced", "performance", "low_memory").
    pub preset: Option<String>,
}

impl Default for JavaSettings {
    fn default() -> Self {
        Self {
            use_custom_jvm_args: false,
            java_path: None,
            xms: None,
            xmx: None,
            jvm_args: None,
            preset: Some("balanced".to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct JavaRuntimeInfo {
    ///полный путь к java/javaw.
    pub path: String,
    ///строка с версией из `java -version`.
    pub version: String,
    ///краткое описание источника (PATH, JAVA_HOME, system, runtime и т.д.).
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct JavaArgsValidationResult {
    pub ok: bool,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub output: String,
}

fn replace_basic_placeholders(
    s: &str,
    classpath_str: &str,
    natives_str: &str,
    game_dir_str: &str,
    assets_str: &str,
    version_id: &str,
) -> String {
    s.replace("${classpath}", classpath_str)
        .replace("${natives}", natives_str)
        .replace("${gameDir}", game_dir_str)
        .replace("${assetsDir}", assets_str)
        .replace("${version}", version_id)
}

fn parse_memory_spec_to_mb(raw: &str) -> Option<u32> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    let (num_part, suffix) = s
        .chars()
        .partition::<String, _>(|c| c.is_ascii_digit());
    if num_part.is_empty() {
        return None;
    }
    let value: u64 = num_part.parse().ok()?;
    let mb = match suffix.to_ascii_lowercase().as_str() {
        "g" | "gb" => value.saturating_mul(1024),
        "m" | "mb" | "" => value,
        _ => return None,
    };
    if mb == 0 || mb > u32::MAX as u64 {
        return None;
    }
    Some(mb as u32)
}

fn format_mb_to_spec(mb: u32) -> String {
    if mb % 1024 == 0 {
        format!("{}G", mb / 1024)
    } else {
        format!("{mb}M")
    }
}

fn build_java_command(
    default_java_path: PathBuf,
    settings: &Settings,
    instance_settings_for_launch: Option<&InstanceSettings>,
    java_settings: &JavaSettings,
    game_dir_str: &str,
    natives_str: &str,
    assets_str: &str,
    version_id: &str,
    classpath_str: &str,
    mut jvm_args: Vec<String>,
) -> Result<(PathBuf, Vec<String>), String> {
    let mut java_path = if let Some(custom) = java_settings
        .java_path
        .as_ref()
        .and_then(|s| if s.trim().is_empty() { None } else { Some(s) })
    {
        PathBuf::from(custom)
    } else {
        default_java_path
    };

    #[cfg(target_os = "windows")]
    if settings.show_console_on_launch {
        if let Some(parent) = java_path.parent() {
            let candidate = parent.join("java.exe");
            if candidate.exists() {
                java_path = candidate;
            }
        }
    }

    let base_ram_mb = settings.ram_mb.max(1024);
    let mut xms_mb = (base_ram_mb / 2).max(512);
    let mut xmx_mb = base_ram_mb;

    if let Some(ref xms_str) = java_settings.xms {
        if let Some(mb) = parse_memory_spec_to_mb(xms_str) {
            xms_mb = mb;
        }
    }
    if let Some(ref xmx_str) = java_settings.xmx {
        if let Some(mb) = parse_memory_spec_to_mb(xmx_str) {
            xmx_mb = mb;
        }
    }

    if xms_mb > xmx_mb {
        std::mem::swap(&mut xms_mb, &mut xmx_mb);
    }

    //ограничение по физической памяти, не больше total_ram-2ГБ.
    let mut sys = System::new_all();
    sys.refresh_memory();
    let total_mb: u64 = sys.total_memory() / 1024;
    if total_mb > 0 {
        let reserve_mb: u64 = 2048;
        let hard_max = total_mb.saturating_sub(reserve_mb).max(1024);
        if (xmx_mb as u64) > hard_max {
            xmx_mb = hard_max as u32;
            if xms_mb > xmx_mb {
                xms_mb = xmx_mb;
            }
        }
    }

    let xms_flag = format!("-Xms{}", format_mb_to_spec(xms_mb));
    let xmx_flag = format!("-Xmx{}", format_mb_to_spec(xmx_mb));

    jvm_args.retain(|a| !a.starts_with("-Xms") && !a.starts_with("-Xmx"));
    jvm_args.insert(0, xmx_flag.clone());
    jvm_args.insert(0, xms_flag.clone());

    let replace_basic = |s: &str| -> String {
        replace_basic_placeholders(
            s,
            classpath_str,
            natives_str,
            game_dir_str,
            assets_str,
            version_id,
        )
    };

    let filter_tokens = |tokens: Vec<String>| -> Vec<String> {
        const FORBIDDEN_PREFIXES: &[&str] = &["-agentlib:", "-agentpath:", "-Xrun", "-Xdebug"];
        let mut out = Vec::new();
        let mut i = 0;
        while i < tokens.len() {
            let a = tokens[i].trim().to_string();
            if a.is_empty() {
                i += 1;
                continue;
            }

            if FORBIDDEN_PREFIXES.iter().any(|p| a.starts_with(p)) {
                eprintln!("[JavaSettings] Запрещённый флаг пропущен: {}", a);
                i += 1;
                continue;
            }

            if a == "-cp" || a == "-classpath" {
                eprintln!("[JavaSettings] Пользовательский -cp/-classpath игнорирован (обязательный classpath задаётся лаунчером).");
                i += 1;
                if i < tokens.len() {
                    i += 1;
                }
                continue;
            }
            if a == "-Djava.library.path" {
                eprintln!("[JavaSettings] Пользовательский -Djava.library.path игнорирован (обязательный natives задаётся лаунчером).");
                i += 1;
                if i < tokens.len() {
                    i += 1;
                }
                continue;
            }
            if a.starts_with("-Djava.library.path=") {
                eprintln!("[JavaSettings] Пользовательский -Djava.library.path=... игнорирован (обязательный natives задаётся лаунчером).");
                i += 1;
                continue;
            }

            out.push(replace_basic(&a));
            i += 1;
        }
        out
    };

    if let Some(inst) = instance_settings_for_launch {
        if let Some(extra) = &inst.jvm_args {
            let parts: Vec<String> = extra
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
            jvm_args.extend(filter_tokens(parts));
        }
    }

    if java_settings.use_custom_jvm_args {
        if let Some(extra) = &java_settings.jvm_args {
            let parts: Vec<String> = extra
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
            jvm_args.extend(filter_tokens(parts));
        }
    }

    Ok((java_path, jvm_args))
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub ram_mb: u32,
    pub show_console_on_launch: bool,
    pub close_launcher_on_game_start: bool,
    pub check_game_processes: bool,

    pub show_snapshots: bool,
    pub show_alpha_versions: bool,

    pub notify_new_update: bool,
    pub notify_new_message: bool,
    pub notify_system_message: bool,

    pub check_updates_on_start: bool,
    pub auto_install_updates: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ram_mb: 4096,
            show_console_on_launch: false,
            close_launcher_on_game_start: false,
            check_game_processes: true,
            show_snapshots: false,
            show_alpha_versions: false,
            notify_new_update: true,
            notify_new_message: true,
            notify_system_message: true,
            check_updates_on_start: true,
            auto_install_updates: false,
        }
    }
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("settings.json"))
}

fn java_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    match app.path().app_config_dir() {
        Ok(base) => Ok(base.join("16Launcher").join("java-settings.json")),
        Err(_) => Ok(launcher_data_dir()?.join("java-settings.json")),
    }
}

fn load_java_settings_from_path(path: &Path) -> JavaSettings {
    match std::fs::read_to_string(path).ok() {
        Some(text) => serde_json::from_str::<JavaSettings>(&text).unwrap_or_default(),
        None => JavaSettings::default(),
    }
}

fn save_java_settings_to_path(path: &Path, settings: &JavaSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку настроек Java: {e}"))?;
    }
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Ошибка сериализации настроек Java: {e}"))?;
    std::fs::write(path, text)
        .map_err(|e| format!("Не удалось записать файл настроек Java: {e}"))?;
    Ok(())
}

fn load_java_settings_internal(app: &AppHandle) -> JavaSettings {
    match java_settings_path(app) {
        Ok(path) => load_java_settings_from_path(&path),
        Err(_) => JavaSettings::default(),
    }
}

fn save_java_settings_internal(app: &AppHandle, settings: &JavaSettings) -> Result<(), String> {
    let path = java_settings_path(app)?;
    save_java_settings_to_path(&path, settings)
}

pub(crate) fn load_settings_from_disk() -> Settings {
    match settings_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
    {
        Some(text) => serde_json::from_str::<Settings>(&text).unwrap_or_default(),
        None => Settings::default(),
    }
}

#[tauri::command]
pub fn get_system_memory_gb() -> Result<u64, String> {
    let mut sys = System::new_all();
    sys.refresh_memory();
    let total_bytes = sys.total_memory();
    if total_bytes == 0 {
        return Err("Не удалось определить объём памяти системы".to_string());
    }
    let gb = total_bytes / (1024 * 1024 * 1024);
    Ok(gb.max(1))
}

fn save_settings_to_disk(settings: &Settings) -> Result<(), String> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку настроек: {e}"))?;
    }
    let text = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Ошибка сериализации настроек: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("Не удалось записать файл настроек: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_settings() -> Result<Settings, String> {
    Ok(load_settings_from_disk())
}

#[tauri::command]
pub fn set_settings(settings: Settings) -> Result<(), String> {
    save_settings_to_disk(&settings)
}

#[tauri::command]
pub fn get_java_settings(app: AppHandle) -> Result<JavaSettings, String> {
    Ok(load_java_settings_internal(&app))
}

#[tauri::command]
pub fn set_java_settings(app: AppHandle, settings: JavaSettings) -> Result<(), String> {
    save_java_settings_internal(&app, &settings)
}

fn effective_java_settings_for_profile_internal(
    app: &AppHandle,
    profile_id: Option<String>,
) -> JavaSettings {
    let id = match profile_id {
        Some(id) if !id.trim().is_empty() => id,
        _ => return load_java_settings_internal(app),
    };
    let path = match instance_settings_path(&id) {
        Ok(p) => p,
        Err(_) => return load_java_settings_internal(app),
    };
    if !path.exists() {
        return load_java_settings_internal(app);
    }
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return load_java_settings_internal(app),
    };
    let inst: InstanceSettings = match serde_json::from_str(&text) {
        Ok(s) => s,
        Err(_) => return load_java_settings_internal(app),
    };
    inst.java_settings
        .unwrap_or_else(|| load_java_settings_internal(app))
}

#[tauri::command]
pub fn get_profile_java_settings(app: AppHandle, id: String) -> Result<JavaSettings, String> {
    Ok(effective_java_settings_for_profile_internal(&app, Some(id)))
}

#[tauri::command]
pub fn set_profile_java_settings(
    id: String,
    settings: JavaSettings,
) -> Result<(), String> {
    let path = instance_settings_path(&id)?;
    let mut current = if path.exists() {
        let text =
            std::fs::read_to_string(&path).map_err(|e| format!("Ошибка чтения settings.json: {e}"))?;
        serde_json::from_str::<InstanceSettings>(&text)
            .map_err(|e| format!("Ошибка разбора settings.json: {e}"))?
    } else {
        InstanceSettings::default()
    };
    current.java_settings = Some(settings);
    let text = serde_json::to_string_pretty(&current)
        .map_err(|e| format!("Ошибка сериализации settings.json сборки: {e}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку для settings.json: {e}"))?;
    }
    std::fs::write(&path, text)
        .map_err(|e| format!("Не удалось записать settings.json: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_effective_settings(profile_id: Option<String>) -> Result<Settings, String> {
    Ok(effective_settings_for_profile_internal(profile_id))
}

fn is_javaw_process_running() -> bool {
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    for (_pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        if name.contains("javaw.exe")
            || name == "javaw"
            || name == "javaw.exe"
            || name.contains("java.exe")
            || name == "java"
            || name == "java.exe"
        {
            return true;
        }
    }
    false
}

#[tauri::command]
pub fn is_game_running_now() -> Result<bool, String> {
    Ok(is_javaw_process_running())
}

#[tauri::command]
pub fn cancel_download() {
    CANCEL_DOWNLOAD.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn reset_download_cancel() {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub async fn validate_java_args(
    java_path: Option<String>,
    args: String,
) -> Result<JavaArgsValidationResult, String> {
    let mut warnings = Vec::new();
    let mut errors = Vec::new();

    let java_exe = java_path
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "java".to_string());

    let mut cmd = std::process::Command::new(&java_exe);
    cmd.arg("-XshowSettings:vm");
    cmd.arg("-version");

    let user_args: Vec<String> = args
        .split_whitespace()
        .map(|s| s.to_string())
        .collect();

    const FORBIDDEN_PREFIXES: &[&str] = &[
        "-agentlib:",
        "-agentpath:",
        "-Xrun",
        "-Xdebug",
    ];
    const FORBIDDEN_EQUALS: &[&str] = &[
        "-XX:+DisableAttachMechanism",
    ];

    const EXPERIMENTAL_FLAGS: &[&str] = &[
        "-XX:+AggressiveOpts",
        "-XX:+UnlockExperimentalVMOptions",
    ];

    let mut filtered_args = Vec::new();
    for a in &user_args {
        let mut blocked = false;
        for p in FORBIDDEN_PREFIXES {
            if a.starts_with(p) {
                blocked = true;
                errors.push(format!("Флаг \"{a}\" не может быть использован по соображениям безопасности."));
                break;
            }
        }
        if blocked {
            continue;
        }
        for eq in FORBIDDEN_EQUALS {
            if a == eq {
                blocked = true;
                errors.push(format!("Флаг \"{a}\" не может быть использован по соображениям безопасности."));
                break;
            }
        }
        if blocked {
            continue;
        }

        for exp in EXPERIMENTAL_FLAGS {
            if a == exp {
                warnings.push(format!(
                    "Флаг \"{a}\" является экспериментальным и может вызывать нестабильность JVM."
                ));
            }
        }

        if let Some(rest) = a.strip_prefix("-Xmx") {
            if let Some(mb) = parse_memory_spec_to_mb(rest) {
                if mb > 64 * 1024 {
                    warnings.push("Указан очень большой Xmx (более 64ГБ). Убедитесь, что это соответствует объёму вашей ОЗУ.".to_string());
                }
            }
        }

        filtered_args.push(a.clone());
    }

    cmd.args(&filtered_args);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let output = cmd
        .output()
        .map_err(|e| format!("Не удалось запустить Java для проверки: {e}"))?;

    let mut combined = String::new();
    combined.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        if !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(&String::from_utf8_lossy(&output.stderr));
    }

    let ok = output.status.success() && errors.is_empty();
    if !output.status.success() {
        errors.push(format!("Команда Java завершилась с кодом: {}", output.status));
    }

    Ok(JavaArgsValidationResult {
        ok,
        warnings,
        errors,
        output: combined,
    })
}

fn detect_java_version(path: &str, source: &str) -> Option<JavaRuntimeInfo> {
    let mut cmd = std::process::Command::new(path);
    cmd.arg("-version");
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let output = cmd.output().ok()?;
    let text = if !output.stderr.is_empty() {
        String::from_utf8_lossy(&output.stderr).into_owned()
    } else {
        String::from_utf8_lossy(&output.stdout).into_owned()
    };
    let version_line = text.lines().next().unwrap_or("").trim();
    if version_line.is_empty() {
        return None;
    }
    Some(JavaRuntimeInfo {
        path: path.to_string(),
        version: version_line.to_string(),
        source: source.to_string(),
    })
}

#[tauri::command]
pub async fn detect_java_runtimes() -> Result<Vec<JavaRuntimeInfo>, String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut result = Vec::new();

    if let Ok(home) = env::var("JAVA_HOME") {
        let base = PathBuf::from(&home);
        let cand_javaw = base.join("bin").join(if cfg!(target_os = "windows") {
            "javaw.exe"
        } else {
            "java"
        });
        if cand_javaw.exists() {
            if let Some(info) =
                detect_java_version(cand_javaw.to_string_lossy().as_ref(), "JAVA_HOME")
            {
                if seen.insert(info.path.clone()) {
                    result.push(info);
                }
            }
        }
    }

    if let Some(info) = detect_java_version("java", "PATH") {
        if seen.insert(info.path.clone()) {
            result.push(info);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(info) = detect_java_version("javaw", "PATH") {
            if seen.insert(info.path.clone()) {
                result.push(info);
            }
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_spec_parsing_and_formatting() {
        assert_eq!(parse_memory_spec_to_mb("1024M"), Some(1024));
        assert_eq!(parse_memory_spec_to_mb("1G"), Some(1024));
        assert_eq!(parse_memory_spec_to_mb("2g"), Some(2048));
        assert_eq!(parse_memory_spec_to_mb(""), None);
        assert_eq!(parse_memory_spec_to_mb("abc"), None);

        assert_eq!(format_mb_to_spec(1024), "1G");
        assert_eq!(format_mb_to_spec(1536), "1536M");
    }

    #[test]
    fn placeholder_replacement_basic() {
        let s = "-Dcp=${classpath} -Dn=${natives} -Dg=${gameDir} -Da=${assetsDir} -Dv=${version}";
        let out = replace_basic_placeholders(
            s,
            "CP",
            "NAT",
            "GD",
            "AS",
            "1.20.1",
        );
        assert!(out.contains("CP"));
        assert!(out.contains("NAT"));
        assert!(out.contains("GD"));
        assert!(out.contains("AS"));
        assert!(out.contains("1.20.1"));
    }

    #[test]
    fn save_and_load_java_settings_roundtrip() {
        let tmp = std::env::temp_dir().join(format!(
            "java-settings-test-{}.json",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        let s = JavaSettings {
            use_custom_jvm_args: true,
            java_path: Some("C:\\Java\\bin\\javaw.exe".to_string()),
            xms: Some("1G".to_string()),
            xmx: Some("4G".to_string()),
            jvm_args: Some("-XX:+UseG1GC".to_string()),
            preset: Some("balanced".to_string()),
        };

        save_java_settings_to_path(&tmp, &s).unwrap();
        let loaded = load_java_settings_from_path(&tmp);
        assert_eq!(loaded.use_custom_jvm_args, true);
        assert_eq!(loaded.java_path.as_deref(), Some("C:\\Java\\bin\\javaw.exe"));
        assert_eq!(loaded.xms.as_deref(), Some("1G"));
        assert_eq!(loaded.xmx.as_deref(), Some("4G"));
        assert_eq!(loaded.jvm_args.as_deref(), Some("-XX:+UseG1GC"));
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn build_java_command_filters_dangerous_and_required_overrides() {
        let settings = Settings {
            ram_mb: 4096,
            show_console_on_launch: false,
            close_launcher_on_game_start: false,
            check_game_processes: true,
            show_snapshots: false,
            show_alpha_versions: false,
            notify_new_update: true,
            notify_new_message: true,
            notify_system_message: true,
            check_updates_on_start: true,
            auto_install_updates: false,
        };

        let java_settings = JavaSettings {
            use_custom_jvm_args: true,
            java_path: None,
            xms: Some("4G".to_string()),
            xmx: Some("2G".to_string()),
            jvm_args: Some("-agentlib:jdwp=transport=dt_socket -cp HACK -Djava.library.path=HACK -Dg=${gameDir}".to_string()),
            preset: None,
        };

        let base_jvm_args = vec![
            "-Djava.library.path=C:\\natives".to_string(),
            "-cp".to_string(),
            "CP".to_string(),
        ];

        let (_java, args) = build_java_command(
            PathBuf::from("java"),
            &settings,
            None,
            &java_settings,
            "C:\\game",
            "C:\\natives",
            "C:\\assets",
            "1.20.1",
            "CP",
            base_jvm_args,
        )
        .unwrap();

        assert!(args[0].starts_with("-Xms"));
        assert!(args[1].starts_with("-Xmx"));

        assert!(!args.iter().any(|a| a.starts_with("-agentlib:")));

        let cp_count = args.iter().filter(|a| a.as_str() == "-cp").count();
        assert_eq!(cp_count, 1);
        assert!(args.iter().any(|a| a.starts_with("-Djava.library.path=")));

        assert!(args.iter().any(|a| a.contains("C:\\game")));
    }
}

#[derive(Debug, Deserialize)]
struct VersionManifest {
    versions: Vec<ManifestVersion>,
}

#[derive(Debug, Deserialize)]
struct ManifestVersion {
    id: String,
    #[serde(rename = "type")]
    version_type: String,
    url: String,
    #[serde(rename = "releaseTime")]
    release_time: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct VersionSummary {
    pub id: String,
    pub version_type: String,
    pub url: String,
    pub release_time: String,
}

impl From<ManifestVersion> for VersionSummary {
    fn from(v: ManifestVersion) -> Self {
        Self {
            id: v.id,
            version_type: v.version_type,
            url: v.url,
            release_time: v.release_time,
        }
    }
}


#[derive(Debug, Deserialize)]
struct VersionDetail {
    #[serde(default)]
    downloads: Option<VersionDownloads>,
    #[serde(rename = "mainClass")]
    main_class: String,
    #[serde(default)]
    libraries: Vec<Library>,
    #[serde(default)]
    arguments: VersionArguments,
    #[serde(rename = "minecraftArguments", default)]
    minecraft_arguments: Option<String>,
    #[serde(rename = "assetIndex", default)]
    asset_index: Option<AssetIndexRef>,
    #[serde(default)]
    assets: Option<String>,
    #[serde(rename = "javaVersion", default)]
    java_version: Option<JavaVersionInfo>,
}

#[derive(Debug, Clone, Deserialize)]
struct JavaVersionInfo {
    component: String,
    #[serde(rename = "majorVersion")]
    major_version: u8,
}

#[derive(Debug, Deserialize)]
struct VersionDownloads {
    client: VersionDownloadInfo,
}

#[derive(Debug, Deserialize)]
struct VersionDownloadInfo {
    url: String,
    size: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct VersionArguments {
    #[serde(default)]
    jvm: Vec<ArgumentValue>,
    #[serde(default)]
    game: Vec<ArgumentValue>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum ArgumentValue {
    String(String),
    WithRules {
        rules: Vec<ArgRule>,
        value: serde_json::Value,
    },
}

#[derive(Debug, Serialize, Deserialize)]
struct ArgRule {
    #[serde(default)]
    action: String,
    #[serde(default)]
    os: Option<OsRule>,
    #[serde(default)]
    features: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OsRule {
    name: Option<String>,
    #[serde(rename = "arch", default)]
    arch: Option<String>,
}

#[derive(Debug, Clone)]
pub struct OsInfo {
    pub name: String,
    pub arch: String,
}

#[derive(Debug, Clone, Default)]
pub struct GameFeatures {
    pub is_demo_user: bool,
    pub has_custom_resolution: bool,
    pub is_quick_play: bool,
}

impl GameFeatures {
    pub fn full() -> Self {
        Self {
            is_demo_user: false,
            has_custom_resolution: false,
            is_quick_play: false,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct AssetIndexRef {
    id: String,
    url: String,
    #[serde(rename = "totalSize", default)]
    total_size: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct AssetIndexJson {
    #[serde(default)]
    objects: HashMap<String, AssetObject>,
}

#[derive(Debug, Deserialize)]
struct AssetObject {
    hash: String,
    size: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct Library {
    name: String,
    #[serde(default)]
    downloads: LibraryDownloads,
    #[serde(default)]
    rules: Vec<LibraryRule>,
    #[serde(default)]
    extract: Option<LibraryExtract>,
    #[serde(default)]
    natives: Option<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct LibraryDownloads {
    #[serde(default)]
    artifact: Option<LibraryArtifact>,
    #[serde(default)]
    classifiers: Option<HashMap<String, LibraryArtifact>>,
}

#[derive(Debug, Clone, Deserialize)]
struct LibraryArtifact {
    path: String,
    url: String,
    #[serde(default)]
    size: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct LibraryRule {
    action: String,
    #[serde(default)]
    os: Option<OsRule>,
}

#[derive(Debug, Clone, Deserialize)]
struct LibraryExtract {
    #[serde(default)]
    exclude: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct DownloadProgressPayload {
    pub version_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: f32,
}

#[derive(Debug, Deserialize)]
struct FabricLoaderInfo {
    version: String,
    #[serde(default)]
    stable: bool,
}

#[derive(Debug, Deserialize)]
struct FabricLoaderEntry {
    loader: FabricLoaderInfo,
}

#[derive(Debug, Deserialize)]
struct QuiltLoaderInfo {
    version: String,
    #[serde(default)]
    build: i32,
}

#[derive(Debug, Deserialize)]
struct QuiltLoaderEntry {
    loader: QuiltLoaderInfo,
}

#[derive(Debug, Serialize, Deserialize)]
struct FabricProfile {
    id: String,
    #[serde(rename = "inheritsFrom")]
    inherits_from: String,
    #[serde(rename = "mainClass")]
    main_class: String,
    #[serde(default)]
    arguments: VersionArguments,
    #[serde(default)]
    libraries: Vec<FabricProfileLibrary>,
}

#[derive(Debug, Serialize, Deserialize)]
struct FabricProfileLibrary {
    name: String,
    url: Option<String>,
    #[serde(default)]
    size: u64,
}

#[derive(Debug, Deserialize)]
struct ForgePromotions {
    promos: HashMap<String, String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ForgeVersionSummary {
    pub id: String,
    pub mc_version: String,
    pub forge_build: String,
    pub installer_url: String,
}

fn game_root_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("Не удалось получить системную папку данных")?;
    Ok(base.join("16Launcher").join("game"))
}

pub(crate) fn launcher_data_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("Не удалось получить системную папку данных")?;
    Ok(base.join("16Launcher"))
}

pub(crate) fn profile_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("profile.json"))
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct Profile {
    pub nickname: String,
    #[serde(default)]
    pub avatar_path: Option<String>,
    #[serde(default)]
    pub ely_username: Option<String>,
    #[serde(default)]
    pub ely_uuid: Option<String>,
    #[serde(default)]
    pub ely_access_token: Option<String>,
    #[serde(default)]
    pub ely_client_token: Option<String>,
    #[serde(default)]
    pub ely_refresh_token: Option<String>,
    #[serde(default)]
    pub ms_access_token: Option<String>,
    #[serde(default)]
    pub ms_refresh_token: Option<String>,
    #[serde(default)]
    pub ms_id_token: Option<String>,
    #[serde(default)]
    pub mc_uuid: Option<String>,
    #[serde(default)]
    pub mc_username: Option<String>,
    #[serde(default)]
    pub mc_access_token: Option<String>,
}

#[tauri::command]
pub fn get_profile() -> Result<Profile, String> {
    let path = profile_path()?;
    if !path.exists() {
        return Ok(Profile::default());
    }
    let s = std::fs::read_to_string(&path).map_err(|e| format!("Ошибка чтения профиля: {e}"))?;
    serde_json::from_str(&s).map_err(|e| format!("Ошибка разбора профиля: {e}"))
}

#[tauri::command]
pub fn set_profile(nickname: String, avatar_path: Option<String>) -> Result<(), String> {
    let path = profile_path()?;
    let mut profile = get_profile().unwrap_or_default();
    profile.nickname = nickname;
    profile.avatar_path = avatar_path;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    }
    let s = serde_json::to_string_pretty(&profile).map_err(|e| format!("Ошибка сериализации: {e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("Не удалось сохранить профиль: {e}"))?;
    Ok(())
}

pub(crate) fn save_full_profile(profile: &Profile) -> Result<(), String> {
    let path = profile_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    }
    let s =
        serde_json::to_string_pretty(profile).map_err(|e| format!("Ошибка сериализации: {e}"))?;
    std::fs::write(&path, s).map_err(|e| format!("Не удалось сохранить профиль: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn save_avatar(source_path: String) -> Result<String, String> {
    let path = std::path::Path::new(&source_path);
    if !path.exists() {
        return Err("Файл не найден.".to_string());
    }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("png");
    let data_dir = launcher_data_dir()?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    let dest = data_dir.join(format!("avatar.{}", ext));
    std::fs::copy(path, &dest).map_err(|e| format!("Не удалось скопировать файл: {e}"))?;
    let dest_str = dest.to_str().ok_or("Путь не в UTF-8")?.to_string();
    let mut profile = get_profile().unwrap_or_default();
    profile.avatar_path = Some(dest_str.clone());
    let pp = profile_path()?;
    let s = serde_json::to_string_pretty(&profile).map_err(|e| format!("{e}"))?;
    std::fs::write(&pp, s).map_err(|e| format!("{e}"))?;
    Ok(dest_str)
}


fn instances_root_dir() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("instances"))
}

fn instance_dir(id: &str) -> Result<PathBuf, String> {
    Ok(instances_root_dir()?.join(id))
}

pub(crate) fn instance_dir_for_id(id: &str) -> Result<PathBuf, String> {
    instance_dir(id)
}

fn instance_config_path(id: &str) -> Result<PathBuf, String> {
    Ok(instance_dir(id)?.join("config.json"))
}

fn instance_settings_path(id: &str) -> Result<PathBuf, String> {
    Ok(instance_dir(id)?.join("settings.json"))
}

fn selected_profile_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("selected_profile.json"))
}

fn generate_instance_id() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(12)
        .map(char::from)
        .collect()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InstanceConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon_path: Option<String>,
    pub game_version: String,
    pub loader: String,
    pub created_at: u64,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct InstanceSettings {
    pub ram_mb: Option<u32>,
    pub jvm_args: Option<String>,
    pub java_settings: Option<JavaSettings>,
    pub resolution_width: Option<u32>,
    pub resolution_height: Option<u32>,
    pub show_console_on_launch: Option<bool>,
    pub close_launcher_on_game_start: Option<bool>,
    pub check_game_processes: Option<bool>,
}

#[derive(Debug, Serialize, Clone)]
pub struct InstanceProfileSummary {
    pub id: String,
    pub name: String,
    pub icon_path: Option<String>,
    pub game_version: String,
    pub loader: String,
    pub created_at: u64,
    pub mods_count: u32,
    pub resourcepacks_count: u32,
    pub shaderpacks_count: u32,
    pub total_size_bytes: u64,
    pub directory: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct SelectedProfileFile {
    pub id: String,
}

fn dir_size_and_count(root: &Path) -> (u64, u32) {
    if !root.exists() {
        return (0, 0);
    }
    let mut total_bytes = 0u64;
    let mut files_count = 0u32;
    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        if let Ok(entries) = std::fs::read_dir(&path) {
            for entry in entries.flatten() {
                let p = entry.path();
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        total_bytes = total_bytes.saturating_add(meta.len());
                        files_count = files_count.saturating_add(1);
                    } else if meta.is_dir() {
                        stack.push(p);
                    }
                }
            }
        }
    }
    (total_bytes, files_count)
}

fn load_all_instance_profiles_internal() -> Result<Vec<InstanceProfileSummary>, String> {
    let root = instances_root_dir()?;
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for entry in std::fs::read_dir(&root)
        .map_err(|e| format!("Ошибка чтения папки instances: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Ошибка чтения entry: {e}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let id = match path.file_name().and_then(|n| n.to_str()) {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => continue,
        };
        let config_path = path.join("config.json");
        if !config_path.exists() {
            continue;
        }
        let cfg_text = match std::fs::read_to_string(&config_path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let cfg: InstanceConfig = match serde_json::from_str(&cfg_text) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mods_dir = path.join("mods");
        let res_dir = path.join("resourcepacks");
        let shader_dir = path.join("shaderpacks");

        let (mods_size, mods_count) = dir_size_and_count(&mods_dir);
        let (res_size, res_count) = dir_size_and_count(&res_dir);
        let (shader_size, shader_count) = dir_size_and_count(&shader_dir);

        let total_size_bytes = mods_size
            .saturating_add(res_size)
            .saturating_add(shader_size);

        let directory = match path.to_str() {
            Some(s) => s.to_string(),
            None => continue,
        };

        out.push(InstanceProfileSummary {
            id: cfg.id,
            name: cfg.name,
            icon_path: cfg.icon_path,
            game_version: cfg.game_version,
            loader: cfg.loader,
            created_at: cfg.created_at,
            mods_count,
            resourcepacks_count: res_count,
            shaderpacks_count: shader_count,
            total_size_bytes,
            directory,
        });
    }

    out.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(out)
}

fn read_selected_profile_id_internal() -> Option<String> {
    let path = selected_profile_path().ok()?;
    let text = std::fs::read_to_string(path).ok()?;
    let obj: SelectedProfileFile = serde_json::from_str(&text).ok()?;
    if obj.id.trim().is_empty() {
        None
    } else {
        Some(obj.id)
    }
}

fn load_selected_instance_settings_internal() -> Result<Option<(String, InstanceSettings)>, String> {
    let id = match read_selected_profile_id_internal() {
        Some(id) => id,
        None => return Ok(None),
    };
    let path = instance_settings_path(&id)?;
    let settings = if path.exists() {
        let text =
            std::fs::read_to_string(&path).map_err(|e| format!("Ошибка чтения настроек сборки: {e}"))?;
        serde_json::from_str::<InstanceSettings>(&text)
            .map_err(|e| format!("Ошибка разбора настроек сборки: {e}"))?
    } else {
        InstanceSettings::default()
    };
    Ok(Some((id, settings)))
}

fn effective_settings_for_launch() -> Settings {
    effective_settings_for_profile_internal(read_selected_profile_id_internal())
}

fn effective_settings_for_profile_internal(profile_id: Option<String>) -> Settings {
    let base = load_settings_from_disk();
    let id = match profile_id {
        Some(id) if !id.trim().is_empty() => id,
        _ => return base,
    };
    let path = match instance_settings_path(&id) {
        Ok(p) => p,
        Err(_) => return base,
    };
    let inst: InstanceSettings = if path.exists() {
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => return base,
        };
        match serde_json::from_str(&text) {
            Ok(s) => s,
            Err(_) => return base,
        }
    } else {
        return base;
    };
    let mut s = base;
    if let Some(ram) = inst.ram_mb {
        s.ram_mb = ram.max(512);
    }
    if let Some(v) = inst.show_console_on_launch {
        s.show_console_on_launch = v;
    }
    if let Some(v) = inst.close_launcher_on_game_start {
        s.close_launcher_on_game_start = v;
    }
    if let Some(v) = inst.check_game_processes {
        s.check_game_processes = v;
    }
    s
}

fn selected_instance_dir_internal() -> Option<PathBuf> {
    let id = read_selected_profile_id_internal()?;
    let dir = instance_dir(&id).ok()?;
    if dir.exists() {
        Some(dir)
    } else {
        None
    }
}

#[tauri::command]
pub fn get_profiles() -> Result<Vec<InstanceProfileSummary>, String> {
    load_all_instance_profiles_internal()
}

fn create_profile_internal(
    name: String,
    game_version: String,
    loader: String,
    icon_source_path: Option<String>,
) -> Result<InstanceProfileSummary, String> {
    let root = instances_root_dir()?;
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Не удалось создать папку instances: {e}"))?;

    let mut id = generate_instance_id();
    while instance_dir(&id)?.exists() {
        id = generate_instance_id();
    }
    let dir = instance_dir(&id)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Не удалось создать папку сборки: {e}"))?;

    for sub in ["mods", "resourcepacks", "shaderpacks"] {
        let subdir = dir.join(sub);
        std::fs::create_dir_all(&subdir)
            .map_err(|e| format!("Не удалось создать папку '{sub}': {e}"))?;
    }

    let mut icon_path: Option<String> = None;
    if let Some(src) = icon_source_path {
        let src_path = PathBuf::from(&src);
        if src_path.exists() {
            let ext = src_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("png");
            let dest = dir.join(format!("icon.{ext}"));
            std::fs::copy(&src_path, &dest)
                .map_err(|e| format!("Не удалось скопировать иконку сборки: {e}"))?;
            icon_path = dest
                .to_str()
                .map(|s| s.to_string())
                .or(icon_path);
        }
    }

    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_secs(0))
        .as_secs();

    let cfg = InstanceConfig {
        id: id.clone(),
        name: name.clone(),
        icon_path: icon_path.clone(),
        game_version: game_version.clone(),
        loader: loader.clone(),
        created_at,
    };

    let cfg_path = instance_config_path(&id)?;
    let cfg_text = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("Ошибка сериализации config.json сборки: {e}"))?;
    if let Some(parent) = cfg_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку для config.json: {e}"))?;
    }
    std::fs::write(&cfg_path, cfg_text)
        .map_err(|e| format!("Не удалось записать config.json сборки: {e}"))?;

    let settings_path = instance_settings_path(&id)?;
    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку для settings.json: {e}"))?;
    }
    let settings = InstanceSettings::default();
    let settings_text = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Ошибка сериализации settings.json сборки: {e}"))?;
    std::fs::write(&settings_path, settings_text)
        .map_err(|e| format!("Не удалось записать settings.json сборки: {e}"))?;

    let (mods_size, mods_count) = dir_size_and_count(&dir.join("mods"));
    let (res_size, res_count) = dir_size_and_count(&dir.join("resourcepacks"));
    let (shader_size, shader_count) = dir_size_and_count(&dir.join("shaderpacks"));
    let total_size_bytes = mods_size
        .saturating_add(res_size)
        .saturating_add(shader_size);

    let directory = dir
        .to_str()
        .ok_or("Путь к папке сборки не в UTF-8")?
        .to_string();

    Ok(InstanceProfileSummary {
        id,
        name,
        icon_path,
        game_version,
        loader,
        created_at,
        mods_count,
        resourcepacks_count: res_count,
        shaderpacks_count: shader_count,
        total_size_bytes,
        directory,
    })
}

#[tauri::command]
pub fn create_profile(
    name: String,
    game_version: String,
    loader: String,
    icon_source_path: Option<String>,
) -> Result<InstanceProfileSummary, String> {
    create_profile_internal(name, game_version, loader, icon_source_path)
}

#[tauri::command]
pub fn set_selected_profile(id: Option<String>) -> Result<(), String> {
    let path = selected_profile_path()?;
    if let Some(id) = id {
        if id.trim().is_empty() {
            if path.exists() {
                std::fs::remove_file(&path)
                    .map_err(|e| format!("Не удалось удалить selected_profile.json: {e}"))?;
            }
            return Ok(());
        }
        let obj = SelectedProfileFile { id };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Не удалось создать папку для selected_profile.json: {e}"))?;
        }
        let text = serde_json::to_string_pretty(&obj)
            .map_err(|e| format!("Ошибка сериализации selected_profile.json: {e}"))?;
        std::fs::write(&path, text)
            .map_err(|e| format!("Не удалось записать selected_profile.json: {e}"))?;
    } else if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Не удалось удалить selected_profile.json: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_profile(id: String) -> Result<(), String> {
    let dir = instance_dir(&id)?;
    if !dir.exists() {
        return Err("Папка сборки не найдена".to_string());
    }

    if let Some(selected_id) = read_selected_profile_id_internal() {
        if selected_id == id {
            set_selected_profile(None)?;
        }
    }

    std::fs::remove_dir_all(&dir)
        .map_err(|e| format!("Не удалось удалить папку сборки {:?}: {e}", dir))?;

    Ok(())
}

#[tauri::command]
pub fn get_selected_profile() -> Result<Option<InstanceProfileSummary>, String> {
    let selected_id = match read_selected_profile_id_internal() {
        Some(id) => id,
        None => return Ok(None),
    };
    let all = load_all_instance_profiles_internal()?;
    Ok(all.into_iter().find(|p| p.id == selected_id))
}

#[tauri::command]
pub fn update_profile_settings(id: String, patch: InstanceSettings) -> Result<(), String> {
    let path = instance_settings_path(&id)?;
    let mut current = if path.exists() {
        let text =
            std::fs::read_to_string(&path).map_err(|e| format!("Ошибка чтения settings.json: {e}"))?;
        serde_json::from_str::<InstanceSettings>(&text)
            .map_err(|e| format!("Ошибка разбора settings.json: {e}"))?
    } else {
        InstanceSettings::default()
    };

    if let Some(v) = patch.ram_mb {
        current.ram_mb = Some(v);
    }
    if let Some(v) = patch.jvm_args {
        current.jvm_args = Some(v);
    }
    if let Some(v) = patch.java_settings {
        current.java_settings = Some(v);
    }
    if let Some(v) = patch.resolution_width {
        current.resolution_width = Some(v);
    }
    if let Some(v) = patch.resolution_height {
        current.resolution_height = Some(v);
    }
    if let Some(v) = patch.show_console_on_launch {
        current.show_console_on_launch = Some(v);
    }
    if let Some(v) = patch.close_launcher_on_game_start {
        current.close_launcher_on_game_start = Some(v);
    }
    if let Some(v) = patch.check_game_processes {
        current.check_game_processes = Some(v);
    }

    let text = serde_json::to_string_pretty(&current)
        .map_err(|e| format!("Ошибка сериализации settings.json сборки: {e}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку для settings.json: {e}"))?;
    }
    std::fs::write(&path, text)
        .map_err(|e| format!("Не удалось записать settings.json: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn rename_profile(id: String, name: String) -> Result<(), String> {
    let cfg_path = instance_config_path(&id)?;
    if !cfg_path.exists() {
        return Err("config.json сборки не найден".to_string());
    }
    let text = std::fs::read_to_string(&cfg_path)
        .map_err(|e| format!("Ошибка чтения config.json сборки: {e}"))?;
    let mut cfg: InstanceConfig =
        serde_json::from_str(&text).map_err(|e| format!("Ошибка разбора config.json: {e}"))?;
    cfg.name = name;
    let new_text = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("Ошибка сериализации config.json: {e}"))?;
    std::fs::write(&cfg_path, new_text)
        .map_err(|e| format!("Не удалось записать config.json сборки: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn delete_item(id: String, category: String, filename: String) -> Result<(), String> {
    let dir = instance_dir(&id)?;
    if !dir.exists() {
        return Err("Папка сборки не найдена".to_string());
    }
    let subdir = match category.as_str() {
        "mod" | "mods" => "mods",
        "resourcepack" | "resourcepacks" => "resourcepacks",
        "shader" | "shaderpack" | "shaderpacks" => "shaderpacks",
        other => {
            return Err(format!(
                "Неизвестная категория контента: {other}. Ожидается mod, resourcepack или shader."
            ))
        }
    };
    let target = dir.join(subdir).join(&filename);
    if target.exists() {
        std::fs::remove_file(&target)
            .map_err(|e| format!("Не удалось удалить файл {:?}: {e}", target))?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_profile_items(id: String, category: String) -> Result<Vec<String>, String> {
    let dir = instance_dir(&id)?;
    if !dir.exists() {
        return Err("Папка сборки не найдена".to_string());
    }
    let subdir = match category.as_str() {
        "mod" | "mods" => "mods",
        "resourcepack" | "resourcepacks" => "resourcepacks",
        "shader" | "shaderpack" | "shaderpacks" => "shaderpacks",
        other => {
            return Err(format!(
                "Неизвестная категория контента: {other}. Ожидается mod, resourcepack или shader."
            ))
        }
    };
    let target_dir = dir.join(subdir);
    if !target_dir.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&target_dir)
        .map_err(|e| format!("Ошибка чтения папки сборки: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Ошибка чтения файла сборки: {e}"))?;
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                files.push(name.to_string());
            }
        }
    }
    files.sort();
    Ok(files)
}

#[tauri::command]
pub async fn add_profile_files(
    id: String,
    category: String,
    files: Vec<String>,
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    let root = instance_dir(&id)?;
    if !root.exists() {
        return Err("Папка сборки не найдена".to_string());
    }

    let subdir = match category.as_str() {
        "mod" | "mods" => "mods",
        "resourcepack" | "resourcepacks" => "resourcepacks",
        "shader" | "shaderpack" | "shaderpacks" => "shaderpacks",
        other => {
            return Err(format!(
                "Неизвестная категория контента сборки: {other}. Ожидается mod, resourcepack или shader."
            ))
        }
    };

    let target_dir = root.join(subdir);
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку '{subdir}' для сборки: {e}"))?;

    for src in files {
        let src_path = PathBuf::from(&src);
        if !src_path.exists() {
            continue;
        }
        let file_name = match src_path.file_name().and_then(|n| n.to_str()) {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => continue,
        };
        let dest_path = target_dir.join(&file_name);
        if let Some(parent) = dest_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Не удалось создать папку для файла сборки: {e}"))?;
        }
        tokio::fs::copy(&src_path, &dest_path)
            .await
            .map_err(|e| format!("Не удалось скопировать файл сборки {:?}: {e}", src_path))?;
    }

    Ok(())
}

#[derive(Debug, Deserialize)]
struct MrpackFileEntry {
    path: String,
    #[serde(default)]
    downloads: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct MrpackIndex {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    dependencies: std::collections::HashMap<String, String>,
    #[serde(default)]
    files: Vec<MrpackFileEntry>,
}

fn mrpack_game_version_and_loader(deps: &std::collections::HashMap<String, String>) -> (String, String) {
    let game = deps
        .get("minecraft")
        .map(String::as_str)
        .unwrap_or("1.20.1");
    let loader = if deps.contains_key("fabric-loader") {
        "fabric"
    } else if deps.contains_key("quilt-loader") {
        "quilt"
    } else if deps.contains_key("neoforge") || deps.contains_key("neo-forge") {
        "neoforge"
    } else if deps.contains_key("forge") {
        "forge"
    } else {
        "vanilla"
    };
    (game.to_string(), loader.to_string())
}

fn resolve_file_path(path_or_uri: &str) -> PathBuf {
    let s = path_or_uri.trim();
    if s.starts_with("file:///") {
        let path_part = s.strip_prefix("file:///").unwrap_or(s);
        PathBuf::from(path_part.replace('/', std::path::MAIN_SEPARATOR_STR))
    } else if s.starts_with("file://") {
        let path_part = s.strip_prefix("file://").unwrap_or(s);
        PathBuf::from(path_part.replace('/', std::path::MAIN_SEPARATOR_STR))
    } else {
        PathBuf::from(s)
    }
}

#[tauri::command]
pub async fn import_mrpack(
    app: AppHandle,
    profile_id: String,
    mrpack_path: String,
) -> Result<(), String> {
    let _ = app.emit(
        EVENT_MRPACK_IMPORT_PROGRESS,
        MrpackImportProgressPayload {
            phase: "start".to_string(),
            current: None,
            total: None,
            message: None,
        },
    );

    let dir = instance_dir(&profile_id)?;
    if !dir.exists() {
        return Err("Папка сборки не найдена".to_string());
    }

    let pack_path = resolve_file_path(&mrpack_path);
    if !pack_path.exists() {
        return Err("Файл .mrpack не найден".to_string());
    }

    let file = std::fs::File::open(&pack_path)
        .map_err(|e| format!("Не удалось открыть .mrpack: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Ошибка чтения .mrpack: {e}"))?;

    let _ = app.emit(
        EVENT_MRPACK_IMPORT_PROGRESS,
        MrpackImportProgressPayload {
            phase: "overrides".to_string(),
            current: None,
            total: None,
            message: None,
        },
    );

    let mut index_json = None;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Ошибка чтения entry .mrpack: {e}"))?;
        let name = entry.name().to_string();
        if name == "modrinth.index.json" {
            let mut buf = String::new();
            use std::io::Read;
            entry
                .read_to_string(&mut buf)
                .map_err(|e| format!("Ошибка чтения modrinth.index.json: {e}"))?;
            index_json = Some(buf);
        } else if name.starts_with("overrides/") && !name.ends_with('/') {
            let rel = &name["overrides/".len()..];
            if rel.is_empty() {
                continue;
            }
            let dest = dir.join(rel);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Не удалось создать папку override: {e}"))?;
            }
            let mut out =
                std::fs::File::create(&dest).map_err(|e| format!("Не удалось создать файл override: {e}"))?;
            use std::io::Write;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Ошибка распаковки override: {e}"))?;
        }
    }

    let Some(index_text) = index_json else {
        return Ok(());
    };

    let index: MrpackIndex =
        serde_json::from_str(&index_text).map_err(|e| format!("Ошибка разбора modrinth.index.json: {e}"))?;

    let files_to_download: Vec<_> = index
        .files
        .iter()
        .filter(|f| !f.downloads.is_empty() && !f.downloads[0].is_empty())
        .collect();
    let total = files_to_download.len() as u32;

    let _ = app.emit(
        EVENT_MRPACK_IMPORT_PROGRESS,
        MrpackImportProgressPayload {
            phase: "files".to_string(),
            current: Some(0),
            total: Some(total),
            message: None,
        },
    );

    let client = http_client();

    let mut current_file: u32 = 0;
    for f in index.files.iter() {
        if f.downloads.is_empty() {
            continue;
        }
        let url = &f.downloads[0];
        if url.is_empty() {
            continue;
        }
        current_file += 1;
        let filename = f.path.rsplit('/').next().unwrap_or(&f.path).to_string();
        let _ = app.emit(
            EVENT_MRPACK_IMPORT_PROGRESS,
            MrpackImportProgressPayload {
                phase: "files".to_string(),
                current: Some(current_file),
                total: Some(total),
                message: Some(filename),
            },
        );
        let dest = dir.join(&f.path);
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Не удалось создать папку для файла сборки: {e}"))?;
        }
        let resp = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Ошибка скачивания файла из Modrinth: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "Modrinth вернул ошибку {} при скачивании {}",
                resp.status(),
                url
            ));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Ошибка чтения тела ответа Modrinth: {e}"))?;
        tokio::fs::write(&dest, &bytes)
            .await
            .map_err(|e| format!("Не удалось сохранить файл сборки: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn import_mrpack_as_new_profile(
    app: AppHandle,
    mrpack_path: String,
) -> Result<InstanceProfileSummary, String> {
    let _ = app.emit(
        EVENT_MRPACK_IMPORT_PROGRESS,
        MrpackImportProgressPayload {
            phase: "start".to_string(),
            current: None,
            total: None,
            message: None,
        },
    );

    let pack_path = resolve_file_path(&mrpack_path);
    if !pack_path.exists() {
        return Err("Файл .mrpack не найден".to_string());
    }

    let file = std::fs::File::open(&pack_path)
        .map_err(|e| format!("Не удалось открыть .mrpack: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Ошибка чтения .mrpack: {e}"))?;

    let mut index_json = None;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Ошибка чтения entry .mrpack: {e}"))?;
        if entry.name() == "modrinth.index.json" {
            let mut buf = String::new();
            use std::io::Read;
            entry
                .read_to_string(&mut buf)
                .map_err(|e| format!("Ошибка чтения modrinth.index.json: {e}"))?;
            index_json = Some(buf);
            break;
        }
    }

    let index_text = index_json.ok_or("В .mrpack нет modrinth.index.json".to_string())?;
    let index: MrpackIndex =
        serde_json::from_str(&index_text).map_err(|e| format!("Ошибка разбора modrinth.index.json: {e}"))?;

    let (game_version, loader) = mrpack_game_version_and_loader(&index.dependencies);
    let name = index
        .name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            pack_path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Modpack")
                .to_string()
        });

    let profile = create_profile_internal(name, game_version, loader, None)?;
    let dir = instance_dir(&profile.id)?;

    let _ = app.emit(
        EVENT_MRPACK_IMPORT_PROGRESS,
        MrpackImportProgressPayload {
            phase: "overrides".to_string(),
            current: None,
            total: None,
            message: None,
        },
    );

    let file2 = std::fs::File::open(&pack_path)
        .map_err(|e| format!("Не удалось открыть .mrpack: {e}"))?;
    let mut archive2 =
        zip::ZipArchive::new(file2).map_err(|e| format!("Ошибка чтения .mrpack: {e}"))?;

    for i in 0..archive2.len() {
        let mut entry = archive2
            .by_index(i)
            .map_err(|e| format!("Ошибка чтения entry .mrpack: {e}"))?;
        let name_entry = entry.name().to_string();
        if name_entry.starts_with("overrides/") && !name_entry.ends_with('/') {
            let rel = &name_entry["overrides/".len()..];
            if rel.is_empty() {
                continue;
            }
            let dest = dir.join(rel);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Не удалось создать папку override: {e}"))?;
            }
            let mut out =
                std::fs::File::create(&dest).map_err(|e| format!("Не удалось создать файл override: {e}"))?;
            use std::io::Read;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Ошибка распаковки override: {e}"))?;
        }
    }

    let files_to_download: Vec<_> = index
        .files
        .iter()
        .filter(|f| !f.downloads.is_empty() && !f.downloads[0].is_empty())
        .collect();
    let total = files_to_download.len() as u32;

    let _ = app.emit(
        EVENT_MRPACK_IMPORT_PROGRESS,
        MrpackImportProgressPayload {
            phase: "files".to_string(),
            current: Some(0),
            total: Some(total),
            message: None,
        },
    );

    let client = http_client();
    let mut current_file: u32 = 0;
    for f in index.files.iter() {
        if f.downloads.is_empty() || f.downloads[0].is_empty() {
            continue;
        }
        current_file += 1;
        let url = &f.downloads[0];
        let filename = f.path.rsplit('/').next().unwrap_or(&f.path).to_string();
        let _ = app.emit(
            EVENT_MRPACK_IMPORT_PROGRESS,
            MrpackImportProgressPayload {
                phase: "files".to_string(),
                current: Some(current_file),
                total: Some(total),
                message: Some(filename),
            },
        );
        let dest = dir.join(&f.path);
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Не удалось создать папку для файла сборки: {e}"))?;
        }
        let resp = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Ошибка скачивания файла из Modrinth: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "Modrinth вернул ошибку {} при скачивании {}",
                resp.status(),
                url
            ));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Ошибка чтения тела ответа Modrinth: {e}"))?;
        tokio::fs::write(&dest, &bytes)
            .await
            .map_err(|e| format!("Не удалось сохранить файл сборки: {e}"))?;
    }

    let (mods_size, mods_count) = dir_size_and_count(&dir.join("mods"));
    let (res_size, res_count) = dir_size_and_count(&dir.join("resourcepacks"));
    let (shader_size, shader_count) = dir_size_and_count(&dir.join("shaderpacks"));
    let total_size_bytes = mods_size
        .saturating_add(res_size)
        .saturating_add(shader_size);
    let directory = dir
        .to_str()
        .ok_or("Путь к папке сборки не в UTF-8")?
        .to_string();

    Ok(InstanceProfileSummary {
        id: profile.id,
        name: profile.name,
        icon_path: profile.icon_path,
        game_version: profile.game_version,
        loader: profile.loader,
        created_at: profile.created_at,
        mods_count,
        resourcepacks_count: res_count,
        shaderpacks_count: shader_count,
        total_size_bytes,
        directory,
    })
}

fn libraries_dir() -> Result<PathBuf, String> {
    Ok(game_root_dir()?.join("libraries"))
}

fn versions_dir() -> Result<PathBuf, String> {
    Ok(game_root_dir()?.join("versions"))
}

fn fabric_library_path(name: &str) -> String {
    let parts: Vec<&str> = name.splitn(3, ':').collect();
    if parts.len() < 3 {
        return format!("{name}.jar");
    }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    format!("{group}/{artifact}/{version}/{artifact}-{version}.jar")
}

fn current_os_name() -> &'static str {
    if std::env::consts::OS == "windows" {
        "windows"
    } else if std::env::consts::OS == "macos" {
        "osx"
    } else {
        "linux"
    }
}

fn current_os_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" | "aarch64" => "x86_64",
        _ => "x86",
    }
}

fn os_info() -> OsInfo {
    OsInfo {
        name: current_os_name().to_string(),
        arch: current_os_arch().to_string(),
    }
}

fn offline_uuid_from_username(name: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    format!("OfflinePlayer:{}", name).hash(&mut hasher);
    let h = hasher.finish();
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (h >> 32) as u32,
        (h >> 16) as u16 & 0x0FFF,
        (h >> 12) as u16 & 0x0FFF,
        (h >> 48) as u16 & 0x3FFF | 0x8000,
        h & 0xFFFFFFFFFFFF
    )
}

fn argument_rule_matches(rule: &ArgRule, features: &GameFeatures, os_info: &OsInfo) -> bool {
    if let Some(ref os) = rule.os {
        if let Some(ref name) = os.name {
            if name != &os_info.name {
                return false;
            }
        }
        if let Some(ref arch) = os.arch {
            if arch != &os_info.arch {
                return false;
            }
        }
    }
    if let Some(ref rule_features) = rule.features {
        if let Some(obj) = rule_features.as_object() {
            for (key, val) in obj {
                let our = match key.as_str() {
                    "is_demo_user" => serde_json::json!(features.is_demo_user),
                    "has_custom_resolution" => serde_json::json!(features.has_custom_resolution),
                    "is_quick_play" => serde_json::json!(features.is_quick_play),
                    _ => continue,
                };
                if &our != val {
                    return false;
                }
            }
        }
    }
    true
}

fn library_applies(lib: &Library, os_name: &str) -> bool {
    if lib.rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for r in &lib.rules {
        let matches_os = r
            .os
            .as_ref()
            .and_then(|o| o.name.as_deref())
            .map(|n| n == os_name)
            .unwrap_or(true);
        if !matches_os {
            continue;
        }
        match r.action.as_str() {
            "allow" => allowed = true,
            "disallow" => return false,
            _ => {}
        }
    }
    allowed
}

pub fn resolve_arguments(
    values: &[ArgumentValue],
    features: &GameFeatures,
    os_info: &OsInfo,
) -> Vec<String> {
    let mut out = Vec::new();
    for v in values {
        match v {
            ArgumentValue::String(s) => {
                out.push(s.clone());
            }
            ArgumentValue::WithRules { rules, value } => {
                let mut allow = false;
                for r in rules {
                    if !argument_rule_matches(r, features, os_info) {
                        continue;
                    }
                    match r.action.as_str() {
                        "allow" => allow = true,
                        "disallow" => {
                            allow = false;
                            break;
                        }
                        _ => {}
                    }
                }
                if !allow {
                    continue;
                }
                match value {
                    serde_json::Value::String(s) => out.push(s.clone()),
                    serde_json::Value::Array(arr) => {
                        for it in arr {
                            if let Some(s) = it.as_str() {
                                out.push(s.to_string());
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    out
}

async fn download_file(
    client: &Client,
    url: &str,
    path: &Path,
    app: &AppHandle,
    version_id: &str,
    total_size: u64,
    offset_downloaded: u64,
) -> Result<u64, String> {
    tokio::fs::create_dir_all(path.parent().unwrap())
        .await
        .map_err(|e| format!("Не удалось создать папку: {e}"))?;

    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| format!("Не удалось создать файл: {e}"))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Сервер вернул ошибку {} для {}",
            resp.status(),
            url
        ));
    }

    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            return Err("Загрузка отменена пользователем".to_string());
        }
        let chunk = chunk.map_err(|e| format!("Ошибка чтения потока: {e}"))?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| format!("Ошибка записи: {e}"))?;
        downloaded += chunk.len() as u64;
        if total_size > 0 {
            let total_done = offset_downloaded + downloaded;
            let percent = total_done as f32 / total_size as f32 * 100.0;
            let _ = app.emit(
                EVENT_DOWNLOAD_PROGRESS,
                DownloadProgressPayload {
                    version_id: version_id.to_string(),
                    downloaded: total_done,
                    total: total_size,
                    percent,
                },
            );
        }
    }
    Ok(downloaded)
}

const ASSETS_BASE_URL: &str = "https://resources.download.minecraft.net";

async fn download_assets(
    client: &Client,
    asset_index: &AssetIndexRef,
    root: &Path,
    app: &AppHandle,
    version_id: &str,
    total_size: u64,
    mut total_downloaded: u64,
) -> Result<(), String> {
    let assets_root = root.join("assets");
    let indexes_dir = assets_root.join("indexes");
    let objects_dir = assets_root.join("objects");
    tokio::fs::create_dir_all(&indexes_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку indexes: {e}"))?;
    tokio::fs::create_dir_all(&objects_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку objects: {e}"))?;

    let index_path = indexes_dir.join(format!("{}.json", asset_index.id));
    let index_json = if index_path.exists() {
        tokio::fs::read_to_string(&index_path)
            .await
            .map_err(|e| format!("Ошибка чтения индекса: {e}"))?
    } else {
        let resp = client
            .get(&asset_index.url)
            .send()
            .await
            .map_err(|e| format!("Ошибка загрузки индекса ассетов: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!(
                "Сервер вернул {} для индекса ассетов",
                resp.status()
            ));
        }
        let text = resp.text().await.map_err(|e| format!("{e}"))?;
        tokio::fs::write(&index_path, &text)
            .await
            .map_err(|e| format!("Не удалось сохранить индекс: {e}"))?;
        text
    };

    let index: AssetIndexJson = serde_json::from_str(&index_json)
        .map_err(|e| format!("Ошибка разбора индекса ассетов: {e}"))?;

    for (_path, obj) in &index.objects {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            return Err("Загрузка отменена пользователем".to_string());
        }
        let hash = &obj.hash;
        if hash.len() < 2 {
            continue;
        }
        let prefix = &hash[..2];
        let obj_path = objects_dir.join(prefix).join(hash);
        if obj_path.exists() {
            total_downloaded = total_downloaded.saturating_add(obj.size);
            if total_size > 0 {
                let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                let _ = app.emit(
                    EVENT_DOWNLOAD_PROGRESS,
                    DownloadProgressPayload {
                        version_id: version_id.to_string(),
                        downloaded: total_downloaded,
                        total: total_size,
                        percent,
                    },
                );
            }
            continue;
        }
        let url = format!("{ASSETS_BASE_URL}/{prefix}/{hash}");
        if let Some(parent) = obj_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Не удалось создать папку: {e}"))?;
        }
        let _ = download_file(
            client,
            &url,
            &obj_path,
            app,
            version_id,
            total_size,
            total_downloaded,
        )
        .await?;
        total_downloaded = total_downloaded.saturating_add(obj.size);
    }

    Ok(())
}

fn extract_natives_jar(jar_path: &Path, out_dir: &Path) -> Result<(), String> {
    let file = std::fs::File::open(jar_path)
        .map_err(|e| format!("Не удалось открыть jar: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Ошибка zip: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("Ошибка чтения entry: {e}"))?;
        let name = entry.name().to_string();
        if name.ends_with('/') {
            continue;
        }
        if name.starts_with("META-INF/") {
            continue;
        }
        let out_path = out_dir.join(&name);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| format!("Ошибка создания папки: {e}"))?;
        } else {
            if let Some(p) = out_path.parent() {
                std::fs::create_dir_all(p).map_err(|e| format!("Ошибка создания папки: {e}"))?;
            }
            let mut out_file =
                std::fs::File::create(&out_path).map_err(|e| format!("Ошибка создания файла: {e}"))?;
            std::io::copy(&mut entry, &mut out_file).map_err(|e| format!("Ошибка копирования: {e}"))?;
        }
    }
    Ok(())
}

async fn load_all_versions() -> Result<Vec<VersionSummary>, String> {
    let client = http_client();
    let resp = client
        .get(VERSION_MANIFEST_URL)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса манифеста версий: {e}"))?;

    let manifest: VersionManifest = resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора манифеста версий: {e}"))?;

    let mut summaries: Vec<VersionSummary> =
        manifest.versions.into_iter().map(VersionSummary::from).collect();

    summaries.sort_by(|a, b| b.release_time.cmp(&a.release_time));

    Ok(summaries)
}

async fn get_mojang_version_url(version_id: &str) -> Result<String, String> {
    let client = http_client();
    let resp = client
        .get(VERSION_MANIFEST_URL)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса манифеста: {e}"))?;
    let manifest: VersionManifest = resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора манифеста: {e}"))?;
    manifest
        .versions
        .into_iter()
        .find(|v| v.id == version_id)
        .map(|v| v.url)
        .ok_or_else(|| format!("Версия {version_id} не найдена в манифесте Mojang"))
}

#[tauri::command]
pub fn get_game_root_dir() -> Result<String, String> {
    let dir = game_root_dir()?;
    dir.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Не удалось преобразовать путь к строке".to_string())
}

#[tauri::command]
pub async fn open_game_folder() -> Result<(), String> {
    let root = game_root_dir()?;
    std::fs::create_dir_all(&root).map_err(|e| format!("Не удалось создать папку игры: {e}"))?;
    let path_str = root
        .to_str()
        .ok_or_else(|| "Путь к папке игры не в UTF-8".to_string())?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Не удалось открыть проводник: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Не удалось открыть папку: {e}"))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path_str)
            .spawn()
            .map_err(|e| format!("Не удалось открыть папку: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn download_modrinth_file(
    category: String,
    url: String,
    filename: String,
) -> Result<(), String> {
    let root = game_root_dir()?;
    let subdir = match category.as_str() {
        "mod" | "mods" => "mods",
        "resourcepack" | "resourcepacks" => "resourcepacks",
        "shader" | "shaderpack" | "shaderpacks" => "shaderpacks",
        other => {
            return Err(format!(
                "Неизвестный тип контента Modrinth: {other}. Ожидается mod, resourcepack или shader."
            ))
        }
    };

    let target_dir = root.join(subdir);
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку '{subdir}': {e}"))?;

    let dest_path = target_dir.join(&filename);

    let client = http_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки файла Modrinth: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Сервер Modrinth вернул ошибку {} при скачивании файла.",
            resp.status()
        ));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения тела ответа Modrinth: {e}"))?;

    tokio::fs::write(&dest_path, &bytes)
        .await
        .map_err(|e| format!("Не удалось сохранить файл в {:?}: {e}", dest_path))?;

    Ok(())
}

#[tauri::command]
pub async fn import_modpack_files(
    modpack_id: String,
    category: String,
    files: Vec<String>,
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    let root = game_root_dir()?;
    let modpacks_root = root.join("modpacks").join(&modpack_id);

    let subdir = match category.as_str() {
        "mod" | "mods" => "mods",
        "resourcepack" | "resourcepacks" => "resourcepacks",
        "shader" | "shaderpack" | "shaderpacks" => "shaderpacks",
        other => {
            return Err(format!(
                "Неизвестный тип контента сборки: {other}. Ожидается mod, resourcepack или shader."
            ))
        }
    };

    let target_dir = modpacks_root.join(subdir);
    tokio::fs::create_dir_all(&target_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку сборки '{subdir}': {e}"))?;

    for src in files {
        let src_path = PathBuf::from(&src);
        if !src_path.exists() {
            continue;
        }
        let file_name = match src_path.file_name().and_then(|n| n.to_str()) {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => continue,
        };
        let dest_path = target_dir.join(&file_name);
        if let Some(parent) = dest_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Не удалось создать папку для файла сборки: {e}"))?;
        }
        tokio::fs::copy(&src_path, &dest_path)
            .await
            .map_err(|e| format!("Не удалось скопировать файл сборки {:?}: {e}", src_path))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn fetch_all_versions() -> Result<Vec<VersionSummary>, String> {
    load_all_versions().await
}

#[tauri::command]
pub async fn fetch_vanilla_releases() -> Result<Vec<VersionSummary>, String> {
    let mut versions = load_all_versions().await?;
    versions.retain(|v| v.version_type == "release");
    Ok(versions)
}

#[tauri::command]
pub async fn fetch_fabric_loaders(game_version: String) -> Result<Vec<String>, String> {
    let url = format!("{FABRIC_META_LOADERS}/{game_version}");
    let client = http_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса списка Fabric: {e}"))?;
    let list: Vec<FabricLoaderEntry> = resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора списка Fabric: {e}"))?;
    let versions: Vec<String> = list
        .into_iter()
        .map(|e| e.loader.version)
        .collect();
    Ok(versions)
}

async fn select_latest_quilt_loader(game_version: &str) -> Result<String, String> {
    let url = format!("https://meta.quiltmc.org/v3/versions/loader/{game_version}");
    let client = http_client();
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса списка Quilt: {e}"))?;
    let list: Vec<QuiltLoaderEntry> = resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора списка Quilt: {e}"))?;
    if list.is_empty() {
        return Err(format!(
            "Для версии Minecraft {game_version} нет доступных версий Quilt Loader"
        ));
    }

    let mut best: Option<QuiltLoaderEntry> = None;
    for entry in list {
        match best {
            None => best = Some(entry),
            Some(ref current) => {
                if entry.loader.build > current.loader.build {
                    best = Some(entry);
                }
            }
        }
    }
    let best = best.ok_or_else(|| "Не удалось выбрать версию Quilt Loader".to_string())?;
    Ok(best.loader.version)
}

#[tauri::command]
pub async fn fetch_forge_versions() -> Result<Vec<ForgeVersionSummary>, String> {
    let client = http_client();
    let resp = client
        .get(FORGE_PROMOTIONS)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса списка Forge: {e}"))?;
    let promos: ForgePromotions = resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора Forge: {e}"))?;
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (key, build) in &promos.promos {
        let mc_ver = key
            .strip_suffix("-latest")
            .or_else(|| key.strip_suffix("-recommended"));
        if let Some(mc) = mc_ver {
            let forge_id = format!("{mc}-forge-{build}");
            if seen.insert(forge_id.clone()) {
                let maven_id = format!("{mc}-{build}");
                let installer_url = format!(
                    "{FORGE_INSTALLER_BASE}/{maven_id}/forge-{maven_id}-installer.jar"
                );
                out.push(ForgeVersionSummary {
                    id: forge_id.clone(),
                    mc_version: mc.to_string(),
                    forge_build: build.clone(),
                    installer_url,
                });
            }
        }
    }
    out.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(out)
}

#[tauri::command]
pub fn get_installed_fabric_profile_id(game_version: String) -> Result<Option<String>, String> {
    let vers_root = versions_dir()?;
    if !vers_root.exists() {
        return Ok(None);
    }
    for e in std::fs::read_dir(&vers_root).map_err(|e| format!("Ошибка чтения versions: {e}"))? {
        let e = e.map_err(|e| format!("Ошибка чтения: {e}"))?;
        let path = e.path();
        if !path.is_dir() {
            continue;
        }
        let profile_path = path.join("profile.json");
        if !profile_path.exists() {
            continue;
        }
        let s = std::fs::read_to_string(&profile_path)
            .map_err(|e| format!("Ошибка чтения profile.json: {e}"))?;
        let profile: FabricProfile = serde_json::from_str(&s)
            .map_err(|e| format!("Ошибка разбора profile.json: {e}"))?;
        if profile.id.starts_with("fabric-loader-") && profile.inherits_from == game_version {
            let id = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            if !id.is_empty() {
                return Ok(Some(id));
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn get_installed_quilt_profile_id(game_version: String) -> Result<Option<String>, String> {
    let vers_root = versions_dir()?;
    if !vers_root.exists() {
        return Ok(None);
    }
    for e in std::fs::read_dir(&vers_root).map_err(|e| format!("Ошибка чтения versions: {e}"))? {
        let e = e.map_err(|e| format!("Ошибка чтения: {e}"))?;
        let path = e.path();
        if !path.is_dir() {
            continue;
        }
        let profile_path = path.join("profile.json");
        if !profile_path.exists() {
            continue;
        }
        let s = std::fs::read_to_string(&profile_path)
            .map_err(|e| format!("Ошибка чтения profile.json: {e}"))?;
        let profile: FabricProfile = serde_json::from_str(&s)
            .map_err(|e| format!("Ошибка разбора profile.json: {e}"))?;
        if profile.id.starts_with("quilt-loader-") && profile.inherits_from == game_version {
            let id = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
            if !id.is_empty() {
                return Ok(Some(id));
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn list_installed_versions() -> Result<Vec<String>, String> {
    let root = game_root_dir()?;
    let vers_root = versions_dir()?;
    let mut ids = std::collections::HashSet::new();
    if root.exists() {
        for e in std::fs::read_dir(&root).map_err(|e| format!("Ошибка чтения папки игры: {e}"))? {
            let e = e.map_err(|e| format!("Ошибка чтения: {e}"))?;
            let name = e.file_name();
            let name = name.to_str().ok_or("Неверная кодировка имени файла")?;
            if name.ends_with(".jar") {
                let id = name.strip_suffix(".jar").unwrap_or(name);
                ids.insert(id.to_string());
            }
        }
    }
    if vers_root.exists() {
        for e in std::fs::read_dir(&vers_root).map_err(|e| format!("Ошибка чтения versions: {e}"))? {
            let e = e.map_err(|e| format!("Ошибка чтения: {e}"))?;
            let path = e.path();
            if path.is_dir() {
                let id = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if !id.is_empty()
                    && (path.join("profile.json").exists() || path.join(format!("{id}.json")).exists())
                {
                    ids.insert(id.to_string());
                }
            }
        }
    }
    let mut result: Vec<String> = ids.into_iter().collect();
    result.sort();
    Ok(result)
}

#[tauri::command]
pub async fn install_fabric(
    app: AppHandle,
    game_version: String,
    loader_version: String,
) -> Result<String, String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    let client = http_client();
    let profile_url = format!(
        "{FABRIC_META_PROFILE}/{game_version}/{loader_version}/profile/json"
    );
    let profile: FabricProfile = client
        .get(&profile_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки профиля Fabric: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора профиля Fabric: {e}"))?;

    let mojang_url = get_mojang_version_url(&profile.inherits_from).await?;
    let mojang_detail: VersionDetail = client
        .get(&mojang_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки версии Mojang: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора версии Mojang: {e}"))?;

    let root = game_root_dir()?;
    let libs_root = libraries_dir()?;
    let vers_root = versions_dir()?;
    tokio::fs::create_dir_all(&root).await.map_err(|e| format!("Папка игры: {e}"))?;
    tokio::fs::create_dir_all(&libs_root).await.map_err(|e| format!("Папка библиотек: {e}"))?;
    tokio::fs::create_dir_all(&vers_root).await.map_err(|e| format!("Папка версий: {e}"))?;

    let profile_id = profile.id.clone();
    let os_name = current_os_name();
    let mojang_dl = mojang_detail
        .downloads
        .as_ref()
        .ok_or("Версия Mojang без downloads")?;
    let mut total_size = mojang_dl.client.size
        + profile
            .libraries
            .iter()
            .map(|l| l.size)
            .fold(0u64, |a, b| a.saturating_add(b));
    for lib in &mojang_detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref a) = lib.downloads.artifact {
            total_size = total_size.saturating_add(a.size);
        }
        let native_classifier = match os_name {
            "windows" => "natives-windows",
            "osx" => "natives-macos",
            _ => "natives-linux",
        };
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(ref nat) = classifiers.get(native_classifier) {
                total_size = total_size.saturating_add(nat.size);
            }
        }
    }
    if let Some(ref ai) = mojang_detail.asset_index {
        if let Some(s) = ai.total_size {
            total_size = total_size.saturating_add(s);
        }
    }
    let mut total_downloaded: u64 = 0;

    let client_jar = root.join(format!("{profile_id}.jar"));
    let _ = download_file(
        &client,
        &mojang_dl.client.url,
        &client_jar,
        &app,
        &profile_id,
        total_size,
        total_downloaded,
    )
    .await?;
    total_downloaded = total_downloaded.saturating_add(mojang_dl.client.size);

    let natives_dir = vers_root.join(&profile_id).join("natives");
    tokio::fs::create_dir_all(&natives_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку natives: {e}"))?;
    let native_classifier = match os_name {
        "windows" => "natives-windows",
        "osx" => "natives-macos",
        _ => "natives-linux",
    };

    for lib in &mojang_detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref artifact) = lib.downloads.artifact {
            let path = libs_root.join(&artifact.path);
            if path.exists() {
                total_downloaded = total_downloaded.saturating_add(artifact.size);
                if total_size > 0 {
                    let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                    let _ = app.emit(
                        EVENT_DOWNLOAD_PROGRESS,
                        DownloadProgressPayload {
                            version_id: profile_id.clone(),
                            downloaded: total_downloaded,
                            total: total_size,
                            percent,
                        },
                    );
                }
                continue;
            }
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
            }
            let _ = download_file(
                &client,
                &artifact.url,
                &path,
                &app,
                &profile_id,
                total_size,
                total_downloaded,
            )
            .await?;
            total_downloaded = total_downloaded.saturating_add(artifact.size);
        }
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(nat) = classifiers.get(native_classifier) {
                let path = libs_root.join(&nat.path);
                if path.exists() {
                    total_downloaded = total_downloaded.saturating_add(nat.size);
                    if total_size > 0 {
                        let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                        let _ = app.emit(
                            EVENT_DOWNLOAD_PROGRESS,
                            DownloadProgressPayload {
                                version_id: profile_id.clone(),
                                downloaded: total_downloaded,
                                total: total_size,
                                percent,
                            },
                        );
                    }
                    let _ = extract_natives_jar(&path, &natives_dir);
                    continue;
                }
                if let Some(parent) = path.parent() {
                    tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
                }
                let _ = download_file(
                    &client,
                    &nat.url,
                    &path,
                    &app,
                    &profile_id,
                    total_size,
                    total_downloaded,
                )
                .await?;
                total_downloaded = total_downloaded.saturating_add(nat.size);
                let _ = extract_natives_jar(&path, &natives_dir);
            }
        }
    }

    let base_url = "https://maven.fabricmc.net/";
    for lib in &profile.libraries {
        let path = fabric_library_path(&lib.name);
        let url = lib
            .url
            .as_deref()
            .unwrap_or(base_url)
            .trim_end_matches('/');
        let lib_url = format!("{url}/{path}");
        let dest = libs_root.join(&path);
        if dest.exists() {
            total_downloaded = total_downloaded.saturating_add(lib.size);
            if total_size > 0 {
                let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                let _ = app.emit(
                    EVENT_DOWNLOAD_PROGRESS,
                    DownloadProgressPayload {
                        version_id: profile_id.clone(),
                        downloaded: total_downloaded,
                        total: total_size,
                        percent,
                    },
                );
            }
            continue;
        }
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
        }
        let _ = download_file(
            &client,
            &lib_url,
            &dest,
            &app,
            &profile_id,
            total_size,
            total_downloaded,
        )
        .await?;
        total_downloaded = total_downloaded.saturating_add(lib.size);
    }

    if let Some(ref asset_index) = mojang_detail.asset_index {
        download_assets(
            &client,
            asset_index,
            &root,
            &app,
            &profile_id,
            total_size,
            total_downloaded,
        )
        .await?;
    }

    let profile_dir = vers_root.join(&profile_id);
    tokio::fs::create_dir_all(&profile_dir).await.map_err(|e| format!("{e}"))?;
    let profile_path = profile_dir.join("profile.json");
    let profile_json = serde_json::to_string(&profile).map_err(|e| format!("Ошибка сериализации: {e}"))?;
    tokio::fs::write(&profile_path, profile_json)
        .await
        .map_err(|e| format!("Ошибка записи профиля: {e}"))?;

    Ok(profile_id)
}

#[tauri::command]
pub async fn install_quilt(
    app: AppHandle,
    game_version: String,
) -> Result<String, String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    let client = http_client();

    let loader_version = select_latest_quilt_loader(&game_version).await?;

    let profile_url = format!(
        "https://meta.quiltmc.org/v3/versions/loader/{game_version}/{loader_version}/profile/json"
    );

    let profile: FabricProfile = client
        .get(&profile_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки профиля Quilt: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора профиля Quilt: {e}"))?;

    let mojang_url = get_mojang_version_url(&profile.inherits_from).await?;
    let mojang_detail: VersionDetail = client
        .get(&mojang_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки версии Mojang: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора версии Mojang: {e}"))?;

    let root = game_root_dir()?;
    let libs_root = libraries_dir()?;
    let vers_root = versions_dir()?;
    tokio::fs::create_dir_all(&root).await.map_err(|e| format!("Папка игры: {e}"))?;
    tokio::fs::create_dir_all(&libs_root).await.map_err(|e| format!("Папка библиотек: {e}"))?;
    tokio::fs::create_dir_all(&vers_root).await.map_err(|e| format!("Папка версий: {e}"))?;

    let profile_id = profile.id.clone();
    let os_name = current_os_name();
    let mojang_dl = mojang_detail
        .downloads
        .as_ref()
        .ok_or("Версия Mojang без downloads")?;

    let mut total_size = mojang_dl.client.size
        + profile
            .libraries
            .iter()
            .map(|l| l.size)
            .fold(0u64, |a, b| a.saturating_add(b));
    for lib in &mojang_detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref a) = lib.downloads.artifact {
            total_size = total_size.saturating_add(a.size);
        }
        let native_classifier = match os_name {
            "windows" => "natives-windows",
            "osx" => "natives-macos",
            _ => "natives-linux",
        };
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(ref nat) = classifiers.get(native_classifier) {
                total_size = total_size.saturating_add(nat.size);
            }
        }
    }
    if let Some(ref ai) = mojang_detail.asset_index {
        if let Some(s) = ai.total_size {
            total_size = total_size.saturating_add(s);
        }
    }
    let mut total_downloaded: u64 = 0;

    let client_jar = root.join(format!("{profile_id}.jar"));
    let _ = download_file(
        &client,
        &mojang_dl.client.url,
        &client_jar,
        &app,
        &profile_id,
        total_size,
        total_downloaded,
    )
    .await?;
    total_downloaded = total_downloaded.saturating_add(mojang_dl.client.size);

    let natives_dir = vers_root.join(&profile_id).join("natives");
    tokio::fs::create_dir_all(&natives_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку natives: {e}"))?;
    let native_classifier = match os_name {
        "windows" => "natives-windows",
        "osx" => "natives-macos",
        _ => "natives-linux",
    };

    for lib in &mojang_detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref artifact) = lib.downloads.artifact {
            let path = libs_root.join(&artifact.path);
            if path.exists() {
                total_downloaded = total_downloaded.saturating_add(artifact.size);
                if total_size > 0 {
                    let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                    let _ = app.emit(
                        EVENT_DOWNLOAD_PROGRESS,
                        DownloadProgressPayload {
                            version_id: profile_id.clone(),
                            downloaded: total_downloaded,
                            total: total_size,
                            percent,
                        },
                    );
                }
                continue;
            }
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
            }
            let _ = download_file(
                &client,
                &artifact.url,
                &path,
                &app,
                &profile_id,
                total_size,
                total_downloaded,
            )
            .await?;
            total_downloaded = total_downloaded.saturating_add(artifact.size);
        }
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(nat) = classifiers.get(native_classifier) {
                let path = libs_root.join(&nat.path);
                if path.exists() {
                    total_downloaded = total_downloaded.saturating_add(nat.size);
                    if total_size > 0 {
                        let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                        let _ = app.emit(
                            EVENT_DOWNLOAD_PROGRESS,
                            DownloadProgressPayload {
                                version_id: profile_id.clone(),
                                downloaded: total_downloaded,
                                total: total_size,
                                percent,
                            },
                        );
                    }
                    let _ = extract_natives_jar(&path, &natives_dir);
                    continue;
                }
                if let Some(parent) = path.parent() {
                    tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
                }
                let _ = download_file(
                    &client,
                    &nat.url,
                    &path,
                    &app,
                    &profile_id,
                    total_size,
                    total_downloaded,
                )
                .await?;
                total_downloaded = total_downloaded.saturating_add(nat.size);
                let _ = extract_natives_jar(&path, &natives_dir);
            }
        }
    }

    let base_url = "https://maven.quiltmc.org/repository/release/";
    for lib in &profile.libraries {
        let path = fabric_library_path(&lib.name);
        let url = lib
            .url
            .as_deref()
            .unwrap_or(base_url)
            .trim_end_matches('/');
        let lib_url = format!("{url}/{path}");
        let dest = libs_root.join(&path);
        if dest.exists() {
            total_downloaded = total_downloaded.saturating_add(lib.size);
            if total_size > 0 {
                let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                let _ = app.emit(
                    EVENT_DOWNLOAD_PROGRESS,
                    DownloadProgressPayload {
                        version_id: profile_id.clone(),
                        downloaded: total_downloaded,
                        total: total_size,
                        percent,
                    },
                );
            }
            continue;
        }
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{e}"))?;
        }
        let _ = download_file(
            &client,
            &lib_url,
            &dest,
            &app,
            &profile_id,
            total_size,
            total_downloaded,
        )
        .await?;
        total_downloaded = total_downloaded.saturating_add(lib.size);
    }

    if let Some(ref asset_index) = mojang_detail.asset_index {
        download_assets(
            &client,
            asset_index,
            &root,
            &app,
            &profile_id,
            total_size,
            total_downloaded,
        )
        .await?;
    }

    let profile_dir = vers_root.join(&profile_id);
    tokio::fs::create_dir_all(&profile_dir).await.map_err(|e| format!("{e}"))?;
    let profile_path = profile_dir.join("profile.json");
    let profile_json =
        serde_json::to_string(&profile).map_err(|e| format!("Ошибка сериализации: {e}"))?;
    tokio::fs::write(&profile_path, profile_json)
        .await
        .map_err(|e| format!("Ошибка записи профиля: {e}"))?;

    Ok(profile_id)
}

#[tauri::command]
pub async fn install_forge(
    app: AppHandle,
    version_id: String,
    installer_url: String,
) -> Result<(), String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    let client = http_client();
    let root = game_root_dir()?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("Папка игры: {e}"))?;

    let installer_jar = root.join("forge-installer.jar");
    let resp = client
        .get(&installer_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки установщика Forge: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!(
            "Сервер вернул ошибку {} при загрузке установщика. Попробуйте другую версию Forge.",
            status
        ));
    }

    let total = resp.content_length().unwrap_or(0);
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения установщика: {e}"))?;

    if bytes.len() < 4 || &bytes[0..2] != b"PK" {
        return Err(
            "Скачанный файл не похож на JAR (возможно, страница ошибки). Попробуйте другую версию или проверьте интернет."
                .to_string(),
        );
    }

    let mut downloaded = 0u64;
    let mut file = tokio::fs::File::create(&installer_jar)
        .await
        .map_err(|e| format!("Ошибка создания файла: {e}"))?;
    tokio::io::AsyncWriteExt::write_all(&mut file, &bytes).await.map_err(|e| format!("{e}"))?;
    downloaded += bytes.len() as u64;
    if total > 0 {
        let _ = app.emit(
            EVENT_DOWNLOAD_PROGRESS,
            DownloadProgressPayload {
                version_id: version_id.clone(),
                downloaded,
                total,
                percent: downloaded as f32 / total as f32 * 100.0,
            },
        );
    }

    let root_str = root
        .to_str()
        .ok_or("Путь к папке игры не в UTF-8")?;
    let mc_version = version_id.split('-').next().unwrap_or(&version_id);
    let mojang_url = get_mojang_version_url(mc_version).await?;
    let mojang_client = http_client();
    let mojang_detail: VersionDetail = mojang_client
        .get(&mojang_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки описания версии Minecraft для Forge: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора описания версии Minecraft для Forge: {e}"))?;
    let (java_major, java_component) = if let Some(jv) = mojang_detail.java_version {
        (jv.major_version, jv.component)
    } else {
        (8, "jre-legacy".to_string())
    };
    let java_path = crate::java_runtime::ensure_java_runtime(java_major, &java_component).await?;

    let status = std::process::Command::new(&java_path)
        .args([
            "-jar",
            installer_jar.to_str().unwrap(),
            "--installClient",
            root_str,
        ])
        .current_dir(&root)
        .status()
        .map_err(|e| format!("Не удалось запустить установщик Forge (нужна Java): {e}"))?;

    let _ = std::fs::remove_file(&installer_jar);

    if !status.success() {
        return Err("Установщик Forge завершился с ошибкой.".to_string());
    }

    let vers_root = versions_dir()?;
    let src_jar = vers_root
        .join(&version_id)
        .join(format!("{version_id}.jar"));
    let dest_jar = root.join(format!("{version_id}.jar"));
    if src_jar.exists() && !dest_jar.exists() {
        if let Some(parent) = dest_jar.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Не удалось создать папку для Forge jar: {e}"))?;
            }
        }
        std::fs::copy(&src_jar, &dest_jar)
            .map_err(|e| format!("Не удалось скопировать Forge jar: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn install_version(
    app: AppHandle,
    version_id: String,
    version_url: String,
) -> Result<(), String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    let client = http_client();
    let os_name = current_os_name();

    let resp = client
        .get(&version_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки описания версии: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Сервер вернул ошибку {} при запросе описания версии. Проверьте интернет и выбранную версию.",
            resp.status()
        ));
    }

    let version_json_text = resp
        .text()
        .await
        .map_err(|e| format!("Ошибка чтения ответа: {e}"))?;

    let detail: VersionDetail = serde_json::from_str(&version_json_text)
        .map_err(|e| format!("Ошибка разбора описания версии: {e}"))?;

    let downloads = detail
        .downloads
        .as_ref()
        .ok_or("Описание версии не содержит downloads (не ванильная версия)")?;

    let root = game_root_dir()?;
    let libs_root = libraries_dir()?;
    let vers_root = versions_dir()?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("Не удалось создать папку игры: {e}"))?;
    tokio::fs::create_dir_all(&libs_root)
        .await
        .map_err(|e| format!("Не удалось создать папку библиотек: {e}"))?;
    tokio::fs::create_dir_all(&vers_root)
        .await
        .map_err(|e| format!("Не удалось создать папку версий: {e}"))?;

    let client_size = downloads.client.size;
    let mut total_size = client_size;
    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref a) = lib.downloads.artifact {
            total_size = total_size.saturating_add(a.size);
        }
        let native_classifier = match os_name {
            "windows" => "natives-windows",
            "osx" => "natives-macos",
            _ => "natives-linux",
        };
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(ref nat) = classifiers.get(native_classifier) {
                total_size = total_size.saturating_add(nat.size);
            }
        }
    }
    if let Some(ref ai) = detail.asset_index {
        if let Some(s) = ai.total_size {
            total_size = total_size.saturating_add(s);
        }
    }

    let mut total_downloaded: u64 = 0;

    //jar
    let client_jar = root.join(format!("{version_id}.jar"));
    let _ = download_file(
        &client,
        &downloads.client.url,
        &client_jar,
        &app,
        &version_id,
        total_size,
        total_downloaded,
    )
    .await?;
    total_downloaded = total_downloaded.saturating_add(downloads.client.size);

    //библиотеки
    let natives_dir = vers_root.join(&version_id).join("natives");
    tokio::fs::create_dir_all(&natives_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку natives: {e}"))?;

    let native_classifier = match os_name {
        "windows" => "natives-windows",
        "osx" => "natives-macos",
        _ => "natives-linux",
    };

    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref artifact) = lib.downloads.artifact {
            let path = libs_root.join(&artifact.path);
            if path.exists() {
                total_downloaded = total_downloaded.saturating_add(artifact.size);
                if total_size > 0 {
                    let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                    let _ = app.emit(
                        EVENT_DOWNLOAD_PROGRESS,
                        DownloadProgressPayload {
                            version_id: version_id.clone(),
                            downloaded: total_downloaded,
                            total: total_size,
                            percent,
                        },
                    );
                }
                continue;
            }
            let _ = download_file(
                &client,
                &artifact.url,
                &path,
                &app,
                &version_id,
                total_size,
                total_downloaded,
            )
            .await?;
            total_downloaded = total_downloaded.saturating_add(artifact.size);
        }
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(nat) = classifiers.get(native_classifier) {
                let path = libs_root.join(&nat.path);
                if path.exists() {
                    total_downloaded = total_downloaded.saturating_add(nat.size);
                    if total_size > 0 {
                        let percent = total_downloaded as f32 / total_size as f32 * 100.0;
                        let _ = app.emit(
                            EVENT_DOWNLOAD_PROGRESS,
                            DownloadProgressPayload {
                                version_id: version_id.clone(),
                                downloaded: total_downloaded,
                                total: total_size,
                                percent,
                            },
                        );
                    }
                    let _ = extract_natives_jar(&path, &natives_dir);
                    continue;
                }
                let _ = download_file(
                    &client,
                    &nat.url,
                    &path,
                    &app,
                    &version_id,
                    total_size,
                    total_downloaded,
                )
                .await?;
                total_downloaded = total_downloaded.saturating_add(nat.size);
                let _ = extract_natives_jar(&path, &natives_dir);
            }
        }
    }

    if let Some(ref asset_index) = detail.asset_index {
        download_assets(
            &client,
            asset_index,
            &root,
            &app,
            &version_id,
            total_size,
            total_downloaded,
        )
        .await?;
    }

    //сохранение json версий
    let version_json_path = vers_root.join(&version_id).join(format!("{version_id}.json"));
    if let Some(parent) = version_json_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    tokio::fs::write(&version_json_path, &version_json_text)
        .await
        .map_err(|e| format!("Не удалось сохранить описание версии: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn launch_game(
    app: AppHandle,
    version_id: String,
    version_url: Option<String>,
) -> Result<(), String> {
    let root = game_root_dir()?;
    let libs_root = libraries_dir()?;
    let vers_root = versions_dir()?;
    let game_dir = selected_instance_dir_internal().unwrap_or_else(|| root.clone());

    let (detail, is_fabric) = if let Some(ref url) = version_url {
        let client = http_client();
        let resp = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Ошибка загрузки описания версии: {e}"))?;
        let d: VersionDetail = resp
            .json()
            .await
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
            let client = http_client();
            let mojang_detail: VersionDetail = client
                .get(&mojang_url)
                .send()
                .await
                .map_err(|e| format!("Ошибка загрузки версии Mojang: {e}"))?
                .json()
                .await
                .map_err(|e| format!("Ошибка разбора: {e}"))?;
            let mut detail = VersionDetail {
                downloads: None,
                main_class: profile.main_class,
                libraries: mojang_detail.libraries.clone(),
                arguments: VersionArguments {
                    jvm: profile.arguments.jvm,
                    game: mojang_detail.arguments.game,
                },
                minecraft_arguments: mojang_detail.minecraft_arguments,
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

    let jar_path = root.join(format!("{version_id}.jar"));
    if detail.downloads.is_some() && !jar_path.exists() {
        return Err("Версия не установлена. Сначала нажмите «Установить».".to_string());
    }

    let os_name = current_os_name();
    let os_info = os_info();
    let features = GameFeatures::full();

    let _native_classifier = match os_name {
        "windows" => "natives-windows",
        "osx" => "natives-macos",
        _ => "natives-linux",
    };

    let mut classpath = Vec::new();
    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref a) = lib.downloads.artifact {
            classpath.push(libs_root.join(&a.path));
        }
    }
    if detail.downloads.is_some() || jar_path.exists() {
        classpath.push(jar_path.clone());
    }

    let classpath_str = classpath
        .iter()
        .map(|p| p.to_str().unwrap_or(""))
        .collect::<Vec<_>>()
        .join(if os_name == "windows" { ";" } else { ":" });

    let game_dir_str = game_dir
        .to_str()
        .ok_or("Путь к папке игры не в UTF-8")?;
    let natives_dir = vers_root.join(&version_id).join("natives");
    std::fs::create_dir_all(&natives_dir)
        .map_err(|e| format!("Не удалось создать папку natives при запуске: {e}"))?;
    let native_classifier = match os_name {
        "windows" => "natives-windows",
        "osx" => "natives-macos",
        _ => "natives-linux",
    };
    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        if let Some(ref classifiers) = lib.downloads.classifiers {
            if let Some(nat) = classifiers.get(native_classifier) {
                let path = libs_root.join(&nat.path);
                if path.exists() {
                    let _ = extract_natives_jar(&path, &natives_dir);
                }
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
        let client = http_client();
        for lib in &detail.libraries {
            if !library_applies(lib, os_name) {
                continue;
            }
            if let Some(ref classifiers) = lib.downloads.classifiers {
                if let Some(nat) = classifiers.get(native_classifier) {
                    let path = libs_root.join(&nat.path);
                    if !path.exists() {
                        if let Some(parent) = path.parent() {
                            std::fs::create_dir_all(parent).map_err(|e| {
                                format!("Не удалось создать папку для natives '{}': {e}", parent.display())
                            })?;
                        }
                        let mut resp = client
                            .get(&nat.url)
                            .send()
                            .await
                            .map_err(|e| format!("Ошибка загрузки natives '{}': {e}", nat.path))?;
                        if !resp.status().is_success() {
                            return Err(format!(
                                "Сервер вернул ошибку {} при загрузке natives '{}'",
                                resp.status(),
                                nat.url
                            ));
                        }
                        let mut file = std::fs::File::create(&path)
                            .map_err(|e| format!("Ошибка создания файла natives '{}': {e}", path.display()))?;
                        while let Some(chunk) = resp
                            .chunk()
                            .await
                            .map_err(|e| format!("Ошибка чтения потока natives '{}': {e}", nat.url))?
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
    }
    let natives_str = natives_dir.to_str().unwrap_or("");
    let assets_root = root.join("assets");
    let assets_str = assets_root.to_str().unwrap_or("");
    let _ = std::fs::create_dir_all(&assets_root);

    if let Err(e) = refresh_ely_session_internal().await {
        return Err(e);
    }

    let profile = get_profile().unwrap_or_default();

    let mut is_offline = profile
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
        "msa".to_string()
    };

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
            is_offline = false;
        }
    }

    if profile
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
            is_offline = false;
        }
    }

    let replace = |s: &str| -> String {
        s.replace("${game_directory}", game_dir_str)
            .replace("${gameDir}", game_dir_str)
            .replace("${natives}", natives_str)
            .replace("${natives_directory}", natives_str)
            .replace("${classpath}", &classpath_str)
            .replace("${assetsDir}", assets_str)
            .replace("${assets_root}", assets_str)
            .replace("${assets_index_name}", detail.assets.as_deref().unwrap_or(""))
            .replace("${version_name}", &version_id)
            .replace("${version}", &version_id)
            .replace("${auth_player_name}", &auth_name)
            .replace("${auth_uuid}", &auth_uuid)
            .replace("${auth_access_token}", &auth_token)
            .replace("${clientid}", ELY_CLIENT_ID)
            .replace("${auth_xuid}", "")
            .replace("${user_type}", &user_type)
            .replace("${version_type}", "release")
            .replace("${is_demo_user}", "false")
            .replace("${launcher_name}", "16Launcher")
            .replace("${launcher_version}", "2.0.0")
    };

    let (java_major, java_component) = if let Some(ref jv) = detail.java_version {
        (jv.major_version, jv.component.clone())
    } else {
        (8, "jre-legacy".to_string())
    };
    let default_java_path =
        crate::java_runtime::ensure_java_runtime(java_major, &java_component).await?;

    let settings = effective_settings_for_launch();
    let instance_settings_for_launch =
        load_selected_instance_settings_internal()
            .ok()
            .flatten()
            .map(|(_, s)| s);

    let replace = |s: &str| -> String {
        s.replace("${game_directory}", game_dir_str)
            .replace("${gameDir}", game_dir_str)
            .replace("${natives_directory}", natives_str)
            .replace("${classpath}", &classpath_str)
            .replace("${assets_root}", assets_str)
            .replace("${assets_index_name}", detail.assets.as_deref().unwrap_or(""))
            .replace("${version_name}", &version_id)
            .replace("${auth_player_name}", &auth_name)
            .replace("${auth_uuid}", &auth_uuid)
            .replace("${auth_access_token}", &auth_token)
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
            let mut base = vec![
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

    if let Some(inst) = &instance_settings_for_launch {
        if let (Some(w), Some(h)) = (inst.resolution_width, inst.resolution_height) {
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

    let java_settings = instance_settings_for_launch
        .as_ref()
        .and_then(|s| s.java_settings.clone())
        .unwrap_or_else(|| load_java_settings_internal(&app));

    let (java_path, mut jvm_args) = build_java_command(
        default_java_path,
        &settings,
        instance_settings_for_launch.as_ref(),
        &java_settings,
        game_dir_str,
        natives_str,
        assets_str,
        &version_id,
        &classpath_str,
        jvm_args,
    )?;

    if auth_token != "offline" && !auth_token.is_empty() {
        match ensure_authlib_injector().await {
            Ok(path) => {
                let agent_path = path.to_string_lossy().replace('\\', "/");
                eprintln!(
                    "[ElyAuth] Используется authlib-injector: {}",
                    agent_path
                );
                jvm_args.insert(0, format!("-javaagent:{}=ely.by", agent_path));
            }
            Err(e) => {
                eprintln!("[ElyAuth] Не удалось подготовить authlib-injector: {e}");
            }
        }
    }

    eprintln!("[Launch] JVM args: {:?}", jvm_args);
    eprintln!("[Launch] Game args: {:?}", game_args);

    let _jar_path_str = jar_path.to_str().ok_or("Путь к jar не в UTF-8")?;

    let mut cmd = std::process::Command::new(&java_path);
    cmd.args(&jvm_args)
        .arg(&detail.main_class)
        .args(&game_args)
        .current_dir(game_dir_str)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Не удалось запустить игру (установите Java): {e}"))?;

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

    if settings.close_launcher_on_game_start {
        app.exit(0);
    }

    Ok(())
}
