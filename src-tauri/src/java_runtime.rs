use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use futures_util::stream::{self, StreamExt};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use sha1::{Digest, Sha1};
use tokio::sync::Mutex;

use crate::models::{JavaIntegrityCheckResult, JavaRuntimeInfo};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

static JAVA_INSTALL_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

const INSTALL_COMPLETE_MARKER: &str = ".install-complete";
const JAVA_DOWNLOAD_RETRIES: usize = 6;
const JAVA_DOWNLOAD_CONCURRENCY: usize = 8;

fn http_client() -> Client {
    crate::infra::http::http_client(false)
}

async fn get_json_with_retries<T: DeserializeOwned>(client: &Client, url: &str) -> Result<T, String> {
    if !crate::infra::network::is_online().await {
        return Err(format!("{}: {url}", crate::infra::network::OFFLINE_ERR));
    }
    let mut last_err = String::new();
    for attempt in 0..JAVA_DOWNLOAD_RETRIES {
        if attempt > 0 {
            tokio::time::sleep(crate::services::game::core::retry_delay(attempt - 1)).await;
        }
        match client.get(url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.json::<T>().await {
                Ok(v) => return Ok(v),
                Err(e) => last_err = format!("Ошибка разбора ответа {url}: {e}"),
            },
            Ok(resp) => {
                let status = resp.status();
                last_err = format!("HTTP {status} для {url}");
                if status.is_client_error() && !matches!(status.as_u16(), 408 | 425 | 429) {
                    break;
                }
            }
            Err(e) => last_err = format!("Ошибка запроса {url}: {e}"),
        }
    }
    Err(last_err)
}

fn runtime_dir(major: u8, component: &str) -> Result<PathBuf, String> {
    Ok(crate::app::paths::game_root_dir()?
        .join("runtimes")
        .join(format!("{component}-java{major}")))
}

fn install_complete_path(root: &Path) -> PathBuf {
    root.join(INSTALL_COMPLETE_MARKER)
}

fn java_bin_path(root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    return root.join("bin").join("javaw.exe");

    #[cfg(target_os = "macos")]
    {
        let bundle = root.join("jre.bundle/Contents/Home/bin/java");
        if bundle.exists() { return bundle; }
        let contents = root.join("Contents/Home/bin/java");
        if contents.exists() { return contents; }
        return root.join("bin").join("java");
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    return root.join("bin").join("java");
}

const INDEX_URL: &str = "https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

fn platform_candidates() -> Result<Vec<&'static str>, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Ok(vec!["windows-x64"]),
        ("windows", "aarch64") => Ok(vec!["windows-arm64", "windows-x64"]),
        ("windows", "x86") => Ok(vec!["windows-x86"]),
        ("linux", "x86_64") => Ok(vec!["linux"]),
        ("linux", "x86") => Ok(vec!["linux-i386"]),
        ("macos", "x86_64") => Ok(vec!["mac-os"]),
        ("macos", "aarch64") => Ok(vec!["mac-os-arm64", "mac-os"]),
        (os, arch) => Err(format!(
            "Неподдерживаемая платформа: {os}/{arch}. Укажите свою Java в настройках."
        )),
    }
}

fn detect_platform() -> Result<&'static str, String> {
    platform_candidates().map(|c| c[0])
}

#[derive(Debug, Deserialize)]
struct JavaIndex {
    #[serde(flatten)]
    platforms: std::collections::HashMap<String, std::collections::HashMap<String, Vec<IndexEntry>>>,
}
#[derive(Debug, Deserialize)]
struct IndexEntry { manifest: ManifestUrl }
#[derive(Debug, Deserialize)]
struct ManifestUrl { url: String }

