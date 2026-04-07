use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use std::io::{BufRead, BufReader, ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::atomic::{AtomicU64};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
#[cfg(windows)]
use std::os::windows::process::CommandExt;

use futures_util::StreamExt;
use rand::distributions::Alphanumeric;
use flate2::read::GzDecoder;
use rand::Rng;
use reqwest::Client;
use reqwest::header::{ACCEPT_ENCODING, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use sysinfo::{ProcessesToUpdate, Pid, System};
use tauri::{AppHandle, Emitter, Manager};
use std::env;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use tokio::sync::Semaphore;
use sha1::{Digest, Sha1};
use urlencoding::encode;

use crate::ely_auth::{ensure_authlib_injector, refresh_ely_session_internal, ELY_CLIENT_ID};

const ELY_AUTHLIB_INJECTOR_TARGET: &str = "ely.by";

fn http_client(use_proxy: bool) -> Client {
    let _ = dotenvy::dotenv();

    let mut builder = Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) 16Launcher/1.0 Chrome/122.0.0.0 Safari/537.36");

    if use_proxy {
        let host = env_var_trim("PROXY_HOST");
        let port_str = env_var_trim("PROXY_PORT");
        let user = env_var_trim("PROXY_USER");
        let pass = env_var_trim("PROXY_PASS");

        if let (Some(host), Some(port_str)) = (host, port_str) {
            if let Ok(port) = port_str.parse::<u16>() {
                let proxy_url = match (user, pass) {
                    (Some(u), Some(p)) => format!(
                        "http://{}:{}@{}:{}",
                        encode(&u),
                        encode(&p),
                        host,
                        port
                    ),
                    _ => format!("http://{host}:{port}"),
                };

                if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
                    builder = builder.proxy(proxy);
                }
            }
        }
    }

    builder.build().unwrap_or_else(|_| Client::new())
}

fn http_client_for_binary_download(use_proxy: bool) -> Client {
    let _ = dotenvy::dotenv();

    let mut builder = Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
        .http1_only()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) 16Launcher/1.0 Chrome/122.0.0.0 Safari/537.36");

    if use_proxy {
        let host = env_var_trim("PROXY_HOST");
        let port_str = env_var_trim("PROXY_PORT");
        let user = env_var_trim("PROXY_USER");
        let pass = env_var_trim("PROXY_PASS");

        if let (Some(host), Some(port_str)) = (host, port_str) {
            if let Ok(port) = port_str.parse::<u16>() {
                let proxy_url = match (user, pass) {
                    (Some(u), Some(p)) => format!(
                        "http://{}:{}@{}:{}",
                        encode(&u),
                        encode(&p),
                        host,
                        port
                    ),
                    _ => format!("http://{host}:{port}"),
                };

                if let Ok(proxy) = reqwest::Proxy::all(&proxy_url) {
                    builder = builder.proxy(proxy);
                }
            }
        }
    }

    builder.build().unwrap_or_else(|_| {
        Client::builder()
            .timeout(Duration::from_secs(300))
            .connect_timeout(Duration::from_secs(30))
            .http1_only()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) 16Launcher/1.0 Chrome/122.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_else(|_| Client::new())
    })
}

fn env_var_trim(key: &str) -> Option<String> {
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
        "PROXY_USER" => option_env!("PROXY_USER"),
        "PROXY_PASS" => option_env!("PROXY_PASS"),
        _ => return None,
    };

    compile_time
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn load_project_env_for_runtime() {
    static ENV_LOADED: OnceLock<()> = OnceLock::new();
    let _ = ENV_LOADED.get_or_init(|| {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let candidate_paths = [
            manifest_dir.join(".env"),
            manifest_dir.join("../.env"),
            PathBuf::from(".env"),
        ];
        for path in candidate_paths {
            if path.exists() {
                let _ = dotenvy::from_path(path);
            }
        }
    });
}

#[cfg(target_os = "linux")]
fn apply_linux_display_env(cmd: &mut std::process::Command) {
    let xdg_session_type = env::var("XDG_SESSION_TYPE")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let has_wayland = env::var_os("WAYLAND_DISPLAY").is_some() || xdg_session_type == "wayland";

    if has_wayland {
        if env::var_os("WINIT_UNIX_BACKEND").is_none() {
            cmd.env("WINIT_UNIX_BACKEND", "wayland");
        }
        if env::var_os("GDK_BACKEND").is_none() {
            cmd.env("GDK_BACKEND", "wayland,x11");
        }
    }

    if env::var_os("_JAVA_AWT_WM_NONREPARENTING").is_none() {
        cmd.env("_JAVA_AWT_WM_NONREPARENTING", "1");
    }
}

fn normalize_api_key(raw: String) -> String {
    raw.trim()
        .trim_matches('\u{feff}')
        .trim_matches('"')
        .trim_matches('\'')
        .trim_start_matches("Bearer ")
        .trim_start_matches("bearer ")
        .trim()
        .to_string()
}

fn build_java_http_proxy_args() -> Vec<String> {
    let _ = dotenvy::dotenv();

    let host = env_var_trim("PROXY_HOST");
    let port_str = env_var_trim("PROXY_PORT");
    let (host, port) = match (host, port_str) {
        (Some(h), Some(p)) => match p.parse::<u16>() {
            Ok(port) => (h, port),
            Err(_) => return Vec::new(),
        },
        _ => return Vec::new(),
    };

    let user = env_var_trim("PROXY_USER");
    let pass = env_var_trim("PROXY_PASS");

    let mut args = Vec::new();

    args.push(format!("-Dhttp.proxyHost={}", host));
    args.push(format!("-Dhttp.proxyPort={}", port));
    args.push(format!("-Dhttps.proxyHost={}", host));
    args.push(format!("-Dhttps.proxyPort={}", port));

    if let (Some(user), Some(pass)) = (user, pass) {
        args.push(format!("-DproxyUser={}", user));
        args.push(format!("-DproxyPass={}", pass));

        args.push(format!("-Dhttp.proxyUser={}", user));
        args.push(format!("-Dhttp.proxyPassword={}", pass));
        args.push(format!("-Dhttps.proxyUser={}", user));
        args.push(format!("-Dhttps.proxyPassword={}", pass));
    }

    args.push("-Djdk.http.auth.tunneling.disabledSchemes=".to_string());

    args.push("-Djava.net.useSystemProxies=true".to_string());

    args.push("-Dsun.net.client.defaultConnectTimeout=120000".to_string()); //2 мин
    args.push("-Dsun.net.client.defaultReadTimeout=600000".to_string());   //10 мин

    args
}

const PROXY_AUTH_BOOTSTRAP_JAVA_SOURCE: &str = include_str!("../ProxyAuthBootstrap.java");

fn ensure_proxy_auth_bootstrap_jar(
    app: &AppHandle,
    installer_jar_path: &Path,
) -> Result<PathBuf, String> {
    let out_dir = launcher_data_dir()?.join("proxy_auth_bootstrap");
    let jar_path = out_dir.join("bootstrap.jar");
    let classes_dir = out_dir.join("classes");

    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidates = [
            resource_dir.join("bootstrap.jar"),
            resource_dir.join("resources").join("bootstrap.jar"),
        ];
        for bundled_jar in &candidates {
            if bundled_jar.exists() {
                std::fs::create_dir_all(&out_dir)
                    .map_err(|e| format!("Не удалось создать папку bootstrap: {e}"))?;
                std::fs::copy(bundled_jar, &jar_path)
                    .map_err(|e| format!("Не удалось скопировать bundled bootstrap.jar: {e}"))?;
                return Ok(jar_path);
            }
        }

        let mut checked = String::new();
        for c in &candidates {
            let _ = std::fmt::Write::write_fmt(
                &mut checked,
                format_args!(
                    "{} exists={}; ",
                    c.display(),
                    c.exists()
                ),
            );
        }
        let _ = log_to_console(
            app,
            &format!(
                "[Forge] bundled bootstrap.jar не найден в resource_dir={} ({}).",
                resource_dir.display(),
                checked
            ),
        );
    }

    if jar_path.exists() {
        let jar_list = std::process::Command::new("jar")
            .arg("tf")
            .arg(&jar_path)
            .output()
            .map_err(|e| format!("Не удалось прочитать bootstrap.jar (jar tf): {e}"))?;

        if jar_list.status.success() {
            let text = String::from_utf8_lossy(&jar_list.stdout);
            if text.contains("ProxyAuthBootstrap$1.class") {
                return Ok(jar_path);
            }
        }
    }

    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Не удалось создать папку bootstrap: {e}"))?;
    std::fs::create_dir_all(&classes_dir)
        .map_err(|e| format!("Не удалось создать папку bootstrap classes: {e}"))?;

    let java_path = out_dir.join("ProxyAuthBootstrap.java");
    std::fs::write(&java_path, PROXY_AUTH_BOOTSTRAP_JAVA_SOURCE)
        .map_err(|e| format!("Не удалось сохранить ProxyAuthBootstrap.java: {e}"))?;

    if std::process::Command::new("javac")
        .arg("-version")
        .output()
        .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound)
    {
        return Err(
            "JDK не найден: javac отсутствует, а bundled bootstrap.jar не обнаружен"
                .to_string(),
        );
    }

    let javac_out = std::process::Command::new("javac")
        .arg("-encoding")
        .arg("UTF-8")
        .arg("-cp")
        .arg(installer_jar_path)
        .arg("-d")
        .arg(&classes_dir)
        .arg(&java_path)
        .output()
        .map_err(|e| format!("Не удалось запустить javac: {e}"))?;

    if !javac_out.status.success() {
        return Err(format!(
            "Не удалось скомпилировать ProxyAuthBootstrap.java (javac {}): {}",
            javac_out.status,
            String::from_utf8_lossy(&javac_out.stderr)
        ));
    }


    let _ = std::fs::remove_file(&jar_path);

    let jar_out = std::process::Command::new("jar")
        .arg("cf")
        .arg(&jar_path)
        .arg("-C")
        .arg(&classes_dir)
        .arg(".")
        .output()
        .map_err(|e| format!("Не удалось запустить jar: {e}"))?;

    if !jar_out.status.success() {
        return Err(format!(
            "Не удалось упаковать bootstrap.jar (jar {}): {}",
            jar_out.status,
            String::from_utf8_lossy(&jar_out.stderr)
        ));
    }

    Ok(jar_path)
}

const VERSION_MANIFEST_URL: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const DEFAULT_DOWNLOAD_CONCURRENCY: usize = 12;
const DEFAULT_DOWNLOAD_RETRIES: usize = 6;
const FORGE_PROMOTIONS_URL: &str =
    "https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json";
const FORGE_MAVEN_BASE: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const NEOFORGE_MAVEN_METADATA_URL: &str =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
const NEOFORGE_MAVEN_BASE: &str = "https://maven.neoforged.net/releases/net/neoforged/neoforge";
const FORGE_INSTALLER_MIN_BYTES: u64 = 1_000_000;
const BMCL_MAVEN_BASE: &str = "https://bmclapi2.bangbang93.com/maven";
const FABRIC_META_LOADERS: &str = "https://meta.fabricmc.net/v2/versions/loader";
const FABRIC_META_PROFILE: &str = "https://meta.fabricmc.net/v2/versions/loader";

pub const EVENT_DOWNLOAD_PROGRESS: &str = "download-progress";
static CANCEL_DOWNLOAD: AtomicBool = AtomicBool::new(false);
static GAME_PROCESS_PID: AtomicU64 = AtomicU64::new(0);

pub const EVENT_GAME_CONSOLE_LINE: &str = "game-console-line";

pub const EVENT_MRPACK_IMPORT_PROGRESS: &str = "mrpack-import-progress";

pub const EVENT_PLAYTIME_UPDATED: &str = "playtime-updated";

fn log_to_console(app: &AppHandle, line: &str) {
    let payload = GameConsoleLinePayload {
        line: line.to_string(),
        source: "stdout".to_string(),
    };
    let _ = app.emit(EVENT_GAME_CONSOLE_LINE, payload);
}


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

    let client = http_client(false);

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

