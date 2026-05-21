use std::collections::HashSet;
use std::path::Path;
use std::path::PathBuf;

use crate::models::JavaRuntimeInfo;

fn detect_java_version(path: &str, source: &str) -> Option<JavaRuntimeInfo> {
    let mut cmd = std::process::Command::new(path);
    cmd.arg("-version");
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let output = cmd.output().ok()?;
    let text = if !output.stderr.is_empty() {
        String::from_utf8_lossy(&output.stderr).into_owned()
    } else {
        String::from_utf8_lossy(&output.stdout).into_owned()
    };
    let version_line = text.lines().next().unwrap_or("").trim();
    if version_line.is_empty() {
        return None;
    }
    Some(JavaRuntimeInfo {
        path: path.to_string(),
        version: version_line.to_string(),
        source: source.to_string(),
    })
}

fn parse_java_major_version(version_line: &str) -> Option<u8> {
    let start_quote = version_line.find('"')?;
    let after = &version_line[start_quote + 1..];
    let end_quote_rel = after.find('"')?;
    let version = &after[..end_quote_rel];

    let mut parts = version.split('.');
    let first = parts.next()?;
    if first == "1" {
        let second = parts.next()?;
        second.parse::<u8>().ok()
    } else {
        first.parse::<u8>().ok()
    }
}

pub(crate) fn detect_java_major_version(java_path: &Path) -> Option<u8> {
    let java_path_str = java_path.to_string_lossy();
    let info = detect_java_version(java_path_str.as_ref(), "LAUNCH_JAVA_RUNTIME")?;
    parse_java_major_version(&info.version)
}

pub async fn detect_java_runtimes() -> Result<Vec<JavaRuntimeInfo>, String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut result = Vec::new();

    if let Ok(home) = std::env::var("JAVA_HOME") {
        let base = PathBuf::from(&home);
        let cand_javaw = base.join("bin").join(if cfg!(target_os = "windows") {
            "javaw.exe"
        } else {
            "java"
        });
        if cand_javaw.exists() {
            if let Some(info) = detect_java_version(cand_javaw.to_string_lossy().as_ref(), "JAVA_HOME") {
                if seen.insert(info.path.clone()) {
                    result.push(info);
                }
            }
        }
    }

    if let Some(info) = detect_java_version("java", "PATH") {
        if seen.insert(info.path.clone()) {
            result.push(info);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(info) = detect_java_version("javaw", "PATH") {
            if seen.insert(info.path.clone()) {
                result.push(info);
            }
        }
    }

    Ok(result)
}

