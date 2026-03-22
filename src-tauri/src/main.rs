#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};

fn load_dotenv_walking_up(start: &Path) {
    let mut dir = start.to_path_buf();
    for _ in 0..16 {
        let cand = dir.join(".env");
        if cand.is_file() {
            let _ = dotenvy::from_path(&cand);
            return;
        }
        if !dir.pop() {
            break;
        }
    }
}

fn load_dotenv_files() {
    if let Ok(cwd) = std::env::current_dir() {
        load_dotenv_walking_up(&cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            load_dotenv_walking_up(dir);
        }
    }
    let fixed = [
        PathBuf::from(".env"),
        PathBuf::from("../.env"),
        PathBuf::from("src-tauri/.env"),
    ];
    for p in fixed {
        if p.is_file() {
            let _ = dotenvy::from_path(&p);
        }
    }
}

fn main() {
    load_dotenv_files();
    mc16launcher_lib::run()
}
