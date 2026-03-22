use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use once_cell::sync::Lazy;
use reqwest::Client;
use serde::Deserialize;
use sha1::{Digest, Sha1};
use tokio::sync::Mutex;

static JAVA_RUNTIME_INSTALL_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
        .user_agent("16Launcher/1.0")
        .build()
        .unwrap_or_else(|_| Client::new())
}

fn launcher_root_dir() -> Result<PathBuf, String> {
    let base =
        dirs::data_dir().ok_or("Не удалось получить системную папку данных для Java runtime")?;
    Ok(base.join("16Launcher"))
}

fn java_runtime_dir(major_version: u8, component: &str) -> Result<PathBuf, String> {
    Ok(
        launcher_root_dir()?
            .join("runtimes")
            .join(format!("{component}-java{major_version}")),
    )
}

fn java_binary_path(root: &Path) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(root.join("bin").join("javaw.exe"))
    }
    #[cfg(target_os = "macos")]
    {
        let candidate_bundle = root
            .join("jre.bundle")
            .join("Contents")
            .join("Home")
            .join("bin")
            .join("java");
        if candidate_bundle.exists() {
            return Ok(candidate_bundle);
        }
        let candidate_contents = root
            .join("Contents")
            .join("Home")
            .join("bin")
            .join("java");
        if candidate_contents.exists() {
            return Ok(candidate_contents);
        }
        Ok(root.join("bin").join("java"))
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Ok(root.join("bin").join("java"))
    }
}

const JAVA_RUNTIME_INDEX_URL: &str = "https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

fn detect_platform() -> Result<&'static str, String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let platform = match (os, arch) {
        ("windows", "x86_64") => "windows-x64",
        ("linux", "x86_64") => "linux",
        ("macos", "x86_64") => "mac-os",
        ("macos", "aarch64") => "mac-os-arm64",
        _ => {
            return Err(format!(
                "Неподдерживаемая платформа для Java runtime: OS = {os}, ARCH = {arch}"
            ))
        }
    };

    Ok(platform)
}

#[derive(Debug, Deserialize)]
struct JavaRuntimeManifest {
    files: std::collections::HashMap<String, JavaRuntimeFileEntry>,
}

