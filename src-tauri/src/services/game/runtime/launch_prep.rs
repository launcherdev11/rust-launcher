use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::AtomicU64;

use tauri::AppHandle;

use crate::infra::http::http_client_for_binary_download;
use crate::services::game::core::library_applies;
use crate::services::game::console::log_to_console;
use crate::services::game::runtime::downloads::download_file_checked;
use crate::services::game::state::{BMCL_MAVEN_BASE, DEFAULT_DOWNLOAD_RETRIES};
use crate::services::game::version_types::Library;

pub(crate) async fn ensure_library_artifacts_present_for_launch(
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

pub(crate) fn offline_uuid_from_username(name: &str) -> String {
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

pub(crate) fn is_release_1_17_or_newer(version_id: &str) -> bool {
    let normalized = version_id
        .split_once('-')
        .map(|(base, _)| base)
        .unwrap_or(version_id);
    let mut parts = normalized.split('.');
    let major = parts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    major > 1 || (major == 1 && minor >= 17)
}

pub(crate) fn lwjgl_fallback_modules() -> &'static [&'static str] {
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

pub(crate) async fn ensure_lwjgl_fallback_for_modern_versions(
    app: &AppHandle,
    version_id: &str,
    libs_root: &Path,
    classpath: &mut Vec<PathBuf>,
    seen_paths: &mut std::collections::HashSet<String>,
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
