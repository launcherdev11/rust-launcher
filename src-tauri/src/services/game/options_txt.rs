use std::path::{Path, PathBuf};

const RESOURCE_PACKS_KEY: &str = "resourcePacks:";

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShaderPackSelection {
    pub name: Option<String>,
    pub enabled: bool,
}

impl ShaderPackSelection {
    pub fn inactive() -> Self {
        Self {
            name: None,
            enabled: false,
        }
    }

    pub fn active(name: impl Into<String>) -> Self {
        Self {
            name: Some(name.into()),
            enabled: true,
        }
    }

    pub fn is_active_pack(&self, filename: &str) -> bool {
        self.enabled
            && self
                .name
                .as_deref()
                .map(|n| n == filename)
                .unwrap_or(false)
    }
}

fn iris_properties_path(profile_dir: &Path) -> PathBuf {
    profile_dir.join("config").join("iris.properties")
}

fn optionsshaders_path(profile_dir: &Path) -> PathBuf {
    profile_dir.join("optionsshaders.txt")
}

fn normalize_shader_pack_name(raw: &str) -> Option<String> {
    let name = raw.trim();
    if name.is_empty() || name.eq_ignore_ascii_case("OFF") || name == "(internal)" {
        return None;
    }
    Some(name.to_string())
}

fn parse_properties_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
        return None;
    }
    let (k, v) = trimmed.split_once('=')?;
    if k.trim() != key {
        return None;
    }
    Some(v.trim())
}

fn escape_java_properties_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c <= '\u{007f}' => out.push(c),
            c => {
                for unit in c.encode_utf16(&mut [0; 2]) {
                    out.push_str(&format!("\\u{unit:04x}"));
                }
            }
        }
    }
    out
}

fn unescape_java_properties_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('u') => {
                let mut hex = String::new();
                for _ in 0..4 {
                    if let Some(h) = chars.next() {
                        hex.push(h);
                    }
                }
                if let Ok(code) = u16::from_str_radix(&hex, 16) {
                    if let Some(decoded) = char::from_u32(u32::from(code)) {
                        out.push(decoded);
                    }
                }
            }
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

fn upsert_properties_key(text: &str, key: &str, value: &str) -> String {
    let new_line = format!("{key}={}", escape_java_properties_value(value));
    let mut found = false;
    let mut lines: Vec<String> = text
        .lines()
        .map(|line| {
            if parse_properties_value(line, key).is_some() {
                found = true;
                new_line.clone()
            } else {
                line.to_string()
            }
        })
        .collect();
    if !found {
        if !lines.is_empty() && !lines.last().map(|l| l.is_empty()).unwrap_or(true) {
        }
        lines.push(new_line);
    }
    let mut output = lines.join("\n");
    if !output.ends_with('\n') {
        output.push('\n');
    }
    output
}

fn read_properties_file(path: &Path) -> Result<Option<String>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("Не удалось прочитать {}: {e}", path.display()))?;
    Ok(Some(text))
}

fn write_text_file(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Не удалось создать папку {}: {e}", parent.display()))?;
    }
    std::fs::write(path, text)
        .map_err(|e| format!("Не удалось записать {}: {e}", path.display()))
}

fn read_iris_selection(text: &str) -> ShaderPackSelection {
    let mut name: Option<String> = None;
    let mut enabled = true;
    for line in text.lines() {
        if let Some(v) = parse_properties_value(line, "shaderPack") {
            name = normalize_shader_pack_name(&unescape_java_properties_value(v));
        } else if let Some(v) = parse_properties_value(line, "enableShaders") {
            enabled = !v.eq_ignore_ascii_case("false");
        }
    }
    ShaderPackSelection { name, enabled }
}

fn read_optionsshaders_selection(text: &str) -> ShaderPackSelection {
    for line in text.lines() {
        if let Some(v) = parse_properties_value(line, "shaderPack") {
            return match normalize_shader_pack_name(v) {
                Some(name) => ShaderPackSelection::active(name),
                None => ShaderPackSelection::inactive(),
            };
        }
    }
    ShaderPackSelection::inactive()
}

pub fn read_shader_pack_selection(profile_dir: &Path) -> Result<ShaderPackSelection, String> {
    let iris_path = iris_properties_path(profile_dir);
    if let Some(text) = read_properties_file(&iris_path)? {
        let selection = read_iris_selection(&text);
        return Ok(selection);
    }

    let of_path = optionsshaders_path(profile_dir);
    if let Some(text) = read_properties_file(&of_path)? {
        return Ok(read_optionsshaders_selection(&text));
    }

    Ok(ShaderPackSelection::inactive())
}

pub fn write_shader_pack_selection(
    profile_dir: &Path,
    selection: &ShaderPackSelection,
) -> Result<(), String> {
    let iris_path = iris_properties_path(profile_dir);
    let of_path = optionsshaders_path(profile_dir);

    let pack_name = selection.name.clone().unwrap_or_default();
    let enable = selection.enabled && selection.name.is_some();

    let iris_text = read_properties_file(&iris_path)?.unwrap_or_else(|| {
        "# This file stores configuration options for Iris, such as the currently active shaderpack\n"
            .to_string()
    });
    let mut iris_next = upsert_properties_key(&iris_text, "shaderPack", &pack_name);
    iris_next = upsert_properties_key(
        &iris_next,
        "enableShaders",
        if enable { "true" } else { "false" },
    );
    write_text_file(&iris_path, &iris_next)?;

    let of_value = if enable {
        pack_name.as_str()
    } else {
        "OFF"
    };
    let of_text = read_properties_file(&of_path)?.unwrap_or_default();
    let of_next = upsert_properties_key(&of_text, "shaderPack", of_value);
    write_text_file(&of_path, &of_next)?;

    Ok(())
}

pub fn clear_shader_pack_if_matches(
    profile_dir: &Path,
    filename: &str,
) -> Result<(), String> {
    let current = read_shader_pack_selection(profile_dir)?;
    if current.name.as_deref() == Some(filename) {
        write_shader_pack_selection(
            profile_dir,
            &ShaderPackSelection {
                name: current.name,
                enabled: false,
            },
        )?;
    }
    Ok(())
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

    #[test]
    fn reads_iris_selection() {
        let text = "shaderPack=Complementary.zip\nenableShaders=true\n";
        let sel = read_iris_selection(text);
        assert!(sel.is_active_pack("Complementary.zip"));
    }

    #[test]
    fn disabled_iris_is_not_active() {
        let text = "shaderPack=Complementary.zip\nenableShaders=false\n";
        let sel = read_iris_selection(text);
        assert!(!sel.is_active_pack("Complementary.zip"));
        assert_eq!(sel.name.as_deref(), Some("Complementary.zip"));
    }

    #[test]
    fn reads_optionsshaders_off() {
        let sel = read_optionsshaders_selection("shaderPack=OFF\n");
        assert!(!sel.enabled);
        assert!(sel.name.is_none());
    }

    #[test]
    fn upsert_updates_existing_key() {
        let next = upsert_properties_key("shaderPack=old.zip\nfoo=bar\n", "shaderPack", "new.zip");
        assert!(next.contains("shaderPack=new.zip"));
        assert!(next.contains("foo=bar"));
    }
}
