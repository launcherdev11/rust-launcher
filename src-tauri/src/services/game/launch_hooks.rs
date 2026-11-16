use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle};

use crate::app::paths::launch_hooks_path;
use crate::infra::fs_atomic::{backup_path_for, read_to_string_with_backup, write_atomic};
use crate::infra::process::hide_console;
use crate::models::ProfileLaunchHooks;
use crate::services::game::console::{for_each_output_line, log_to_console};

const HOOK_TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub(crate) const HOOK_FAILED_PREFIX: &str = "launch_hook_failed:";
pub(crate) const WRAPPER_FAILED_PREFIX: &str = "launch_wrapper_failed:";
const ERR_INVALID_ENV_NAME: &str = "launch_hooks.invalid_env_name";
const ERR_INVALID_WRAPPER: &str = "launch_hooks.invalid_wrapper";
const ERR_INVALID_COMMAND: &str = "launch_hooks.invalid_command";

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct LaunchHooksFile {
    profiles: BTreeMap<String, ProfileLaunchHooks>,
}

fn load_file() -> Result<LaunchHooksFile, String> {
    let path = launch_hooks_path()?;
    if !path.exists() && !backup_path_for(&path).exists() {
        return Ok(LaunchHooksFile::default());
    }
    let text = read_to_string_with_backup(&path)
        .ok_or_else(|| format!("Ошибка чтения {}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("Ошибка разбора launch_hooks.json: {e}"))
}

fn save_file(file: &LaunchHooksFile) -> Result<(), String> {
    let text = serde_json::to_string_pretty(file)
        .map_err(|e| format!("Ошибка сериализации launch_hooks.json: {e}"))?;
    write_atomic(&launch_hooks_path()?, text)
}

fn normalize_command(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.contains('\0') {
        return Err(ERR_INVALID_COMMAND.to_string());
    }
    Ok((!trimmed.is_empty()).then(|| trimmed.to_string()))
}

fn is_valid_env_name(name: &str) -> bool {
    !name.is_empty() && !name.chars().any(|c| c == '=' || c == '\0' || c.is_whitespace())
}

fn normalize(hooks: ProfileLaunchHooks) -> Result<ProfileLaunchHooks, String> {
    let wrapper_command = normalize_command(hooks.wrapper_command)?;
    if let Some(wrapper) = wrapper_command.as_deref() {
        split_command_line(wrapper).ok_or_else(|| ERR_INVALID_WRAPPER.to_string())?;
    }

    let mut env_vars = hooks.env_vars;
    for var in &mut env_vars {
        var.name = var.name.trim().to_string();
    }
    env_vars.retain(|var| !var.name.is_empty() || !var.value.is_empty());
    if env_vars
        .iter()
        .any(|var| !is_valid_env_name(&var.name) || var.value.contains('\0'))
    {
        return Err(ERR_INVALID_ENV_NAME.to_string());
    }

    Ok(ProfileLaunchHooks {
        pre_launch_command: normalize_command(hooks.pre_launch_command)?,
        post_exit_command: normalize_command(hooks.post_exit_command)?,
        wrapper_command,
        env_vars,
    })
}

fn is_empty(hooks: &ProfileLaunchHooks) -> bool {
    hooks.pre_launch_command.is_none()
        && hooks.post_exit_command.is_none()
        && hooks.wrapper_command.is_none()
        && hooks.env_vars.is_empty()
}

#[command]
pub fn get_profile_launch_hooks(profile_id: String) -> Result<ProfileLaunchHooks, String> {
    Ok(load_file()?.profiles.remove(&profile_id).unwrap_or_default())
}

#[command]
pub fn set_profile_launch_hooks(
    profile_id: String,
    hooks: ProfileLaunchHooks,
) -> Result<ProfileLaunchHooks, String> {
    let normalized = normalize(hooks)?;
    let mut file = load_file()?;
    if is_empty(&normalized) {
        file.profiles.remove(&profile_id);
    } else {
        file.profiles.insert(profile_id, normalized.clone());
    }
    save_file(&file)?;
    Ok(normalized)
}

pub(crate) fn hooks_for_launch(profile_id: Option<&str>) -> ProfileLaunchHooks {
    let Some(id) = profile_id else {
        return ProfileLaunchHooks::default();
    };
    match load_file() {
        Ok(mut file) => file.profiles.remove(id).unwrap_or_default(),
        Err(e) => {
            eprintln!("[Launch] Не удалось прочитать команды запуска: {e}");
            ProfileLaunchHooks::default()
        }
    }
}

pub(crate) fn forget_profile_hooks(profile_id: &str) {
    let Ok(mut file) = load_file() else {
        return;
    };
    if file.profiles.remove(profile_id).is_some() {
        if let Err(e) = save_file(&file) {
            eprintln!("[Launch] Не удалось удалить команды запуска сборки: {e}");
        }
    }
}

pub(crate) fn copy_profile_hooks(from_id: &str, to_id: &str) {
    let Ok(mut file) = load_file() else {
        return;
    };
    let Some(hooks) = file.profiles.get(from_id).cloned() else {
        return;
    };
    file.profiles.insert(to_id.to_string(), hooks);
    if let Err(e) = save_file(&file) {
        eprintln!("[Launch] Не удалось скопировать команды запуска сборки: {e}");
    }
}

fn split_command_line(input: &str) -> Option<Vec<String>> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_token = false;
    let mut quote: Option<char> = None;

    for c in input.chars() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => current.push(c),
            None if c == '"' || c == '\'' => {
                quote = Some(c);
                in_token = true;
            }
            None if c.is_whitespace() => {
                if in_token {
                    parts.push(std::mem::take(&mut current));
                    in_token = false;
                }
            }
            None => {
                current.push(c);
                in_token = true;
            }
        }
    }
    if quote.is_some() {
        return None;
    }
    if in_token {
        parts.push(current);
    }
    Some(parts)
}

