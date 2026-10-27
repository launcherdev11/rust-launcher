use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct JavaSettings {
    pub use_custom_jvm_args: bool,
    pub java_path: Option<String>,
    pub xms: Option<String>,
    pub xmx: Option<String>,
    pub jvm_args: Option<String>,
    pub preset: Option<String>,
    #[serde(default)]
    pub prefer_ipv6_network: bool,
}

impl Default for JavaSettings {
    fn default() -> Self {
        Self {
            use_custom_jvm_args: false,
            java_path: None,
            xms: None,
            xmx: None,
            jvm_args: None,
            preset: Some("balanced".to_string()),
            prefer_ipv6_network: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct JavaRuntimeInfo {
    pub path: String,
    pub version: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct JavaArgsValidationResult {
    pub ok: bool,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub output: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct JavaIntegrityCheckResult {
    pub is_ok: bool,
    pub checked_files: u32,
    pub missing_files: u32,
    pub corrupted_files: u32,
    pub runtimes_checked: u32,
}

