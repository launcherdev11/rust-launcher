#![allow(dead_code)]

use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub(crate) struct VersionManifest {
    pub(crate) versions: Vec<ManifestVersion>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ManifestVersion {
    pub(crate) id: String,
    #[serde(rename = "type")]
    pub(crate) version_type: String,
    pub(crate) url: String,
    #[serde(rename = "releaseTime")]
    pub(crate) release_time: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct VersionSummary {
    pub id: String,
    pub version_type: String,
    pub url: String,
    pub release_time: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct LoaderMetaGameVersion {
    pub(crate) version: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct VersionIntegrityCheckResult {
    pub is_ok: bool,
    pub checked_files: u32,
    pub missing_files: u32,
    pub corrupted_files: u32,
}

impl From<ManifestVersion> for VersionSummary {
    fn from(v: ManifestVersion) -> Self {
        Self {
            id: v.id,
            version_type: v.version_type,
            url: v.url,
            release_time: v.release_time,
        }
    }
}


#[derive(Debug, Deserialize)]
pub(crate) struct VersionDetail {
    #[serde(default)]
    pub(crate) downloads: Option<VersionDownloads>,
    #[serde(rename = "inheritsFrom", default)]
    pub(crate) inherits_from: Option<String>,
    #[serde(rename = "mainClass")]
    pub(crate) main_class: String,
    #[serde(default)]
    pub(crate) libraries: Vec<Library>,
    #[serde(default)]
    pub(crate) arguments: VersionArguments,
    #[serde(rename = "minecraftArguments", default)]
    pub(crate) minecraft_arguments: Option<String>,
    #[serde(rename = "assetIndex", default)]
    pub(crate) asset_index: Option<AssetIndexRef>,
    #[serde(default)]
    pub(crate) assets: Option<String>,
    #[serde(rename = "javaVersion", default)]
    pub(crate) java_version: Option<JavaVersionInfo>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct JavaVersionInfo {
    pub(crate) component: String,
    #[serde(rename = "majorVersion")]
    pub(crate) major_version: u8,
}

#[derive(Debug, Deserialize)]
pub(crate) struct VersionDownloads {
    pub(crate) client: VersionDownloadInfo,
}

#[derive(Debug, Deserialize)]
pub(crate) struct VersionDownloadInfo {
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) sha1: Option<String>,
    pub(crate) size: u64,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub(crate) struct VersionArguments {
    #[serde(default)]
    pub(crate) jvm: Vec<ArgumentValue>,
    #[serde(default)]
    pub(crate) game: Vec<ArgumentValue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub(crate) enum ArgumentValue {
    String(String),
    WithRules {
        rules: Vec<ArgRule>,
        value: serde_json::Value,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct ArgRule {
    #[serde(default)]
    pub(crate) action: String,
    #[serde(default)]
    pub(crate) os: Option<OsRule>,
    #[serde(default)]
    pub(crate) features: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct OsRule {
    pub(crate) name: Option<String>,
    #[serde(rename = "arch", default)]
    pub(crate) arch: Option<String>,
}

#[derive(Debug, Clone)]
pub struct OsInfo {
    pub name: String,
    pub arch: String,
}

#[derive(Debug, Clone, Default)]
pub struct GameFeatures {
    pub is_demo_user: bool,
    pub has_custom_resolution: bool,
    pub is_quick_play: bool,
}

impl GameFeatures {
    pub fn full() -> Self {
        Self {
            is_demo_user: false,
            has_custom_resolution: false,
            is_quick_play: false,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct AssetIndexRef {
    pub(crate) id: String,
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) sha1: Option<String>,
    #[serde(rename = "totalSize", default)]
    pub(crate) total_size: Option<u64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AssetIndexJson {
    #[serde(default)]
    pub(crate) objects: HashMap<String, AssetObject>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AssetObject {
    pub(crate) hash: String,
    pub(crate) size: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Library {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) downloads: LibraryDownloads,
    #[serde(default)]
    pub(crate) rules: Vec<LibraryRule>,
    #[serde(default)]
    pub(crate) extract: Option<LibraryExtract>,
    #[serde(default)]
    pub(crate) natives: Option<serde_json::Map<String, serde_json::Value>>,
}


pub(crate) fn is_forge_profile(version_id: &str, main_class: &str, libraries: &[Library]) -> bool {
    let version_lower = version_id.to_lowercase();
    let main_class_lower = main_class.to_lowercase();

    if version_lower.contains("forge") {
        return true;
    }
    if main_class_lower.contains("bootstraplauncher") || main_class_lower.contains("cpw.mods.bootstraplauncher") {
        return true;
    }
    if main_class_lower.contains("forge") && !main_class_lower.contains("neoforge") {
        return true;
    }

    for lib in libraries {
        let name_lower = lib.name.to_lowercase();
        if name_lower.contains("forge:forge")
            || name_lower.contains("net.minecraftforge:forge")
            || name_lower.contains("cpw.mods:bootstraplauncher")
            || name_lower.contains("cpw.mods:securejarhandler")
            || (name_lower.starts_with("cpw.mods:") && !name_lower.contains("neoforge"))
        {
            return true;
        }
    }

    false
}

pub(crate) fn parse_forge_id(id: &str) -> Option<(String, String)> {
    let mut parts = id.split("-forge-");
    let mc = parts.next()?.trim();
    let forge = parts.next()?.trim();
    if mc.is_empty() || forge.is_empty() {
        return None;
    }
    Some((mc.to_string(), forge.to_string()))
}

pub(crate) fn parse_neoforge_id(id: &str) -> Option<(String, String)> {
    let mut parts = id.split("-neoforge-");
    let mc = parts.next()?.trim();
    let neoforge = parts.next()?.trim();
    if mc.is_empty() || neoforge.is_empty() {
        return None;
    }
    Some((mc.to_string(), neoforge.to_string()))
}

#[derive(Debug, Clone, Deserialize, Default)]
pub(crate) struct LibraryDownloads {
    #[serde(default)]
    pub(crate) artifact: Option<LibraryArtifact>,
    #[serde(default)]
    pub(crate) classifiers: Option<HashMap<String, LibraryArtifact>>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct LibraryArtifact {
    pub(crate) path: String,
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) sha1: Option<String>,
    #[serde(default)]
    pub(crate) size: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct LibraryRule {
    pub(crate) action: String,
    #[serde(default)]
    pub(crate) os: Option<OsRule>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct LibraryExtract {
    #[serde(default)]
    pub(crate) exclude: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct FabricLoaderInfo {
    pub(crate) version: String,
    #[serde(default)]
    pub(crate) build: u32,
    #[serde(default)]
    pub(crate) stable: bool,
}

#[derive(Debug, Deserialize)]
pub(crate) struct FabricLoaderEntry {
    pub(crate) loader: FabricLoaderInfo,
}

#[derive(Debug, Deserialize)]
pub(crate) struct QuiltLoaderInfo {
    pub(crate) version: String,
    #[serde(default)]
    pub(crate) build: i32,
}

#[derive(Debug, Deserialize)]
pub(crate) struct QuiltLoaderEntry {
    pub(crate) loader: QuiltLoaderInfo,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct FabricProfile {
    pub(crate) id: String,
    #[serde(rename = "inheritsFrom")]
    pub(crate) inherits_from: String,
    #[serde(rename = "mainClass")]
    pub(crate) main_class: String,
    #[serde(default)]
    pub(crate) arguments: VersionArguments,
    #[serde(default)]
    pub(crate) libraries: Vec<FabricProfileLibrary>,
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct FabricProfileLibrary {
    pub(crate) name: String,
    pub(crate) url: Option<String>,
    #[serde(default)]
    pub(crate) size: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct ForgeVersionSummary {
    pub id: String,
    pub mc_version: String,
    pub forge_build: String,
    pub installer_url: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct NeoForgeVersionSummary {
    pub id: String,
    pub mc_version: String,
    pub neoforge_build: String,
    pub installer_url: String,
}
#[derive(Debug, Deserialize)]
pub(crate) struct ForgePromotionsSlim {
    pub(crate) promos: HashMap<String, String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LoaderVersionChannel {
    Stable,
    Beta,
    Alpha,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoaderVersionOption {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<LoaderVersionChannel>,
}
