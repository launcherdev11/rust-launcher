use std::path::Path;
use serde::{Deserialize, Serialize};
use crate::services::game::options_txt::{
    read_resource_packs, read_shader_pack_selection, write_resource_packs, write_shader_pack_selection,
    ShaderPackSelection,
};

use super::paths::is_safe_component;

const MAX_RESOURCE_PACKS: usize = 200;
const MAX_PACK_ID_LEN: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOptions {
    pub resource_packs: Vec<String>,
    pub shader_pack: Option<String>,
    pub shaders_enabled: bool,
}

pub(super) fn read_options(root: &Path) -> SyncOptions {
    let shader = read_shader_pack_selection(root).unwrap_or_else(|_| ShaderPackSelection::inactive());
    SyncOptions {
        resource_packs: read_resource_packs(&root.join("options.txt")).unwrap_or_default(),
        shaders_enabled: shader.enabled && shader.name.is_some(),
        shader_pack: shader.name,
    }
}

fn valid_pack_id(id: &str) -> bool {
    if id.is_empty() || id.len() > MAX_PACK_ID_LEN || id.chars().any(char::is_control) {
        return false;
    }
    match id.strip_prefix("file/") {
        Some(name) => is_safe_component(name),
        None => id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':' | '/')),
    }
}

pub(super) fn sanitize(options: SyncOptions) -> Option<SyncOptions> {
    let packs_ok = options.resource_packs.len() <= MAX_RESOURCE_PACKS
        && options.resource_packs.iter().all(|id| valid_pack_id(id));
    let shader_ok = options
        .shader_pack
        .as_deref()
        .is_none_or(|name| name.len() <= MAX_PACK_ID_LEN && is_safe_component(name));
    (packs_ok && shader_ok).then_some(options)
}

pub(super) fn apply_options(root: &Path, options: &SyncOptions) -> Result<(), String> {
    write_resource_packs(&root.join("options.txt"), &options.resource_packs)?;
    let selection = match options.shader_pack.as_deref() {
        Some(name) if options.shaders_enabled => ShaderPackSelection::active(name),
        _ => ShaderPackSelection::inactive(),
    };
    write_shader_pack_selection(root, &selection)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(packs: &[&str], shader: Option<&str>) -> SyncOptions {
        SyncOptions {
            resource_packs: packs.iter().map(|s| s.to_string()).collect(),
            shader_pack: shader.map(str::to_string),
            shaders_enabled: shader.is_some(),
        }
    }

    #[test]
    fn keeps_normal_values() {
        assert!(sanitize(opts(&["vanilla", "fabric", "file/Faithful 32x.zip"], Some("BSL.zip"))).is_some());
    }

    #[test]
    fn rejects_paths_outside_packs() {
        assert!(sanitize(opts(&["file/../../evil.zip"], None)).is_none());
        assert!(sanitize(opts(&["vanilla"], Some("../shader.zip"))).is_none());
        assert!(sanitize(opts(&["file/a\nb"], None)).is_none());
    }
}
