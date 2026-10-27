use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::command;

use crate::app::paths::launcher_data_dir;
use crate::infra::fs_atomic::write_atomic;

const RUNS_DIR: &str = "runs";
const NO_PROFILE_KEY: &str = "_default";
const KEEP_RUNS_PER_PROFILE: usize = 40;
const MAX_LOG_BYTES: u64 = 16 * 1024 * 1024;
const STDERR_MARK: &str = "\u{1}";
const MAX_SEARCH_HITS: usize = 300;
const REPORT_TAIL_LINES: usize = 400;

pub(crate) static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub id: String,
    pub profile_id: Option<String>,
    pub version_id: String,
    pub java_path: Option<String>,
    pub ram_mb: Option<u32>,
    pub started_at_ms: u64,
    #[serde(default)]
    pub ended_at_ms: Option<u64>,
    #[serde(default)]
    pub exit_code: Option<i32>,
    pub outcome: String,
    #[serde(default)]
    pub line_count: u64,
    #[serde(default)]
    pub error_lines: u64,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLogLine {
    pub line: String,
    pub stderr: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSearchHit {
    pub run_id: String,
    pub line_no: u64,
    pub line: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn profile_runs_dir(profile_id: Option<&str>) -> Result<PathBuf, String> {
    let key = profile_id.filter(|s| !s.trim().is_empty()).unwrap_or(NO_PROFILE_KEY);
    if !valid_key(key) {
        return Err("Некорректный id сборки".to_string());
    }
    Ok(launcher_data_dir()?.join(RUNS_DIR).join(key))
}

fn run_paths(dir: &Path, run_id: &str) -> Result<(PathBuf, PathBuf), String> {
    if !valid_key(run_id) {
        return Err("Некорректный id запуска".to_string());
    }
    Ok((dir.join(format!("{run_id}.json")), dir.join(format!("{run_id}.log"))))
}

fn read_record(path: &Path) -> Option<RunRecord> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_record(path: &Path, record: &RunRecord) {
    match serde_json::to_vec_pretty(record) {
        Ok(bytes) => {
            if let Err(e) = write_atomic(path, bytes) {
                eprintln!("[Runs] Не удалось сохранить карточку запуска: {e}");
            }
        }
        Err(e) => eprintln!("[Runs] Не удалось сериализовать карточку запуска: {e}"),
    }
}

fn outcome_for(exit_code: Option<i32>, stopped_by_user: bool) -> &'static str {
    if stopped_by_user {
        return "stopped";
    }
    match exit_code {
        Some(0) => "ok",
        _ => "crashed",
    }
}

struct LogSink {
    writer: Option<BufWriter<File>>,
    written: u64,
    lines: u64,
    error_lines: u64,
    truncated: bool,
}

#[derive(Clone)]
pub(crate) struct RunRecorder {
    record_path: PathBuf,
    record: Arc<Mutex<RunRecord>>,
    sink: Arc<Mutex<LogSink>>,
}

impl RunRecorder {
    pub(crate) fn start(
        profile_id: Option<String>,
        version_id: &str,
        java_path: Option<String>,
        ram_mb: Option<u32>,
    ) -> Option<Self> {
        let dir = profile_runs_dir(profile_id.as_deref()).ok()?;
        if let Err(e) = fs::create_dir_all(&dir) {
            eprintln!("[Runs] Не удалось создать папку журнала: {e}");
            return None;
        }
        let started_at_ms = now_ms();
        let id = format!("{started_at_ms}");
        let (record_path, log_path) = run_paths(&dir, &id).ok()?;
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&log_path)
            .map_err(|e| eprintln!("[Runs] Не удалось открыть лог запуска: {e}"))
            .ok()?;

        STOP_REQUESTED.store(false, Ordering::SeqCst);
        let record = RunRecord {
            id,
            profile_id,
            version_id: version_id.to_string(),
            java_path,
            ram_mb,
            started_at_ms,
            ended_at_ms: None,
            exit_code: None,
            outcome: "running".to_string(),
            line_count: 0,
            error_lines: 0,
            truncated: false,
        };
        write_record(&record_path, &record);
        prune_old_runs(&dir);

        Some(Self {
            record_path,
            record: Arc::new(Mutex::new(record)),
            sink: Arc::new(Mutex::new(LogSink {
                writer: Some(BufWriter::new(file)),
                written: 0,
                lines: 0,
                error_lines: 0,
                truncated: false,
            })),
        })
    }

    pub(crate) fn push(&self, line: &str, stderr: bool) {
        let Ok(mut sink) = self.sink.lock() else { return };
        sink.lines += 1;
        if stderr || looks_like_error(line) {
            sink.error_lines += 1;
        }
        if sink.truncated {
            return;
        }
        let bytes = line.len() as u64 + 2;
        if sink.written + bytes > MAX_LOG_BYTES {
            sink.truncated = true;
            return;
        }
        sink.written += bytes;
        if let Some(w) = sink.writer.as_mut() {
            let res = if stderr {
                writeln!(w, "{STDERR_MARK}{line}")
            } else {
                writeln!(w, "{line}")
            };
            if res.is_err() {
                sink.writer = None;
            }
        }
    }

    pub(crate) fn finish(&self, exit_code: Option<i32>) {
        let (lines, error_lines, truncated) = match self.sink.lock() {
            Ok(mut sink) => {
                if let Some(mut w) = sink.writer.take() {
                    let _ = w.flush();
                }
                (sink.lines, sink.error_lines, sink.truncated)
            }
            Err(_) => (0, 0, false),
        };
        let stopped = STOP_REQUESTED.swap(false, Ordering::SeqCst);
        let Ok(mut record) = self.record.lock() else { return };
        record.ended_at_ms = Some(now_ms());
        record.exit_code = exit_code;
        record.outcome = outcome_for(exit_code, stopped).to_string();
        record.line_count = lines;
        record.error_lines = error_lines;
        record.truncated = truncated;
        write_record(&self.record_path, &record);
    }
}

