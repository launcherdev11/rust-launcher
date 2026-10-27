use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use tauri::command;

use crate::app::paths::{game_root_dir, instance_config_path, instance_dir};
use crate::infra::fs_atomic::write_atomic;
use crate::infra::http::{http_client, http_client_for_binary_download};
use crate::services::game::core::download_text_with_retries;
use crate::services::game::profiles::read_instance_config;
use crate::services::game::runtime::{fallback_java_runtime_for_mc_version, forge_java_runtime_for_mc_version};
use crate::services::game::state::{DEFAULT_DOWNLOAD_RETRIES, NEOFORGE_MAVEN_BASE};
use crate::services::game::versions::resolve_mojang_version;
use crate::services::modrinth::jar_compat::{read_jar_mod_info, JarModInfo};

const CONFIG_DIRS: &[&str] = &["config", "defaultconfigs", "kubejs", "scripts"];
const AUTHLIB_JAR: &str = "authlib-injector.jar";

const CLIENT_ONLY_IDS: &[&str] = &[
    "sodium", "iris", "oculus", "embeddium", "rubidium", "magnesium", "optifine", "optifabric",
    "modmenu", "betterf3", "dynamic_fps", "dynamicfps", "zoomify", "okzoomer", "controlling",
    "mousetweaks", "entityculling", "cullleaves", "lambdynlights", "continuity", "indium",
    "sodiumextra", "sodium-extra", "reeses-sodium-options", "reeses_sodium_options", "immediatelyfast",
    "fancymenu", "drippyloadingscreen", "notenoughanimations", "skinlayers3d", "3dskinlayers",
    "betterpingdisplay", "chat_heads", "legendarytooltips", "enhancedvisuals", "watermedia",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServerKind {
    Vanilla,
    Paper,
    Purpur,
    Fabric,
    Forge,
    Neoforge,
}

impl ServerKind {
    fn modded(self) -> bool {
        matches!(self, ServerKind::Fabric | ServerKind::Forge | ServerKind::Neoforge)
    }

    fn uses_installer(self) -> bool {
        matches!(self, ServerKind::Forge | ServerKind::Neoforge)
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ServerAuth {
    #[default]
    Microsoft,
    Ely,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ServerPackConfig {
    pub kind: Option<ServerKind>,
    pub ram_mb: u32,
    pub auth: ServerAuth,
    pub eula: bool,
    pub include_configs: bool,
    pub mod_overrides: BTreeMap<String, bool>,
    pub properties: BTreeMap<String, String>,
}

impl Default for ServerPackConfig {
    fn default() -> Self {
        Self {
            kind: None,
            ram_mb: 4096,
            auth: ServerAuth::default(),
            eula: false,
            include_configs: true,
            mod_overrides: BTreeMap::new(),
            properties: default_properties(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerPackState {
    pub name: String,
    pub loader: String,
    pub mc_version: String,
    pub loader_version: Option<String>,
    pub kinds: Vec<ServerKind>,
    pub java_major: u8,
    pub saved: bool,
    pub config: ServerPackConfig,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerPackMod {
    pub file: String,
    pub title: String,
    pub client_only: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerPackExportResult {
    pub mods: usize,
    pub skipped: usize,
}

fn default_properties() -> BTreeMap<String, String> {
    [
        ("motd", "A Minecraft Server"),
        ("server-port", "25565"),
        ("max-players", "20"),
        ("white-list", "false"),
        ("pvp", "true"),
        ("allow-flight", "false"),
        ("difficulty", "easy"),
        ("gamemode", "survival"),
        ("hardcore", "false"),
        ("view-distance", "10"),
        ("simulation-distance", "10"),
        ("spawn-protection", "16"),
        ("level-seed", ""),
        ("enable-command-block", "false"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect()
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn config_path(profile_id: &str) -> Result<PathBuf, String> {
    if !valid_id(profile_id) {
        return Err("Некорректный id сборки".to_string());
    }
    Ok(game_root_dir()?.join("server-packs").join(format!("{profile_id}.json")))
}

fn read_config(profile_id: &str) -> Result<Option<ServerPackConfig>, String> {
    let path = config_path(profile_id)?;
    Ok(fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()))
}

struct Instance {
    name: String,
    loader: String,
    mc_version: String,
    loader_version: Option<String>,
}

fn instance(profile_id: &str) -> Result<Instance, String> {
    let cfg = read_instance_config(&instance_config_path(profile_id)?)?;
    Ok(Instance {
        name: cfg.name,
        loader: cfg.loader.to_ascii_lowercase(),
        mc_version: cfg.game_version,
        loader_version: cfg.loader_version.filter(|v| !v.trim().is_empty()),
    })
}

fn kinds_for_loader(loader: &str) -> Vec<ServerKind> {
    match loader {
        "fabric" => vec![ServerKind::Fabric],
        "forge" => vec![ServerKind::Forge],
        "neoforge" => vec![ServerKind::Neoforge],
        "vanilla" => vec![ServerKind::Vanilla, ServerKind::Paper, ServerKind::Purpur],
        _ => Vec::new(),
    }
}

fn java_major(loader: &str, mc_version: &str) -> u8 {
    if loader == "forge" || loader == "neoforge" {
        forge_java_runtime_for_mc_version(mc_version).0
    } else {
        fallback_java_runtime_for_mc_version(mc_version).0
    }
}

fn resolve_config(mut config: ServerPackConfig, kinds: &[ServerKind]) -> ServerPackConfig {
    if !config.kind.is_some_and(|k| kinds.contains(&k)) {
        config.kind = kinds.first().copied();
    }
    config
}

fn is_client_only(info: &JarModInfo) -> bool {
    if info.environment.as_deref() == Some("client") {
        return true;
    }
    let norm = |s: &str| s.to_ascii_lowercase().replace(['-', '_', ' '], "");
    let known: HashSet<String> = CLIENT_ONLY_IDS.iter().map(|s| norm(s)).collect();
    info.mod_id.as_deref().is_some_and(|id| known.contains(&norm(id)))
}

fn scan_mods(profile_id: &str, loader: &str) -> Result<Vec<(PathBuf, ServerPackMod)>, String> {
    let dir = instance_dir(profile_id)?.join("mods");
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(&dir) else { return Ok(out) };
    for entry in rd.flatten() {
        let path = entry.path();
        let file = entry.file_name().to_string_lossy().to_string();
        if !path.is_file() || !file.to_ascii_lowercase().ends_with(".jar") {
            continue;
        }
        let info = read_jar_mod_info(&path, &file, true, Some(loader));
        let client_only = is_client_only(&info);
        let title = info.title.clone().filter(|t| !t.trim().is_empty()).unwrap_or_else(|| file.clone());
        out.push((path, ServerPackMod { file, title, client_only }));
    }
    out.sort_by(|a, b| a.1.title.to_lowercase().cmp(&b.1.title.to_lowercase()));
    Ok(out)
}

fn mod_included(config: &ServerPackConfig, m: &ServerPackMod) -> bool {
    config.mod_overrides.get(&m.file).copied().unwrap_or(!m.client_only)
}

fn escape_property(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            c if c.is_ascii() => out.push(c),
            c => {
                let mut buf = [0u16; 2];
                for unit in c.encode_utf16(&mut buf) {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
            }
        }
    }
    out
}

fn properties_text(config: &ServerPackConfig) -> String {
    let mut props = config.properties.clone();
    props.insert(
        "online-mode".to_string(),
        (config.auth != ServerAuth::Offline).to_string(),
    );
    if config.auth != ServerAuth::Microsoft {
        props.insert("enforce-secure-profile".to_string(), "false".to_string());
    }
    let mut out = String::from("#Minecraft server properties\n");
    for (k, v) in props {
        out.push_str(&format!("{k}={}\n", escape_property(&v)));
    }
    out
}

fn jvm_args(config: &ServerPackConfig) -> String {
    let mut args = format!("-Xmx{}M -Xms{}M", config.ram_mb, (config.ram_mb / 2).max(512));
    if config.auth == ServerAuth::Ely {
        args.push_str(&format!(" -javaagent:{AUTHLIB_JAR}=ely.by"));
    }
    args
}

fn start_scripts(kind: ServerKind, config: &ServerPackConfig) -> [(&'static str, String, bool); 2] {
    let jvm = jvm_args(config);
    if !kind.uses_installer() {
        return [
            ("start.bat", format!("@echo off\r\ncd /d \"%~dp0\"\r\njava {jvm} -jar server.jar nogui %*\r\npause\r\n"), false),
            ("start.sh", format!("#!/usr/bin/env sh\ncd \"$(dirname \"$0\")\"\nexec java {jvm} -jar server.jar nogui \"$@\"\n"), true),
        ];
    }
    let bat = [
        "@echo off",
        "cd /d \"%~dp0\"",
        "if not exist installer.jar goto run",
        "java -jar installer.jar --installServer",
        "if errorlevel 1 goto fail",
        "del installer.jar installer.jar.log 2>nul",
        ":run",
        "set \"ARGS=\"",
        "for /d %%d in (libraries\\net\\minecraftforge\\forge\\* libraries\\net\\neoforged\\neoforge\\*) do if exist \"%%d\\win_args.txt\" set \"ARGS=%%d\\win_args.txt\"",
        "if not defined ARGS goto legacy",
        &format!("java {jvm} @%ARGS% nogui %*"),
        "goto end",
        ":legacy",
        "set \"JAR=\"",
        "for %%f in (forge-*.jar) do set \"JAR=%%f\"",
        &format!("java {jvm} -jar \"%JAR%\" nogui %*"),
        "goto end",
        ":fail",
        "echo Server installation failed.",
        ":end",
        "pause",
    ]
    .join("\r\n");
    let sh = [
        "#!/usr/bin/env sh",
        "cd \"$(dirname \"$0\")\"",
        "if [ -f installer.jar ]; then",
        "  java -jar installer.jar --installServer || exit 1",
        "  rm -f installer.jar installer.jar.log",
        "fi",
        "ARGS=$(ls libraries/net/minecraftforge/forge/*/unix_args.txt libraries/net/neoforged/neoforge/*/unix_args.txt 2>/dev/null | head -n 1)",
        "if [ -n \"$ARGS\" ]; then",
        &format!("  exec java {jvm} @\"$ARGS\" nogui \"$@\""),
        "fi",
        "JAR=$(ls forge-*.jar 2>/dev/null | head -n 1)",
        &format!("exec java {jvm} -jar \"$JAR\" nogui \"$@\""),
    ]
    .join("\n");
    [("start.bat", format!("{bat}\r\n"), false), ("start.sh", format!("{sh}\n"), true)]
}

async fn fetch_json(url: &str) -> Result<serde_json::Value, String> {
    let text = download_text_with_retries(&http_client(false), url, DEFAULT_DOWNLOAD_RETRIES).await?;
    serde_json::from_str(&text).map_err(|e| format!("Некорректный ответ {url}: {e}"))
}

async fn download_bytes(url: &str, sha1: Option<&str>) -> Result<Vec<u8>, String> {
    let client = http_client_for_binary_download(false);
    let mut last_err = String::new();
    for attempt in 0..DEFAULT_DOWNLOAD_RETRIES.max(1) {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(800 * attempt as u64)).await;
        }
        let resp = match client.get(url).send().await.and_then(|r| r.error_for_status()) {
            Ok(r) => r,
            Err(e) => {
                last_err = e.to_string();
                continue;
            }
        };
        match resp.bytes().await {
            Ok(bytes) => {
                if let Some(expected) = sha1 {
                    let actual = format!("{:x}", Sha1::digest(&bytes));
                    if !actual.eq_ignore_ascii_case(expected) {
                        last_err = "контрольная сумма не совпала".to_string();
                        continue;
                    }
                }
                return Ok(bytes.to_vec());
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(format!("Не удалось скачать {url}: {last_err}"))
}

async fn paper_download_url(mc: &str) -> Result<String, String> {
    if let Ok(v) = fetch_json(&format!("https://fill.papermc.io/v3/projects/paper/versions/{mc}/builds")).await {
        if let Some(builds) = v.as_array() {
            let mut sorted: Vec<&serde_json::Value> = builds.iter().collect();
            sorted.sort_by_key(|b| std::cmp::Reverse(b.get("id").and_then(|x| x.as_i64()).unwrap_or(0)));
            let stable_first = sorted
                .iter()
                .filter(|b| b.get("channel").and_then(|c| c.as_str()).is_some_and(|c| c.eq_ignore_ascii_case("stable")))
                .chain(sorted.iter());
            for b in stable_first {
                let url = b
                    .get("downloads")
                    .and_then(|d| d.as_object())
                    .and_then(|d| d.values().find_map(|x| x.get("url").and_then(|u| u.as_str())));
                if let Some(url) = url {
                    return Ok(url.to_string());
                }
            }
        }
    }
    let v = fetch_json(&format!("https://api.papermc.io/v2/projects/paper/versions/{mc}/builds")).await?;
    let build = v
        .get("builds")
        .and_then(|b| b.as_array())
        .and_then(|b| b.last())
        .ok_or_else(|| format!("Для {mc} нет сборок Paper"))?;
    let number = build.get("build").and_then(|x| x.as_i64()).ok_or("Нет номера сборки Paper")?;
    let name = build
        .pointer("/downloads/application/name")
        .and_then(|x| x.as_str())
        .ok_or("Нет файла сборки Paper")?;
    Ok(format!("https://api.papermc.io/v2/projects/paper/versions/{mc}/builds/{number}/downloads/{name}"))
}

async fn fabric_server_url(mc: &str, loader: Option<&str>) -> Result<String, String> {
    let loader = match loader {
        Some(l) => l.trim().to_string(),
        None => {
            let v = fetch_json(&format!("https://meta.fabricmc.net/v2/versions/loader/{mc}")).await?;
            v.as_array()
                .and_then(|a| a.first())
                .and_then(|x| x.pointer("/loader/version"))
                .and_then(|x| x.as_str())
                .ok_or("Не найдена версия Fabric Loader")?
                .to_string()
        }
    };
    let installers = fetch_json("https://meta.fabricmc.net/v2/versions/installer").await?;
    let installer = installers
        .as_array()
        .and_then(|a| a.iter().find(|i| i.get("stable").and_then(|s| s.as_bool()) == Some(true)).or(a.first()))
        .and_then(|i| i.get("version"))
        .and_then(|v| v.as_str())
        .ok_or("Не найдена версия Fabric Installer")?;
    Ok(format!("https://meta.fabricmc.net/v2/versions/loader/{mc}/{loader}/{installer}/server/jar"))
}

async fn download_core(kind: ServerKind, inst: &Instance) -> Result<(&'static str, Vec<u8>), String> {
    let mc = inst.mc_version.as_str();
    match kind {
        ServerKind::Vanilla => {
            let (_, version_url) = resolve_mojang_version(mc).await?;
            let detail = fetch_json(&version_url).await?;
            let url = detail
                .pointer("/downloads/server/url")
                .and_then(|x| x.as_str())
                .ok_or("У этой версии нет официального сервера")?;
            let sha1 = detail.pointer("/downloads/server/sha1").and_then(|x| x.as_str());
            Ok(("server.jar", download_bytes(url, sha1).await?))
        }
        ServerKind::Paper => Ok(("server.jar", download_bytes(&paper_download_url(mc).await?, None).await?)),
        ServerKind::Purpur => {
            let url = format!("https://api.purpurmc.org/v2/purpur/{mc}/latest/download");
            Ok(("server.jar", download_bytes(&url, None).await?))
        }
        ServerKind::Fabric => {
            let url = fabric_server_url(mc, inst.loader_version.as_deref()).await?;
            Ok(("server.jar", download_bytes(&url, None).await?))
        }
        ServerKind::Forge | ServerKind::Neoforge => {
            let build = inst.loader_version.as_deref().ok_or("У сборки не указана версия загрузчика")?;
            let url = if kind == ServerKind::Forge {
                format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{mc}-{build}/forge-{mc}-{build}-installer.jar")
            } else {
                format!("{NEOFORGE_MAVEN_BASE}/{build}/neoforge-{build}-installer.jar")
            };
            Ok(("installer.jar", download_bytes(&url, None).await?))
        }
    }
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<(PathBuf, String)>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("Не удалось прочитать {}: {e}", dir.display()))?.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            collect_files(root, &path, out)?;
        } else if ft.is_file() {
            let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            out.push((path, rel));
        }
    }
    Ok(())
}

struct PackContents {
    kind: ServerKind,
    config: ServerPackConfig,
    core: (&'static str, Vec<u8>),
    authlib: Option<Vec<u8>>,
    files: Vec<(PathBuf, String)>,
}

fn write_zip(pack: &PackContents, dest: &Path) -> Result<(), String> {
    use zip::write::SimpleFileOptions;

    let file = fs::File::create(dest).map_err(|e| format!("Не удалось создать архив: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let base = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut put = |name: &str, bytes: &[u8], opts: SimpleFileOptions| -> Result<(), String> {
        zip.start_file(name, opts).map_err(|e| format!("Ошибка архива: {e}"))?;
        zip.write_all(bytes).map_err(|e| format!("Ошибка записи архива: {e}"))
    };

    put(pack.core.0, &pack.core.1, base)?;
    if let Some(bytes) = &pack.authlib {
        put(AUTHLIB_JAR, bytes, base)?;
    }
    put("server.properties", properties_text(&pack.config).as_bytes(), base)?;
    if pack.config.eula {
        put("eula.txt", b"# https://aka.ms/MinecraftEULA\neula=true\n", base)?;
    }
    for (name, text, exec) in start_scripts(pack.kind, &pack.config) {
        put(name, text.as_bytes(), if exec { base.unix_permissions(0o755) } else { base })?;
    }
    for (path, rel) in &pack.files {
        let bytes = fs::read(path).map_err(|e| format!("Не удалось прочитать {rel}: {e}"))?;
        put(rel, &bytes, base.large_file(bytes.len() as u64 >= u32::MAX as u64))?;
    }
    zip.finish().map_err(|e| format!("Ошибка записи архива: {e}"))?;
    Ok(())
}

#[command]
pub fn get_server_pack(profile_id: String) -> Result<ServerPackState, String> {
    let inst = instance(&profile_id)?;
    let kinds = kinds_for_loader(&inst.loader);
    let saved = read_config(&profile_id)?;
    let is_saved = saved.is_some();
    let config = saved.unwrap_or_else(|| {
        let mut c = ServerPackConfig::default();
        c.properties.insert("motd".to_string(), inst.name.clone());
        c
    });
    Ok(ServerPackState {
        java_major: java_major(&inst.loader, &inst.mc_version),
        config: resolve_config(config, &kinds),
        saved: is_saved,
        kinds,
        name: inst.name,
        loader: inst.loader,
        mc_version: inst.mc_version,
        loader_version: inst.loader_version,
    })
}

#[command]
pub fn save_server_pack_config(profile_id: String, config: ServerPackConfig) -> Result<(), String> {
    let inst = instance(&profile_id)?;
    let kinds = kinds_for_loader(&inst.loader);
    if config.kind.is_some_and(|k| !kinds.contains(&k)) {
        return Err("Это ядро не подходит загрузчику сборки".to_string());
    }
    for (key, value) in &config.properties {
        if key.trim().is_empty() || key.contains(['=', ':', ' ', '\n', '\r']) || value.contains(['\n', '\r']) {
            return Err(format!("Некорректное свойство «{key}»"));
        }
    }
    let mut config = config;
    config.ram_mb = config.ram_mb.clamp(1024, 65536);
    let path = config_path(&profile_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Не удалось создать папку: {e}"))?;
    }
    let text = serde_json::to_string_pretty(&config).map_err(|e| format!("Ошибка сериализации: {e}"))?;
    write_atomic(&path, text)
}

#[command]
pub async fn list_server_pack_mods(profile_id: String) -> Result<Vec<ServerPackMod>, String> {
    let loader = instance(&profile_id)?.loader;
    tokio::task::spawn_blocking(move || scan_mods(&profile_id, &loader))
        .await
        .map_err(|e| format!("Ошибка чтения модов: {e}"))?
        .map(|mods| mods.into_iter().map(|(_, m)| m).collect())
}

#[command]
pub async fn export_server_pack(profile_id: String, dest_path: String) -> Result<ServerPackExportResult, String> {
    let inst = instance(&profile_id)?;
    let kinds = kinds_for_loader(&inst.loader);
    let config = resolve_config(read_config(&profile_id)?.unwrap_or_default(), &kinds);
    let kind = config.kind.ok_or("Для этого загрузчика сервер не собрать")?;
    let dest = PathBuf::from(dest_path);

    let root = instance_dir(&profile_id)?;
    let (files, mods, skipped) = {
        let config = config.clone();
        let loader = inst.loader.clone();
        let id = profile_id.clone();
        let root = root.clone();
        tokio::task::spawn_blocking(move || -> Result<_, String> {
            let mut files = Vec::new();
            let (mut mods, mut skipped) = (0, 0);
            if !kind.modded() {
                return Ok((files, mods, skipped));
            }
            for (path, m) in scan_mods(&id, &loader)? {
                if mod_included(&config, &m) {
                    files.push((path, format!("mods/{}", m.file)));
                    mods += 1;
                } else {
                    skipped += 1;
                }
            }
            if config.include_configs {
                for d in CONFIG_DIRS {
                    let dir = root.join(d);
                    if dir.is_dir() {
                        collect_files(&root, &dir, &mut files)?;
                    }
                }
            }
            Ok((files, mods, skipped))
        })
        .await
        .map_err(|e| format!("Ошибка чтения сборки: {e}"))??
    };

    let core = download_core(kind, &inst).await?;
    let authlib = match config.auth {
        ServerAuth::Ely => {
            let path = crate::services::auth::ely::ensure_authlib_injector().await?;
            Some(fs::read(path).map_err(|e| format!("Не удалось прочитать authlib-injector: {e}"))?)
        }
        _ => None,
    };

    let pack = PackContents { kind, config, core, authlib, files };
    tokio::task::spawn_blocking(move || {
        let result = write_zip(&pack, &dest);
        if result.is_err() {
            let _ = fs::remove_file(&dest);
        }
        result
    })
    .await
    .map_err(|e| format!("Ошибка экспорта: {e}"))??;
    Ok(ServerPackExportResult { mods, skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loaders_map_to_server_kinds() {
        assert_eq!(kinds_for_loader("fabric"), vec![ServerKind::Fabric]);
        assert_eq!(kinds_for_loader("vanilla").len(), 3);
        assert!(kinds_for_loader("quilt").is_empty());
    }

    #[test]
    fn config_falls_back_to_loader_kind() {
        let mut c = ServerPackConfig::default();
        c.kind = Some(ServerKind::Paper);
        assert_eq!(resolve_config(c.clone(), &[ServerKind::Fabric]).kind, Some(ServerKind::Fabric));
        assert_eq!(
            resolve_config(c, &kinds_for_loader("vanilla")).kind,
            Some(ServerKind::Paper)
        );
        let partial: ServerPackConfig = serde_json::from_str(r#"{"ramMb":2048}"#).unwrap();
        assert_eq!(partial.ram_mb, 2048);
        assert!(partial.include_configs);
        assert_eq!(partial.properties.get("server-port").map(String::as_str), Some("25565"));
    }

    #[test]
    fn properties_follow_auth_and_escape_unicode() {
        let mut c = ServerPackConfig::default();
        c.properties.insert("motd".into(), "Сервер \\o/".into());
        let ms = properties_text(&c);
        assert!(ms.contains("online-mode=true\n"));
        assert!(!ms.contains("enforce-secure-profile"));
        assert!(ms.contains("motd=\\u0421\\u0435\\u0440\\u0432\\u0435\\u0440 \\\\o/\n"));

        c.auth = ServerAuth::Offline;
        let off = properties_text(&c);
        assert!(off.contains("online-mode=false\n") && off.contains("enforce-secure-profile=false\n"));
    }

    #[test]
    fn mod_overrides_beat_detection() {
        let mut c = ServerPackConfig::default();
        let client = ServerPackMod { file: "iris.jar".into(), title: "Iris".into(), client_only: true };
        let common = ServerPackMod { file: "jei.jar".into(), title: "JEI".into(), client_only: false };
        assert!(!mod_included(&c, &client) && mod_included(&c, &common));
        c.mod_overrides.insert("iris.jar".into(), true);
        c.mod_overrides.insert("jei.jar".into(), false);
        assert!(mod_included(&c, &client) && !mod_included(&c, &common));
    }

    #[test]
    fn scripts_match_core() {
        let mut c = ServerPackConfig::default();
        c.auth = ServerAuth::Ely;
        let [(bat_name, bat, _), (sh_name, sh, exec)] = start_scripts(ServerKind::Paper, &c);
        assert_eq!((bat_name, sh_name, exec), ("start.bat", "start.sh", true));
        assert!(bat.contains("java -Xmx4096M -Xms2048M -javaagent:authlib-injector.jar=ely.by -jar server.jar nogui"));
        assert!(sh.contains("-jar server.jar nogui"));

        let [(_, bat, _), (_, sh, _)] = start_scripts(ServerKind::Forge, &ServerPackConfig::default());
        assert!(bat.contains("java -jar installer.jar --installServer") && bat.contains("@%ARGS% nogui"));
        assert!(sh.contains("unix_args.txt") && sh.contains("@\"$ARGS\" nogui"));
        assert!(bat.lines().all(|l| !l.is_empty()) && bat.ends_with("pause\r\n"));
    }

    #[test]
    fn zip_holds_core_scripts_and_selected_files() {
        let base = std::env::temp_dir().join(format!("mc16-server-pack-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(base.join("mods")).unwrap();
        fs::write(base.join("mods/a.jar"), "a").unwrap();
        let mut config = ServerPackConfig::default();
        config.eula = true;
        let pack = PackContents {
            kind: ServerKind::Forge,
            config,
            core: ("installer.jar", b"jar".to_vec()),
            authlib: None,
            files: vec![(base.join("mods/a.jar"), "mods/a.jar".into())],
        };
        let dest = base.join("pack.zip");
        write_zip(&pack, &dest).unwrap();
        let mut zip = zip::ZipArchive::new(fs::File::open(&dest).unwrap()).unwrap();
        let names: HashSet<String> = (0..zip.len()).map(|i| zip.by_index(i).unwrap().name().to_string()).collect();
        for n in ["installer.jar", "server.properties", "eula.txt", "start.bat", "start.sh", "mods/a.jar"] {
            assert!(names.contains(n), "{n}");
        }
        assert!(!names.contains(AUTHLIB_JAR));
        let _ = fs::remove_dir_all(&base);
    }
}