#[derive(Debug, Serialize, Clone)]
pub struct PlaytimeUpdatedPayload {
    pub profile_id: String,
    pub delta_seconds: u64,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct JavaSettings {
    pub use_custom_jvm_args: bool,
    ///явный путь к java/javaw.по дефолту офиц runtime Mojang
    pub java_path: Option<String>,
    ///мин. объем памяти xms (1G\1024M)
    pub xms: Option<String>,
    ///макс объем памяти xmx (4G\4096M)
    pub xmx: Option<String>,
    ///доп JVM аргументы
    pub jvm_args: Option<String>,
    ///имя пресета ("balanced", "performance", "low_memory")
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
    ///полный путь к java/javaw
    pub path: String,
    ///строка с версией из `java -version`
    pub version: String,
    ///краткое описание источника (PATH, JAVA_HOME, system, runtime и т.д.)
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


fn extract_module_from_add_exports_opens_value(s: &str) -> &str {
    let before_eq = s.split('=').next().unwrap_or(s).trim();
    before_eq.split('/').next().unwrap_or(before_eq)
}

fn is_problematic_module(module: &str) -> bool {
    let m = extract_module_from_add_exports_opens_value(module);
    m.starts_with("cpw.mods.")
        || m.starts_with("org.objectweb.asm")
        || m.starts_with("org.openjdk.nashorn")
}


fn filter_forge_problematic_jvm_args(args: Vec<String>) -> (Vec<String>, Vec<String>) {
    let mut filtered = Vec::with_capacity(args.len());
    let mut removed = Vec::new();
    let mut i = 0usize;

    while i < args.len() {
        let skip = if args[i] == "--add-exports" || args[i] == "--add-opens" {
            if i + 1 < args.len() && is_problematic_module(&args[i + 1]) {
                removed.push(format!("{} {}", args[i], args[i + 1]));
                true
            } else {
                false
            }
        } else if args[i].starts_with("--add-exports=") || args[i].starts_with("--add-opens=") {
            let value = args[i].split('=').nth(1).unwrap_or("");
            if is_problematic_module(value) {
                removed.push(args[i].clone());
                true
            } else {
                false
            }
        } else {
            false
        };

        if skip {
            if (args[i] == "--add-exports" || args[i] == "--add-opens") && i + 1 < args.len() {
                i += 2;
            } else {
                i += 1;
            }
        } else {
            filtered.push(args[i].clone());
            i += 1;
        }
    }

    (filtered, removed)
}


fn ensure_forge_ignore_list_includes_vanilla_client_jar(jvm_args: &mut Vec<String>, mc_version: &str) {
    let token = format!("{mc_version}.jar");
    for arg in jvm_args.iter_mut() {
        if let Some(val) = arg.strip_prefix("-DignoreList=") {
            if val.split(',').any(|s| s == token) {
                return;
            }
            *arg = format!("-DignoreList={val},{token}");
            return;
        }
    }
}

fn ensure_forge_safe_opens(args: &mut Vec<String>) {
    let has_invoke = args.iter().any(|s| {
        s.contains("java.lang.invoke=ALL-UNNAMED") || s.contains("java.base/java.lang.invoke=ALL-UNNAMED")
    });
    if !has_invoke {
        args.push("--add-opens".to_string());
        args.push("java.base/java.lang.invoke=ALL-UNNAMED".to_string());
    }

    let has_jar = args.iter().any(|s| s.contains("java.base/java.util.jar=ALL-UNNAMED"));
    if !has_jar {
        args.push("--add-opens".to_string());
        args.push("java.base/java.util.jar=ALL-UNNAMED".to_string());
    }
}

fn remove_add_opens_for_java_under_9(args: Vec<String>) -> Vec<String> {
    let mut filtered = Vec::with_capacity(args.len());
    let mut i = 0usize;
    while i < args.len() {
        if args[i] == "--add-opens" {
            i += 2;
            continue;
        }
        if args[i].starts_with("--add-opens=") {
            i += 1;
            continue;
        }
        filtered.push(args[i].clone());
        i += 1;
    }
    filtered
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
    force_java_path: Option<PathBuf>,
) -> Result<(PathBuf, Vec<String>), String> {
    let mut java_path = if let Some(forced) = force_java_path {
        forced
    } else if let Some(custom) = java_settings
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

    if let Some(java_major) = detect_java_major_version(&java_path) {
        if java_major < 9 {
            let mut filtered: Vec<String> = Vec::with_capacity(jvm_args.len());
            let mut i = 0usize;
            while i < jvm_args.len() {
                if jvm_args[i] == "--add-opens" {
                    i += 2;
                    continue;
                }
                if jvm_args[i].starts_with("--add-opens=") {
                    i += 1;
                    continue;
                }
                filtered.push(jvm_args[i].clone());
                i += 1;
            }
            jvm_args = filtered;
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

            if a == "-p" || a == "--module-path" {
                eprintln!("[JavaSettings] Флаг модулей игнорирован: {}", a);
                i += 1;
                if i < tokens.len() {
                    i += 1;
                }
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
    #[serde(default)]
    pub game_directory: Option<String>,
    pub ram_mb: u32,
    pub show_console_on_launch: bool,
    pub close_launcher_on_game_start: bool,
    pub check_game_processes: bool,

    pub resolution_width: Option<u32>,
    pub resolution_height: Option<u32>,

    pub show_snapshots: bool,
    pub show_alpha_versions: bool,

    pub notify_new_update: bool,
    pub notify_new_message: bool,
    pub notify_system_message: bool,

    pub check_updates_on_start: bool,
    pub auto_install_updates: bool,

    pub open_launcher_on_profiles_tab: bool,

    #[serde(default = "default_ui_sounds_enabled")]
    pub ui_sounds_enabled: bool,

    #[serde(default = "default_interface_language")]
    pub interface_language: String,

    pub background_accent_color: String,
    pub background_image_url: Option<String>,

    #[serde(default = "default_background_blur_enabled")]
    pub background_blur_enabled: bool,
}

fn default_interface_language() -> String {
    "ru".to_string()
}

fn default_background_blur_enabled() -> bool {
    true
}

fn default_ui_sounds_enabled() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            game_directory: None,
            ram_mb: 4096,
            show_console_on_launch: false,
            close_launcher_on_game_start: false,
            check_game_processes: true,
            resolution_width: None,
            resolution_height: None,
            show_snapshots: false,
            show_alpha_versions: false,
            notify_new_update: true,
            notify_new_message: true,
            notify_system_message: true,
            check_updates_on_start: true,
            auto_install_updates: false,
            open_launcher_on_profiles_tab: false,
            ui_sounds_enabled: true,
            interface_language: "ru".to_string(),
            background_accent_color: "#0b1530".to_string(),
            background_image_url: None,
            background_blur_enabled: true,
        }
    }
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("settings.json"))
}

fn launcher_cache_dir() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("cache"))
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherSettingsBackupV1 {
    pub format_version: u32,
    pub exported_at_ms: u64,
    pub settings: Settings,
    pub java_settings: JavaSettings,
    #[serde(default)]
    pub sidebar_order: Option<Vec<String>>,
}

fn now_unix_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
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
pub fn reset_settings_to_default() -> Result<Settings, String> {
    let defaults = Settings::default();
    save_settings_to_disk(&defaults)?;
    Ok(defaults)
}

#[tauri::command]
pub fn export_launcher_settings_backup(
    app: AppHandle,
    path: String,
    sidebar_order: Option<Vec<String>>,
) -> Result<String, String> {
    let p = PathBuf::from(path.clone());
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку для экспорта: {e}"))?;
    }

    let settings = load_settings_from_disk();
    let java_settings = load_java_settings_internal(&app);
    let backup = LauncherSettingsBackupV1 {
        format_version: 1,
        exported_at_ms: now_unix_ms(),
        settings,
        java_settings,
        sidebar_order,
    };

    let text = serde_json::to_string_pretty(&backup)
        .map_err(|e| format!("Ошибка сериализации файла экспорта: {e}"))?;
    std::fs::write(&p, text).map_err(|e| format!("Не удалось записать файл экспорта: {e}"))?;
    Ok(path)
}

#[tauri::command]
pub fn import_launcher_settings_backup(app: AppHandle, path: String) -> Result<LauncherSettingsBackupV1, String> {
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("Не удалось прочитать файл импорта: {e}"))?;

    let parsed_backup = serde_json::from_str::<LauncherSettingsBackupV1>(&text).ok();
    let (mut settings, mut java_settings, sidebar_order) = if let Some(b) = parsed_backup {
        (b.settings, b.java_settings, b.sidebar_order)
    } else {
        let s = serde_json::from_str::<Settings>(&text)
            .map_err(|e| format!("Файл импорта не распознан (ожидался JSON настроек): {e}"))?;
        let js = load_java_settings_internal(&app);
        (s, js, None)
    };

    if settings.interface_language.trim().is_empty() {
        settings.interface_language = default_interface_language();
    }
    if settings.background_accent_color.trim().is_empty() {
        settings.background_accent_color = "#0b1530".to_string();
    }
    if java_settings.java_path.as_deref().unwrap_or("").trim().is_empty() {
        java_settings.java_path = None;
    }

    save_settings_to_disk(&settings)?;
    save_java_settings_internal(&app, &java_settings)?;

    Ok(LauncherSettingsBackupV1 {
        format_version: 1,
        exported_at_ms: now_unix_ms(),
        settings,
        java_settings,
        sidebar_order,
    })
}

#[tauri::command]
pub fn get_launcher_cache_size() -> Result<u64, String> {
    let dir = launcher_cache_dir()?;
    let (bytes, _) = dir_size_and_count(&dir);
    Ok(bytes)
}

#[tauri::command]
pub fn clear_launcher_cache() -> Result<(), String> {
    let dir = launcher_cache_dir()?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .map_err(|e| format!("Не удалось удалить кэш лаунчера: {e}"))?;
    }
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Не удалось создать папку кэша лаунчера: {e}"))?;
    Ok(())
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

