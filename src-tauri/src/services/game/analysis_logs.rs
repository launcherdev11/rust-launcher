use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

use crate::app::paths::instance_dir;

const MAX_FILE_CHARS: usize = 512_000;
const MAX_JVM_CRASH_HEAD_BYTES: usize = 64 * 1024;
const MAX_CRASH_REPORTS: usize = 3;
const SESSION_SLACK_SECS: u64 = 120;
const FALLBACK_SESSION_SECS: u64 = 10 * 60;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisLogSource {
    pub kind: String,
    pub name: String,
    pub path: String,
    pub content: String,
    pub truncated: bool,
    pub modified_at: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstanceAnalysisLogs {
    pub sources: Vec<AnalysisLogSource>,
    pub skipped_stale: usize,
}

fn modified_secs(path: &Path) -> u64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn read_text_tail(path: &Path, max_chars: usize) -> Result<(String, bool), String> {
    let raw = fs::read(path).map_err(|e| format!("Не удалось прочитать {}: {e}", path.display()))?;
    let full = String::from_utf8_lossy(&raw);
    if full.len() <= max_chars {
        return Ok((full.into_owned(), false));
    }
    let mut start = full.len().saturating_sub(max_chars);
    while start > 0 && !full.is_char_boundary(start) {
        start -= 1;
    }
    let tail = &full[start..];
    let trimmed = match tail.find('\n') {
        Some(i) if i + 1 < tail.len() => &tail[i + 1..],
        _ => tail,
    };
    Ok((trimmed.to_string(), true))
}

fn read_text_head(path: &Path, max_bytes: usize) -> Result<(String, bool), String> {
    let file = fs::File::open(path).map_err(|e| format!("Не удалось прочитать {}: {e}", path.display()))?;
    let mut raw = Vec::with_capacity(max_bytes.min(64 * 1024));
    file.take(max_bytes as u64 + 1)
        .read_to_end(&mut raw)
        .map_err(|e| format!("Не удалось прочитать {}: {e}", path.display()))?;
    let truncated = raw.len() > max_bytes;
    raw.truncate(max_bytes);
    let text = String::from_utf8_lossy(&raw).into_owned();
    if !truncated {
        return Ok((text, false));
    }
    let cut = text.rfind('\n').unwrap_or(text.len());
    Ok((text[..cut].to_string(), true))
}

fn push_source(out: &mut Vec<AnalysisLogSource>, kind: &str, path: &Path, read: (String, bool)) {
    let (content, truncated) = read;
    if content.trim().is_empty() {
        return;
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("log")
        .to_string();
    out.push(AnalysisLogSource {
        kind: kind.to_string(),
        name,
        path: path.to_string_lossy().to_string(),
        content,
        truncated,
        modified_at: modified_secs(path),
    });
}

fn push_file_source(out: &mut Vec<AnalysisLogSource>, kind: &str, path: &Path, max_chars: usize) {
    if !path.is_file() {
        return;
    }
    if let Ok(read) = read_text_tail(path, max_chars) {
        push_source(out, kind, path, read);
    }
}

fn line_time_of_day(line: &str) -> Option<u64> {
    let head = line.trim_start();
    if !head.starts_with('[') {
        return None;
    }
    let end = head.find(']')?.min(40);
    let bytes = &head.as_bytes()[..end];
    bytes.windows(8).find_map(|w| {
        let is_digit = |i: usize| w[i].is_ascii_digit();
        if !(is_digit(0) && is_digit(1) && w[2] == b':' && is_digit(3) && is_digit(4) && w[5] == b':' && is_digit(6) && is_digit(7)) {
            return None;
        }
        let num = |i: usize| u64::from(w[i] - b'0') * 10 + u64::from(w[i + 1] - b'0');
        let (h, m, s) = (num(0), num(3), num(6));
        (h < 24 && m < 60 && s < 61).then_some(h * 3600 + m * 60 + s)
    })
}

fn latest_log_session_start(path: &Path, tail: &str) -> Option<u64> {
    let mtime = modified_secs(path);
    if mtime == 0 {
        return None;
    }
    let (head, _) = read_text_head(path, 16 * 1024).ok()?;
    let first = head.lines().find_map(line_time_of_day);
    let last = tail.lines().rev().find_map(line_time_of_day);
    let duration = match (first, last) {
        (Some(a), Some(b)) => (b + 86_400 - a) % 86_400,
        _ => FALLBACK_SESSION_SECS,
    };
    Some(mtime.saturating_sub(duration))
}

fn collect_crash_reports(crash_dir: &Path) -> Vec<(u64, PathBuf)> {
    let Ok(entries) = fs::read_dir(crash_dir) else {
        return Vec::new();
    };
    let mut files: Vec<(u64, PathBuf)> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            if !p.is_file() {
                return false;
            }
            let name = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_lowercase();
            name.ends_with(".txt")
                || name.ends_with(".log")
                || name.contains("crash")
        })
        .map(|p| (modified_secs(&p), p))
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files
}

