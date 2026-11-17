use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::services::modrinth::jar_compat::read_jar_mod_info;

use super::paths::SyncFileKind;

const EXECUTABLE_EXTENSIONS: &[&str] = &[
    "exe", "bat", "cmd", "com", "scr", "msi", "ps1", "psm1", "vbs", "vbe", "jse", "wsf", "hta", "lnk",
    "cpl",
];

const NATIVE_EXTENSIONS: &[&str] = &["dll", "so", "dylib", "jnilib"];
const CODE_IN_PACK_EXTENSIONS: &[&str] = &["jar", "class", "dll", "so", "dylib", "jnilib"];
const MAX_ARCHIVE_ENTRIES: usize = 100_000;
const MAX_UNPACKED_BYTES: u64 = 8 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileIssue {
    InvalidArchive,
    Executable,
    NativeCode,
    NoModMetadata,
}

impl FileIssue {
    fn blocks_install(self) -> bool {
        matches!(self, FileIssue::InvalidArchive | FileIssue::Executable)
    }
}

pub(super) struct Archive {
    pub rel: String,
    pub path: PathBuf,
    pub kind: SyncFileKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectedFile {
    pub path: String,
    pub title: Option<String>,
    pub issues: Vec<FileIssue>,
    pub blocked: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectReport {
    pub files: Vec<InspectedFile>,
}

fn archive_issues(path: &Path, kind: SyncFileKind) -> Vec<FileIssue> {
    let Ok(file) = std::fs::File::open(path) else {
        return vec![FileIssue::InvalidArchive];
    };
    let Ok(mut archive) = zip::ZipArchive::new(file) else {
        return vec![FileIssue::InvalidArchive];
    };
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return vec![FileIssue::InvalidArchive];
    }
    let mut issues = Vec::new();
    let mut unpacked = 0u64;
    for i in 0..archive.len() {
        let Ok(entry) = archive.by_index_raw(i) else {
            return vec![FileIssue::InvalidArchive];
        };
        unpacked = unpacked.saturating_add(entry.size());
        if unpacked > MAX_UNPACKED_BYTES {
            return vec![FileIssue::InvalidArchive];
        }
        let ext = entry
            .name()
            .rsplit_once('.')
            .map(|(_, ext)| ext.to_ascii_lowercase())
            .unwrap_or_default();
        let issue = if EXECUTABLE_EXTENSIONS.contains(&ext.as_str())
            || (kind == SyncFileKind::Pack && CODE_IN_PACK_EXTENSIONS.contains(&ext.as_str()))
        {
            Some(FileIssue::Executable)
        } else if NATIVE_EXTENSIONS.contains(&ext.as_str()) {
            Some(FileIssue::NativeCode)
        } else {
            None
        };
        if let Some(issue) = issue.filter(|i| !issues.contains(i)) {
            issues.push(issue);
        }
    }
    issues
}

pub(super) fn inspect_archives(archives: &[Archive]) -> InspectReport {
    let files = archives
        .iter()
        .map(|Archive { rel, path, kind }| {
            let mut issues = archive_issues(path, *kind);
            let mut title = None;
            if *kind == SyncFileKind::Mod && !issues.contains(&FileIssue::InvalidArchive) {
                let file_name = rel.rsplit('/').next().unwrap_or(rel);
                let info = read_jar_mod_info(path, file_name, true, None);
                if info.mod_id.is_none() {
                    issues.push(FileIssue::NoModMetadata);
                }
                title = info.title;
            }
            InspectedFile {
                path: rel.clone(),
                title,
                blocked: issues.iter().any(|i| i.blocks_install()),
                issues,
            }
        })
        .collect();
    InspectReport { files }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn jar_with(entries: &[&str]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("room-sync-scan-{}", rand_suffix()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.jar");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        for name in entries {
            writer
                .start_file(*name, zip::write::SimpleFileOptions::default())
                .unwrap();
            writer.write_all(b"x").unwrap();
        }
        writer.finish().unwrap();
        path
    }

    fn mod_archive(path: &std::path::Path) -> Archive {
        Archive {
            rel: "mods/test.jar".to_string(),
            path: path.to_path_buf(),
            kind: SyncFileKind::Mod,
        }
    }

    #[test]
    fn native_code_inside_pack_blocks_install() {
        let path = jar_with(&["pack.mcmeta", "natives/evil.dll"]);
        let report = inspect_archives(&[Archive {
            rel: "resourcepacks/test.zip".to_string(),
            path: path.clone(),
            kind: SyncFileKind::Pack,
        }]);
        assert!(report.files[0].blocked);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn packs_are_not_required_to_be_mods() {
        let path = jar_with(&["pack.mcmeta", "assets/minecraft/textures/a.png"]);
        let report = inspect_archives(&[Archive {
            rel: "resourcepacks/test.zip".to_string(),
            path: path.clone(),
            kind: SyncFileKind::Pack,
        }]);
        assert!(report.files[0].issues.is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    fn rand_suffix() -> String {
        use rand::{distributions::Alphanumeric, Rng};
        rand::thread_rng().sample_iter(&Alphanumeric).take(8).map(char::from).collect()
    }

    #[test]
    fn executable_inside_jar_blocks_install() {
        let path = jar_with(&["a/Main.class", "payload/run.exe"]);
        let report = inspect_archives(&[mod_archive(&path)]);
        assert!(report.files[0].blocked);
        assert!(report.files[0].issues.contains(&FileIssue::Executable));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn natives_only_warn() {
        let path = jar_with(&["natives/opus.dll"]);
        let report = inspect_archives(&[mod_archive(&path)]);
        assert!(!report.files[0].blocked);
        assert!(report.files[0].issues.contains(&FileIssue::NativeCode));
        assert!(report.files[0].issues.contains(&FileIssue::NoModMetadata));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn non_zip_is_blocked() {
        let dir = std::env::temp_dir().join(format!("room-sync-scan-{}", rand_suffix()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fake.jar");
        std::fs::write(&path, b"MZ not a zip").unwrap();
        let report = inspect_archives(&[mod_archive(&path)]);
        assert_eq!(report.files[0].issues, vec![FileIssue::InvalidArchive]);
        assert!(report.files[0].blocked);
        let _ = std::fs::remove_dir_all(dir);
    }
}