fn is_minecraft_java_process_running() -> bool {
    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    for (_pid, process) in sys.processes() {
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        if !(name.contains("javaw.exe")
            || name == "javaw"
            || name == "javaw.exe"
            || name.contains("java.exe")
            || name == "java"
            || name == "java.exe")
        {
            continue;
        }

        let cmd = process
            .cmd()
            .iter()
            .map(|s| s.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase();

        let looks_like_client_launch = cmd.contains("net.minecraft.client.main.main")
            || cmd.contains("--gamedir")
            || cmd.contains("cpw.mods.bootstraplauncher")
            || cmd.contains("fabric-loader")
            || cmd.contains("org.quiltmc.loader")
            || cmd.contains("minecraft.client.main")
            || (cmd.contains("main")
                && cmd.contains("minecraft")
                && (cmd.contains("natives") || cmd.contains("--accessToken")));

        if looks_like_client_launch {
            return true;
        }
    }
    false
}

#[tauri::command]
pub fn is_game_running_now() -> Result<bool, String> {
    let pid = GAME_PROCESS_PID.load(Ordering::SeqCst);
    if pid != 0 {
        let mut sys = System::new_all();
        sys.refresh_processes(ProcessesToUpdate::All, true);

        let pid_u32 = pid as u32;
        let pid_obj = Pid::from_u32(pid_u32);
        if sys.process(pid_obj).is_some() {
            return Ok(true);
        }

        GAME_PROCESS_PID.store(0, Ordering::SeqCst);
        return Ok(false);
    }

    Ok(is_minecraft_java_process_running())
}

#[tauri::command]
pub fn stop_game() -> Result<(), String> {
    let pid = GAME_PROCESS_PID.swap(0, Ordering::SeqCst);
    if pid == 0 {
        return Ok(());
    }

    let pid_u32 = pid as u32;
    let pid_obj = Pid::from_u32(pid_u32);

    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    if let Some(process) = sys.process(pid_obj) {
        let _ = process.kill(); // best-effort kill
    }

    Ok(())
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

fn parse_java_major_version(version_line: &str) -> Option<u8> {
    let start_quote = version_line.find('"')?;
    let after = &version_line[start_quote + 1..];
    let end_quote_rel = after.find('"')?;
    let version = &after[..end_quote_rel];

    let mut parts = version.split('.');
    let first = parts.next()?;
    if first == "1" {
        let second = parts.next()?;
        second.parse::<u8>().ok()
    } else {
        first.parse::<u8>().ok()
    }
}

fn detect_java_major_version(java_path: &Path) -> Option<u8> {
    let java_path_str = java_path.to_string_lossy();
    let info = detect_java_version(java_path_str.as_ref(), "LAUNCH_JAVA_RUNTIME")?;
    parse_java_major_version(&info.version)
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
        let mut settings = Settings::default();
        settings.ram_mb = 4096;

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
            None,
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

    #[test]
    fn filter_forge_problematic_jvm_args_removes_cpw_mods() {
        let args = vec![
            "-Xms1G".to_string(),
            "--add-exports".to_string(),
            "cpw.mods.securejarhandler/cpw.mods.jar=ALL-UNNAMED".to_string(),
            "--add-opens".to_string(),
            "cpw.mods.bootstraplauncher/cpw.mods=ALL-UNNAMED".to_string(),
            "-cp".to_string(),
            "classpath".to_string(),
        ];
        let (filtered, removed) = filter_forge_problematic_jvm_args(args);
        assert!(!filtered.iter().any(|a| a.contains("cpw.mods")));
        assert_eq!(removed.len(), 2);
        assert!(removed.iter().any(|s| s.contains("securejarhandler")));
        assert!(filtered.contains(&"-Xms1G".to_string()));
        assert!(filtered.contains(&"-cp".to_string()));
    }

    #[test]
    fn filter_forge_problematic_jvm_args_removes_org_objectweb_asm() {
        let args = vec![
            "--add-exports=org.objectweb.asm/org.objectweb.asm=ALL-UNNAMED".to_string(),
            "-Xmx2G".to_string(),
        ];
        let (filtered, removed) = filter_forge_problematic_jvm_args(args);
        assert!(!filtered.iter().any(|a| a.contains("org.objectweb.asm")));
        assert_eq!(removed.len(), 1);
    }

    #[test]
    fn filter_forge_problematic_jvm_args_removes_org_openjdk_nashorn() {
        let args = vec![
            "--add-opens".to_string(),
            "org.openjdk.nashorn/org.openjdk.nashorn=ALL-UNNAMED".to_string(),
        ];
        let (filtered, _) = filter_forge_problematic_jvm_args(args);
        assert!(!filtered.iter().any(|a| a.contains("nashorn")));
    }

    #[test]
    fn filter_forge_problematic_jvm_args_preserves_java_base() {
        let args = vec![
            "--add-opens".to_string(),
            "java.base/java.lang.invoke=ALL-UNNAMED".to_string(),
            "--add-opens".to_string(),
            "java.base/java.util.jar=ALL-UNNAMED".to_string(),
        ];
        let (filtered, removed) = filter_forge_problematic_jvm_args(args);
        assert!(filtered.iter().any(|a| a.contains("java.lang.invoke")));
        assert!(filtered.iter().any(|a| a.contains("java.util.jar")));
        assert!(removed.is_empty());
    }

    #[test]
    fn remove_add_opens_for_java_under_9_removes_all() {
        let args = vec![
            "-Xms1G".to_string(),
            "--add-opens".to_string(),
            "java.base/java.lang=ALL-UNNAMED".to_string(),
            "--add-opens=java.base/java.util=ALL-UNNAMED".to_string(),
            "-cp".to_string(),
            "x".to_string(),
        ];
        let filtered = remove_add_opens_for_java_under_9(args);
        assert!(!filtered.iter().any(|a| a.contains("--add-opens")));
        assert!(filtered.contains(&"-Xms1G".to_string()));
        assert!(filtered.contains(&"-cp".to_string()));
    }

    #[test]
    fn ensure_forge_ignore_list_appends_vanilla_client_jar() {
        let mut args = vec![
            "-Xms1G".to_string(),
            "-DignoreList=asm-,forge-,1.20.2-forge-48.0.0.jar".to_string(),
        ];
        ensure_forge_ignore_list_includes_vanilla_client_jar(&mut args, "1.20.2");
        assert!(
            args[1].contains("1.20.2.jar"),
            "expected vanilla client jar in ignoreList: {:?}",
            args[1]
        );
        assert!(args[1].contains("1.20.2-forge-48.0.0.jar"));
    }

    #[test]
    fn ensure_forge_ignore_list_idempotent() {
        let mut args = vec!["-DignoreList=foo,1.20.2.jar".to_string()];
        ensure_forge_ignore_list_includes_vanilla_client_jar(&mut args, "1.20.2");
        assert_eq!(args[0], "-DignoreList=foo,1.20.2.jar");
    }

    #[test]
    fn ensure_forge_safe_opens_adds_missing() {
        let mut args = vec!["-Xms1G".to_string()];
        ensure_forge_safe_opens(&mut args);
        assert!(args.iter().any(|s| s.contains("java.lang.invoke=ALL-UNNAMED")));
        assert!(args.iter().any(|s| s.contains("java.util.jar=ALL-UNNAMED")));
    }

    #[test]
    fn ensure_forge_safe_opens_no_duplicates() {
        let mut args = vec![
            "--add-opens".to_string(),
            "java.base/java.lang.invoke=ALL-UNNAMED".to_string(),
            "--add-opens".to_string(),
            "java.base/java.util.jar=ALL-UNNAMED".to_string(),
        ];
        ensure_forge_safe_opens(&mut args);
        let invoke_count = args.iter().filter(|s| s.contains("java.lang.invoke")).count();
        let jar_count = args.iter().filter(|s| s.contains("java.util.jar")).count();
        assert_eq!(invoke_count, 1);
        assert_eq!(jar_count, 1);
    }

    #[test]
    fn forge_jvm_args_preserve_cp_xms_xmx_library_path() {
        let args = vec![
            "-Xms512M".to_string(),
            "-Xmx4G".to_string(),
            "-Djava.library.path=C:\\natives".to_string(),
            "-cp".to_string(),
            "a.jar;b.jar".to_string(),
            "--add-exports".to_string(),
            "cpw.mods.securejarhandler/cpw.mods=ALL-UNNAMED".to_string(),
        ];
        let (filtered, _) = filter_forge_problematic_jvm_args(args);
        assert!(filtered.iter().any(|a| a.starts_with("-Xms")));
        assert!(filtered.iter().any(|a| a.starts_with("-Xmx")));
        assert!(filtered.iter().any(|a| a.contains("java.library.path")));
        assert!(filtered.contains(&"-cp".to_string()));
        assert!(filtered.contains(&"a.jar;b.jar".to_string()));
    }

    #[test]
    fn is_forge_profile_detects_version_id() {
        let libs: Vec<Library> = vec![];
        assert!(is_forge_profile("1.20.3-forge-49.0.2", "net.minecraft.client.main.Main", &libs));
        assert!(is_forge_profile("1.20.3-forge49.0.2", "x", &libs));
        assert!(!is_forge_profile("1.20.1", "net.minecraft.client.main.Main", &libs));
    }

    #[test]
    fn is_forge_profile_detects_main_class() {
        let libs: Vec<Library> = vec![];
        assert!(is_forge_profile("1.20.1", "cpw.mods.bootstraplauncher.BootstrapLauncher", &libs));
    }

    #[test]
    fn is_forge_profile_detects_libraries() {
        let lib: Library = serde_json::from_str(r#"{"name":"cpw.mods:bootstraplauncher:1.2.3"}"#).unwrap();
        let libs = vec![lib];
        assert!(is_forge_profile("1.20.1", "net.minecraft.client.main.Main", &libs));
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

#[derive(Debug, Serialize, Clone)]
pub struct VersionIntegrityCheckResult {
    pub is_ok: bool,
    pub checked_files: u32,
    pub missing_files: u32,
    pub corrupted_files: u32,
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
    #[serde(rename = "inheritsFrom", default)]
    inherits_from: Option<String>,
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
    #[serde(default)]
    sha1: Option<String>,
    size: u64,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
struct VersionArguments {
    #[serde(default)]
    jvm: Vec<ArgumentValue>,
    #[serde(default)]
    game: Vec<ArgumentValue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
enum ArgumentValue {
    String(String),
    WithRules {
        rules: Vec<ArgRule>,
        value: serde_json::Value,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
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
    #[serde(default)]
    sha1: Option<String>,
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


fn is_forge_profile(version_id: &str, main_class: &str, libraries: &[Library]) -> bool {
    let version_lower = version_id.to_lowercase();
    let main_class_lower = main_class.to_lowercase();

    if version_lower.contains("forge") {
        return true;
    }
    if main_class_lower.contains("bootstraplauncher") || main_class_lower.contains("cpw.mods.bootstraplauncher") {
        return true;
    }
    if main_class_lower.contains("forge") && !main_class_lower.contains("neoforge") {
        return true;
    }

    for lib in libraries {
        let name_lower = lib.name.to_lowercase();
        if name_lower.contains("forge:forge")
            || name_lower.contains("net.minecraftforge:forge")
            || name_lower.contains("cpw.mods:bootstraplauncher")
            || name_lower.contains("cpw.mods:securejarhandler")
            || (name_lower.starts_with("cpw.mods:") && !name_lower.contains("neoforge"))
        {
            return true;
        }
    }

    false
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
    sha1: Option<String>,
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

#[derive(Debug, Serialize, Clone)]
pub struct ForgeVersionSummary {
    pub id: String,
    pub mc_version: String,
    pub forge_build: String,
    pub installer_url: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct NeoForgeVersionSummary {
    pub id: String,
    pub mc_version: String,
    pub neoforge_build: String,
    pub installer_url: String,
}

fn game_root_dir() -> Result<PathBuf, String> {
    let settings = load_settings_from_disk();
    if let Some(raw) = settings.game_directory {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LauncherAccountEntry {
    id: String,
    profile: Profile,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct LauncherAccountsStore {
    #[serde(default)]
    active_id: Option<String>,
    #[serde(default)]
    accounts: Vec<LauncherAccountEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherAccountSummary {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub is_active: bool,
}

fn launcher_accounts_path() -> Result<PathBuf, String> {
    Ok(launcher_data_dir()?.join("accounts.json"))
}

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

fn read_profile_from_disk() -> Result<Profile, String> {
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
    let has_mc = p.mc_uuid.as_ref().map_or(false, |s| !s.trim().is_empty());
    let has_ms = p.ms_access_token.is_some() || p.ms_id_token.is_some();
    if has_mc && has_ms {
        return "microsoft";
    }
    let has_ely = p.ely_uuid.as_ref().map_or(false, |s| !s.trim().is_empty());
    if has_ely {
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
        let has_online_identity = profile.mc_uuid.as_ref().map_or(false, |s| !s.trim().is_empty())
            || profile.ely_uuid.as_ref().map_or(false, |s| !s.trim().is_empty());
        if has_online_identity {
            let id = new_launcher_account_id();
            store
                .accounts
                .push(LauncherAccountEntry {
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

pub(crate) fn persist_profile_json(profile: &Profile) -> Result<(), String> {
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
pub fn get_profile() -> Result<Profile, String> {
    if !launcher_accounts_path()?.exists() {
        let _ = load_accounts_store()?;
    }
    read_profile_from_disk()
}

#[tauri::command]
pub fn set_profile(nickname: String) -> Result<(), String> {
    let mut profile = get_profile()?;
    profile.nickname = nickname;
    save_full_profile(&profile)?;
    Ok(())
}

pub(crate) fn save_full_profile(profile: &Profile) -> Result<(), String> {
    persist_profile_json(profile)?;
    upsert_launcher_accounts_store(profile)?;
    Ok(())
}

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

fn image_path_to_data_uri(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(path)
        .map_err(|e| format!("Не удалось прочитать файл изображения: {e}"))?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "png" | _ => "image/png",
    };
    let encoded = BASE64_STANDARD.encode(bytes);
    Ok(Some(format!("data:{};base64,{}", mime, encoded)))
}

#[tauri::command]
pub fn set_background_image(source_path: Option<String>) -> Result<Option<String>, String> {
    let mut settings = load_settings_from_disk();

    let new_path = if let Some(src) = source_path {
        let path = Path::new(&src);
        if !path.exists() {
            return Err("Файл не найден.".to_string());
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png");
        let data_dir = launcher_data_dir()?;
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Не удалось создать папку данных лаунчера: {e}"))?;
        let dest = data_dir.join(format!("background.{}", ext));
        std::fs::copy(path, &dest)
            .map_err(|e| format!("Не удалось скопировать файл: {e}"))?;
        Some(
            dest.to_str()
                .ok_or("Путь не в UTF-8")?
                .to_string(),
        )
    } else {
        None
    };

    if new_path.is_none() {
        if let Some(old) = settings.background_image_url.as_ref() {
            let old_path = PathBuf::from(old);
            if let Ok(data_dir) = launcher_data_dir() {
                if old_path.starts_with(&data_dir) {
                    let _ = std::fs::remove_file(&old_path);
                }
            }
        }
    }

    settings.background_image_url = new_path.clone();
    save_settings_to_disk(&settings)?;
    Ok(new_path)
}

#[tauri::command]
pub fn get_background_data_uri() -> Result<Option<String>, String> {
    let settings = load_settings_from_disk();
    let path_str = match settings.background_image_url {
        Some(p) => p,
        None => return Ok(None),
    };
    let path = PathBuf::from(path_str);
    image_path_to_data_uri(&path)
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
    #[serde(default)]
    pub play_time_seconds: u64,
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
    pub play_time_seconds: u64,
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

fn find_icon_png_in_profile(root: &Path) -> Option<String> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let meta = match entry.metadata() {
                Ok(meta) => meta,
                Err(_) => continue,
            };
            if meta.is_dir() {
                stack.push(path);
                continue;
            }
            let is_icon_png = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.eq_ignore_ascii_case("icon.png"))
                .unwrap_or(false);
            if is_icon_png {
                return path.to_str().map(|s| s.to_string());
            }
        }
    }
    None
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

        let icon_path = find_icon_png_in_profile(&path).or(cfg.icon_path);

        out.push(InstanceProfileSummary {
            id: cfg.id,
            name: cfg.name,
            icon_path,
            game_version: cfg.game_version,
            loader: cfg.loader,
            created_at: cfg.created_at,
            play_time_seconds: cfg.play_time_seconds,
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

#[tauri::command]
pub fn get_profile_play_time_seconds(profile_id: String) -> Result<u64, String> {
    let cfg_path = instance_config_path(&profile_id)?;
    if !cfg_path.exists() {
        return Ok(0);
    }
    let text = std::fs::read_to_string(&cfg_path)
        .map_err(|e| format!("Ошибка чтения config.json для playtime: {e}"))?;
    let cfg: InstanceConfig = serde_json::from_str(&text)
        .map_err(|e| format!("Ошибка разбора config.json для playtime: {e}"))?;
    Ok(cfg.play_time_seconds)
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
            let dest = dir.join("icon.png");
            std::fs::copy(&src_path, &dest)
                .map_err(|e| format!("Не удалось скопировать иконку сборки: {e}"))?;
            icon_path = dest.to_str().map(|s| s.to_string());
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
        play_time_seconds: 0,
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
        play_time_seconds: 0,
        mods_count,
        resourcepacks_count: res_count,
        shaderpacks_count: shader_count,
        total_size_bytes,
        directory,
    })
}

fn add_play_time_seconds_to_profile(profile_id: &str, delta_secs: u64) -> Result<(), String> {
    let cfg_path = instance_config_path(profile_id)?;
    if !cfg_path.exists() {
        return Ok(());
    }

    let text = std::fs::read_to_string(&cfg_path)
        .map_err(|e| format!("Ошибка чтения config.json для playtime: {e}"))?;

    let mut cfg: InstanceConfig = match serde_json::from_str(&text) {
        Ok(c) => c,
        Err(_) => return Ok(()), 
    };

    cfg.play_time_seconds = cfg.play_time_seconds.saturating_add(delta_secs);

    let new_text = serde_json::to_string_pretty(&cfg)
        .map_err(|e| format!("Ошибка сериализации config.json для playtime: {e}"))?;

    std::fs::write(&cfg_path, new_text)
        .map_err(|e| format!("Ошибка записи config.json для playtime: {e}"))?;

    Ok(())
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

    let client = http_client(false);

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

    let client = http_client(false);
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
        icon_path: {
            let icon_png_path = dir.join("icon.png");
            if icon_png_path.exists() {
                icon_png_path.to_str().map(|s| s.to_string())
            } else {
                profile.icon_path
            }
        },
        game_version: profile.game_version,
        loader: profile.loader,
        created_at: profile.created_at,
        play_time_seconds: profile.play_time_seconds,
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

async fn ensure_library_artifacts_present_for_launch(
    app: &AppHandle,
    version_id: &str,
    libs_root: &Path,
    libraries: &[Library],
    os_name: &str,
) -> Result<(), String> {
    let client = http_client_for_binary_download(true);
    let total_done = Arc::new(AtomicU64::new(0));

    for lib in libraries {
        if !library_applies(lib, os_name) {
            continue;
        }
        let Some(ref a) = lib.downloads.artifact else {
            continue;
        };
        let path = libs_root.join(&a.path);
        if path.exists() {
            continue;
        }

        let url = if !a.url.trim().is_empty() {
            a.url.clone()
        } else {
            format!("{}/{}", BMCL_MAVEN_BASE, a.path)
        };

        eprintln!(
            "[Launch] Missing library artifact, downloading: {}",
            path.display()
        );
        download_file_checked(
            &client,
            &url,
            &path,
            a.sha1.clone(),
            app,
            version_id,
            0,
            total_done.clone(),
            DEFAULT_DOWNLOAD_RETRIES,
        )
        .await?;
    }

    Ok(())
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
    let current_arch = std::env::consts::ARCH;
    let mut allowed = false;
    for r in &lib.rules {
        if let Some(rule_os) = r.os.as_ref() {
            if let Some(name) = rule_os.name.as_deref() {
                if name != os_name {
                    continue;
                }
            }
            if let Some(arch) = rule_os.arch.as_deref() {
                if !current_arch.contains(arch) {
                    continue;
                }
            }
        }
        match r.action.as_str() {
            "allow" => allowed = true,
            "disallow" => return false,
            _ => {}
        }
    }
    allowed
}

fn parse_library_coords(name: &str) -> Option<(&str, &str, &str)> {
    let mut parts = name.splitn(3, ':');
    let group = parts.next()?;
    let artifact = parts.next()?;
    let version = parts.next()?;
    if group.is_empty() || artifact.is_empty() || version.is_empty() {
        return None;
    }
    Some((group, artifact, version))
}

fn compare_version_like(a: &str, b: &str) -> std::cmp::Ordering {
    let av = a
        .split(|c: char| !(c.is_ascii_alphanumeric()))
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>();
    let bv = b
        .split(|c: char| !(c.is_ascii_alphanumeric()))
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>();
    let n = av.len().max(bv.len());
    for i in 0..n {
        let aa = av.get(i).copied().unwrap_or("0");
        let bb = bv.get(i).copied().unwrap_or("0");
        let ord = match (aa.parse::<u64>(), bb.parse::<u64>()) {
            (Ok(na), Ok(nb)) => na.cmp(&nb),
            _ => aa.cmp(bb),
        };
        if ord != std::cmp::Ordering::Equal {
            return ord;
        }
    }
    std::cmp::Ordering::Equal
}

fn native_classifier_candidates(lib: &Library, os_name: &str) -> Vec<String> {
    let mut out = Vec::<String>::new();
    let is_64 = std::env::consts::ARCH == "x86_64";
    let base = match os_name {
        "windows" => "natives-windows",
        "osx" => "natives-macos",
        _ => "natives-linux",
    };
    out.push(base.to_string());
    if os_name == "windows" {
        if is_64 {
            out.push("natives-windows-64".to_string());
            out.push("natives-windows-x86_64".to_string());
        } else {
            out.push("natives-windows-32".to_string());
            out.push("natives-windows-x86".to_string());
        }
    }
    if let Some(map) = &lib.natives {
        if let Some(value) = map.get(os_name).and_then(|v| v.as_str()) {
            let replaced = value.replace("${arch}", if is_64 { "64" } else { "32" });
            out.push(replaced);
        }
    }
    out.sort();
    out.dedup();
    out
}

fn is_probably_native_jar_path(rel_path: &str) -> bool {
    let p = rel_path.replace('\\', "/").to_ascii_lowercase();
    p.ends_with(".jar") && p.contains("-natives-")
}

fn resolve_native_artifact<'a>(lib: &'a Library, os_name: &str) -> Option<&'a LibraryArtifact> {
    let classifiers = lib.downloads.classifiers.as_ref()?;
    for key in native_classifier_candidates(lib, os_name) {
        if let Some(artifact) = classifiers.get(&key) {
            return Some(artifact);
        }
    }
    None
}

fn is_release_1_17_or_newer(version_id: &str) -> bool {
    let normalized = version_id
        .split_once('-')
        .map(|(base, _)| base)
        .unwrap_or(version_id);
    let mut parts = normalized.split('.');
    let major = parts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    major > 1 || (major == 1 && minor >= 17)
}

fn lwjgl_fallback_modules() -> &'static [&'static str] {
    &[
        "lwjgl",
        "lwjgl-glfw",
        "lwjgl-openal",
        "lwjgl-opengl",
        "lwjgl-stb",
        "lwjgl-freetype",
        "lwjgl-tinyfd",
    ]
}

async fn ensure_lwjgl_fallback_for_modern_versions(
    app: &AppHandle,
    version_id: &str,
    libs_root: &Path,
    classpath: &mut Vec<PathBuf>,
    seen_paths: &mut HashSet<String>,
    os_name: &str,
) -> Result<(), String> {
    if !is_release_1_17_or_newer(version_id) {
        return Ok(());
    }
    let has_lwjgl_glfw = classpath.iter().any(|p| {
        p.file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.starts_with("lwjgl-glfw-"))
            .unwrap_or(false)
    });
    if has_lwjgl_glfw {
        return Ok(());
    }
    let lwjgl_version = "3.3.3";
    let native_classifier = match os_name {
        "windows" => "natives-windows",
        "osx" => "natives-macos",
        _ => "natives-linux",
    };
    let client = http_client_for_binary_download(true);
    let total_done = Arc::new(AtomicU64::new(0));
    log_to_console(
        app,
        &format!(
            "[Launch] LWJGL fallback активирован для {version_id}: докачка {lwjgl_version}"
        ),
    );
    for module in lwjgl_fallback_modules() {
        let rel = format!("org/lwjgl/{module}/{lwjgl_version}/{module}-{lwjgl_version}.jar");
        let path = libs_root.join(&rel);
        if !path.exists() {
            let url = format!("{BMCL_MAVEN_BASE}/{rel}");
            download_file_checked(
                &client,
                &url,
                &path,
                None,
                app,
                version_id,
                0,
                total_done.clone(),
                DEFAULT_DOWNLOAD_RETRIES,
            )
            .await?;
        }
        let key = path.to_str().unwrap_or("").replace('\\', "/");
        if seen_paths.insert(key) {
            classpath.push(path);
        }

        let native_rel = format!(
            "org/lwjgl/{module}/{lwjgl_version}/{module}-{lwjgl_version}-{native_classifier}.jar"
        );
        let native_path = libs_root.join(&native_rel);
        if !native_path.exists() {
            let url = format!("{BMCL_MAVEN_BASE}/{native_rel}");
            let _ = download_file_checked(
                &client,
                &url,
                &native_path,
                None,
                app,
                version_id,
                0,
                total_done.clone(),
                DEFAULT_DOWNLOAD_RETRIES,
            )
            .await;
        }
    }
    Ok(())
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

    let total_done = Arc::new(AtomicU64::new(offset_downloaded));
    download_file_checked(
        client,
        url,
        path,
        None,
        app,
        version_id,
        total_size,
        total_done,
        DEFAULT_DOWNLOAD_RETRIES,
    )
    .await
}

async fn download_text_with_retries(client: &Client, url: &str, retries: usize) -> Result<String, String> {
    let mut attempt: usize = 0;
    loop {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            return Err("Загрузка отменена пользователем".to_string());
        }
        let resp = client.get(url).send().await;
        match resp {
            Ok(r) => {
                let status = r.status();
                if status.is_success() {
                    return r.text().await.map_err(|e| format!("Ошибка чтения ответа: {e}"));
                }
                let should_retry = status.as_u16() == 404
                    || status.as_u16() == 408
                    || status.as_u16() == 429
                    || status.is_server_error();
                if !should_retry || attempt + 1 >= retries {
                    let body = r.text().await.unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
                    return Err(format!("HTTP {} для {}: {}", status, url, body));
                }
            }
            Err(e) => {
                if attempt + 1 >= retries {
                    return Err(format!("Ошибка запроса {url}: {e}"));
                }
            }
        }
        let delay_ms = (1000u64).saturating_mul(2u64.saturating_pow(attempt.min(6) as u32));
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        attempt += 1;
    }
}

fn sha1_hex_of_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha1::new();
    hasher.update(bytes);
    let out = hasher.finalize();
    format!("{:x}", out)
}

async fn sha1_hex_of_file(path: &Path) -> Result<String, String> {
    let data = tokio::fs::read(path)
        .await
        .map_err(|e| {
            format!(
                "Не удалось прочитать файл '{}' для SHA1: {e}",
                path.display()
            )
        })?;
    Ok(sha1_hex_of_bytes(&data))
}

async fn try_fetch_remote_sha1(client: &Client, url: &str) -> Option<String> {
    let sha1_url = format!("{url}.sha1");
    let text = download_text_with_retries(client, &sha1_url, 2).await.ok()?;
    let s = text.trim();
    if s.len() >= 40 {
        Some(s[..40].to_ascii_lowercase())
    } else {
        None
    }
}

async fn try_resolve_one_redirect_location(url: &str) -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .connect_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) 16Launcher/1.0 Chrome/122.0.0.0 Safari/537.36")
        .build()
        .ok()?;

    let resp = client.get(url).send().await.ok()?;
    if !resp.status().is_redirection() {
        return None;
    }
    let loc = resp.headers().get(reqwest::header::LOCATION)?.to_str().ok()?.trim();
    if loc.is_empty() {
        return None;
    }
    if loc.starts_with("http://") || loc.starts_with("https://") {
        Some(loc.to_string())
    } else {
        None
    }
}

fn parse_forge_id(id: &str) -> Option<(String, String)> {
    let mut parts = id.split("-forge-");
    let mc = parts.next()?.trim();
    let forge = parts.next()?.trim();
    if mc.is_empty() || forge.is_empty() {
        return None;
    }
    Some((mc.to_string(), forge.to_string()))
}

fn parse_neoforge_id(id: &str) -> Option<(String, String)> {
    let mut parts = id.split("-neoforge-");
    let mc = parts.next()?.trim();
    let neoforge = parts.next()?.trim();
    if mc.is_empty() || neoforge.is_empty() {
        return None;
    }
    Some((mc.to_string(), neoforge.to_string()))
}

async fn file_starts_with_pk(path: &Path) -> Result<bool, String> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || -> Result<bool, String> {
        use std::io::Read;
        let mut f = std::fs::File::open(&path)
            .map_err(|e| format!("Не удалось открыть файл для проверки заголовка: {e}"))?;
        let mut buf = [0u8; 4];
        let n = f
            .read(&mut buf)
            .map_err(|e| format!("Не удалось прочитать заголовок файла: {e}"))?;
        if n < 2 {
            return Ok(false);
        }
        Ok(buf[0] == b'P' && buf[1] == b'K')
    })
    .await
    .map_err(|e| format!("Ошибка проверки файла: {e}"))?
}

fn ensure_launcher_profiles_json(game_dir: &Path, mc_version: &str) -> Result<(), String> {

    let launcher_profiles_path = game_dir.join("launcher_profiles.json");
    let game_dir_str = game_dir
        .to_str()
        .ok_or("Путь к gameDir не в UTF-8")?
        .to_string();

    let profile_key = format!("mc16launcher-forge-{}", mc_version);

    let mut root_obj = if launcher_profiles_path.exists() {
        let text = std::fs::read_to_string(&launcher_profiles_path)
            .map_err(|e| format!("Не удалось прочитать launcher_profiles.json: {e}"))?;
        serde_json::from_str::<serde_json::Value>(&text).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if !root_obj.get("profiles").is_some() || !root_obj["profiles"].is_object() {
        root_obj["profiles"] = serde_json::json!({});
    }

    let profiles_obj = root_obj["profiles"].as_object_mut().ok_or_else(|| {
        "launcher_profiles.json: поле profiles не является объектом".to_string()
    })?;

    let mut found_key: Option<String> = None;
    for (k, v) in profiles_obj.iter() {
        if v.get("gameDir").and_then(|x| x.as_str()) == Some(game_dir_str.as_str()) {
            found_key = Some(k.clone());
            break;
        }
    }

    if found_key.is_none() {
        profiles_obj.insert(
            profile_key.clone(),
            serde_json::json!({
                "name": profile_key,
                "gameDir": game_dir_str,
                "lastVersionId": mc_version,
                "type": "custom",
                "created": "1970-01-01T00:00:00.000Z",
                "lastUsed": "1970-01-01T00:00:00.000Z"
            }),
        );
        found_key = Some(profile_key.clone());
    }

    let selected_profile = found_key.ok_or_else(|| "Не удалось определить selectedProfile".to_string())?;
    root_obj["selectedProfile"] = serde_json::Value::String(selected_profile);

    if !root_obj.get("clientToken").is_some() {
        root_obj["clientToken"] =
            serde_json::Value::String("00000000-0000-0000-0000-000000000000".to_string());
    }
    if !root_obj.get("authenticationDatabase").is_some() || !root_obj["authenticationDatabase"].is_object() {
        root_obj["authenticationDatabase"] = serde_json::json!({});
    }
    if !root_obj.get("selectedUser").is_some() {
        root_obj["selectedUser"] = serde_json::Value::String("00000000000000000000000000000000".to_string());
    }
    if !root_obj.get("launcherVersion").is_some() {
        root_obj["launcherVersion"] = serde_json::json!({"name": "1.5.3", "format": 17});
    }

    let text = serde_json::to_string_pretty(&root_obj)
        .map_err(|e| format!("Не удалось сериализовать launcher_profiles.json: {e}"))?;
    std::fs::write(&launcher_profiles_path, text)
        .map_err(|e| format!("Не удалось записать launcher_profiles.json: {e}"))?;
    Ok(())
}

async fn download_forge_installer_once(
    client: &Client,
    url: &str,
    path: &Path,
    app: &AppHandle,
    version_id: &str,
    total_done: Arc<AtomicU64>,
) -> Result<u64, String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Не удалось создать папку: {e}"))?;
    }

    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
        return Err("Загрузка отменена пользователем".to_string());
    }

    let tmp_path = path.with_extension("part");
    let mut file = tokio::fs::File::create(&tmp_path)
        .await
        .map_err(|e| format!("Не удалось создать файл: {e}"))?;


    let resp = client
        .get(url)
        .header(ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса Forge installer: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        if status.as_u16() == 404 || status.is_server_error() {
            return Err("Версия Forge не найдена".to_string());
        }
        return Err(format!("HTTP {status} при запросе Forge installer"));
    }

    let ct = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("<нет>");
    log_to_console(app, &format!("[Forge] Content-Type installer: {ct}"));
    if ct.to_ascii_lowercase().starts_with("text/html") {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err("Версия Forge не найдена".to_string());
    }

    let content_len = resp.content_length().unwrap_or(0);
    if content_len < FORGE_INSTALLER_MIN_BYTES {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err("Версия Forge не найдена".to_string());
    }

    let effective_total = content_len;

    let mut raw = resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения потока: {e}"))?;

    if raw.len() >= 2 && raw[0] == 0x1f && raw[1] == 0x8b {
        let mut decoder = GzDecoder::new(raw.as_ref());
        let mut out = Vec::new();
        decoder
            .read_to_end(&mut out)
            .map_err(|e| format!("Ошибка распаковки gzip (Forge installer): {e}"))?;
        raw = out.into();
    }

    let bytes = raw;

    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err("Загрузка отменена пользователем".to_string());
    }

    tokio::io::AsyncWriteExt::write_all(&mut file, &bytes)
        .await
        .map_err(|e| format!("Ошибка записи: {e}"))?;

    let downloaded = bytes.len() as u64;
    total_done.fetch_add(downloaded, Ordering::SeqCst);

    let percent = if effective_total > 0 {
        downloaded as f32 / effective_total as f32 * 100.0
    } else {
        100.0
    };
    let _ = app.emit(
        EVENT_DOWNLOAD_PROGRESS,
        DownloadProgressPayload {
            version_id: version_id.to_string(),
            downloaded,
            total: effective_total,
            percent,
        },
    );

    drop(file);
    let _ = tokio::fs::remove_file(path).await;
    tokio::fs::rename(&tmp_path, path)
        .await
        .map_err(|e| format!("Не удалось переместить файл: {e}"))?;
    Ok(downloaded)
}

async fn download_file_checked(
    client: &Client,
    url: &str,
    path: &Path,
    expected_sha1: Option<String>,
    app: &AppHandle,
    version_id: &str,
    total_size: u64,
    total_done: Arc<AtomicU64>,
    retries: usize,
) -> Result<u64, String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Не удалось создать папку: {e}"))?;
    }

    let mut attempt: usize = 0;
    loop {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            return Err("Загрузка отменена пользователем".to_string());
        }

        if path.exists() {
            if let Some(expected) = expected_sha1.as_ref() {
                let actual = sha1_hex_of_file(path).await?;
                if actual.eq_ignore_ascii_case(expected) {
                    return Ok(0);
                }
                let _ = tokio::fs::remove_file(path).await;
            } else {
                return Ok(0);
            }
        }

        let unique_id = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let tmp_path = path.with_extension(format!("part-{}-{}", std::process::id(), unique_id));
        let mut file = tokio::fs::File::create(&tmp_path)
            .await
            .map_err(|e| format!("Не удалось создать файл: {e}"))?;

        let resp = client.get(url).send().await;
        let resp = match resp {
            Ok(r) => r,
            Err(e) => {
                if attempt + 1 >= retries {
                    let _ = tokio::fs::remove_file(&tmp_path).await;
                    return Err(format!("Ошибка загрузки {url}: {e}"));
                }
                let _ = tokio::fs::remove_file(&tmp_path).await;
                let delay_ms = (1000u64).saturating_mul(2u64.saturating_pow(attempt.min(6) as u32));
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                attempt += 1;
                continue;
            }
        };

        let status = resp.status();
        if !status.is_success() {
            let should_retry = status.as_u16() == 404
                || status.as_u16() == 408
                || status.as_u16() == 429
                || status.is_server_error();
            let body = resp.text().await.unwrap_or_else(|_| "<тело ответа недоступно>".to_string());
            if !should_retry || attempt + 1 >= retries {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return Err(format!("HTTP {} для {}: {}", status, url, body));
            }
            let _ = tokio::fs::remove_file(&tmp_path).await;
            let delay_ms = (1000u64).saturating_mul(2u64.saturating_pow(attempt.min(6) as u32));
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            attempt += 1;
            continue;
        }

        let content_len = resp.content_length().unwrap_or(0);
        let effective_total = if total_size > 0 { total_size } else { content_len };

        let mut downloaded: u64 = 0;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return Err("Загрузка отменена пользователем".to_string());
            }
            let chunk = chunk.map_err(|e| format!("Ошибка чтения потока: {e}"))?;
            tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
                .await
                .map_err(|e| format!("Ошибка записи: {e}"))?;
            downloaded += chunk.len() as u64;
            let total_now = total_done.fetch_add(chunk.len() as u64, Ordering::SeqCst) + (chunk.len() as u64);
            let (reported_done, percent) = if total_size > 0 {
                let p = if effective_total > 0 {
                    total_now as f32 / effective_total as f32 * 100.0
                } else {
                    0.0
                };
                (total_now, p)
            } else {
                let p = if effective_total > 0 {
                    downloaded as f32 / effective_total as f32 * 100.0
                } else {
                    0.0
                };
                (downloaded, p)
            };
            let _ = app.emit(
                EVENT_DOWNLOAD_PROGRESS,
                DownloadProgressPayload {
                    version_id: version_id.to_string(),
                    downloaded: reported_done,
                    total: effective_total,
                    percent,
                },
            );
        }

        drop(file);

        if let Some(expected) = expected_sha1.clone() {
            let actual = sha1_hex_of_file(&tmp_path).await?;
            if actual.to_ascii_lowercase() != expected.to_ascii_lowercase() {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                if attempt + 1 >= retries {
                    return Err(format!(
                        "SHA1 не совпал для {} (ожидалось {}, получено {})",
                        path.display(),
                        expected,
                        actual
                    ));
                }
                let delay_ms = (800u64).saturating_mul(2u64.saturating_pow(attempt.min(6) as u32));
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                attempt += 1;
                continue;
            }
        }

        if path.exists() {
            if let Some(expected) = expected_sha1.as_ref() {
                let actual_existing = sha1_hex_of_file(path).await?;
                if actual_existing.eq_ignore_ascii_case(expected) {
                    let _ = tokio::fs::remove_file(&tmp_path).await;
                    return Ok(downloaded);
                }
                let _ = tokio::fs::remove_file(path).await;
            } else {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return Ok(downloaded);
            }
        }

        match tokio::fs::rename(&tmp_path, path).await {
            Ok(()) => return Ok(downloaded),
            Err(e) => {
                if path.exists() {
                    if let Some(expected) = expected_sha1.as_ref() {
                        let actual_existing = sha1_hex_of_file(path).await?;
                        if actual_existing.eq_ignore_ascii_case(expected) {
                            let _ = tokio::fs::remove_file(&tmp_path).await;
                            return Ok(downloaded);
                        }
                    } else {
                        let _ = tokio::fs::remove_file(&tmp_path).await;
                        return Ok(downloaded);
                    }
                }
                return Err(format!(
                    "Не удалось финализировать файл: {e} (url: {url}, target: {})",
                    path.display()
                ));
            }
        }
    }
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
        let text = download_text_with_retries(client, &asset_index.url, DEFAULT_DOWNLOAD_RETRIES).await?;
        tokio::fs::write(&index_path, &text)
            .await
            .map_err(|e| format!("Не удалось сохранить индекс: {e}"))?;
        text
    };

    let index: AssetIndexJson = serde_json::from_str(&index_json)
        .map_err(|e| format!("Ошибка разбора индекса ассетов: {e}"))?;

    let sem = Arc::new(Semaphore::new(DEFAULT_DOWNLOAD_CONCURRENCY));
    let total_done = Arc::new(AtomicU64::new(total_downloaded));
    let mut tasks = futures_util::stream::FuturesUnordered::new();

    for (_path, obj) in &index.objects {
        if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
            return Err("Загрузка отменена пользователем".to_string());
        }
        let hash = obj.hash.clone();
        let size = obj.size;
        if hash.len() < 2 {
            continue;
        }
        let prefix = hash[..2].to_string();
        let obj_path = objects_dir.join(&prefix).join(&hash);
        if obj_path.exists() {
            total_done.fetch_add(size, Ordering::SeqCst);
            continue;
        }
        let url = format!("{ASSETS_BASE_URL}/{prefix}/{hash}");
        let client = client.clone();
        let app = app.clone();
        let sem = sem.clone();
        let total_done = total_done.clone();
        let version_id = version_id.to_string();
        let obj_path2 = obj_path.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = sem.acquire_owned().await.map_err(|_| "Semaphore закрыт".to_string())?;
            if let Some(parent) = obj_path2.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| format!("Не удалось создать папку: {e}"))?;
            }
            download_file_checked(
                &client,
                &url,
                &obj_path2,
                Some(hash),
                &app,
                &version_id,
                total_size,
                total_done,
                DEFAULT_DOWNLOAD_RETRIES,
            )
            .await?;
            Ok::<(), String>(())
        }));
    }

    while let Some(res) = tasks.next().await {
        res.map_err(|e| format!("Ошибка задачи загрузки ассетов: {e}"))??;
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
    let client = http_client(false);
    let text = download_text_with_retries(&client, VERSION_MANIFEST_URL, DEFAULT_DOWNLOAD_RETRIES)
        .await
        .map_err(|e| format!("Ошибка загрузки манифеста версий: {e}"))?;
    let manifest: VersionManifest = serde_json::from_str(&text).map_err(|e| {
        let head = text.chars().take(200).collect::<String>();
        format!("Ошибка разбора манифеста версий: {e}. Первые символы ответа: {head}")
    })?;

    let mut summaries: Vec<VersionSummary> =
        manifest.versions.into_iter().map(VersionSummary::from).collect();

    summaries.sort_by(|a, b| b.release_time.cmp(&a.release_time));

    Ok(summaries)
}

