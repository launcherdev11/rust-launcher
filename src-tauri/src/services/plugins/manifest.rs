use std::path::Path;

use crate::models::plugin::{PluginManifest, PLUGIN_API_VERSION};

pub fn read_manifest(plugin_dir: &Path) -> Result<PluginManifest, String> {
    let manifest_path = plugin_dir.join("plugin.json");
    if !manifest_path.is_file() {
        return Err(format!(
            "Файл plugin.json не найден: {}",
            manifest_path.display()
        ));
    }

    let text = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Не удалось прочитать {}: {e}", manifest_path.display()))?;

    let manifest: PluginManifest = serde_json::from_str(&text)
        .map_err(|e| format!("Некорректный plugin.json в {}: {e}", plugin_dir.display()))?;

    validate_manifest(&manifest)?;
    Ok(manifest)
}

pub fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    if manifest.api_version != PLUGIN_API_VERSION {
        return Err(format!(
            "Плагин «{}» использует api_version {}, лаунчер поддерживает {}",
            manifest.id, manifest.api_version, PLUGIN_API_VERSION
        ));
    }

    if manifest.id.trim().is_empty() {
        return Err("Поле id в plugin.json не может быть пустым".to_string());
    }

    if !manifest
        .id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!(
            "Некорректный id плагина «{}»: допустимы только буквы, цифры, - и _",
            manifest.id
        ));
    }

    if manifest.name.trim().is_empty() {
        return Err(format!("Плагин «{}»: поле name обязательно", manifest.id));
    }

    if manifest.version.trim().is_empty() {
        return Err(format!("Плагин «{}»: поле version обязательно", manifest.id));
    }

    Ok(())
}