pub(crate) fn game_command(
    java_path: &Path,
    wrapper: Option<&str>,
) -> Result<(Command, Option<String>), String> {
    let parts = match wrapper {
        Some(line) => split_command_line(line).ok_or_else(|| ERR_INVALID_WRAPPER.to_string())?,
        None => Vec::new(),
    };
    let mut parts = parts.into_iter();
    let Some(program) = parts.next() else {
        return Ok((Command::new(java_path), None));
    };
    let mut cmd = Command::new(&program);
    cmd.args(parts).arg(java_path);
    Ok((cmd, Some(program)))
}

fn shell_command(line: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("cmd");
        cmd.raw_arg("/D /S /C \"").raw_arg(line).raw_arg("\"");
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(line);
        cmd
    }
}

#[derive(Debug, Clone)]
pub(crate) struct HookContext {
    pub profile_id: String,
    pub game_dir: PathBuf,
    pub version_id: String,
    pub java_path: PathBuf,
    pub env_vars: Vec<(String, String)>,
}

#[derive(Debug, PartialEq, Eq)]
enum HookError {
    Spawn(String),
    Exit(Option<i32>),
    Timeout,
}

fn describe_error(error: HookError) -> String {
    match error {
        HookError::Spawn(msg) => msg,
        HookError::Exit(Some(code)) => format!("exit {code}"),
        HookError::Exit(None) => "killed".to_string(),
        HookError::Timeout => "timeout".to_string(),
    }
}