async fn get_mojang_version_url(version_id: &str) -> Result<String, String> {
    let client = http_client(false);
    let text = download_text_with_retries(&client, VERSION_MANIFEST_URL, DEFAULT_DOWNLOAD_RETRIES)
        .await
        .map_err(|e| format!("Ошибка запроса манифеста: {e}"))?;
    let manifest: VersionManifest = serde_json::from_str(&text)
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
pub async fn open_profile_folder(profile_id: String) -> Result<(), String> {
    let root = instance_dir(&profile_id)?;
    std::fs::create_dir_all(&root).map_err(|e| format!("Не удалось создать папку сборки: {e}"))?;
    let path_str = root
        .to_str()
        .ok_or_else(|| "Путь к папке сборки не в UTF-8".to_string())?;

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
pub async fn open_game_folder(profile_id: Option<String>) -> Result<(), String> {
    let root = if let Some(id) = profile_id {
        instance_dir(&id)?
    } else {
        game_root_dir()?
    };
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
pub async fn download_modrinth_modpack_and_import(
    app: AppHandle,
    url: String,
    filename: String,
) -> Result<InstanceProfileSummary, String> {
    let root = launcher_data_dir()?
        .join("tmp")
        .join("modrinth_modpacks");
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("Не удалось создать temp-папку: {e}"))?;

    let base_name = Path::new(&filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("pack.mrpack");

    let suffix: u64 = rand::thread_rng().gen();
    let dest = root.join(format!("{}-{}", suffix, base_name));

    let client = http_client(false);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки Modrinth .mrpack: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Modrinth вернул ошибку {} при скачивании .mrpack",
            resp.status()
        ));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Ошибка чтения тела ответа Modrinth: {e}"))?;

    tokio::fs::write(&dest, &bytes)
        .await
        .map_err(|e| format!("Не удалось сохранить .mrpack во временный файл: {e}"))?;

    let dest_str = dest
        .to_str()
        .ok_or_else(|| "Путь к временной .mrpack не в UTF-8".to_string())?
        .to_string();

    let imported = import_mrpack_as_new_profile(app.clone(), dest_str).await?;

    let _ = tokio::fs::remove_file(&dest).await;

    Ok(imported)
}

#[tauri::command]
pub async fn download_modrinth_file(
    category: String,
    url: String,
    filename: String,
    profile_id: Option<String>,
) -> Result<(), String> {
    let root = if let Some(ref id) = profile_id {
        instance_dir(id)?
    } else {
        game_root_dir()?
    };
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

    let client = http_client(false);
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
pub async fn check_version_files_integrity(
    version_id: String,
    version_url: String,
) -> Result<VersionIntegrityCheckResult, String> {
    let client = http_client(false);
    let version_json_text =
        download_text_with_retries(&client, &version_url, DEFAULT_DOWNLOAD_RETRIES).await?;
    let detail: VersionDetail = serde_json::from_str(&version_json_text)
        .map_err(|e| format!("Ошибка разбора описания версии: {e}"))?;
    let downloads = detail
        .downloads
        .as_ref()
        .ok_or("Описание версии не содержит downloads (не ванильная версия)")?;

    let root = game_root_dir()?;
    let libs_root = libraries_dir()?;
    let vers_root = versions_dir()?;
    let os_name = current_os_name();

    let mut checked_files: u32 = 0;
    let mut missing_files: u32 = 0;
    let mut corrupted_files: u32 = 0;

    let mut check_one = |path: &Path, expected_sha1: Option<&str>| {
        checked_files = checked_files.saturating_add(1);
        if !path.exists() {
            missing_files = missing_files.saturating_add(1);
            return;
        }
        if let Some(expected) = expected_sha1 {
            let expected_lc = expected.trim().to_ascii_lowercase();
            if expected_lc.len() == 40 {
                if let Ok(actual) = std::fs::read(path).map(|bytes| sha1_hex_of_bytes(&bytes)) {
                    if actual != expected_lc {
                        corrupted_files = corrupted_files.saturating_add(1);
                    }
                } else {
                    corrupted_files = corrupted_files.saturating_add(1);
                }
            }
        }
    };

    let version_json_path = vers_root.join(&version_id).join(format!("{version_id}.json"));
    check_one(&version_json_path, None);

    let client_jar = root.join(format!("{version_id}.jar"));
    check_one(&client_jar, downloads.client.sha1.as_deref());

    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }

        if let Some(ref artifact) = lib.downloads.artifact {
            let path = libs_root.join(&artifact.path);
            check_one(&path, artifact.sha1.as_deref());
        }

        if let Some(nat) = resolve_native_artifact(lib, os_name) {
            let path = libs_root.join(&nat.path);
            check_one(&path, nat.sha1.as_deref());
        }
    }

    let is_ok = missing_files == 0 && corrupted_files == 0;
    Ok(VersionIntegrityCheckResult {
        is_ok,
        checked_files,
        missing_files,
        corrupted_files,
    })
}

