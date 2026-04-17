use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use once_cell::sync::Lazy;
use reqwest::Client;
use serde::Deserialize;
use sha1::{Digest, Sha1};
use tokio::sync::Mutex;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

static JAVA_INSTALL_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

fn http_client() -> Client {
    Client::builder()
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
        .user_agent("16Launcher/1.0")
        .build()
        .unwrap_or_else(|_| Client::new())
}

fn launcher_root() -> Result<PathBuf, String> {
    dirs::data_dir()
        .ok_or_else(|| "Не удалось получить папку данных".to_string())
        .map(|p| p.join("16Launcher"))
}

fn runtime_dir(major: u8, component: &str) -> Result<PathBuf, String> {
    Ok(launcher_root()?.join("runtimes").join(format!("{component}-java{major}")))
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

fn detect_platform() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Ok("windows-x64"),
        ("linux", "x86_64") => Ok("linux"),
        ("macos", "x86_64") => Ok("mac-os"),
        ("macos", "aarch64") => Ok("mac-os-arm64"),
        (os, arch) => Err(format!("Неподдерживаемая платформа: {os}/{arch}")),
    }
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

fn resolve_existing(major: u8, component: &str) -> Result<Option<PathBuf>, String> {
    let dir = runtime_dir(major, component)?;
    let bin = java_bin_path(&dir);
    if !bin.is_file() { return Ok(None); }
    
    if let Some(home) = java_home_from_bin(&bin) {
        if is_runtime_ready(&home, major) {
            return Ok(Some(bin));
        }
    }
    Ok(None)
}

fn verify_cache(path: &Path, size: u64, sha1: &str) -> Result<bool, String> {
    let meta = match fs::metadata(path) {
        Ok(m) if m.is_file() => m,
        _ => return Ok(false),
    };
    if size > 0 && meta.len() != size { return Ok(false); }
    
    if !sha1.is_empty() && (size == 0 || meta.len() <= 256 * 1024) {
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

fn unzip_to(zip_path: &Path, out_dir: &Path) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name();
        if name.ends_with('/') { continue; }
        
        let out = out_dir.join(name);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut dst = File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut dst).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn flatten_archive(tmp: &Path, final_dir: &Path) -> Result<(), String> {
    if final_dir.exists() {
        fs::remove_dir_all(final_dir).map_err(|e| e.to_string())?;
    }

    let mut entries: Vec<_> = fs::read_dir(tmp)
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;

    if entries.is_empty() { return Err("Пустой архив".into()); }

    if entries.len() == 1 && entries[0].path().is_dir() {
        let inner = entries.remove(0).path();
        fs::create_dir_all(final_dir).map_err(|e| e.to_string())?;
        for child in fs::read_dir(&inner).map_err(|e| e.to_string())? {
            let child = child.map_err(|e| e.to_string())?;
            let name = child.file_name().to_string_lossy().to_string();
            fs::rename(child.path(), final_dir.join(name)).map_err(|e| e.to_string())?;
        }
        fs::remove_dir_all(tmp).map_err(|e| e.to_string())?;
    } else {
        fs::rename(tmp, final_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn ensure_java_runtime(major: u8, component: &str) -> Result<PathBuf, String> {
    let _guard = JAVA_INSTALL_LOCK.lock().await;

    if let Some(path) = resolve_existing(major, component)? {
        eprintln!("[Java] Найден готовый Java {}: {}", major, path.display());
        return Ok(path);
    }

    let platform = detect_platform()?;
    eprintln!("[Java] Установка Java {} ({}) для {}", major, component, platform);

    let client = http_client();
    
    let index: JavaIndex = client.get(INDEX_URL).send().await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let manifest_url = index.platforms.get(platform)
        .or_else(|| index.platforms.get("gamecore"))
        .and_then(|m| m.get(component))
        .and_then(|list| list.first())
        .map(|e| e.manifest.url.clone())
        .ok_or_else(|| format!("Java не найдена для {platform}/{component}"))?;

    let manifest: FileManifest = client.get(&manifest_url).send().await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;

    let root = runtime_dir(major, component)?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let mut files: Vec<_> = manifest.files.into_iter().collect();
    files.sort_by_key(|(k, _)| {
        if k.starts_with("lib/") { 0 } else if k.starts_with("conf/") { 1 } else { 2 }
    });

    for (rel_path, entry) in files {
        let dest = root.join(&rel_path);
        let e_type = entry.entry_type.as_deref().unwrap_or("file");

        if e_type == "directory" && entry.downloads.is_none() {
            fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            continue;
        }

        let raw = match entry.downloads.and_then(|d| d.raw) {
            Some(r) => r,
            None => continue,
        };

        if let Some(p) = dest.parent() { fs::create_dir_all(p).map_err(|e| e.to_string())?; }

        if verify_cache(&dest, raw.size, &raw.sha1).unwrap_or(false) {
            #[cfg(unix)] if entry.executable { let _ = set_executable(&dest, true); }
            continue;
        }

        let _ = if dest.is_file() { fs::remove_file(&dest) } else { fs::remove_dir_all(&dest) };

        let tmp = dest.with_extension("download");
        let _ = fs::remove_file(&tmp);

        let mut resp = client.get(&raw.url).send().await.map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("Ошибка загрузки {}: {}", rel_path, resp.status()));
        }

        let mut out = File::create(&tmp).map_err(|e| e.to_string())?;
        let mut hasher = Sha1::new();
        let mut downloaded: u64 = 0;

        while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
            out.write_all(&chunk).map_err(|e| e.to_string())?;
            hasher.update(&chunk);
            downloaded += chunk.len() as u64;
        }
        drop(out);

        if raw.size > 0 && downloaded != raw.size {
            return Err(format!("Размер файла {} не совпадает", rel_path));
        }
        
        let actual_sha = format!("{:x}", hasher.finalize());
        if !raw.sha1.is_empty() && !actual_sha.eq_ignore_ascii_case(&raw.sha1) {
            return Err(format!("SHA1 не совпадает для {}", rel_path));
        }

        fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
        #[cfg(unix)] if entry.executable { let _ = set_executable(&dest, true); }
    }

    let bin = java_bin_path(&root);
    if !bin.is_file() { return Err("Бинарник Java не найден после установки".into()); }
    
    let home = java_home_from_bin(&bin).ok_or("Не удалось определить JAVA_HOME")?;
    if !is_runtime_ready(&home, major) {
        return Err("Установленная Java повреждена".into());
    }

    eprintln!("[Java] Готово: {}", bin.display());
    Ok(bin)
}

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