#[derive(Debug, Deserialize)]
struct JavaRuntimeFileEntry {
    #[serde(default)]
    downloads: Option<JavaRuntimeDownloads>,
    #[serde(rename = "type", default)]
    entry_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JavaRuntimeDownloads {
    #[serde(default)]
    raw: Option<JavaRuntimeDownloadRaw>,
}

#[derive(Debug, Deserialize)]
struct JavaRuntimeDownloadRaw {
    url: String,
    sha1: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct JavaRuntimeIndex {
    #[serde(flatten)]
    platforms: std::collections::HashMap<
        String,
        std::collections::HashMap<String, Vec<JavaRuntimeIndexEntry>>,
    >,
}

#[derive(Debug, Deserialize)]
struct JavaRuntimeIndexEntry {
    manifest: JavaRuntimeIndexManifest,
}

#[derive(Debug, Deserialize)]
struct JavaRuntimeIndexManifest {
    url: String,
}

fn java_home_from_binary(java_bin: &Path) -> Option<PathBuf> {
    let bin = java_bin.parent()?;
    let home = bin.parent()?;
    Some(home.to_path_buf())
}

fn file_nonempty(path: &Path) -> bool {
    fs::metadata(path)
        .map(|m| m.is_file() && m.len() > 0)
        .unwrap_or(false)
}

/// Проверяет, что дерево JDK/JRE рядом с `java` не оборвано на середине (типичный случай: есть javaw, нет jvm.cfg).
fn runtime_tree_looks_ready(java_home: &Path, major_version: u8) -> bool {
    let jvm_cfg_ok = if major_version >= 9 {
        let p = java_home.join("lib").join("jvm.cfg");
        p.is_file() && file_nonempty(&p)
    } else {
        [
            java_home.join("lib").join("amd64").join("jvm.cfg"),
            java_home.join("lib").join("i386").join("jvm.cfg"),
            java_home.join("lib").join("jvm.cfg"),
        ]
        .iter()
        .any(|p| p.is_file() && file_nonempty(p))
    };
    if !jvm_cfg_ok {
        return false;
    }
    if major_version >= 9 {
        let modules = java_home.join("lib").join("modules");
        if !modules.is_file() {
            return false;
        }
        let Ok(len) = fs::metadata(&modules).map(|m| m.len()) else {
            return false;
        };
        if len < 1024 * 1024 {
            return false;
        }
    }
    true
}

fn resolve_ready_java_binary(major_version: u8, component: &str) -> Result<Option<PathBuf>, String> {
    let dir = java_runtime_dir(major_version, component)?;
    let java_path = java_binary_path(&dir)?;
    if !java_path.is_file() {
        return Ok(None);
    }
    let Some(home) = java_home_from_binary(&java_path) else {
        return Ok(None);
    };
    if !runtime_tree_looks_ready(&home, major_version) {
        return Ok(None);
    }
    Ok(Some(java_path))
}

/// Быстрая проверка уже скачанного файла: размер; для мелких файлов — ещё и SHA1.
fn cached_file_matches(path: &Path, expected_size: u64, expected_sha1: &str) -> Result<bool, String> {
    let meta = match fs::metadata(path) {
        Ok(m) if m.is_file() => m,
        _ => return Ok(false),
    };
    let len = meta.len();
    if expected_size > 0 && len != expected_size {
        return Ok(false);
    }
    if !expected_sha1.is_empty() && (expected_size == 0 || len <= 256 * 1024) {
        let actual = compute_sha1(path)?;
        return Ok(actual.eq_ignore_ascii_case(expected_sha1));
    }
    if expected_size > 0 {
        return Ok(len == expected_size);
    }
    Ok(false)
}

fn compute_sha1(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|e| format!("Ошибка открытия файла для SHA1: {e}"))?;
    let mut hasher = Sha1::new();
    let mut buf = [0u8; 8192];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("Ошибка чтения файла для SHA1: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn unzip_to_dir(zip_path: &Path, out_dir: &Path) -> Result<(), String> {
    let file =
        fs::File::open(zip_path).map_err(|e| format!("Не удалось открыть архив Java runtime: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Ошибка чтения zip‑архива Java: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Ошибка чтения entry из zip: {e}"))?;
        let name = entry.name().to_string();
        if name.ends_with('/') {
            continue;
        }
        let out_path = out_dir.join(&name);
        if entry.is_dir() {
            fs::create_dir_all(&out_path)
                .map_err(|e| format!("Ошибка создания папки при распаковке Java: {e}"))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Ошибка создания папки при распаковке Java: {e}"))?;
            }
            let mut out_file = fs::File::create(&out_path)
                .map_err(|e| format!("Ошибка создания файла при распаковке Java: {e}"))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| format!("Ошибка копирования при распаковке Java: {e}"))?;
        }
    }

    Ok(())
}