fn collect_jvm_crash_logs(root: &Path) -> Vec<(u64, PathBuf)> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };
    let mut files: Vec<(u64, PathBuf)> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("hs_err_pid") && n.ends_with(".log"))
        })
        .map(|p| (modified_secs(&p), p))
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files
}

#[tauri::command]
pub fn read_instance_analysis_logs(profile_id: String) -> Result<InstanceAnalysisLogs, String> {
    let id = profile_id.trim();
    if id.is_empty() || id.starts_with("__") {
        return Ok(InstanceAnalysisLogs {
            sources: Vec::new(),
            skipped_stale: 0,
        });
    }

    let root = instance_dir(id)?;
    let mut sources: Vec<AnalysisLogSource> = Vec::new();

    let latest_path = root.join("logs").join("latest.log");
    push_file_source(&mut sources, "latest", &latest_path, MAX_FILE_CHARS);
    let session_start = sources
        .first()
        .and_then(|latest| latest_log_session_start(&latest_path, &latest.content))
        .map(|start| start.saturating_sub(SESSION_SLACK_SECS));
    let is_current = |mtime: u64| session_start.map_or(true, |start| mtime >= start);

    let mut crash_files: Vec<(u64, PathBuf)> = Vec::new();
    for flat in [root.join("logs").join("crash-report.log"), root.join("crash-report.log")] {
        if flat.is_file() {
            crash_files.push((modified_secs(&flat), flat));
        }
    }
    crash_files.extend(collect_crash_reports(&root.join("crash-reports")));
    crash_files.sort_by(|a, b| b.0.cmp(&a.0));

    let mut skipped_stale = 0usize;
    let mut taken = 0usize;
    for (mtime, path) in crash_files {
        let keep = if session_start.is_some() { is_current(mtime) } else { taken == 0 };
        if !keep || taken >= MAX_CRASH_REPORTS {
            skipped_stale += usize::from(!keep);
            continue;
        }
        push_file_source(&mut sources, "crash_report", &path, MAX_FILE_CHARS);
        taken += 1;
    }

    if let Some((mtime, path)) = collect_jvm_crash_logs(&root).into_iter().next() {
        if session_start.is_some() && is_current(mtime) {
            if let Ok(read) = read_text_head(&path, MAX_JVM_CRASH_HEAD_BYTES) {
                push_source(&mut sources, "jvm_crash", &path, read);
            }
        }
    }

    sources.sort_by(|a, b| {
        let rank = |k: &str| match k {
            "jvm_crash" => 0,
            "crash_report" => 1,
            "latest" => 2,
            _ => 3,
        };
        rank(&a.kind)
            .cmp(&rank(&b.kind))
            .then(b.modified_at.cmp(&a.modified_at))
    });

    Ok(InstanceAnalysisLogs {
        sources,
        skipped_stale,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn read_text_tail_truncates_on_char_boundary() {
        let dir = std::env::temp_dir().join(format!(
            "mc16_analysis_logs_test_{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sample.log");
        let mut f = fs::File::create(&path).unwrap();
        writeln!(f, "line-one").unwrap();
        writeln!(f, "line-two-привіт").unwrap();
        writeln!(f, "line-three").unwrap();
        drop(f);

        let (content, truncated) = read_text_tail(&path, 20).unwrap();
        assert!(truncated);
        assert!(!content.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn line_time_of_day_parses_vanilla_and_forge_prefixes() {
        assert_eq!(
            line_time_of_day("[12:34:56] [Render thread/INFO]: hi"),
            Some(12 * 3600 + 34 * 60 + 56)
        );
        assert_eq!(
            line_time_of_day("[26Oct2026 01:02:03.456] [main/INFO] [cpw.mods/]: x"),
            Some(3600 + 2 * 60 + 3)
        );
        assert_eq!(line_time_of_day("\tat net.minecraft.Foo.bar(Foo.java:1)"), None);
        assert_eq!(line_time_of_day("[main/INFO]: no time"), None);
    }
}