fn looks_like_error(line: &str) -> bool {
    line.contains("/ERROR]")
        || line.contains("/FATAL]")
        || line.contains("Exception in thread")
        || line.trim_start().starts_with("Caused by:")
}

fn prune_old_runs(dir: &Path) {
    let mut ids: Vec<String> = match fs::read_dir(dir) {
        Ok(rd) => rd
            .flatten()
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                name.strip_suffix(".json").map(str::to_string)
            })
            .collect(),
        Err(_) => return,
    };
    if ids.len() <= KEEP_RUNS_PER_PROFILE {
        return;
    }
    ids.sort_by_key(|id| std::cmp::Reverse(id.parse::<u64>().unwrap_or(0)));
    for id in ids.into_iter().skip(KEEP_RUNS_PER_PROFILE) {
        let _ = fs::remove_file(dir.join(format!("{id}.json")));
        let _ = fs::remove_file(dir.join(format!("{id}.log")));
    }
}

fn list_records(dir: &Path) -> Vec<RunRecord> {
    let Ok(rd) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let game_running = crate::services::game::state::GAME_PROCESS_PID.load(Ordering::SeqCst) != 0;
    let mut out: Vec<RunRecord> = rd
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| read_record(&e.path()))
        .collect();
    out.sort_by(|a, b| b.started_at_ms.cmp(&a.started_at_ms));
    for (idx, r) in out.iter_mut().enumerate() {
        if r.outcome == "running" && !(idx == 0 && game_running) {
            r.outcome = "interrupted".to_string();
        }
    }
    out
}

fn decode_line(raw: String) -> RunLogLine {
    match raw.strip_prefix(STDERR_MARK) {
        Some(rest) => RunLogLine { line: rest.to_string(), stderr: true },
        None => RunLogLine { line: raw, stderr: false },
    }
}

fn read_log_lines(path: &Path) -> Result<Vec<RunLogLine>, String> {
    let file = File::open(path).map_err(|e| format!("Лог запуска недоступен: {e}"))?;
    let mut out = Vec::new();
    for line in BufReader::new(file).lines() {
        match line {
            Ok(l) => out.push(decode_line(l)),
            Err(_) => continue,
        }
    }
    Ok(out)
}

#[command]
pub async fn list_game_runs(profile_id: Option<String>) -> Result<Vec<RunRecord>, String> {
    let dir = profile_runs_dir(profile_id.as_deref())?;
    tokio::task::spawn_blocking(move || list_records(&dir))
        .await
        .map_err(|e| format!("Ошибка чтения журнала запусков: {e}"))
}

#[command]
pub async fn read_game_run_log(
    profile_id: Option<String>,
    run_id: String,
) -> Result<Vec<RunLogLine>, String> {
    let dir = profile_runs_dir(profile_id.as_deref())?;
    let (_, log_path) = run_paths(&dir, &run_id)?;
    tokio::task::spawn_blocking(move || read_log_lines(&log_path))
        .await
        .map_err(|e| format!("Ошибка чтения лога: {e}"))?
}

