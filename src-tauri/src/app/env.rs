use std::path::Path;
use std::path::PathBuf;

fn load_dotenv_walking_up(start: &Path) {
    let mut dir = start.to_path_buf();
    for _ in 0..16 {
        let cand = dir.join(".env");
        if cand.is_file() {
            let _ = dotenvy::from_path_override(&cand);
            return;
        }
        if !dir.pop() {
            break;
        }
    }
}

pub fn load_dotenv_files() {
    if let Ok(cwd) = std::env::current_dir() {
        load_dotenv_walking_up(&cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            load_dotenv_walking_up(dir);
        }
    }
    // Compile-time project paths — stable even when cwd is target/debug or Sandbox mapping differs.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixed = [
        PathBuf::from(".env"),
        PathBuf::from("../.env"),
        PathBuf::from("src-tauri/.env"),
        manifest_dir.join(".env"),
        manifest_dir.join("../.env"),
    ];
    for p in fixed {
        if p.is_file() {
            let _ = dotenvy::from_path_override(&p);
        }
    }
}