#[tauri::command]
pub async fn fetch_vanilla_releases() -> Result<Vec<VersionSummary>, String> {
    let mut versions = load_all_versions().await?;
    versions.retain(|v| v.version_type == "release");
    Ok(versions)
}

#[derive(Debug, Deserialize)]
struct ForgePromotionsSlim {
    promos: HashMap<String, String>,
}

#[tauri::command]
pub async fn fetch_forge_versions() -> Result<Vec<ForgeVersionSummary>, String> {

    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);

    let client = http_client(true);
    let text = download_text_with_retries(&client, FORGE_PROMOTIONS_URL, DEFAULT_DOWNLOAD_RETRIES)
        .await
        .map_err(|e| format!("Ошибка загрузки Forge promotions: {e}"))?;

    let parsed: ForgePromotionsSlim = serde_json::from_str(&text)
        .map_err(|e| format!("Ошибка разбора Forge promotions JSON: {e}"))?;


    let mut chosen_by_mc: HashMap<String, String> = HashMap::new();
    for (promo_key, forge_build) in parsed.promos {
        let Some((mc_version, suffix)) = promo_key.rsplit_once('-') else {
            continue;
        };
        if suffix != "latest" && suffix != "recommended" {
            continue;
        }

        let entry = chosen_by_mc.entry(mc_version.to_string());
        let should_replace = match entry {
            std::collections::hash_map::Entry::Vacant(_) => true,
            std::collections::hash_map::Entry::Occupied(o) => {
                let existing = o.get();
                suffix == "recommended" || existing.is_empty()
            }
        };

        if should_replace {
            chosen_by_mc.insert(mc_version.to_string(), forge_build);
        }
    }

    let mut out: Vec<ForgeVersionSummary> = chosen_by_mc
        .into_iter()
        .map(|(mc_version, forge_build)| {
            let id = format!("{mc_version}-forge-{forge_build}");
            let installer_url = format!(
                "{FORGE_MAVEN_BASE}/{mc_version}-{forge_build}/forge-{mc_version}-{forge_build}-installer.jar"
            );
            ForgeVersionSummary {
                id,
                mc_version,
                forge_build,
                installer_url,
            }
        })
        .collect();

    out.sort_by(|a, b| b.mc_version.cmp(&a.mc_version));
    Ok(out)
}

