fn is_pure_noise(line: &str) -> bool {
    line.starts_with("Picked up JAVA_TOOL_OPTIONS")
        || line.starts_with("OpenJDK 64-Bit Server VM warning:")
        || line.starts_with("SLF4J:")
        || line.starts_with("Initializing LWJGL")
        || line.starts_with("GLFW API version:")
        || line.starts_with("[LWJGL] Version:")
        || line.starts_with("Setting user:")
        || line.starts_with("Environment: ")
        || line.starts_with("Backend library: LWJGL")
        || line.starts_with("Narrator library successfully loaded")
        || line.starts_with("Created: ")
        || line.starts_with("Reloading ResourceManager:")
        || line.starts_with("Loaded ")
        || line.starts_with("OpenAL initialized.")
        || line.starts_with("Sound engine started")
        || line.starts_with("Started on ")
        || line.starts_with("[Datafixer ")
        || line.starts_with("Registering synthetic datapack")
        || line.starts_with("Constructing ModContainer [")
        || line.starts_with("Found mod file ")
        || line.starts_with("Adding duplicate mod ")
        || line.starts_with("Skipping jar.Mod")
        || line.starts_with("ModLauncher running:")
        || line.starts_with("Using debug probe provider")
        || line.starts_with("Java HotSpot(TM) 64-Bit")
        || line.starts_with("SpongePowered MIXIN Subsystem")
        || line.starts_with("MixinExtras")
        || line.starts_with("Please visit https://www.spongepowered.org")
        || line.starts_with("authlib-injector [INFO]")
        || line.starts_with("Scanning for mods...")
        || line.starts_with("Loading [")
}

fn has_error_signal(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("exception")
        || lower.contains("fatal")
        || lower.contains("crash")
        || lower.contains("crashed")
        || lower.contains("failed")
        || lower.contains("failure")
        || lower.contains("ошибк")
        || lower.contains("cannot")
        || lower.contains("can't")
        || lower.contains("unable")
        || lower.contains("missing")
        || lower.contains("conflict")
        || lower.contains("invalid")
        || lower.contains("denied")
        || lower.contains("abort")
        || lower.contains("killed")
        || lower.contains("incompatible")
        || lower.contains("mixin apply")
        || lower.contains("java.lang.")
        || lower.contains("---- minecraft crash report ----")
        || lower.contains("#@!@#")
        || lower.contains("crash report")
        || lower.contains("outofmemoryerror")
}

fn has_warn_signal(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("warn") || lower.contains("warning") || lower.contains("предупрежден")
}

fn has_milestone(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("loading minecraft")
        || lower.contains("starting minecraft")
        || lower.contains("minecraft main menu")
        || lower.contains("done!")
        || lower.contains("fully initialized")
        || lower.contains("connected to")
        || lower.contains("joined the game")
        || lower.contains("left the game")
        || lower.contains("lost connection")
        || lower.contains("shutting down")
        || lower.contains("stopping server")
        || lower.contains("saving chunks")
        || lower.contains("preparing start region")
}

fn has_useful_info(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("mod loading")
        || lower.contains("mods loaded")
        || lower.contains("loaded ")
        || lower.contains("missing dependency")
        || lower.contains("missing mod")
        || lower.contains("missing resource")
        || lower.contains("requires:")
        || lower.contains("version mismatch")
        || lower.contains("failed to load")
        || lower.contains("failed to start")
        || lower.contains("failed to download")
        || lower.contains("failed to apply")
        || lower.contains("failed to initialize")
        || lower.contains("could not")
        || lower.contains("couldn't")
        || lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("access denied")
        || lower.contains("permission denied")
        || lower.contains("glfw error")
        || lower.contains("report saved to")
        || lower.contains("report written to")
        || lower.contains("entered the game")
        || lower.contains("disconnect")
        || lower.contains("mixin transformation")
        || lower.contains("bootstrap")
        || lower.contains("launching target")
        || lower.contains("launching minecraft")
        || lower.contains("render thread")
        || lower.contains("sound engine failed")
        || lower.contains("sound engine error")
}

fn is_launcher_line(line: &str) -> bool {
    line.starts_with("[Launch]")
        || line.starts_with("[ElyAuth]")
        || line.starts_with("[Java]")
        || line.starts_with("[Forge]")
        || line.starts_with("[Fabric]")
        || line.starts_with("[Quilt]")
        || line.starts_with("[Vanilla]")
}

fn is_launcher_verbose(line: &str) -> bool {
    line.starts_with("[Launch] LWJGL")
}

fn minecraft_log_level(line: &str) -> Option<&'static str> {
    if line.contains("/ERROR]:") || line.contains("/FATAL]:") {
        return Some("ERROR");
    }
    if line.contains("/WARN]:") || line.contains("/WARNING]:") {
        return Some("WARN");
    }
    if line.contains("/DEBUG]:") || line.contains("/TRACE]:") {
        return Some("DEBUG");
    }
    if line.contains("/INFO]:") {
        return Some("INFO");
    }
    None
}

pub fn is_game_console_line_important(line: &str, source: &str) -> bool {
    let trimmed = line.trim_end();
    if trimmed.is_empty() {
        return false;
    }

    if is_pure_noise(trimmed) {
        return false;
    }

    if source == "stderr" && !trimmed.starts_with('[') {
        return true;
    }

    if is_launcher_line(trimmed) {
        return !is_launcher_verbose(trimmed);
    }

    if has_error_signal(trimmed) {
        return true;
    }

    if let Some(level) = minecraft_log_level(trimmed) {
        return matches!(level, "ERROR" | "FATAL" | "WARN") || has_warn_signal(trimmed);
    }

    if has_warn_signal(trimmed) || has_milestone(trimmed) || has_useful_info(trimmed) {
        return true;
    }

    if source == "stderr" {
        return true;
    }

    trimmed.len() <= 200
}
