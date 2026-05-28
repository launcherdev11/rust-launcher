use std::sync::atomic::{AtomicBool, AtomicU64};

pub(crate) static CANCEL_DOWNLOAD: AtomicBool = AtomicBool::new(false);
pub(crate) static GAME_PROCESS_PID: AtomicU64 = AtomicU64::new(0);

pub const VERSION_MANIFEST_URL: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
pub const DEFAULT_DOWNLOAD_CONCURRENCY: usize = 12;
pub const DEFAULT_DOWNLOAD_RETRIES: usize = 6;
pub const FORGE_PROMOTIONS_URL: &str =
    "https://files.minecraftforge.net/maven/net/minecraftforge/forge/promotions_slim.json";
pub const FORGE_MAVEN_OFFICIAL_BASE: &str =
    "https://maven.minecraftforge.net/net/minecraftforge/forge";
pub const FORGE_MAVEN_MIRROR_BASE: &str = "https://forgemvn.lumintomc.ru/net/minecraftforge/forge";
pub const FORGE_MAVEN_BASE: &str = FORGE_MAVEN_MIRROR_BASE;
pub const FORGE_MAVEN_OFFICIAL_METADATA_URL: &str =
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
pub const FORGE_MAVEN_METADATA_URL: &str =
    "https://forgemvn.lumintomc.ru/net/minecraftforge/forge/maven-metadata.xml";
pub const NEOFORGE_MAVEN_METADATA_URL: &str =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
pub const NEOFORGE_MAVEN_BASE: &str = "https://maven.neoforged.net/releases/net/neoforged/neoforge";
pub const FORGE_INSTALLER_MIN_BYTES: u64 = 1_000_000;
pub const BMCL_MAVEN_BASE: &str = "https://bmclapi2.bangbang93.com/maven";
pub const FABRIC_META_GAME: &str = "https://meta.fabricmc.net/v2/versions/game";
pub const FABRIC_META_LOADERS: &str = "https://meta.fabricmc.net/v2/versions/loader";
pub const FABRIC_META_PROFILE: &str = "https://meta.fabricmc.net/v2/versions/loader";
pub const QUILT_META_GAME: &str = "https://meta.quiltmc.org/v3/versions/game";