fn parse_neoforge_mc_version(build: &str) -> Option<String> {
    let mut parts = build.split('.');
    let major = parts.next()?;
    let minor = parts.next()?;
    if !major.chars().all(|c| c.is_ascii_digit()) || !minor.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(format!("1.{major}.{minor}"))
}

#[tauri::command]
pub async fn fetch_neoforge_versions() -> Result<Vec<NeoForgeVersionSummary>, String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);

    let client = http_client(true);
    let metadata = download_text_with_retries(
        &client,
        NEOFORGE_MAVEN_METADATA_URL,
        DEFAULT_DOWNLOAD_RETRIES,
    )
    .await
    .map_err(|e| format!("Ошибка загрузки NeoForge metadata: {e}"))?;

    let mut out: Vec<NeoForgeVersionSummary> = Vec::new();
    for entry in metadata.match_indices("<version>") {
        let start = entry.0 + "<version>".len();
        let rest = &metadata[start..];
        let Some(end_rel) = rest.find("</version>") else {
            continue;
        };
        let build = rest[..end_rel].trim();
        if build.is_empty() || !build.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            continue;
        }
        let Some(mc_version) = parse_neoforge_mc_version(build) else {
            continue;
        };

        let id = format!("{mc_version}-neoforge-{build}");
        let installer_url = format!("{NEOFORGE_MAVEN_BASE}/{build}/neoforge-{build}-installer.jar");
        out.push(NeoForgeVersionSummary {
            id,
            mc_version,
            neoforge_build: build.to_string(),
            installer_url,
        });
    }

    out.sort_by(|a, b| b.neoforge_build.cmp(&a.neoforge_build));
    out.dedup_by(|a, b| a.neoforge_build == b.neoforge_build);
    Ok(out)
}

#[tauri::command]
pub async fn fetch_fabric_loaders(game_version: String) -> Result<Vec<String>, String> {
    let url = format!("{FABRIC_META_LOADERS}/{game_version}");
    let client = http_client(false);
    let text = download_text_with_retries(&client, &url, DEFAULT_DOWNLOAD_RETRIES)
        .await
        .map_err(|e| format!("Ошибка запроса списка Fabric: {e}"))?;
    let list: Vec<FabricLoaderEntry> = serde_json::from_str(&text).map_err(|e| {
        let head = text.chars().take(200).collect::<String>();
        format!("Ошибка разбора списка Fabric: {e}. Первые символы ответа: {head}")
    })?;
    let versions: Vec<String> = list
        .into_iter()
        .map(|e| e.loader.version)
        .collect();
    Ok(versions)
}

