use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::app::paths::launcher_data_dir;
use crate::infra::proxy::{env_var_trim, preferred_proxy_host};
use crate::services::game::console::log_to_console;
pub(crate) fn build_java_http_proxy_args_with_preferred_host(prefer_ipv6: bool) -> Vec<String> {
    let _ = dotenvy::dotenv();

    let host = preferred_proxy_host(prefer_ipv6);
    let port_str = env_var_trim("PROXY_PORT");
    let (host, port) = match (host, port_str) {
        (Some(h), Some(p)) => match p.parse::<u16>() {
            Ok(port) => (h, port),
            Err(_) => return Vec::new(),
        },
        _ => return Vec::new(),
    };

    let user = env_var_trim("PROXY_USER");
    let pass = env_var_trim("PROXY_PASS");

    let mut args = Vec::new();

    args.push(format!("-Dhttp.proxyHost={}", host));
    args.push(format!("-Dhttp.proxyPort={}", port));
    args.push(format!("-Dhttps.proxyHost={}", host));
    args.push(format!("-Dhttps.proxyPort={}", port));

    if let (Some(user), Some(pass)) = (user, pass) {
        args.push(format!("-DproxyUser={}", user));
        args.push(format!("-DproxyPass={}", pass));

        args.push(format!("-Dhttp.proxyUser={}", user));
        args.push(format!("-Dhttp.proxyPassword={}", pass));
        args.push(format!("-Dhttps.proxyUser={}", user));
        args.push(format!("-Dhttps.proxyPassword={}", pass));
    }

    args.push("-Djdk.http.auth.tunneling.disabledSchemes=".to_string());

    args.push("-Djava.net.useSystemProxies=true".to_string());

    args.push("-Dsun.net.client.defaultConnectTimeout=120000".to_string()); //2 мин
    args.push("-Dsun.net.client.defaultReadTimeout=600000".to_string());   //10 мин

    args
}

const PROXY_AUTH_BOOTSTRAP_JAVA_SOURCE: &str = include_str!("../../../../ProxyAuthBootstrap.java");

pub(crate) fn ensure_proxy_auth_bootstrap_jar(
    app: &AppHandle,
    installer_jar_path: &Path,
) -> Result<PathBuf, String> {
    let out_dir = launcher_data_dir()?.join("proxy_auth_bootstrap");
    let jar_path = out_dir.join("bootstrap.jar");
    let classes_dir = out_dir.join("classes");

    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidates = [
            resource_dir.join("bootstrap.jar"),
            resource_dir.join("resources").join("bootstrap.jar"),
        ];
        for bundled_jar in &candidates {
            if bundled_jar.exists() {
                std::fs::create_dir_all(&out_dir)
                    .map_err(|e| format!("Не удалось создать папку bootstrap: {e}"))?;
                std::fs::copy(bundled_jar, &jar_path)
                    .map_err(|e| format!("Не удалось скопировать bundled bootstrap.jar: {e}"))?;
                return Ok(jar_path);
            }
        }

        let mut checked = String::new();
        for c in &candidates {
            let _ = std::fmt::Write::write_fmt(
                &mut checked,
                format_args!(
                    "{} exists={}; ",
                    c.display(),
                    c.exists()
                ),
            );
        }
        let _ = log_to_console(
            app,
            &format!(
                "[Forge] bundled bootstrap.jar не найден в resource_dir={} ({}).",
                resource_dir.display(),
                checked
            ),
        );
    }

    if jar_path.exists() {
        let jar_list = std::process::Command::new("jar")
            .arg("tf")
            .arg(&jar_path)
            .output()
            .map_err(|e| format!("Не удалось прочитать bootstrap.jar (jar tf): {e}"))?;

        if jar_list.status.success() {
            let text = String::from_utf8_lossy(&jar_list.stdout);
            if text.contains("ProxyAuthBootstrap$1.class") {
                return Ok(jar_path);
            }
        }
    }

    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Не удалось создать папку bootstrap: {e}"))?;
    std::fs::create_dir_all(&classes_dir)
        .map_err(|e| format!("Не удалось создать папку bootstrap classes: {e}"))?;

    let java_path = out_dir.join("ProxyAuthBootstrap.java");
    std::fs::write(&java_path, PROXY_AUTH_BOOTSTRAP_JAVA_SOURCE)
        .map_err(|e| format!("Не удалось сохранить ProxyAuthBootstrap.java: {e}"))?;

    if std::process::Command::new("javac")
        .arg("-version")
        .output()
        .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound)
    {
        return Err(
            "JDK не найден: javac отсутствует, а bundled bootstrap.jar не обнаружен"
                .to_string(),
        );
    }

    let javac_out = std::process::Command::new("javac")
        .arg("-encoding")
        .arg("UTF-8")
        .arg("-cp")
        .arg(installer_jar_path)
        .arg("-d")
        .arg(&classes_dir)
        .arg(&java_path)
        .output()
        .map_err(|e| format!("Не удалось запустить javac: {e}"))?;

    if !javac_out.status.success() {
        return Err(format!(
            "Не удалось скомпилировать ProxyAuthBootstrap.java (javac {}): {}",
            javac_out.status,
            String::from_utf8_lossy(&javac_out.stderr)
        ));
    }


    let _ = std::fs::remove_file(&jar_path);

    let jar_out = std::process::Command::new("jar")
        .arg("cf")
        .arg(&jar_path)
        .arg("-C")
        .arg(&classes_dir)
        .arg(".")
        .output()
        .map_err(|e| format!("Не удалось запустить jar: {e}"))?;

    if !jar_out.status.success() {
        return Err(format!(
            "Не удалось упаковать bootstrap.jar (jar {}): {}",
            jar_out.status,
            String::from_utf8_lossy(&jar_out.stderr)
        ));
    }

    Ok(jar_path)
}