#[derive(Debug, Deserialize)]
struct FileManifest {
    files: std::collections::HashMap<String, FileEntry>,
}
#[derive(Debug, Deserialize)]
struct FileEntry {
    #[serde(default)]
    downloads: Option<Downloads>,
    #[serde(rename = "type", default)]
    entry_type: Option<String>,
    #[serde(default)]
    #[cfg_attr(not(unix), allow(dead_code))]
    target: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    executable: bool,
}
#[derive(Debug, Deserialize)]
struct Downloads {
    #[serde(default)]
    raw: Option<RawFile>,
}
#[derive(Debug, Deserialize)]
struct RawFile {
    url: String,
    sha1: String,
    size: u64,
}

fn java_home_from_bin(bin: &Path) -> Option<PathBuf> {
    bin.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf())
}

fn is_valid_file(p: &Path) -> bool {
    fs::metadata(p).map(|m| m.is_file() && m.len() > 0).unwrap_or(false)
}

fn is_runtime_ready(home: &Path, major: u8) -> bool {
    let jvm_cfg = if major >= 9 {
        home.join("lib/jvm.cfg")
    } else {
        ["lib/amd64/jvm.cfg", "lib/i386/jvm.cfg", "lib/jvm.cfg"]
            .iter()
            .map(|s| home.join(s))
            .find(|p| p.exists())
            .unwrap_or_else(|| home.join("lib/jvm.cfg"))
    };

    if !is_valid_file(&jvm_cfg) { return false; }

    if major >= 9 {
        let modules = home.join("lib/modules");
        if let Ok(m) = fs::metadata(&modules) {
            if m.is_file() && m.len() >= 1024 * 1024 { return true; }
        }
        return false;
    }
    true
}

fn parse_major_from_runtime_dir(name: &str) -> Option<u8> {
    parse_runtime_dir_name(name).map(|(major, _)| major)
}

fn parse_runtime_dir_name(name: &str) -> Option<(u8, String)> {
    let (component, major_str) = name.rsplit_once("-java")?;
    if component.is_empty() {
        return None;
    }
    let major: u8 = major_str.parse().ok()?;
    Some((major, component.to_string()))
}

const DEFAULT_RUNTIMES: &[(u8, &str)] = &[
    (8, "jre-legacy"),
    (17, "java-runtime-gamma"),
    (21, "java-runtime-delta"),
    (25, "java-runtime-epsilon"),
];

fn list_local_runtime_specs() -> Result<Vec<(u8, String)>, String> {
    let runtimes_root = crate::app::paths::game_root_dir()?.join("runtimes");
    if !runtimes_root.is_dir() {
        return Ok(Vec::new());
    }

    let mut result: Vec<(u8, String)> = Vec::new();
    for entry in fs::read_dir(&runtimes_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let dir_name = dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let Some((major, component)) = parse_runtime_dir_name(dir_name) else {
            continue;
        };
        result.push((major, component));
    }

    result.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    Ok(result)
}

async fn fetch_file_manifest(
    client: &Client,
    component: &str,
) -> Result<FileManifest, String> {
    let candidates = platform_candidates()?;
    let index: JavaIndex = get_json_with_retries(client, INDEX_URL)
        .await
        .map_err(|e| format!("Не удалось получить список Java от Mojang: {e}"))?;

    let manifest_url = candidates
        .iter()
        .filter_map(|platform| index.platforms.get(*platform))
        .chain(index.platforms.get("gamecore"))
        .find_map(|m| m.get(component).and_then(|list| list.first()))
        .map(|e| e.manifest.url.clone())
        .ok_or_else(|| {
            format!("Java не найдена для {}/{component}", candidates[0])
        })?;

    get_json_with_retries(client, &manifest_url)
        .await
        .map_err(|e| format!("Не удалось получить манифест Java {component}: {e}"))
}

