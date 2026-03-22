#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn load_dotenv_files() {
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_filename("../.env");
    let _ = dotenvy::from_filename("src-tauri/.env");
}

fn main() {
    load_dotenv_files();
    mc16launcher_lib::run()
}