#[command]
pub async fn delete_game_run(profile_id: Option<String>, run_id: String) -> Result<(), String> {
    let dir = profile_runs_dir(profile_id.as_deref())?;
    let (record_path, log_path) = run_paths(&dir, &run_id)?;
    if read_record(&record_path).is_some_and(|r| r.outcome == "running")
        && crate::services::game::state::GAME_PROCESS_PID.load(Ordering::SeqCst) != 0
    {
        return Err("Этот запуск ещё идёт".to_string());
    }
    let _ = fs::remove_file(&log_path);
    fs::remove_file(&record_path).map_err(|e| format!("Не удалось удалить запуск: {e}"))
}

#[command]
pub async fn search_game_runs(
    profile_id: Option<String>,
    query: String,
) -> Result<Vec<RunSearchHit>, String> {
    let needle = query.trim().to_lowercase();
    if needle.len() < 2 {
        return Ok(Vec::new());
    }
    let dir = profile_runs_dir(profile_id.as_deref())?;
    tokio::task::spawn_blocking(move || {
        let mut hits = Vec::new();
        for record in list_records(&dir) {
            let Ok((_, log_path)) = run_paths(&dir, &record.id) else { continue };
            let Ok(file) = File::open(&log_path) else { continue };
            for (idx, line) in BufReader::new(file).lines().enumerate() {
                let Ok(line) = line else { continue };
                if line.to_lowercase().contains(&needle) {
                    hits.push(RunSearchHit {
                        run_id: record.id.clone(),
                        line_no: idx as u64 + 1,
                        line: decode_line(line).line.chars().take(400).collect(),
                    });
                    if hits.len() >= MAX_SEARCH_HITS {
                        return hits;
                    }
                }
            }
        }
        hits
    })
    .await
    .map_err(|e| format!("Ошибка поиска по журналу: {e}"))
}

fn redact(text: &str, home: Option<&str>) -> String {
    let mut out = text.to_string();
    if let Some(home) = home.filter(|h| h.len() > 3) {
        out = out.replace(home, "~");
        let alt = if home.contains('\\') { home.replace('\\', "/") } else { home.replace('/', "\\") };
        out = out.replace(&alt, "~");
    }
    mask_ipv4(&mask_secrets(&out))
}

const SECRET_KEYS: &[&str] = &["accesstoken", "access_token", "sessionid", "session_id", "--uuid", "--xuid", "--clientid", "token"];

fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':')
}

fn mask_secrets(text: &str) -> String {
    let lower = text.to_ascii_lowercase();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    let bytes = text.as_bytes();
    while i < text.len() {
        let key = SECRET_KEYS.iter().find(|k| lower[i..].starts_with(**k));
        let Some(key) = key else {
            let ch = text[i..].chars().next().unwrap_or(' ');
            out.push(ch);
            i += ch.len_utf8();
            continue;
        };
        let key_end = i + key.len();
        let mut j = key_end;
        while j < text.len() && matches!(bytes[j], b'=' | b':' | b' ' | b'\t' | b'"') {
            j += 1;
        }
        let value_len = text[j..].chars().take_while(|c| is_token_char(*c)).map(char::len_utf8).sum::<usize>();
        out.push_str(&text[i..j]);
        if j > key_end && value_len >= 12 {
            out.push_str("***");
            i = j + value_len;
        } else {
            i = j;
        }
    }
    out
}

