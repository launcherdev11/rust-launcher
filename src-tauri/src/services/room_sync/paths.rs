use serde::Serialize;

pub(super) const MAX_MOD_BYTES: u64 = 64 * 1024 * 1024;
pub(super) const MAX_PACK_BYTES: u64 = 512 * 1024 * 1024;
pub(super) const MAX_CONFIG_BYTES: u64 = 16 * 1024 * 1024;
pub(super) const MAX_SCRIPT_BYTES: u64 = 16 * 1024 * 1024;
pub(super) const MAX_ASSET_BYTES: u64 = 64 * 1024 * 1024;
pub(super) const MAX_DEPTH: usize = 12;
const MAX_PATH_LEN: usize = 300;

pub(super) const CONFIG_ROOTS: &[&str] = &[
    "config",
    "defaultconfigs",
    "patchouli_books",
    "fancymenu_data",
];
pub(super) const PACK_ROOTS: &[&str] = &[
    "resourcepacks",
    "shaderpacks",
    "global_packs",
    "openloader",
    "datapacks",
];

pub(super) const KUBEJS_DIRS: &[&str] = &[
    "assets",
    "data",
    "client_scripts",
    "server_scripts",
    "startup_scripts",
    "config",
];
pub(super) const CRAFTTWEAKER_DIR: &str = "scripts";

const DATA_EXTENSIONS: &[&str] = &[
    "toml", "json", "json5", "jsonc", "cfg", "conf", "properties", "yaml", "yml", "txt", "ini",
    "snbt", "csv", "md", "xml", "lang", "mcfunction", "mcmeta",
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "tga",
    "ogg", "wav",
    "nbt", "dat", "schem", "schematic", "litematic",
    "obj", "mtl", "bbmodel", "jem", "jpm", "geo", "animation",
    "ttf", "otf",
    "fsh", "vsh", "gsh", "csh", "glsl", "tcs", "tes", "inc",
];
const RESERVED_WINDOWS_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncFileKind {
    Mod,
    Pack,
    Config,
    Script,
    Asset,
}

impl SyncFileKind {
    pub(super) fn max_bytes(self) -> u64 {
        match self {
            SyncFileKind::Mod => MAX_MOD_BYTES,
            SyncFileKind::Pack => MAX_PACK_BYTES,
            SyncFileKind::Config => MAX_CONFIG_BYTES,
            SyncFileKind::Script => MAX_SCRIPT_BYTES,
            SyncFileKind::Asset => MAX_ASSET_BYTES,
        }
    }

    pub(super) fn needs_config_share(self) -> bool {
        matches!(self, SyncFileKind::Config | SyncFileKind::Script)
    }

    pub(super) fn is_archive(self) -> bool {
        matches!(self, SyncFileKind::Mod | SyncFileKind::Pack)
    }
}

pub(super) fn is_safe_component(part: &str) -> bool {
    if part.is_empty() || part == "." || part == ".." || part.ends_with('.') || part.ends_with(' ') {
        return false;
    }
    if part
        .chars()
        .any(|c| c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\\' | '/'))
    {
        return false;
    }
    let stem = part.split('.').next().unwrap_or(part).to_ascii_lowercase();
    !RESERVED_WINDOWS_NAMES.contains(&stem.as_str())
}

fn extension(name: &str) -> Option<String> {
    name.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase())
}

fn has_extension(name: &str, allowed: &[&str]) -> bool {
    extension(name).is_some_and(|ext| allowed.contains(&ext.as_str()))
}

pub fn classify(rel: &str) -> Option<SyncFileKind> {
    if rel.len() > MAX_PATH_LEN || rel.starts_with('/') {
        return None;
    }
    let parts: Vec<&str> = rel.split('/').collect();
    if parts.len() > MAX_DEPTH + 1 || !parts.iter().all(|p| is_safe_component(p)) {
        return None;
    }
    let file_name = *parts.last()?;
    match parts.as_slice() {
        ["mods", _] if has_extension(file_name, &["jar"]) => Some(SyncFileKind::Mod),
        [root, _, ..] if PACK_ROOTS.contains(root) => {
            if has_extension(file_name, &["zip"]) {
                Some(SyncFileKind::Pack)
            } else if parts.len() > 2 && has_extension(file_name, DATA_EXTENSIONS) {
                Some(SyncFileKind::Asset)
            } else {
                None
            }
        }
        [root, _, ..] if CONFIG_ROOTS.contains(root) && has_extension(file_name, DATA_EXTENSIONS) => {
            Some(SyncFileKind::Config)
        }
        ["kubejs", dir, _, ..]
            if KUBEJS_DIRS.contains(dir)
                && (has_extension(file_name, DATA_EXTENSIONS) || has_extension(file_name, &["js"])) =>
        {
            Some(SyncFileKind::Script)
        }
        [root, _, ..] if *root == CRAFTTWEAKER_DIR && has_extension(file_name, &["zs"]) => {
            Some(SyncFileKind::Script)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_known_content() {
        let cases = [
            ("mods/sodium-0.5.jar", SyncFileKind::Mod),
            ("resourcepacks/Faithful.zip", SyncFileKind::Pack),
            ("shaderpacks/Complementary.zip", SyncFileKind::Pack),
            ("global_packs/required_data/pack.zip", SyncFileKind::Pack),
            ("resourcepacks/MyPack/pack.mcmeta", SyncFileKind::Asset),
            ("resourcepacks/MyPack/assets/minecraft/sounds/a.ogg", SyncFileKind::Asset),
            ("shaderpacks/BSL/shaders/final.fsh", SyncFileKind::Asset),
            ("openloader/data/pack/data/x/structures/house.nbt", SyncFileKind::Asset),
            ("config/create/client.toml", SyncFileKind::Config),
            ("config/fancymenu/assets/logo.png", SyncFileKind::Config),
            ("defaultconfigs/x.json5", SyncFileKind::Config),
            ("patchouli_books/guide/en_us/entries/a.json", SyncFileKind::Config),
            ("kubejs/server_scripts/recipes.js", SyncFileKind::Script),
            ("kubejs/assets/pack/textures/a.png", SyncFileKind::Script),
            ("kubejs/data/pack/structures/a.nbt", SyncFileKind::Script),
            ("scripts/recipes.zs", SyncFileKind::Script),
        ];
        for (path, kind) in cases {
            assert_eq!(classify(path), Some(kind), "{path}");
        }
    }

    #[test]
    fn rejects_escapes_executables_and_personal_files() {
        for bad in [
            "../mods/a.jar",
            "mods/../../a.jar",
            "/etc/passwd",
            "mods/sub/a.jar",
            "mods/a.exe",
            "mods/a.jar.disabled",
            "resourcepacks/pack.mcmeta",
            "resourcepacks/MyPack/run.exe",
            "resourcepacks/MyPack/lib.dll",
            "shaderpacks/a.exe",
            "config/run.bat",
            "config/tool.jar",
            "config/script.js",
            "config/lib.dll",
            "kubejs/exported/cache.json",
            "kubejs/server_scripts/run.exe",
            "kubejs/a.js",
            "scripts/a.js",
            "saves/world/level.dat",
            "options.txt",
            "config/C:evil.toml",
            "config/a\\..\\b.toml",
            "config/CON.toml",
            "config/trailing. ",
            "mods/",
        ] {
            assert_eq!(classify(bad), None, "{bad}");
        }
    }
}
