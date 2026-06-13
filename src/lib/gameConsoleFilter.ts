const LAUNCHER_PREFIX = /^\[(Launch|ElyAuth|Java|Forge|Fabric|Quilt|Vanilla)\]/;

const VERSION_INSTALL_PREFIX = /^\[(Vanilla|Fabric|Quilt|Forge)\]/;

const LAUNCHER_VERBOSE = [
  /^\[Launch\] LWJGL в classpath:/,
  /^\[Launch\] LWJGL natives dir:/,
];

const MC_LOG_LEVEL = /\[[\w\s\-#.']+\/(INFO|WARN|WARNING|ERROR|FATAL|DEBUG|TRACE)\]:/i;

const STACK_TRACE_LINE =
  /^\s+(at\s[\w$.]+|\.{3}\s*\d+\s+more|Caused by:|Suppressed:)/;

const ERROR_SIGNAL =
  /\b(error|exception|fatal|crash|crashed|failed|failure|ошибк|cannot|can't|unable|missing|conflict|invalid|denied|abort|killed|incompatible|mixin apply)\b|java\.lang\.|---- Minecraft Crash Report ----|#@!@#|Crash Report|OutOfMemoryError/i;

const WARN_SIGNAL = /\b(warn|warning|предупрежден)\b/i;

const MILESTONE =
  /\b(loading minecraft|starting minecraft|minecraft main menu|done!?\b|fully initialized|connected to|joined the game|left the game|lost connection|shutting down|stopping server|saving chunks|preparing start region)\b/i;

const USEFUL_INFO =
  /\b(mod loading|mods? loaded|loaded \d+ mods?|finished loading|missing (dependency|mods?|resource)|requires?:|version mismatch|failed to (load|start|download|apply|initialize)|could not|couldn't|timed out|timeout|access denied|permission denied|glfw error|report (saved|written) to|done \([\d.]+s\)|entered the game|disconnect|died|death|kicked|exit(?:ed)?(?: with code)?|mixin transformation|transformer|bootstrap|launching target|launching minecraft|render thread|sound engine (failed|error))\b|#@!@#|---- Minecraft Crash Report ----/i;

const PURE_NOISE =
  /^(Picked up JAVA_TOOL_OPTIONS|OpenJDK 64-Bit Server VM warning:|SLF4J:|Initializing LWJGL \d|GLFW API version:|\[LWJGL\] Version:|Setting user:|Environment: \w+|Backend library: LWJGL|Found \d+ override|Narrator library successfully loaded|Created: \d+x\d+ framebuffer|Reloading ResourceManager: \w+$|Loaded \d+ advancements|Loaded \d+ recipes|OpenAL initialized\.|Sound engine started|Started on .* port|^\[Datafixer \d|Registering synthetic datapack|Constructing ModContainer \[|Found mod file |Adding duplicate mod |Skipping jar\.Mod|ModLauncher running:|Using debug probe provider|Java HotSpot\(TM\) 64-Bit|SpongePowered MIXIN Subsystem|MixinExtras|Please visit https:\/\/www\.spongepowered\.org|authlib-injector \[INFO\]|Scanning for mods\.\.\.|Loading \[.*\] mods \.\.\.|^\s*$)/i;

const CONTEXT_BURST = 60;

let contextLinesRemaining = 0;

function getMinecraftLogLevel(line: string): string | null {
  const match = line.match(MC_LOG_LEVEL);
  if (!match) return null;
  const level = match[1].toUpperCase();
  return level === "WARNING" ? "WARN" : level;
}

function extendsContext(line: string): boolean {
  return (
    ERROR_SIGNAL.test(line) ||
    WARN_SIGNAL.test(line) ||
    STACK_TRACE_LINE.test(line) ||
    /---- Minecraft Crash Report ----/.test(line)
  );
}

function bumpContext(line: string): void {
  if (extendsContext(line)) {
    contextLinesRemaining = CONTEXT_BURST;
  }
}

export function resetGameConsoleFilter(): void {
  contextLinesRemaining = 0;
}

export function isVersionInstallConsoleLine(line: string): boolean {
  return VERSION_INSTALL_PREFIX.test(line.trimEnd());
}

export function isGameConsoleLineImportant(
  line: string,
  source: "stdout" | "stderr" = "stdout",
): boolean {
  const trimmed = line.trimEnd();
  if (!trimmed) return false;

  if (PURE_NOISE.test(trimmed)) return false;

  if (source === "stderr" && !/^\[\d{2}:\d{2}:\d{2}\]/.test(trimmed)) {
    if (extendsContext(trimmed)) bumpContext(trimmed);
    return true;
  }

  if (LAUNCHER_PREFIX.test(trimmed)) {
    return !LAUNCHER_VERBOSE.some((re) => re.test(trimmed));
  }

  if (STACK_TRACE_LINE.test(trimmed)) {
    bumpContext(trimmed);
    return true;
  }

  if (ERROR_SIGNAL.test(trimmed)) {
    bumpContext(trimmed);
    return true;
  }

  const level = getMinecraftLogLevel(trimmed);

  if (level === "ERROR" || level === "FATAL") {
    bumpContext(trimmed);
    return true;
  }

  if (level === "WARN" || WARN_SIGNAL.test(trimmed)) {
    bumpContext(trimmed);
    return true;
  }

  if (MILESTONE.test(trimmed) || USEFUL_INFO.test(trimmed)) {
    return true;
  }

  if (contextLinesRemaining > 0) {
    contextLinesRemaining -= 1;
    return true;
  }

  if (level === "DEBUG" || level === "TRACE") {
    return false;
  }

  if (level === "INFO") {
    return false;
  }

  return trimmed.length <= 200;
}