fn mask_ipv4(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        let boundary = i == 0 || !(chars[i - 1].is_ascii_alphanumeric() || chars[i - 1] == '.');
        if boundary && chars[i].is_ascii_digit() {
            let mut j = i;
            let mut octets = 0;
            let mut ok = true;
            loop {
                let start = j;
                while j < chars.len() && chars[j].is_ascii_digit() && j - start < 4 {
                    j += 1;
                }
                let digits: String = chars[start..j].iter().collect();
                if digits.is_empty() || digits.len() > 3 || digits.parse::<u16>().map_or(true, |n| n > 255) {
                    ok = false;
                    break;
                }
                octets += 1;
                if octets == 4 || j >= chars.len() || chars[j] != '.' {
                    break;
                }
                j += 1;
            }
            let tail_ok = j >= chars.len() || !(chars[j].is_ascii_alphanumeric() || chars[j] == '.');
            if ok && octets == 4 && tail_ok {
                let ip: String = chars[i..j].iter().collect();
                if ip.starts_with("127.") || ip.starts_with("0.") {
                    out.push_str(&ip);
                } else {
                    out.push_str("x.x.x.x");
                }
                i = j;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn format_duration(ms: u64) -> String {
    let secs = ms / 1000;
    format!("{}:{:02}:{:02}", secs / 3600, (secs / 60) % 60, secs % 60)
}

fn mod_list(profile_id: Option<&str>) -> Vec<String> {
    let Some(id) = profile_id else { return Vec::new() };
    let Ok(dir) = crate::app::paths::instance_dir(id) else { return Vec::new() };
    let Ok(rd) = fs::read_dir(dir.join("mods")) else { return Vec::new() };
    let mut names: Vec<String> = rd
        .flatten()
        .filter(|e| e.path().is_file())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| {
            let l = n.to_ascii_lowercase();
            l.ends_with(".jar") || l.ends_with(".jar.disabled")
        })
        .collect();
    names.sort_by_key(|n| n.to_ascii_lowercase());
    names
}

#[command]
pub async fn build_game_run_report(
    app: tauri::AppHandle,
    profile_id: Option<String>,
    run_id: String,
) -> Result<String, String> {
    let dir = profile_runs_dir(profile_id.as_deref())?;
    let (record_path, log_path) = run_paths(&dir, &run_id)?;
    let record = read_record(&record_path).ok_or("Запуск не найден")?;
    let launcher_version = app.package_info().version.to_string();

    tokio::task::spawn_blocking(move || {
        let lines = read_log_lines(&log_path).unwrap_or_default();
        let home = dirs_home();
        let mut report = String::new();
        let mut push = |s: String| {
            report.push_str(&s);
            report.push('\n');
        };
        push("### Отчёт о запуске / Launch report".to_string());
        push(format!("Launcher: 16Launcher {launcher_version}"));
        push(format!(
            "OS: {} {} ({})",
            sysinfo::System::name().unwrap_or_default(),
            sysinfo::System::os_version().unwrap_or_default(),
            std::env::consts::ARCH
        ));
        let total_gb = {
            let mut sys = sysinfo::System::new();
            sys.refresh_memory();
            sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0
        };
        push(format!("RAM: {total_gb:.1} GB"));
        push(format!("Version: {}", record.version_id));
        if let Some(ram) = record.ram_mb {
            push(format!("Game memory: {ram} MB"));
        }
        if let Some(java) = record.java_path.as_deref() {
            push(format!("Java: {}", redact(java, home.as_deref())));
        }
        let duration = record
            .ended_at_ms
            .map(|end| format_duration(end.saturating_sub(record.started_at_ms)))
            .unwrap_or_else(|| "—".to_string());
        push(format!(
            "Outcome: {} · exit code {} · duration {}",
            record.outcome,
            record.exit_code.map(|c| c.to_string()).unwrap_or_else(|| "—".to_string()),
            duration
        ));
        let mods = mod_list(record.profile_id.as_deref());
        if !mods.is_empty() {
            push(format!("Mods ({}):", mods.len()));
            for m in mods {
                push(format!("  {m}"));
            }
        }
        push(String::new());
        let skip = lines.len().saturating_sub(REPORT_TAIL_LINES);
        push(format!(
            "Log (last {} of {} lines):",
            lines.len() - skip,
            lines.len()
        ));
        push("```".to_string());
        for l in lines.into_iter().skip(skip) {
            push(redact(&l.line, home.as_deref()));
        }
        push("```".to_string());
        report
    })
    .await
    .map_err(|e| format!("Не удалось собрать отчёт: {e}"))
}

fn dirs_home() -> Option<String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .filter(|s| !s.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcome_mapping() {
        assert_eq!(outcome_for(Some(0), false), "ok");
        assert_eq!(outcome_for(Some(1), false), "crashed");
        assert_eq!(outcome_for(None, false), "crashed");
        assert_eq!(outcome_for(Some(1), true), "stopped");
    }

    #[test]
    fn keys_are_restricted() {
        assert!(valid_key("1729950000000"));
        assert!(valid_key("abc-DEF_1"));
        assert!(!valid_key("../x"));
        assert!(!valid_key("a/b"));
        assert!(!valid_key(""));
    }

    #[test]
    fn redaction_hides_home_tokens_and_ips() {
        let home = Some(r"C:\Users\Steve");
        let text = r"Loading C:\Users\Steve\AppData\x.jar accessToken: eyJhbGciOiJIUzI1NiJ9.abc connect 93.184.216.34 local 127.0.0.1";
        let out = redact(text, home);
        assert!(!out.contains("Steve"));
        assert!(!out.contains("eyJhbGci"));
        assert!(!out.contains("93.184.216.34"));
        assert!(out.contains("127.0.0.1"));
    }

    #[test]
    fn stderr_marker_roundtrip() {
        let l = decode_line(format!("{STDERR_MARK}boom"));
        assert!(l.stderr);
        assert_eq!(l.line, "boom");
        assert!(!decode_line("ok".to_string()).stderr);
    }
}