fn verify_runtime_files(
    root: &Path,
    manifest: &FileManifest,
) -> (u32, u32, u32) {
    let mut checked_files: u32 = 0;
    let mut missing_files: u32 = 0;
    let mut corrupted_files: u32 = 0;

    for (rel_path, entry) in &manifest.files {
        let e_type = entry.entry_type.as_deref().unwrap_or("file");
        let raw = match entry.downloads.as_ref().and_then(|d| d.raw.as_ref()) {
            Some(r) => r,
            None => {
                if e_type == "directory" {
                    checked_files = checked_files.saturating_add(1);
                    let dest = root.join(rel_path);
                    if !dest.is_dir() {
                        missing_files = missing_files.saturating_add(1);
                    }
                }
                continue;
            }
        };

        checked_files = checked_files.saturating_add(1);
        let dest = root.join(rel_path);
        match verify_cache(&dest, raw.size, &raw.sha1) {
            Ok(true) => {}
            Ok(false) => {
                if dest.exists() {
                    corrupted_files = corrupted_files.saturating_add(1);
                } else {
                    missing_files = missing_files.saturating_add(1);
                }
            }
            Err(_) => {
                if dest.exists() {
                    corrupted_files = corrupted_files.saturating_add(1);
                } else {
                    missing_files = missing_files.saturating_add(1);
                }
            }
        }
    }

    (checked_files, missing_files, corrupted_files)
}

pub fn list_installed_runtimes() -> Result<Vec<JavaRuntimeInfo>, String> {
    let runtimes_root = crate::app::paths::game_root_dir()?.join("runtimes");
    if !runtimes_root.is_dir() {
        return Ok(Vec::new());
    }

    let mut result: Vec<(u8, JavaRuntimeInfo)> = Vec::new();
    for entry in fs::read_dir(&runtimes_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }

        let dir_name = dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let Some(major) = parse_major_from_runtime_dir(dir_name) else {
            continue;
        };

        if !install_complete_path(&dir).is_file() {
            continue;
        }

        let bin = java_bin_path(&dir);
        if !bin.is_file() {
            continue;
        }

        let Some(home) = java_home_from_bin(&bin) else {
            continue;
        };
        if !is_runtime_ready(&home, major) {
            continue;
        }

        result.push((
            major,
            JavaRuntimeInfo {
                path: bin.to_string_lossy().into_owned(),
                version: format!("Java {major}"),
                source: "Mojang runtime".to_string(),
            },
        ));
    }

    result.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(result.into_iter().map(|(_, info)| info).collect())
}

fn resolve_existing(major: u8, component: &str) -> Result<Option<PathBuf>, String> {
    let dir = runtime_dir(major, component)?;
    if !install_complete_path(&dir).is_file() {
        return Ok(None);
    }
    let bin = java_bin_path(&dir);
    if !bin.is_file() { return Ok(None); }
    
    if let Some(home) = java_home_from_bin(&bin) {
        if is_runtime_ready(&home, major) {
            return Ok(Some(bin));
        }
    }
    let _ = fs::remove_file(install_complete_path(&dir));
    Ok(None)
}

fn verify_cache(path: &Path, size: u64, sha1: &str) -> Result<bool, String> {
    let meta = match fs::metadata(path) {
        Ok(m) if m.is_file() => m,
        _ => return Ok(false),
    };
    if size > 0 && meta.len() != size {
        return Ok(false);
    }
    if meta.len() == 0 {
        return Ok(false);
    }
    if !sha1.is_empty() {
        return Ok(compute_sha1(path)?.eq_ignore_ascii_case(sha1));
    }
    Ok(size > 0 && meta.len() == size)
}

