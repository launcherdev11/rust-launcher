fn main() {
    println!("cargo:rerun-if-env-changed=ELY_CLIENT_SECRET");
    tauri_build::build()
}
