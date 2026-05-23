use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

use tauri::command;

use crate::app::paths::launcher_data_dir;
use crate::profile_launch::LAUNCH_PROFILE_ARG;
use crate::services::game::profiles::{load_all_instance_profiles, profile_icon_file_path};

const SHORTCUT_SUFFIX: &str = " - 16Launcher";

fn sanitize_shortcut_base_name(name: &str) -> String {
    const INVALID: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let mut out: String = name
        .chars()
        .map(|c| {
            if INVALID.contains(&c) || c.is_control() {
                '_'
            } else {
                c
            }
        })
        .collect();
    while out.ends_with(' ') || out.ends_with('.') {
        out.pop();
    }
    if out.is_empty() {
        "Minecraft".to_string()
    } else {
        out
    }
}

#[cfg(target_os = "windows")]
fn shortcut_file_name(base: &str) -> String {
    format!("{base}.lnk")
}

#[cfg(target_os = "linux")]
fn shortcut_file_name(base: &str) -> String {
    format!("{base}.desktop")
}

#[cfg(target_os = "macos")]
fn shortcut_file_name(base: &str) -> String {
    format!("{base}.command")
}

fn unique_shortcut_path(desktop: &Path, base: &str) -> PathBuf {
    let primary = desktop.join(shortcut_file_name(base));
    if !primary.exists() {
        return primary;
    }
    for i in 2..100 {
        let candidate = desktop.join(shortcut_file_name(&format!("{base} ({i})")));
        if !candidate.exists() {
            return candidate;
        }
    }
    primary
}

#[cfg(windows)]
fn file_modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).ok().and_then(|m| m.modified().ok())
}

#[cfg(windows)]
fn needs_icon_refresh(source: &Path, ico_path: &Path) -> bool {
    if !ico_path.is_file() {
        return true;
    }
    match (file_modified(source), file_modified(ico_path)) {
        (Some(src), Some(dest)) => src > dest,
        _ => true,
    }
}

#[cfg(windows)]
fn ensure_windows_shortcut_icon(source: &Path, profile_id: &str) -> Result<PathBuf, String> {
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    if ext.as_deref() == Some("ico") {
        return Ok(source.to_path_buf());
    }

    let cache_dir = launcher_data_dir()?.join("shortcut-icons");
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Не удалось создать кэш иконок ярлыков: {e}"))?;
    let ico_path = cache_dir.join(format!("{profile_id}.ico"));

    if needs_icon_refresh(source, &ico_path) {
        use image::imageops::FilterType;
        use image::ImageFormat;

        let img = image::open(source)
            .map_err(|e| format!("Не удалось прочитать иконку сборки: {e}"))?;
        let resized = img.resize(256, 256, FilterType::Lanczos3);
        resized
            .save_with_format(&ico_path, ImageFormat::Ico)
            .map_err(|e| format!("Не удалось сохранить ICO для ярлыка: {e}"))?;
    }

    Ok(ico_path)
}

#[cfg(windows)]
fn resolve_windows_icon_location(
    profile_id: &str,
    launcher_exe: &Path,
) -> Result<Option<String>, String> {
    if let Some(source) = profile_icon_file_path(profile_id) {
        let ico = ensure_windows_shortcut_icon(&source, profile_id)?;
        return Ok(Some(format!("{},0", ico.display())));
    }

    if let Some(fallback) = launcher_fallback_icon(launcher_exe) {
        return Ok(Some(format!("{},0", fallback.display())));
    }

    Ok(None)
}

fn launcher_fallback_icon(exe: &Path) -> Option<PathBuf> {
    let parent = exe.parent()?;
    let candidates = [
        parent.join("icons/icon.ico"),
        parent.join("resources/icons/icon.ico"),
        parent.join("../icons/icon.ico"),
        parent.join("../../src-tauri/icons/icon.ico"),
        parent.join("../../../src-tauri/icons/icon.ico"),
    ];
    for path in candidates {
        if path.is_file() {
            return path.canonicalize().ok().or(Some(path));
        }
    }
    None
}

#[cfg(windows)]
fn create_windows_shortcut(
    shortcut_path: &Path,
    exe: &Path,
    profile_id: &str,
) -> Result<(), String> {
    let work_dir = exe
        .parent()
        .ok_or("Не удалось определить рабочую папку лаунчера")?;

    fn ps_quote(value: &str) -> String {
        format!("'{}'", value.replace('\'', "''"))
    }

    let target = ps_quote(&exe.to_string_lossy());
    let args = ps_quote(&format!("{LAUNCH_PROFILE_ARG} {profile_id}"));
    let work = ps_quote(&work_dir.to_string_lossy());
    let link = ps_quote(&shortcut_path.to_string_lossy());
    let icon_line = resolve_windows_icon_location(profile_id, exe)?
        .map(|loc| format!("$s.IconLocation = {};", ps_quote(&loc)))
        .unwrap_or_default();

    let script = format!(
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut({link}); \
         $s.TargetPath = {target}; \
         $s.Arguments = {args}; \
         $s.WorkingDirectory = {work}; \
         {icon_line} \
         $s.Save();"
    );

    let status = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .status()
        .map_err(|e| format!("Не удалось запустить PowerShell: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "PowerShell завершился с кодом {}",
            status.code().unwrap_or(-1)
        ))
    }
}