fn compute_sha1(path: &Path) -> Result<String, String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha1::new();
    let mut buf = [0u8; 8192];
    while let Ok(n) = f.read(&mut buf) {
        if n == 0 { break; }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

#[cfg(unix)]
fn set_executable(path: &Path, exec: bool) -> Result<(), String> {
    let mut p = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
    let mut mode = p.mode();
    if exec { mode |= 0o111; } else { mode &= !0o111; }
    p.set_mode(mode);
    fs::set_permissions(path, p).map_err(|e| e.to_string())
}

async fn download_java_file(
    client: &Client,
    rel_path: &str,
    url: &str,
    dest: &Path,
    expected_size: u64,
    expected_sha1: &str,
) -> Result<(), String> {
    let mut last_err = String::new();
    for attempt in 0..JAVA_DOWNLOAD_RETRIES {
        if attempt > 0 {
            let delay_ms = (1000u64).saturating_mul(2u64.saturating_pow((attempt - 1).min(5) as u32));
            eprintln!(
                "[Java] Повтор {attempt}/{JAVA_DOWNLOAD_RETRIES} для {rel_path} через {delay_ms}ms"
            );
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        }

        let _ = if dest.is_file() {
            fs::remove_file(dest)
        } else if dest.exists() {
            fs::remove_dir_all(dest)
        } else {
            Ok(())
        };

        let tmp = {
            let mut name = dest.as_os_str().to_owned();
            name.push(".download");
            PathBuf::from(name)
        };
        let _ = fs::remove_file(&tmp);

        let resp = match client.get(url).send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("Ошибка загрузки {rel_path}: {e}");
                continue;
            }
        };
        if !resp.status().is_success() {
            last_err = format!("Ошибка загрузки {rel_path}: {}", resp.status());
            let _ = fs::remove_file(&tmp);
            continue;
        }

        let mut out = match File::create(&tmp) {
            Ok(f) => f,
            Err(e) => {
                last_err = format!("Не удалось создать временный файл {rel_path}: {e}");
                continue;
            }
        };
        let mut hasher = Sha1::new();
        let mut downloaded: u64 = 0;
        let mut stream_err: Option<String> = None;

        let mut resp = resp;
        loop {
            match resp.chunk().await {
                Ok(Some(chunk)) => {
                    if let Err(e) = out.write_all(&chunk) {
                        stream_err = Some(format!("Ошибка записи {rel_path}: {e}"));
                        break;
                    }
                    hasher.update(&chunk);
                    downloaded += chunk.len() as u64;
                }
                Ok(None) => break,
                Err(e) => {
                    stream_err = Some(format!("Ошибка чтения потока {rel_path}: {e}"));
                    break;
                }
            }
        }
        drop(out);

        if let Some(e) = stream_err {
            let _ = fs::remove_file(&tmp);
            last_err = e;
            continue;
        }

        if expected_size > 0 && downloaded != expected_size {
            let _ = fs::remove_file(&tmp);
            last_err = format!(
                "Размер файла {rel_path} не совпадает (ожидалось {expected_size}, получено {downloaded})"
            );
            continue;
        }

        let actual_sha = format!("{:x}", hasher.finalize());
        if !expected_sha1.is_empty() && !actual_sha.eq_ignore_ascii_case(expected_sha1) {
            let _ = fs::remove_file(&tmp);
            last_err = format!("SHA1 не совпадает для {rel_path}");
            continue;
        }

        if let Err(e) = fs::rename(&tmp, dest) {
            let _ = fs::remove_file(&tmp);
            last_err = format!("Не удалось финализировать {rel_path}: {e}");
            continue;
        }
        return Ok(());
    }
    Err(last_err)
}

