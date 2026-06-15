use crate::app::paths::{game_root_dir, instance_dir};

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
