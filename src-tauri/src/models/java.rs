use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct JavaSettings {
    pub use_custom_jvm_args: bool,
    //явный путь к java/javaw. по дефолту офиц runtime Mojang
    pub java_path: Option<String>,
    //мин. объем памяти xms (1G\\1024M)
    pub xms: Option<String>,
    //макс объем памяти xmx (4G\\4096M)
    pub xmx: Option<String>,
    //доп JVM аргументы
    pub jvm_args: Option<String>,
    //имя пресета ("balanced", "performance", "low_memory")
    pub preset: Option<String>,
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
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct JavaRuntimeInfo {
    //полный путь к java/javaw
    pub path: String,
    //строка с версией из java -version
    pub version: String,
    //краткое описание источника (PATH, JAVA_HOME, system, runtime и тд)
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct JavaArgsValidationResult {
    pub ok: bool,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
    pub output: String,
}