async fn ensure_java_runtime_inner(
    major: u8,
    component: &str,
    force: bool,
) -> Result<PathBuf, String> {
    let root = runtime_dir(major, component)?;

    if force && root.exists() {
        eprintln!(
            "[Java] Принудительная переустановка Java {} ({})",
            major, component
        );
        fs::remove_dir_all(&root).map_err(|e| {
            format!("Не удалось удалить Java runtime {}: {e}", root.display())
        })?;
    } else if let Some(path) = resolve_existing(major, component)? {
        eprintln!("[Java] Найден готовый Java {}: {}", major, path.display());
        return Ok(path);
    }

    let platform = detect_platform()?;
    eprintln!("[Java] Установка Java {} ({}) для {}", major, component, platform);

    let client = http_client();
    let manifest = fetch_file_manifest(&client, component).await?;

    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(install_complete_path(&root));

    let mut files: Vec<_> = manifest.files.into_iter().collect();
    files.sort_by_key(|(k, _)| {
        if k.starts_with("lib/") {
            0
        } else if k.starts_with("conf/") {
            1
        } else {
            2
        }
    });

    struct PlannedFile {
        rel_path: String,
        dest: PathBuf,
        raw: RawFile,
        #[cfg_attr(not(unix), allow(dead_code))]
        executable: bool,
    }
    let plan_root = root.clone();
    let (to_download, links) = tokio::task::spawn_blocking(
        move || -> Result<(Vec<PlannedFile>, Vec<(PathBuf, String)>), String> {
            let mut to_download = Vec::new();
            let mut links = Vec::new();
            for (rel_path, entry) in files {
                let dest = crate::services::game::core::safe_join(&plan_root, &rel_path)
                    .ok_or_else(|| format!("Небезопасный путь в манифесте Java: {rel_path}"))?;
                let e_type = entry.entry_type.as_deref().unwrap_or("file");
                let executable = entry.executable;

                if e_type == "directory" && entry.downloads.is_none() {
                    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
                    continue;
                }
                if e_type == "link" {
                    if let Some(target) = entry.target.clone() {
                        links.push((dest, target));
                    }
                    continue;
                }

                let Some(raw) = entry.downloads.and_then(|d| d.raw) else {
                    continue;
                };
                if let Some(p) = dest.parent() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
                if verify_cache(&dest, raw.size, &raw.sha1).unwrap_or(false) {
                    #[cfg(unix)]
                    if executable {
                        let _ = set_executable(&dest, true);
                    }
                    continue;
                }
                to_download.push(PlannedFile {
                    rel_path,
                    dest,
                    raw,
                    executable,
                });
            }
            Ok((to_download, links))
        },
    )
    .await
    .map_err(|e| format!("Ошибка подготовки установки Java: {e}"))??;

    let mut downloads = stream::iter(to_download.into_iter())
        .map(|file| {
            let client = client.clone();
            async move {
                download_java_file(
                    &client,
                    &file.rel_path,
                    &file.raw.url,
                    &file.dest,
                    file.raw.size,
                    &file.raw.sha1,
                )
                .await?;
                #[cfg(unix)]
                if file.executable {
                    let _ = set_executable(&file.dest, true);
                }
                Ok::<(), String>(())
            }
        })
        .buffer_unordered(JAVA_DOWNLOAD_CONCURRENCY);
    while let Some(res) = downloads.next().await {
        res?;
    }
    drop(downloads);

    #[cfg(unix)]
    for (link_path, target) in &links {
        if let Some(parent) = link_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::remove_file(link_path);
        std::os::unix::fs::symlink(target, link_path)
            .map_err(|e| format!("Не удалось создать ссылку {}: {e}", link_path.display()))?;
    }
    #[cfg(not(unix))]
    let _ = &links;

    let bin = java_bin_path(&root);
    if !bin.is_file() {
        return Err("Бинарник Java не найден после установки".into());
    }

    let home = java_home_from_bin(&bin).ok_or("Не удалось определить JAVA_HOME")?;
    if !is_runtime_ready(&home, major) {
        return Err("Установленная Java повреждена (проверка готовности не пройдена)".into());
    }

    crate::infra::fs_atomic::write_atomic(&install_complete_path(&root), b"ok").map_err(|e| {
        format!("Не удалось записать маркер завершения установки Java: {e}")
    })?;

    eprintln!("[Java] Готово: {}", bin.display());
    Ok(bin)
}

pub async fn ensure_java_runtime(major: u8, component: &str) -> Result<PathBuf, String> {
    let _guard = JAVA_INSTALL_LOCK.lock().await;
    ensure_java_runtime_inner(major, component, false).await
}

fn filter_specs_by_majors(
    specs: Vec<(u8, String)>,
    majors: Option<&[u8]>,
) -> Vec<(u8, String)> {
    let Some(filter) = majors else {
        return specs;
    };
    if filter.is_empty() {
        return Vec::new();
    }
    specs
        .into_iter()
        .filter(|(major, _)| filter.contains(major))
        .collect()
}

