use crate::models::JavaArgsValidationResult;

pub async fn validate_java_args(java_path: Option<String>, args: String) -> Result<JavaArgsValidationResult, String> {
    let mut warnings = Vec::new();
    let mut errors = Vec::new();

    let java_exe = java_path
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "java".to_string());

    let mut cmd = std::process::Command::new(&java_exe);
    cmd.arg("-XshowSettings:vm");
    cmd.arg("-version");

    let user_args: Vec<String> = args.split_whitespace().map(|s| s.to_string()).collect();

    const FORBIDDEN_PREFIXES: &[&str] = &["-agentlib:", "-agentpath:", "-Xrun", "-Xdebug"];
    const FORBIDDEN_EQUALS: &[&str] = &["-XX:+DisableAttachMechanism"];

    const EXPERIMENTAL_FLAGS: &[&str] = &["-XX:+AggressiveOpts", "-XX:+UnlockExperimentalVMOptions"];

    let mut filtered_args = Vec::new();
    for a in &user_args {
        let mut blocked = false;
        for p in FORBIDDEN_PREFIXES {
            if a.starts_with(p) {
                blocked = true;
                errors.push(format!(
                    "Флаг \"{a}\" не может быть использован по соображениям безопасности."
                ));
                break;
            }
        }
        if blocked {
            continue;
        }
        for eq in FORBIDDEN_EQUALS {
            if a == eq {
                blocked = true;
                errors.push(format!(
                    "Флаг \"{a}\" не может быть использован по соображениям безопасности."
                ));
                break;
            }
        }
        if blocked {
            continue;
        }

        for exp in EXPERIMENTAL_FLAGS {
            if a == exp {
                warnings.push(format!(
                    "Флаг \"{a}\" является экспериментальным и может вызывать нестабильность JVM."
                ));
            }
        }

        if let Some(rest) = a.strip_prefix("-Xmx") {
            if let Some(mb) = crate::services::game::arguments::parse_memory_spec_to_mb(rest) {
                if mb > 64 * 1024 {
                    warnings.push("Указан очень большой Xmx (более 64ГБ). Убедитесь, что это соответствует объёму вашей ОЗУ.".to_string());
                }
            }
        }

        filtered_args.push(a.clone());
    }

    cmd.args(&filtered_args);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let output = cmd
        .output()
        .map_err(|e| format!("Не удалось запустить Java для проверки: {e}"))?;

    let mut combined = String::new();
    combined.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        if !combined.is_empty() {
            combined.push('\n');
        }
        combined.push_str(&String::from_utf8_lossy(&output.stderr));
    }

    let ok = output.status.success() && errors.is_empty();
    if !output.status.success() {
        errors.push(format!("Команда Java завершилась с кодом: {}", output.status));
    }

    Ok(JavaArgsValidationResult {
        ok,
        warnings,
        errors,
        output: combined,
    })
}