fn run_hook(
    line: &str,
    ctx: &HookContext,
    exit_code: Option<i32>,
    timeout: Duration,
    on_line: impl Fn(String) + Clone + Send + 'static,
) -> Result<(), HookError> {
    let mut cmd = shell_command(line);
    cmd.current_dir(&ctx.game_dir)
        .envs(ctx.env_vars.iter().map(|(k, v)| (k, v)))
        .env("INST_ID", &ctx.profile_id)
        .env("INST_DIR", &ctx.game_dir)
        .env("INST_VERSION", &ctx.version_id)
        .env("INST_JAVA", &ctx.java_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(code) = exit_code {
        cmd.env("INST_EXIT_CODE", code.to_string());
    }
    hide_console(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| HookError::Spawn(e.to_string()))?;

    if let Some(stdout) = child.stdout.take() {
        let on_line = on_line.clone();
        std::thread::spawn(move || for_each_output_line(stdout, on_line));
    }
    if let Some(stderr) = child.stderr.take() {
        let on_line = on_line.clone();
        std::thread::spawn(move || for_each_output_line(stderr, on_line));
    }

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => return Err(HookError::Exit(status.code())),
            Ok(None) => {}
            Err(e) => return Err(HookError::Spawn(e.to_string())),
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(HookError::Timeout);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn console_sink(app: &AppHandle, tag: &'static str) -> impl Fn(String) + Clone + Send + 'static {
    let app = app.clone();
    move |text: String| log_to_console(&app, &format!("[{tag}] {text}"))
}

pub(crate) fn run_pre_launch(app: &AppHandle, line: &str, ctx: &HookContext) -> Result<(), String> {
    let sink = console_sink(app, "pre-launch");
    sink(line.to_string());
    run_hook(line, ctx, None, HOOK_TIMEOUT, sink)
        .map_err(|e| format!("{HOOK_FAILED_PREFIX}{}", describe_error(e)))
}

pub(crate) fn run_post_exit(app: &AppHandle, line: &str, ctx: &HookContext, exit_code: Option<i32>) {
    let sink = console_sink(app, "post-exit");
    sink(line.to_string());
    if let Err(e) = run_hook(line, ctx, exit_code, HOOK_TIMEOUT, sink.clone()) {
        sink(describe_error(e));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::LaunchEnvVar;
    use std::sync::{Arc, Mutex};

    fn ctx(dir: &Path) -> HookContext {
        HookContext {
            profile_id: "profile-1".to_string(),
            game_dir: dir.to_path_buf(),
            version_id: "1.21.1".to_string(),
            java_path: PathBuf::from("java"),
            env_vars: vec![("MY_VAR".to_string(), "from user".to_string())],
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "launch-hooks-{name}-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn run_collect(
        line: &str,
        dir: &Path,
        exit_code: Option<i32>,
        timeout: Duration,
    ) -> (Result<(), HookError>, Arc<Mutex<Vec<String>>>) {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = {
            let lines = lines.clone();
            move |text: String| lines.lock().unwrap().push(text)
        };
        let result = run_hook(line, &ctx(dir), exit_code, timeout, sink);
        std::thread::sleep(Duration::from_millis(200));
        (result, lines)
    }

    #[test]
    fn splits_quoted_wrapper() {
        assert_eq!(
            split_command_line(r#"gamemoderun "C:\Program Files\x.exe" --flag='a b'"#).unwrap(),
            vec!["gamemoderun", r"C:\Program Files\x.exe", "--flag=a b"],
        );
        assert_eq!(split_command_line("  ").unwrap(), Vec::<String>::new());
        assert_eq!(split_command_line(r#"a """#).unwrap(), vec!["a", ""]);
        assert!(split_command_line(r#"a "b"#).is_none());
    }

    #[test]
    fn wrapper_goes_before_java() {
        let java = Path::new("java");
        let (plain, name) = game_command(java, None).unwrap();
        assert_eq!(plain.get_program(), "java");
        assert_eq!(name, None);

        let (wrapped, name) = game_command(java, Some("mangohud --dlsym")).unwrap();
        assert_eq!(wrapped.get_program(), "mangohud");
        assert_eq!(name.as_deref(), Some("mangohud"));
        let args: Vec<_> = wrapped.get_args().collect();
        assert_eq!(args, ["--dlsym", "java"]);
    }

    #[test]
    fn normalize_trims_and_rejects() {
        let hooks = normalize(ProfileLaunchHooks {
            pre_launch_command: Some("  echo hi ".to_string()),
            post_exit_command: Some("   ".to_string()),
            wrapper_command: None,
            env_vars: vec![
                LaunchEnvVar { name: " A ".to_string(), value: "1".to_string() },
                LaunchEnvVar { name: String::new(), value: String::new() },
            ],
        })
        .unwrap();
        assert_eq!(hooks.pre_launch_command.as_deref(), Some("echo hi"));
        assert_eq!(hooks.post_exit_command, None);
        assert_eq!(hooks.env_vars.len(), 1);
        assert_eq!(hooks.env_vars[0].name, "A");

        for bad in ["A=B", "A B", ""] {
            let result = normalize(ProfileLaunchHooks {
                env_vars: vec![LaunchEnvVar { name: bad.to_string(), value: "1".to_string() }],
                ..Default::default()
            });
            assert_eq!(result.unwrap_err(), ERR_INVALID_ENV_NAME);
        }

        let result = normalize(ProfileLaunchHooks {
            wrapper_command: Some("a \"b".to_string()),
            ..Default::default()
        });
        assert_eq!(result.unwrap_err(), ERR_INVALID_WRAPPER);
    }

    #[test]
    fn hook_reports_exit_code_and_output() {
        let dir = temp_dir("exit");
        let (ok, lines) = run_collect("echo hello", &dir, None, HOOK_TIMEOUT);
        assert_eq!(ok, Ok(()));
        assert_eq!(lines.lock().unwrap().join("\n").trim(), "hello");

        let (failed, _) = run_collect("exit 7", &dir, None, HOOK_TIMEOUT);
        assert_eq!(failed, Err(HookError::Exit(Some(7))));
    }

    #[test]
    fn hook_runs_in_game_dir_with_env() {
        let dir = temp_dir("env");
        #[cfg(windows)]
        let line = "echo %MY_VAR%^|%INST_ID%^|%INST_VERSION%^|%INST_EXIT_CODE%^|%CD%";
        #[cfg(not(windows))]
        let line = r#"echo "$MY_VAR|$INST_ID|$INST_VERSION|$INST_EXIT_CODE|$PWD""#;

        let (result, lines) = run_collect(line, &dir, Some(3), HOOK_TIMEOUT);
        assert_eq!(result, Ok(()));
        let output = lines.lock().unwrap().join("\n");
        let parts: Vec<&str> = output.trim().split('|').collect();
        assert_eq!(parts[..4], ["from user", "profile-1", "1.21.1", "3"]);
        assert_eq!(
            std::fs::canonicalize(parts[4]).unwrap(),
            std::fs::canonicalize(&dir).unwrap(),
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_shell_keeps_quoted_paths() {
        let dir = temp_dir("quoted").join("with space");
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("say.cmd");
        std::fs::write(&script, "@echo [%~1]\r\n").unwrap();

        let line = format!("\"{}\" \"two words\"", script.display());
        let (result, lines) = run_collect(&line, &dir, None, HOOK_TIMEOUT);
        assert_eq!(result, Ok(()));
        assert_eq!(lines.lock().unwrap().join("\n").trim(), "[two words]");
    }

    #[test]
    fn hook_times_out() {
        let dir = temp_dir("timeout");
        #[cfg(windows)]
        let line = "ping -n 30 127.0.0.1";
        #[cfg(not(windows))]
        let line = "sleep 30";

        let started = Instant::now();
        let (result, _) = run_collect(line, &dir, None, Duration::from_millis(300));
        assert_eq!(result, Err(HookError::Timeout));
        assert!(started.elapsed() < Duration::from_secs(10));
    }
}