fn flatten_top_level(tmp_dir: &Path, final_dir: &Path) -> Result<(), String> {
    if final_dir.exists() {
        fs::remove_dir_all(final_dir)
            .map_err(|e| format!("Не удалось удалить старую папку Java runtime: {e}"))?;
    }

    let mut entries = fs::read_dir(tmp_dir)
        .map_err(|e| format!("Ошибка чтения временной папки Java runtime: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Ошибка чтения содержимого временной папки: {e}"))?;

    if entries.is_empty() {
        return Err("Пустой архив Java runtime".to_string());
    }

    if entries.len() == 1 && entries[0].path().is_dir() {
        let inner = entries.remove(0).path();
        fs::create_dir_all(final_dir)
            .map_err(|e| format!("Не удалось создать папку Java runtime: {e}"))?;

        for child in fs::read_dir(&inner)
            .map_err(|e| format!("Ошибка чтения содержимого вложенной папки Java: {e}"))?
        {
            let child =
                child.map_err(|e| format!("Ошибка чтения entry вложенной папки Java: {e}"))?;
            let from = child.path();
            let name = from
                .file_name()
                .ok_or("Некорректное имя файла в архиве Java")?;
            let to = final_dir.join(name);
            fs::rename(&from, &to)
                .map_err(|e| format!("Ошибка перемещения файлов Java runtime: {e}"))?;
        }

        fs::remove_dir_all(tmp_dir)
            .map_err(|e| format!("Ошибка очистки временной папки Java runtime: {e}"))?;
    } else {
        fs::rename(tmp_dir, final_dir)
            .map_err(|e| format!("Ошибка перемещения Java runtime в итоговую папку: {e}"))?;
    }

    Ok(())
}