async fn select_latest_quilt_loader(game_version: &str) -> Result<String, String> {
    let url = format!("https://meta.quiltmc.org/v3/versions/loader/{game_version}");
    let client = http_client(false);
    let text = download_text_with_retries(&client, &url, DEFAULT_DOWNLOAD_RETRIES)
        .await
        .map_err(|e| format!("Ошибка запроса списка Quilt: {e}"))?;
    let list: Vec<QuiltLoaderEntry> = serde_json::from_str(&text).map_err(|e| {
        let head = text.chars().take(200).collect::<String>();
        format!("Ошибка разбора списка Quilt: {e}. Первые символы ответа: {head}")
    })?;
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
pub fn list_installed_fabric_game_versions() -> Result<Vec<String>, String> {
    let vers_root = versions_dir()?;
    if !vers_root.exists() {
        return Ok(vec![]);
    }
    let mut out: HashSet<String> = HashSet::new();
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
        let profile: FabricProfile =
            serde_json::from_str(&s).map_err(|e| format!("Ошибка разбора profile.json: {e}"))?;
        if profile.id.starts_with("fabric-loader-") && !profile.inherits_from.is_empty() {
            out.insert(profile.inherits_from);
        }
    }
    let mut result: Vec<String> = out.into_iter().collect();
    result.sort();
    Ok(result)
}

#[tauri::command]
pub fn list_installed_quilt_game_versions() -> Result<Vec<String>, String> {
    let vers_root = versions_dir()?;
    if !vers_root.exists() {
        return Ok(vec![]);
    }
    let mut out: HashSet<String> = HashSet::new();
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
        let profile: FabricProfile =
            serde_json::from_str(&s).map_err(|e| format!("Ошибка разбора profile.json: {e}"))?;
        if profile.id.starts_with("quilt-loader-") && !profile.inherits_from.is_empty() {
            out.insert(profile.inherits_from);
        }
    }
    let mut result: Vec<String> = out.into_iter().collect();
    result.sort();
    Ok(result)
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
    let client = http_client(false);
    log_to_console(
        &app,
        &format!(
            "[Fabric] Начало установки Fabric для Minecraft {game_version}, loader {loader_version}"
        ),
    );
    let profile_url =
        format!("{FABRIC_META_PROFILE}/{game_version}/{loader_version}/profile/json");
    log_to_console(&app, &format!("[Fabric] Загрузка профиля с {profile_url}"));
    let resp = client
        .get(&profile_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки профиля Fabric: {e}"))?;
    let status = resp.status();
    log_to_console(&app, &format!("[Fabric] Ответ профиля: HTTP {status}"));
    let profile: FabricProfile = resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора профиля Fabric: {e}"))?;

    let mojang_url = get_mojang_version_url(&profile.inherits_from).await?;
    log_to_console(
        &app,
        &format!(
            "[Fabric] Манифест Mojang для базовой версии {}: {mojang_url}",
            profile.inherits_from
        ),
    );
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
        if let Some(nat) = resolve_native_artifact(lib, os_name) {
            total_size = total_size.saturating_add(nat.size);
        }
    }
    if let Some(ref ai) = mojang_detail.asset_index {
        log_to_console(
            &app,
            &format!(
                "[Fabric] Загрузка ассетов из {}",
                ai.url.as_str()
            ),
        );
        if let Some(s) = ai.total_size {
            total_size = total_size.saturating_add(s);
        }
    }
    let mut total_downloaded: u64 = 0;

    log_to_console(
        &app,
        &format!(
            "[Fabric] Итоговый размер загрузки (jar+lib+natives+assets): {} байт",
            total_size
        ),
    );

    let client_jar = root.join(format!("{profile_id}.jar"));
    log_to_console(
        &app,
        &format!(
            "[Fabric] Загрузка клиентского JAR в {}",
            client_jar.display()
        ),
    );
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

    log_to_console(&app, "[Fabric] Загрузка библиотек и natives Mojang");
    log_to_console(&app, "[Quilt] Загрузка библиотек и natives Mojang");
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
    let client = http_client(false);

    log_to_console(
        &app,
        &format!("[Quilt] Начало установки Quilt для Minecraft {game_version}"),
    );

    let loader_version = select_latest_quilt_loader(&game_version).await?;
    log_to_console(
        &app,
        &format!("[Quilt] Выбран loader {loader_version}"),
    );

    let profile_url = format!(
        "https://meta.quiltmc.org/v3/versions/loader/{game_version}/{loader_version}/profile/json"
    );
    log_to_console(&app, &format!("[Quilt] Загрузка профиля с {profile_url}"));

    let resp = client
        .get(&profile_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка загрузки профиля Quilt: {e}"))?;
    let status = resp.status();
    log_to_console(&app, &format!("[Quilt] Ответ профиля: HTTP {status}"));

    let profile: FabricProfile = resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора профиля Quilt: {e}"))?;

    let mojang_url = get_mojang_version_url(&profile.inherits_from).await?;
    log_to_console(
        &app,
        &format!(
            "[Quilt] Манифест Mojang для базовой версии {}: {mojang_url}",
            profile.inherits_from
        ),
    );
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
        log_to_console(
            &app,
            &format!(
                "[Quilt] Загрузка ассетов из {}",
                ai.url.as_str()
            ),
        );
        if let Some(s) = ai.total_size {
            total_size = total_size.saturating_add(s);
        }
    }
    let mut total_downloaded: u64 = 0;

    log_to_console(
        &app,
        &format!(
            "[Quilt] Итоговый размер загрузки (jar+lib+natives+assets): {} байт",
            total_size
        ),
    );

    let client_jar = root.join(format!("{profile_id}.jar"));
    log_to_console(
        &app,
        &format!(
            "[Quilt] Загрузка клиентского JAR в {}",
            client_jar.display()
        ),
    );
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

    let is_neoforge = version_id.contains("-neoforge-");
    let (mc_version, forge_build) = parse_forge_id(&version_id)
        .or_else(|| parse_neoforge_id(&version_id))
        .ok_or_else(|| format!("Некорректный id версии Forge/NeoForge: {version_id}"))?;

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

    let base_version_json_path =
        vers_root.join(&mc_version).join(format!("{mc_version}.json"));
    if !base_version_json_path.exists() {
        let vanilla_url = get_mojang_version_url(&mc_version).await?;
        install_version(app.clone(), mc_version.clone(), vanilla_url).await?;
    }

    ensure_launcher_profiles_json(&root, &mc_version)?;

    let installer_client = http_client_for_binary_download(true);
    let installer_dir = launcher_data_dir()?.join("forge_installers").join(&version_id);
    tokio::fs::create_dir_all(&installer_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку для Forge installer: {e}"))?;
    let installer_path = installer_dir.join("installer.jar");

    let need_download = if installer_path.exists() {
        let ok = file_starts_with_pk(&installer_path).await.unwrap_or(false);
        !ok
    } else {
        true
    };

    let total_done = Arc::new(AtomicU64::new(0));
    if need_download {
        let _ = download_forge_installer_once(
            &installer_client,
            &installer_url,
            &installer_path,
            &app,
            &version_id,
            total_done,
        )
        .await?;
    }


    let vanilla_client_jar = vers_root.join(&mc_version).join(format!("{mc_version}.jar"));
    if !vanilla_client_jar.exists() {
        let json_text = tokio::fs::read_to_string(&base_version_json_path)
            .await
            .map_err(|e| format!("Не удалось прочитать манифест версии: {e}"))?;
        let detail: VersionDetail = serde_json::from_str(&json_text)
            .map_err(|e| format!("Ошибка разбора манифеста версии: {e}"))?;
        if let Some(ref downloads) = detail.downloads {
            log_to_console(
                &app,
                &format!(
                    "[Forge] Предзагрузка vanilla client.jar (через прокси лаунчера): {}",
                    vanilla_client_jar.display()
                ),
            );
            let total_done_pre = Arc::new(AtomicU64::new(0));
            if let Err(e) = download_file_checked(
                &installer_client,
                &downloads.client.url,
                &vanilla_client_jar,
                downloads.client.sha1.clone(),
                &app,
                &version_id,
                downloads.client.size,
                total_done_pre,
                DEFAULT_DOWNLOAD_RETRIES,
            )
            .await
            {
                log_to_console(
                    &app,
                    &format!(
                        "[Forge] Предзагрузка client.jar не удалась (Forge попробует сам): {e}"
                    ),
                );
                let _ = tokio::fs::remove_file(&vanilla_client_jar).await;
            }
        }
    }

    let game_dir = root.clone();
    let java_installer = installer_path.clone();

    let java_http_proxy_args = build_java_http_proxy_args();

    let mut forge_java_bin =
        crate::java_runtime::ensure_java_runtime(17, "java-runtime-gamma").await?;
    #[cfg(target_os = "windows")]
    {
        if let Some(name) = forge_java_bin.file_name().and_then(|n| n.to_str()) {
            if name.eq_ignore_ascii_case("javaw.exe") {
                let candidate = forge_java_bin.with_file_name("java.exe");
                if candidate.is_file() {
                    forge_java_bin = candidate;
                }
            }
        }
    }

    let app_for_forge_install = app.clone();
    let forge_java_bin_for_thread = forge_java_bin.clone();
    let output = tokio::task::spawn_blocking(move || {
        use std::process::{Command, Stdio};

        let cp_sep = if cfg!(windows) { ";" } else { ":" };

        let proxy_user = env_var_trim("PROXY_USER");
        let proxy_pass = env_var_trim("PROXY_PASS");
        let has_proxy_auth = proxy_user.is_some() && proxy_pass.is_some();

        let bootstrap_jar_path = if has_proxy_auth {
            match ensure_proxy_auth_bootstrap_jar(&app_for_forge_install, &java_installer) {
                Ok(path) => Some(path),
                Err(e) => {
                    let _ = log_to_console(
                        &app_for_forge_install,
                        &format!(
                            "[Forge] ProxyAuth bootstrap недоступен ({e}). Продолжаем без bootstrap (без proxy auth classpath)."
                        ),
                    );
                    None
                }
            }
        } else {
            None
        };

        let classpath_opt = bootstrap_jar_path.as_ref().map(|b| {
            format!("{}{}{}", b.display(), cp_sep, java_installer.display())
        });

        let help_output = if let Some(ref classpath) = classpath_opt {
            let mut cmd_help = Command::new(&forge_java_bin_for_thread);
            for a in &java_http_proxy_args {
                cmd_help.arg(a);
            }
            cmd_help
                .arg("-cp")
                .arg(classpath)
                .arg("ProxyAuthBootstrap")
                .arg("--help")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            cmd_help.output()
        } else {
            let mut cmd_help = Command::new(&forge_java_bin_for_thread);
            for a in &java_http_proxy_args {
                cmd_help.arg(a);
            }
            cmd_help
                .arg("-jar")
                .arg(&java_installer)
                .arg("--help")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            cmd_help.output()
        };

        let help_text = help_output
            .as_ref()
            .map(|o| {
                let mut s = String::new();
                s.push_str(&String::from_utf8_lossy(&o.stdout));
                s.push_str(&String::from_utf8_lossy(&o.stderr));
                s
            })
            .unwrap_or_default();

        let has_install_client = help_text.contains("--installClient");
        let has_install_server = help_text.contains("--installServer");

        if has_install_client {
            let _ = log_to_console(&app_for_forge_install, "[Forge] Installer mode: --installClient");
            if let Some(ref classpath) = classpath_opt {
                let mut cmd = Command::new(&forge_java_bin_for_thread);
                for a in &java_http_proxy_args {
                    cmd.arg(a);
                }
                cmd.current_dir(&game_dir);
                cmd.arg("-cp")
                    .arg(classpath)
                    .arg("ProxyAuthBootstrap")
                    .arg("--installClient")
                    .arg(&game_dir)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                cmd.output()
            } else {
                let mut cmd = Command::new(&forge_java_bin_for_thread);
                for a in &java_http_proxy_args {
                    cmd.arg(a);
                }
                cmd.current_dir(&game_dir);
                cmd.arg("-jar")
                    .arg(&java_installer)
                    .arg("--installClient")
                    .arg(&game_dir)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                cmd.output()
            }
        } else if has_install_server {
            let _ = log_to_console(&app_for_forge_install, "[Forge] Installer mode: --installServer (cwd=game_dir)");
            if let Some(ref classpath) = classpath_opt {
                let mut cmd = Command::new(&forge_java_bin_for_thread);
                for a in &java_http_proxy_args {
                    cmd.arg(a);
                }
                cmd.current_dir(&game_dir);
                cmd.arg("-cp")
                    .arg(classpath)
                    .arg("ProxyAuthBootstrap")
                    .arg("--installServer")
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                cmd.output()
            } else {
                let mut cmd = Command::new(&forge_java_bin_for_thread);
                for a in &java_http_proxy_args {
                    cmd.arg(a);
                }
                cmd.current_dir(&game_dir);
                cmd.arg("-jar")
                    .arg(&java_installer)
                    .arg("--installServer")
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                cmd.output()
            }
        } else {
            let _ = log_to_console(&app_for_forge_install, "[Forge] Installer mode: fallback --installClient");
            if let Some(ref classpath) = classpath_opt {
                let mut cmd = Command::new(&forge_java_bin_for_thread);
                for a in &java_http_proxy_args {
                    cmd.arg(a);
                }
                cmd.current_dir(&game_dir);
                cmd.arg("-cp")
                    .arg(classpath)
                    .arg("ProxyAuthBootstrap")
                    .arg("--installClient")
                    .arg(&game_dir)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                cmd.output()
            } else {
                let mut cmd = Command::new(&forge_java_bin_for_thread);
                for a in &java_http_proxy_args {
                    cmd.arg(a);
                }
                cmd.current_dir(&game_dir);
                cmd.arg("-jar")
                    .arg(&java_installer)
                    .arg("--installClient")
                    .arg(&game_dir)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                cmd.output()
            }
        }
    })
    .await
    .map_err(|e| format!("Ошибка запуска Forge installer (spawn_blocking): {e}"))?;

    let output = output.map_err(|e| format!("Ошибка запуска Forge installer: {e}"))?;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Forge installer завершился ошибкой ({}). stdout: {}\nstderr: {}",
            output.status,
            stdout,
            stderr
        ));
    }

    let expected_version_json_path =
        vers_root.join(&version_id).join(format!("{version_id}.json"));
    if expected_version_json_path.exists() {
        return Ok(());
    }

    let alt_folder_name = format!("{mc_version}-forge-{forge_build}");
    let alt_json_name = format!("{alt_folder_name}.json");
    let alt_dir = vers_root.join(&alt_folder_name);
    let alt_json = alt_dir.join(&alt_json_name);
    if alt_json.exists() {
        let expected_dir = vers_root.join(&version_id);
        tokio::fs::create_dir_all(&expected_dir)
            .await
            .map_err(|e| format!("Не удалось создать папку версии: {e}"))?;
        let mut json_content = tokio::fs::read_to_string(&alt_json)
            .await
            .map_err(|e| format!("Не удалось прочитать JSON Forge: {e}"))?;
        json_content = json_content.replace(&alt_folder_name, &version_id);
        tokio::fs::write(&expected_version_json_path, &json_content)
            .await
            .map_err(|e| format!("Не удалось записать JSON версии: {e}"))?;
        let _ = tokio::fs::remove_dir_all(&alt_dir).await;
        return Ok(());
    }

    if is_neoforge {
        let neo_folder_name = format!("neoforge-{forge_build}");
        let neo_dir = vers_root.join(&neo_folder_name);
        let neo_json = neo_dir.join(format!("{neo_folder_name}.json"));
        if neo_json.exists() {
            let expected_dir = vers_root.join(&version_id);
            tokio::fs::create_dir_all(&expected_dir)
                .await
                .map_err(|e| format!("Не удалось создать папку версии: {e}"))?;
            let mut json_content = tokio::fs::read_to_string(&neo_json)
                .await
                .map_err(|e| format!("Не удалось прочитать JSON NeoForge: {e}"))?;
            json_content = json_content.replace(&neo_folder_name, &version_id);
            tokio::fs::write(&expected_version_json_path, &json_content)
                .await
                .map_err(|e| format!("Не удалось записать JSON версии: {e}"))?;
            let _ = tokio::fs::remove_dir_all(&neo_dir).await;
            return Ok(());
        }
    }

    let mut discovered_json: Option<(PathBuf, String)> = None;
    if let Ok(entries) = std::fs::read_dir(&vers_root) {
        for entry in entries.flatten() {
            let dir_path = entry.path();
            if !dir_path.is_dir() {
                continue;
            }
            let folder_name = match dir_path.file_name().and_then(|n| n.to_str()) {
                Some(v) => v.to_string(),
                None => continue,
            };
            let folder_lower = folder_name.to_ascii_lowercase();
            let matches = if is_neoforge {
                folder_lower.contains("neoforge") && folder_name.contains(&forge_build)
            } else {
                folder_lower.contains("forge") && folder_name.contains(&forge_build)
            };
            if !matches {
                continue;
            }

            let exact_json = dir_path.join(format!("{folder_name}.json"));
            if exact_json.exists() {
                discovered_json = Some((exact_json, folder_name));
                break;
            }

            let mut json_candidates: Vec<PathBuf> = Vec::new();
            if let Ok(inner_entries) = std::fs::read_dir(&dir_path) {
                for inner_entry in inner_entries.flatten() {
                    let p = inner_entry.path();
                    if !p.is_file() {
                        continue;
                    }
                    let is_json = p.extension().and_then(|s| s.to_str()).map_or(false, |ext| {
                        ext.eq_ignore_ascii_case("json")
                    });
                    if is_json {
                        json_candidates.push(p);
                    }
                }
            }

            if json_candidates.len() == 1 {
                let source_json = json_candidates.pop().expect("len==1 implies pop Some");
                discovered_json = Some((source_json, folder_name));
                break;
            }
        }
    }

    if let Some((source_json_path, source_folder_name)) = discovered_json {
        let expected_dir = vers_root.join(&version_id);
        tokio::fs::create_dir_all(&expected_dir)
            .await
            .map_err(|e| format!("Не удалось создать папку версии: {e}"))?;
        let mut json_content = tokio::fs::read_to_string(&source_json_path)
            .await
            .map_err(|e| format!("Не удалось прочитать JSON установленной версии: {e}"))?;
        json_content = json_content.replace(&source_folder_name, &version_id);
        tokio::fs::write(&expected_version_json_path, &json_content)
            .await
            .map_err(|e| format!("Не удалось записать JSON версии: {e}"))?;
        return Ok(());
    }

    return Err(format!(
        "После установки Forge не найден файл версии: {}",
        expected_version_json_path.display()
    ));
}