fn default_runtime_specs_for_majors(majors: &[u8]) -> Vec<(u8, String)> {
    majors
        .iter()
        .filter_map(|wanted| {
            DEFAULT_RUNTIMES
                .iter()
                .find(|(major, _)| major == wanted)
                .map(|(major, component)| (*major, (*component).to_string()))
        })
        .collect()
}

pub async fn verify_installed_java_runtimes(
    majors: Option<Vec<u8>>,
) -> Result<JavaIntegrityCheckResult, String> {
    let specs = filter_specs_by_majors(list_local_runtime_specs()?, majors.as_deref());
    if specs.is_empty() {
        return Ok(JavaIntegrityCheckResult {
            is_ok: true,
            checked_files: 0,
            missing_files: 0,
            corrupted_files: 0,
            runtimes_checked: 0,
        });
    }

    let client = http_client();
    let mut checked_files: u32 = 0;
    let mut missing_files: u32 = 0;
    let mut corrupted_files: u32 = 0;
    let mut runtimes_checked: u32 = 0;

    for (major, component) in &specs {
        let root = runtime_dir(*major, component)?;
        if !root.is_dir() {
            continue;
        }

        eprintln!(
            "[Java] Проверка файлов Java {} ({})",
            major, component
        );
        let manifest = fetch_file_manifest(&client, component).await?;
        let (checked, missing, corrupted) = verify_runtime_files(&root, &manifest);
        checked_files = checked_files.saturating_add(checked);
        missing_files = missing_files.saturating_add(missing);
        corrupted_files = corrupted_files.saturating_add(corrupted);
        runtimes_checked = runtimes_checked.saturating_add(1);

        let bin = java_bin_path(&root);
        if let Some(home) = java_home_from_bin(&bin) {
            if !is_runtime_ready(&home, *major) {
                corrupted_files = corrupted_files.saturating_add(1);
            }
        } else if bin.is_file() {
            corrupted_files = corrupted_files.saturating_add(1);
        } else {
            missing_files = missing_files.saturating_add(1);
        }
    }

    Ok(JavaIntegrityCheckResult {
        is_ok: missing_files == 0 && corrupted_files == 0,
        checked_files,
        missing_files,
        corrupted_files,
        runtimes_checked,
    })
}

pub async fn reinstall_java_runtimes(
    majors: Option<Vec<u8>>,
) -> Result<Vec<JavaRuntimeInfo>, String> {
    let _guard = JAVA_INSTALL_LOCK.lock().await;

    let specs = if let Some(filter) = majors.as_deref() {
        if filter.is_empty() {
            return Err("Не выбрана ни одна версия Java".to_string());
        }
        let selected = default_runtime_specs_for_majors(filter);
        if selected.is_empty() {
            return Err("Неизвестные версии Java".to_string());
        }
        selected
    } else {
        let mut local = list_local_runtime_specs()?;
        if local.is_empty() {
            local = DEFAULT_RUNTIMES
                .iter()
                .map(|(major, component)| (*major, (*component).to_string()))
                .collect();
            eprintln!("[Java] Локальных runtime нет — устанавливаем стандартный набор");
        }
        local
    };

    for (major, component) in &specs {
        ensure_java_runtime_inner(*major, component, true).await?;
    }

    list_installed_runtimes()
}

#[cfg_attr(not(unix), allow(dead_code))]
pub fn ensure_executable(path: &Path) -> Result<(), String> {
    if !path.exists() { return Err(format!("Файл не найден: {:?}", path)); }
    
    #[cfg(unix)]
    {
        let meta = fs::metadata(path).map_err(|e| e.to_string())?;
        let mut perms = meta.permissions();
        let mode = perms.mode();
        if mode & 0o100 == 0 {
            perms.set_mode(mode | 0o100);
            fs::set_permissions(path, perms).map_err(|e| e.to_string())?;
            eprintln!("[Java] Выставлен флаг исполнения для {:?}", path);
        }
    }
    Ok(())
}