pub async fn ensure_java_runtime(major_version: u8, component: &str) -> Result<PathBuf, String> {
    let _install_guard = JAVA_RUNTIME_INSTALL_LOCK.lock().await;

    if let Some(path) = resolve_ready_java_binary(major_version, component)? {
        eprintln!(
            "[JavaRuntime] Используется уже установленный Java {} ({}): {}",
            major_version,
            component,
            path.display()
        );
        return Ok(path);
    }

    let platform = detect_platform()?;
    eprintln!(
        "[JavaRuntime] Требуется Java {}, компонент: {}, платформа: {}",
        major_version, component, platform
    );

    let client = http_client();

    let index_resp = client
        .get(JAVA_RUNTIME_INDEX_URL)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса списка Java runtime (all.json): {e}"))?;

    if !index_resp.status().is_success() {
        return Err(format!(
            "Сервер вернул ошибку {} при запросе списка Java runtime (all.json)",
            index_resp.status()
        ));
    }

    let index: JavaRuntimeIndex = index_resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора списка Java runtime (all.json): {e}"))?;

    let manifest_url = index
        .platforms
        .get(platform)
        .and_then(|platform_map| platform_map.get(component))
        .and_then(|list| list.first())
        .map(|e| e.manifest.url.clone())
        .or_else(|| {
            index
                .platforms
                .get("gamecore")
                .and_then(|platform_map| platform_map.get(component))
                .and_then(|list| list.first())
                .map(|e| e.manifest.url.clone())
        })
        .ok_or_else(|| {
            format!(
                "Не удалось найти Java runtime component='{}' для платформы '{}' (и gamecore) в all.json",
                component, platform
            )
        })?;

    eprintln!("[JavaRuntime] URL манифеста файлов: {}", manifest_url);

    let manifest_resp = client
        .get(&manifest_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса манифеста файлов Java runtime: {e}"))?;

    if !manifest_resp.status().is_success() {
        return Err(format!(
            "Сервер вернул ошибку {} при запросе манифеста файлов Java runtime",
            manifest_resp.status()
        ));
    }

    let manifest: JavaRuntimeManifest = manifest_resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора манифеста файлов Java runtime: {e}"))?;

    let mut manifest_files: Vec<(String, JavaRuntimeFileEntry)> =
        manifest.files.into_iter().collect();
    manifest_files.sort_by(|(ka, _), (kb, _)| {
        fn download_bucket(key: &str) -> u8 {
            if key.starts_with("lib/") || key == "lib" {
                0
            } else if key.starts_with("conf/") || key == "conf" {
                1
            } else {
                2
            }
        }
        download_bucket(ka)
            .cmp(&download_bucket(kb))
            .then_with(|| ka.cmp(kb))
    });

    let runtime_root = java_runtime_dir(major_version, component)?;
    fs::create_dir_all(&runtime_root)
        .map_err(|e| format!("Не удалось создать папку Java runtime: {e}"))?;

    for (relative_path, entry) in manifest_files {
        let entry_type = entry.entry_type.as_deref().unwrap_or("file");
        let dest_path = runtime_root.join(Path::new(&relative_path));

        if entry_type == "directory" && entry.downloads.is_none() {
            fs::create_dir_all(&dest_path).map_err(|e| {
                format!(
                    "Не удалось создать папку '{}' для Java runtime: {e}",
                    dest_path.display()
                )
            })?;
            continue;
        }

        let raw = match entry.downloads.and_then(|d| d.raw) {
            Some(raw) => raw,
            None => {
                continue;
            }
        };

        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "Не удалось создать родительскую папку '{}' для Java runtime: {e}",
                    parent.display()
                )
            })?;
        }

        if cached_file_matches(&dest_path, raw.size, &raw.sha1).unwrap_or(false) {
            continue;
        }
        if dest_path.exists() {
            if dest_path.is_file() {
                let _ = fs::remove_file(&dest_path);
            } else {
                let _ = fs::remove_dir_all(&dest_path);
            }
        }

        let mut resp = client
            .get(&raw.url)
            .send()
            .await
            .map_err(|e| format!("Ошибка загрузки файла Java runtime '{}': {e}", relative_path))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Сервер вернул ошибку {} при загрузке файла Java runtime '{}': {}",
                resp.status(),
                relative_path,
                raw.url
            ));
        }

        let tmp_path = dest_path.with_extension("download");
        let _ = fs::remove_file(&tmp_path);
        let mut file = fs::File::create(&tmp_path).map_err(|e| {
            format!(
                "Не удалось создать файл '{}' для Java runtime: {e}",
                tmp_path.display()
            )
        })?;

        let mut hasher = Sha1::new();
        let mut downloaded: u64 = 0;

        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| format!("Ошибка чтения потока Java runtime '{}': {e}", relative_path))?
        {
            file.write_all(&chunk)
                .map_err(|e| format!("Ошибка записи файла Java runtime '{}': {e}", relative_path))?;
            hasher.update(&chunk);
            downloaded += chunk.len() as u64;
        }

        drop(file);

        if raw.size > 0 && downloaded != raw.size {
            return Err(format!(
                "Несовпадение размера файла Java runtime '{}': ожидалось {}, скачано {}",
                relative_path, raw.size, downloaded
            ));
        }

        let actual_sha1 = compute_sha1(&tmp_path)?;
        if !raw.sha1.is_empty() && !actual_sha1.eq_ignore_ascii_case(&raw.sha1) {
            return Err(format!(
                "SHA1 файла Java runtime '{}' не совпадает. Ожидалось {}, получено {}",
                relative_path, raw.sha1, actual_sha1
            ));
        }

        fs::rename(&tmp_path, &dest_path).map_err(|e| {
            format!(
                "Не удалось переместить временный файл Java runtime '{}' в '{}': {}",
                tmp_path.display(),
                dest_path.display(),
                e
            )
        })?;
    }

    let java_path = java_binary_path(&runtime_root)?;
    if !java_path.is_file() {
        return Err(format!(
            "После загрузки Java runtime не найден Java бинарник по пути: {}",
            java_path.display()
        ));
    }
    let home = java_home_from_binary(&java_path).ok_or_else(|| {
        "После загрузки Java runtime не удалось определить корень JDK/JRE (некорректный путь к java)"
            .to_string()
    })?;
    if !runtime_tree_looks_ready(&home, major_version) {
        return Err(format!(
            "После загрузки Java runtime дерево JRE неполное (нет jvm.cfg или lib/modules). Удалите папку '{}' и попробуйте снова.",
            runtime_root.display()
        ));
    }

    eprintln!(
        "[JavaRuntime] Готово. Используется Java {} ({}): {}",
        major_version,
        component,
        java_path.display()
    );

    Ok(java_path)
}