#[tauri::command]
pub async fn install_version(
    app: AppHandle,
    version_id: String,
    version_url: String,
) -> Result<(), String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    let client = http_client(false);
    let os_name = current_os_name();

    log_to_console(
        &app,
        &format!(
            "[Vanilla] Начало установки версии {version_id}\nURL манифеста: {version_url}"
        ),
    );

    let version_json_text =
        download_text_with_retries(&client, &version_url, DEFAULT_DOWNLOAD_RETRIES).await?;

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

    let total_done = Arc::new(AtomicU64::new(0));

    log_to_console(
        &app,
        &format!(
            "[Vanilla] Итоговый размер загрузки (jar+lib+natives+assets): {} байт",
            total_size
        ),
    );

    // jar
    let client_jar = root.join(format!("{version_id}.jar"));
    log_to_console(
        &app,
        &format!(
            "[Vanilla] Загрузка клиентского JAR в {}",
            client_jar.display()
        ),
    );
    download_file_checked(
        &client,
        &downloads.client.url,
        &client_jar,
        downloads.client.sha1.clone(),
        &app,
        &version_id,
        total_size,
        total_done.clone(),
        DEFAULT_DOWNLOAD_RETRIES,
    )
    .await?;

    //библиотеки
    let natives_dir = vers_root.join(&version_id).join("natives");
    tokio::fs::create_dir_all(&natives_dir)
        .await
        .map_err(|e| format!("Не удалось создать папку natives: {e}"))?;

    log_to_console(&app, "[Vanilla] Загрузка библиотек и natives (параллельно)");
    let sem = Arc::new(Semaphore::new(DEFAULT_DOWNLOAD_CONCURRENCY));
    let mut tasks = futures_util::stream::FuturesUnordered::new();

    for lib in &detail.libraries {
        if !library_applies(lib, os_name) {
            continue;
        }

        if let Some(ref artifact) = lib.downloads.artifact {
            let dest = libs_root.join(&artifact.path);
            if dest.exists() {
                continue;
            }
            let url = artifact.url.clone();
            let expected = artifact.sha1.clone();
            let client2 = client.clone();
            let app2 = app.clone();
            let sem2 = sem.clone();
            let total_done2 = total_done.clone();
            let vid = version_id.clone();
            tasks.push(tokio::spawn(async move {
                let _permit = sem2.acquire_owned().await.map_err(|_| "Semaphore закрыт".to_string())?;
                let expected2 = match expected {
                    Some(s) => Some(s),
                    None => try_fetch_remote_sha1(&client2, &url).await,
                };
                download_file_checked(
                    &client2,
                    &url,
                    &dest,
                    expected2,
                    &app2,
                    &vid,
                    total_size,
                    total_done2,
                    DEFAULT_DOWNLOAD_RETRIES,
                )
                .await?;
                Ok::<(), String>(())
            }));
        }

        if let Some(nat) = resolve_native_artifact(lib, os_name) {
            let dest = libs_root.join(&nat.path);
            if dest.exists() {
                let natives_dir2 = natives_dir.clone();
                let dest2 = dest.clone();
                let _ = tokio::task::spawn_blocking(move || extract_natives_jar(&dest2, &natives_dir2)).await;
            } else {
                let url = nat.url.clone();
                let expected = nat.sha1.clone();
                let client2 = client.clone();
                let app2 = app.clone();
                let sem2 = sem.clone();
                let total_done2 = total_done.clone();
                let vid = version_id.clone();
                let natives_dir2 = natives_dir.clone();
                tasks.push(tokio::spawn(async move {
                    let _permit = sem2.acquire_owned().await.map_err(|_| "Semaphore закрыт".to_string())?;
                    let expected2 = match expected {
                        Some(s) => Some(s),
                        None => try_fetch_remote_sha1(&client2, &url).await,
                    };
                    download_file_checked(
                        &client2,
                        &url,
                        &dest,
                        expected2,
                        &app2,
                        &vid,
                        total_size,
                        total_done2,
                        DEFAULT_DOWNLOAD_RETRIES,
                    )
                    .await?;
                    let _ = tokio::task::spawn_blocking(move || extract_natives_jar(&dest, &natives_dir2)).await;
                    Ok::<(), String>(())
                }));
            }
        }
    }

    while let Some(res) = tasks.next().await {
        res.map_err(|e| format!("Ошибка задачи загрузки библиотек: {e}"))??;
    }

    if let Some(ref asset_index) = detail.asset_index {
        log_to_console(
            &app,
            &format!(
                "[Vanilla] Загрузка ассетов из {}",
                asset_index.url.as_str()
            ),
        );
        download_assets(
            &client,
            asset_index,
            &root,
            &app,
            &version_id,
            total_size,
            total_done.load(Ordering::SeqCst),
        )
        .await?;
    }

    log_to_console(
        &app,
        "[Vanilla] Сохранение json-описания версии и финализация установки",
    );

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
pub async fn install_neoforge(app: AppHandle, version_id: String) -> Result<(), String> {
    let (_mc_version, neoforge_build) = parse_neoforge_id(&version_id)
        .ok_or_else(|| format!("Некорректный id NeoForge версии: {version_id}"))?;
    let installer_url =
        format!("{NEOFORGE_MAVEN_BASE}/{neoforge_build}/neoforge-{neoforge_build}-installer.jar");
    install_forge(app, version_id, installer_url).await
}

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
    let playtime_profile_id = read_selected_profile_id_internal();
    let game_dir = selected_instance_dir_internal().unwrap_or_else(|| root.clone());

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
                inherits_from: None,
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

    let jar_path = root.join(format!("{effective_jar_version}.jar"));
    if detail.downloads.is_some() && !jar_path.exists() {
        return Err("Версия не установлена. Сначала нажмите «Установить».".to_string());
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
    if detail.downloads.is_some() || jar_path.exists() {
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
        "mojang".to_string()
    };
    let mut auth_is_mojang = false;

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
                is_offline = false;
                auth_is_mojang = true;
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
            is_offline = false;
            auth_is_mojang = true;
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

    let settings = effective_settings_for_launch();
    let instance_settings_for_launch =
        load_selected_instance_settings_internal()
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
        .unwrap_or_else(|| load_java_settings_internal(&app));

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
    // Fix for SE: Ensure Java binary has ex permissions (os error 13)
    #[cfg(unix)]
    {
        if let Err(e) = crate::java_runtime::ensure_executable(&java_path) {
            eprintln!("[Launch] Warning: Failed to set execute permission for {}: {}", java_path.display(), e);
        } else {
            // Opt()
            // eprintln!("[Launch] Verified/Fixed execute permission for {}", java_path.display());
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
    apply_linux_display_env(&mut cmd);
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