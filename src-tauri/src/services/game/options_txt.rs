use std::path::Path;

const RESOURCE_PACKS_KEY: &str = "resourcePacks:";

/// Minecraft 1.13+ stores custom packs as `file/<filename>` in options.txt.
pub fn resource_pack_options_id(filename: &str) -> String {
    format!("file/{filename}")
}

const BUILTIN_RESOURCE_PACK_IDS: &[&str] = &[
    "vanilla",
    "programmer_art",
    "high_contrast",
    "black_and_white",
];

fn is_builtin_resource_pack_id(id: &str) -> bool {
    BUILTIN_RESOURCE_PACK_IDS.contains(&id)
}

/// Map an options.txt entry to a filename in `resourcepacks/`, if applicable.
pub fn resource_pack_filename_from_options_id(id: &str) -> Option<String> {
    let id = id.trim();
    if id.is_empty() || is_builtin_resource_pack_id(id) {
        return None;
    }
    if let Some(rest) = id.strip_prefix("file/") {
        if !rest.is_empty() {
            return Some(rest.to_string());
        }
        return None;
    }
    if id.contains('/') {
        return None;
    }
    Some(id.to_string())
}

pub fn read_resource_packs(options_path: &Path) -> Result<Vec<String>, String> {
    if !options_path.is_file() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(options_path)
        .map_err(|e| format!("Не удалось прочитать options.txt: {e}"))?;
    Ok(parse_resource_packs_from_text(&text))
}

pub fn parse_resource_packs_from_text(text: &str) -> Vec<String> {
    for line in text.lines() {
        if let Some(packs) = parse_resource_packs_line(line) {
            return packs;
        }
    }
    Vec::new()
}

fn parse_resource_packs_line(line: &str) -> Option<Vec<String>> {
    let trimmed = line.trim();
    if !trimmed.starts_with(RESOURCE_PACKS_KEY) {
        return None;
    }
    let value = trimmed[RESOURCE_PACKS_KEY.len()..].trim();
    if value.is_empty() {
        return Some(Vec::new());
    }
    serde_json::from_str::<Vec<String>>(value)
        .ok()
        .or_else(|| {
            let normalized = value.replace('\'', "\"");
            serde_json::from_str(&normalized).ok()
        })
}

pub fn write_resource_packs(options_path: &Path, packs: &[String]) -> Result<(), String> {
    let mut lines: Vec<String> = if options_path.is_file() {
        std::fs::read_to_string(options_path)
            .map_err(|e| format!("Не удалось прочитать options.txt: {e}"))?
            .lines()
            .map(str::to_string)
            .collect()
    } else {
        Vec::new()
    };

    let serialized = serde_json::to_string(packs)
        .map_err(|e| format!("Не удалось сериализовать resourcePacks: {e}"))?;
    let new_line = format!("{RESOURCE_PACKS_KEY}{serialized}");

    if let Some(idx) = lines
        .iter()
        .position(|line| line.trim().starts_with(RESOURCE_PACKS_KEY))
    {
        lines[idx] = new_line.clone();
    } else {
        lines.push(new_line.clone());
    }

    if let Some(parent) = options_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку {}: {e}", parent.display()))?;
    }

    let output = format!("{}\n", lines.join("\n"));
    std::fs::write(options_path, output)
        .map_err(|e| format!("Не удалось записать options.txt: {e}"))?;
    Ok(())
}

/// Rebuild the file-based portion of `resourcePacks` while preserving built-in entries
/// (e.g. `vanilla`). `ordered_filenames` is top-to-bottom UI order (highest priority first).
pub fn merge_resource_pack_order(
    current: &[String],
    ordered_filenames: &[String],
) -> Vec<String> {
    let mut preserved: Vec<String> = current
        .iter()
        .filter(|id| resource_pack_filename_from_options_id(id).is_none())
        .cloned()
        .collect();

    let mut file_ids: Vec<String> = ordered_filenames
        .iter()
        .rev()
        .map(|name| resource_pack_options_id(name))
        .collect();

    preserved.append(&mut file_ids);
    preserved
}

pub fn resource_pack_enabled_in_options(
    options_order: &[String],
    filename: &str,
    has_options_file: bool,
) -> bool {
    if !has_options_file || options_order.is_empty() {
        return true;
    }
    let target = filename;
    options_order.iter().any(|id| {
        resource_pack_filename_from_options_id(id)
            .map(|name| name == target)
            .unwrap_or(false)
    })
}

pub fn add_resource_pack_to_options(current: &[String], filename: &str) -> Vec<String> {
    let id = resource_pack_options_id(filename);
    if current.iter().any(|entry| entry == &id) {
        return current.to_vec();
    }
    let mut next = current.to_vec();
    next.push(id);
    next
}

pub fn remove_resource_pack_from_options(current: &[String], filename: &str) -> Vec<String> {
    current
        .iter()
        .filter(|id| {
            resource_pack_filename_from_options_id(id)
                .map(|name| name != filename)
                .unwrap_or(true)
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_resource_packs_line() {
        let packs = parse_resource_packs_line(r#"resourcePacks:["vanilla","file/pack.zip"]"#)
            .expect("parse");
        assert_eq!(packs, vec!["vanilla", "file/pack.zip"]);
    }

    #[test]
    fn maps_file_prefix_to_filename() {
        assert_eq!(
            resource_pack_filename_from_options_id("file/My Pack.zip"),
            Some("My Pack.zip".to_string())
        );
        assert_eq!(
            resource_pack_filename_from_options_id("Legacy.zip"),
            Some("Legacy.zip".to_string())
        );
        assert_eq!(resource_pack_filename_from_options_id("vanilla"), None);
    }

    #[test]
    fn merge_preserves_builtin_and_reverses_ui_order() {
        let current = vec![
            "vanilla".to_string(),
            "file/a.zip".to_string(),
            "file/b.zip".to_string(),
        ];
        let merged = merge_resource_pack_order(&current, &["b.zip".to_string(), "a.zip".to_string()]);
        assert_eq!(
            merged,
            vec![
                "vanilla".to_string(),
                "file/a.zip".to_string(),
                "file/b.zip".to_string(),
            ]
        );
    }
}