#[cfg(target_os = "linux")]
fn resolve_linux_icon(profile_id: &str, launcher_exe: &Path) -> Option<PathBuf> {
    profile_icon_file_path(profile_id).or_else(|| launcher_fallback_icon(launcher_exe))
}

#[cfg(target_os = "linux")]
fn create_linux_shortcut(
    shortcut_path: &Path,
    exe: &Path,
    profile_name: &str,
    profile_id: &str,
) -> Result<(), String> {
    let icon_line = resolve_linux_icon(profile_id, exe)
        .map(|p| format!("Icon={}\n", p.display()))
        .unwrap_or_default();

    let content = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Version=1.0\n\
         Name={name}\n\
         Comment=Launch Minecraft profile via 16Launcher\n\
         Exec={exec} {arg} {profile_id}\n\
         {icon_line}\
         Terminal=false\n\
         Categories=Game;\n\
         StartupNotify=true\n",
        name = profile_name.replace('\n', " "),
        exec = shell_escape_linux(exe),
        arg = LAUNCH_PROFILE_ARG,
        profile_id = profile_id,
    );

    std::fs::write(shortcut_path, content)
        .map_err(|e| format!("Не удалось записать .desktop файл: {e}"))?;

    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(shortcut_path)
        .map_err(|e| format!("Не удалось прочитать права файла: {e}"))?
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(shortcut_path, perms)
        .map_err(|e| format!("Не удалось сделать ярлык исполняемым: {e}"))?;

    Ok(())
}

#[cfg(target_os = "linux")]
fn shell_escape_linux(path: &Path) -> String {
    let s = path.to_string_lossy();
    if s.contains(' ') || s.contains('\t') {
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        s.into_owned()
    }
}

#[cfg(target_os = "macos")]
fn create_macos_shortcut(
    shortcut_path: &Path,
    exe: &Path,
    profile_id: &str,
) -> Result<(), String> {
    let content = format!(
        "#!/bin/bash\nexec \"{exe}\" {arg} {profile_id}\n",
        exe = exe.display(),
        arg = LAUNCH_PROFILE_ARG,
        profile_id = profile_id,
    );

    std::fs::write(shortcut_path, content)
        .map_err(|e| format!("Не удалось записать ярлык: {e}"))?;

    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(shortcut_path)
        .map_err(|e| format!("Не удалось прочитать права файла: {e}"))?
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(shortcut_path, perms)
        .map_err(|e| format!("Не удалось сделать ярлык исполняемым: {e}"))?;

    Ok(())
}

#[command]
pub fn create_profile_desktop_shortcut(profile_id: String) -> Result<String, String> {
    let profile_id = profile_id.trim().to_string();
    if profile_id.is_empty() {
        return Err("Не указан идентификатор сборки".to_string());
    }

    let profiles = load_all_instance_profiles()?;
    let profile = profiles
        .into_iter()
        .find(|p| p.id == profile_id)
        .ok_or("Сборка не найдена".to_string())?;

    let desktop = dirs::desktop_dir()
        .ok_or("Не удалось определить папку рабочего стола".to_string())?;
    std::fs::create_dir_all(&desktop)
        .map_err(|e| format!("Не удалось создать папку рабочего стола: {e}"))?;

    let exe = std::env::current_exe()
        .map_err(|e| format!("Не удалось определить путь к лаунчеру: {e}"))?;

    let base = sanitize_shortcut_base_name(&format!("{}{SHORTCUT_SUFFIX}", profile.name));
    let shortcut_path = unique_shortcut_path(&desktop, &base);

    #[cfg(target_os = "windows")]
    create_windows_shortcut(&shortcut_path, &exe, &profile.id)?;

    #[cfg(target_os = "linux")]
    create_linux_shortcut(&shortcut_path, &exe, &profile.name, &profile.id)?;

    #[cfg(target_os = "macos")]
    create_macos_shortcut(&shortcut_path, &exe, &profile.id)?;

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = (shortcut_path, exe, profile);
        return Err("Создание ярлыков не поддерживается на этой ОС".to_string());
    }

    shortcut_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Путь к ярлыку не в UTF-8".to_string())
}
