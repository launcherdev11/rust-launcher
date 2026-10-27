export type LogAnalyzerSeverity = "error" | "warning" | "info";

export type LogAnalyzerFinding = {
  id: string;
  severity: LogAnalyzerSeverity;
  titleKey: string;
  fixKey: string;
  title?: string;
  fix?: string;
  fixVars?: Record<string, string | number>;
  matchCount: number;
  sample?: string;
  detail?: string;
  subjects?: string[];
  sources?: string[];
};

export type LogAnalyzerInputSource = {
  id: string;
  label: string;
  text: string;
};

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

type RuleMatch = {
  subject?: string;
  fixKey?: string;
  fixVars?: Record<string, string | number>;
};

export type AnalyzerRule = {
  id: string;
  severity: LogAnalyzerSeverity;
  pattern: RegExp;
  i18nBase?: string;
  text?: { title: string; fix: string };
  hidden?: boolean;
  anyLevel?: boolean;
  strict?: boolean;
  exclude?: RegExp;
  inspect?: (line: string, m: RegExpMatchArray) => RuleMatch | null;
  generic?: boolean;
};

const PLATFORM_DEP = /^(?:minecraft|java|fabricloader|fabric-loader|forge|neoforge|quilt_loader)$/i;

function cleanSubject(raw: string | undefined | null): string | undefined {
  const s = (raw ?? "").trim().replace(/^['"`]+|['"`,.!]+$/g, "");
  return s ? s : undefined;
}

function classVersionToJava(classVersion: number): number | null {
  return classVersion >= 45 ? classVersion - 44 : null;
}

function fabricModRef(text: string): { name: string; id?: string } | null {
  const quoted = text.match(/'([^']+)'(?:\s*\(([\w\-.]+)\))?/);
  if (quoted) return { name: quoted[1], id: quoted[2] };
  const bare = text.match(/(?:mod\s+)?([\w\-.]+)/);
  return bare ? { name: bare[1], id: bare[1] } : null;
}

function describeModRef(ref: { name: string; id?: string }): string {
  return ref.id && ref.id !== ref.name ? `${ref.name} (${ref.id})` : ref.name;
}

const RULES: AnalyzerRule[] = [
  {
    id: "jvmStart",
    severity: "error",
    anyLevel: true,
    pattern:
      /Could not reserve enough space for (?:\d+\w* )?object heap|Invalid (?:maximum|initial) heap size|Initial heap size set to a larger value than the maximum heap size|Too small (?:maximum|initial) heap|Error occurred during initialization of VM|Could not create the Java Virtual Machine/i,
  },
  {
    id: "badJvmArgs",
    severity: "error",
    anyLevel: true,
    pattern: /Unrecognized VM option '([^']+)'|Unrecognized option: (\S+)|Improperly specified VM option '([^']+)'/i,
    inspect: (_line, m) => ({ subject: cleanSubject(m[1] ?? m[2] ?? m[3]) }),
  },
  {
    id: "oom",
    severity: "error",
    anyLevel: true,
    pattern:
      /OutOfMemoryError|Java heap space|GC overhead limit exceeded|Native memory allocation \(\w+\) failed|Out of memory: Java process/i,
    exclude: /\s-X(?:X:|mx|ms|ss)/,
  },
  {
    id: "wrongJava",
    severity: "error",
    anyLevel: true,
    pattern:
      /UnsupportedClassVersionError|has been compiled by a more recent version of the Java Runtime|Unsupported class file major version (\d+)|Unsupported Java detected|This Java version is unrecognized|requires Java (\d+)|Java (\d+) or (?:later|newer|above) is required/i,
    inspect: (line) => {
      const compiled = line.match(/class file version (\d+)(?:\.\d+)?/i);
      if (compiled && /more recent version/i.test(line)) {
        const java = classVersionToJava(Number(compiled[1]));
        if (java) return { fixKey: "play.console.analyzer.rules.wrongJava.fixNeed", fixVars: { java } };
      }
      const tooNew = line.match(/Unsupported class file major version (\d+)/i);
      if (tooNew) {
        const java = classVersionToJava(Number(tooNew[1]));
        if (java) return { fixKey: "play.console.analyzer.rules.wrongJava.fixTooNew", fixVars: { java } };
      }
      const needs = line.match(/requires Java (\d+)|Java (\d+) or (?:later|newer|above) is required/i);
      const java = Number(needs?.[1] ?? needs?.[2]);
      if (java >= 8) {
        return { fixKey: "play.console.analyzer.rules.wrongJava.fixNeed", fixVars: { java } };
      }
      return {};
    },
  },
  {
    id: "corruptJar",
    severity: "error",
    anyLevel: true,
    pattern:
      /Invalid or corrupt jarfile|zip END header not found|Error opening zip file|ZipException|truncated ZIP|Unexpected end of ZLIB input stream|Error reading zip|Not a valid zip|invalid (?:LOC|CEN) header/i,
    exclude: /region|chunk|\.mca\b|level\.dat/i,
    inspect: (line) => ({ subject: cleanSubject(line.match(/([^\s\\/:'"]+\.(?:jar|zip))/i)?.[1]) }),
  },
  {
    id: "missingDependency",
    severity: "error",
    pattern:
      /requires .+? of (.+?),? which is missing|Mod ID: '([^']+)', Requested by: '([^']+)'.*Actual version: '\[MISSING\]'|Currently, ([\w\-.]+) is not installed|Missing (?:required )?(?:mod|dependency|dependencies)\b|dependency .+ (?:was not found|is missing)|requires mod ([\w\-.]+), which is missing/i,
    exclude: /\b(?:optional|recommends|suggests)\b/i,
    inspect: (line, m) => {
      if (m[1]) {
        const ref = fabricModRef(m[1]);
        if (ref && PLATFORM_DEP.test(ref.id ?? ref.name)) return null;
        const requester = line.match(/Mod '([^']+)'(?:\s*\(([\w\-.]+)\))?/);
        const dep = ref ? describeModRef(ref) : undefined;
        return {
          subject: requester && dep ? `${dep} ← ${requester[1]}` : dep,
        };
      }
      if (m[2]) {
        if (PLATFORM_DEP.test(m[2])) return null;
        return { subject: `${m[2]} ← ${m[3]}` };
      }
      const id = m[4] ?? m[5];
      if (id && PLATFORM_DEP.test(id)) return null;
      return { subject: cleanSubject(id) };
    },
  },
  {
    id: "dependencyVersion",
    severity: "error",
    pattern:
      /requires .+? of (.+?), but only the wrong version is present|Mod ID: '([^']+)', Requested by: '([^']+)', Expected range: '([^']*)', Actual version: '([^'\]]+)'|Currently, ([\w\-.]+) is (?!not installed)(\S+)/i,
    inspect: (_line, m) => {
      if (m[1]) {
        const ref = fabricModRef(m[1]);
        if (!ref || PLATFORM_DEP.test(ref.id ?? ref.name)) return null;
        return { subject: describeModRef(ref) };
      }
      if (m[2]) {
        if (PLATFORM_DEP.test(m[2])) return null;
        return { subject: `${m[2]} ${m[5]} → ${m[4]} (${m[3]})` };
      }
      if (!m[6] || PLATFORM_DEP.test(m[6])) return null;
      return { subject: `${m[6]} ${m[7]}` };
    },
  },
  {
    id: "duplicateMods",
    severity: "error",
    pattern:
      /Duplicate mods? found|Found duplicate mods|Mod ID '?([\w\-.]+)'? is (?:present|provided) (?:by|in) (?:multiple|several)|Mod ID: '([^']+)' from mod files: (.+)|Duplicate mods? (?:id|ID)s? ['`"]?([\w\-.]+)/i,
    exclude: /ignoring|using the newest|Jar-in-Jar|JarJar/i,
    inspect: (_line, m) => ({
      subject: cleanSubject(m[2] ? `${m[2]}: ${m[3]}` : (m[1] ?? m[4])),
    }),
  },
  {
    id: "versionMismatch",
    severity: "error",
    pattern:
      /requires .+? of (?:'Minecraft' \(minecraft\)|minecraft\b)|Mod ID: 'minecraft', Requested by: '([^']+)'|Mod ([\w\-.]+) requires minecraft |was designed for Minecraft|incompatible with (?:Minecraft|game version)/i,
    inspect: (line, m) => {
      const fabricOwner = line.match(/Mod '([^']+)'/)?.[1];
      return { subject: cleanSubject(fabricOwner ?? m[1] ?? m[2]) };
    },
  },
  {
    id: "fabricLoader",
    severity: "error",
    pattern:
      /requires .+? of (?:'Fabric Loader' \(fabricloader\)|fabricloader\b)|Incompatible Fabric Loader|needs (?:a newer )?Fabric Loader|requires .+? of (?:'Quilt Loader' \(quilt_loader\)|quilt_loader\b)/i,
    inspect: (line) => ({ subject: cleanSubject(line.match(/Mod '([^']+)'/)?.[1]) }),
  },
  {
    id: "forgeVersion",
    severity: "error",
    pattern:
      /Mod ID: '(?:forge|neoforge)', Requested by: '([^']+)'|missing or wrong version of Forge|Mod ([\w\-.]+) requires (?:forge|neoforge) \S+ or above|requires (?:Minecraft )?Forge (?:version )?\d/i,
    inspect: (_line, m) => ({ subject: cleanSubject(m[1] ?? m[2]) }),
  },
  {
    id: "mixinConflict",
    severity: "error",
    pattern:
      /Mixin apply(?: for mod [\w\-.]+)? failed|Mixin prepare for mod [\w\-.]+ failed|Critical injection failure|InvalidInjectionException|InvalidMixinException|MixinApplyError|MixinPrepareError|MixinTransformerError|Mixin transformation of [\w$.]+ failed|@(?:Redirect|Overwrite) conflict|Unable to apply mixin/i,
    strict: true,
    inspect: (line) => {
      const mod = line.match(/(?:for|from) mod ['"]?([\w\-.]+)/i)?.[1];
      const config = line.match(/([\w\-.]+\.mixins?\.json)/i)?.[1];
      return { subject: cleanSubject(mod ?? config) };
    },
  },
  {
    id: "apiMismatch",
    severity: "error",
    pattern:
      /(?:NoSuchMethodError|NoSuchFieldError|AbstractMethodError|IncompatibleClassChangeError|NoClassDefFoundError|ClassNotFoundException)(?::\s*['"]?([\w$/.]+))?/,
    strict: true,
    exclude: /Error loading class|was not found .*mixin|@Mixin target|Skipping|optional|soft dependency/i,
    inspect: (line) => {
      if (!/^\s*(?:Caused by:\s*|Exception in thread "[^"]*"\s*)?(?:[\w$]+\.)+[\w$]+(?:Error|Exception)\b/.test(line)) {
        return null;
      }
      const cls = line
        .match(/(?:Error|Exception):\s*'?(?:[\w$[\]<>]+\s+)?([\w$]+(?:[./][\w$]+)+)/)?.[1]
        ?.replace(/\//g, ".");
      if (!cls) return {};
      return { subject: cls.split(".").slice(0, 5).join(".") };
    },
  },
  {
    id: "openglGlfw",
    severity: "error",
    anyLevel: true,
    pattern:
      /Failed to create the GLFW window|Failed to create window|No OpenGL context|Pixel format not accelerated|GLXBadFBConfig|Couldn't set pixel format|Failed to create Display|WGL: The driver does not appear to support OpenGL|OpenGL \d\.\d(?: core)?(?: profile)? (?:is )?not supported|GLFW error 6554[23]|Unable to initiali[sz]e OpenGL|Couldn't initiali[sz]e OpenGL|does not support OpenGL/i,
  },
  {
    id: "nativeCrash",
    severity: "error",
    anyLevel: true,
    pattern:
      /EXCEPTION_ACCESS_VIOLATION|EXCEPTION_STACK_OVERFLOW|\bSIG(?:SEGV|BUS|ILL|ABRT)\b|A fatal error has been detected by the Java Runtime Environment|An error report file with more information is saved as/i,
  },
  {
    id: "diskSpace",
    severity: "error",
    anyLevel: true,
    pattern: /No space left on device|ENOSPC|There is not enough space on the disk|disk (?:is )?full/i,
  },
  {
    id: "accessDenied",
    severity: "warning",
    pattern: /AccessDeniedException|Access is denied|Permission denied|операция не разрешена|Отказано в доступе/i,
    inspect: (line) => ({
      subject: cleanSubject(line.match(/AccessDeniedException:\s*(.+)$/)?.[1]?.split(/[\\/]/).pop()),
    }),
  },
  {
    id: "authFailed",
    severity: "warning",
    pattern:
      /Invalid session|Failed to login:|authentication (?:failed|error)|ForbiddenOperationException|multiplayer\.disconnect\.unverified_username|Not authenticated with Minecraft\.net|UserBannedException/i,
  },
  {
    id: "worldCorruption",
    severity: "warning",
    pattern:
      /Failed to load level|Exception loading world|Couldn't load chunk|Chunk file at .* is (?:corrupt|in the wrong location)|Region file .* (?:corrupt|invalid)|Failed to read chunk|Error loading region|level\.dat.*(?:corrupt|failed)|Unexpected end of ZLIB input stream.*(?:region|chunk)/i,
  },
  {
    id: "shaderCrash",
    severity: "warning",
    pattern:
      /Failed to (?:load|compile|link) (?:shader|program)|Shader compilation failed|Couldn't compile (?:shader|program)|Iris (?:has )?crashed|Failed to load shader ?pack/i,
    inspect: (line) => ({ subject: cleanSubject(line.match(/([\w\-. ]+\.zip)/i)?.[1]) }),
  },
  {
    id: "tickingEntity",
    severity: "error",
    anyLevel: true,
    i18nBase: "crashRules.tickingEntity",
    pattern: /Ticking (?:entity|block entity|player|world)|Entity being ticked|Block entity being ticked/i,
    inspect: (line) => ({
      subject: cleanSubject(
        line.match(/Entity Type:\s*([\w:.\-]+)/i)?.[1] ??
          line.match(/Block entity being ticked.*?([\w-]+:[\w/.\-]+)/i)?.[1],
      ),
    }),
  },
  {
    id: "serverWatchdog",
    severity: "error",
    anyLevel: true,
    i18nBase: "crashRules.serverWatchdog",
    pattern:
      /A single server tick took [\d.]+ seconds|ServerHangWatchdog|Considering it to be crashed, server will forcibly shutdown/i,
  },
  {
    id: "stackOverflow",
    severity: "error",
    anyLevel: true,
    i18nBase: "crashRules.stackOverflow",
    pattern: /java\.lang\.StackOverflowError/,
  },
  {
    id: "missingRegistries",
    severity: "error",
    i18nBase: "crashRules.missingRegistries",
    pattern:
      /Missing registry entries|Registry remapping failed|Unidentified mapping from registry|Detected missing registry entries/i,
    inspect: (line) => ({
      subject: cleanSubject(line.match(/\b([a-z][a-z0-9_\-.]*:[a-z][a-z0-9_\-./]*)/)?.[1]),
    }),
  },
  {
    id: "linuxXrandr",
    severity: "error",
    anyLevel: true,
    i18nBase: "crashRules.linuxXrandr",
    pattern: /xrandr: (?:not found|command not found)|Cannot run program "xrandr"|LWJGLException.*XRandR/i,
  },
  {
    id: "optifinePresent",
    severity: "info",
    anyLevel: true,
    hidden: true,
    pattern: /\bOptiFine\b|optifine[\w.\-]*\.jar/i,
  },
  {
    id: "modIncompatible",
    severity: "error",
    generic: true,
    pattern:
      /Incompatible mods? found|Some of your mods are incompatible|ModResolutionException|Mod resolution failed|Mod Loading has failed|ModLoadingException|LoadingFailedException|Failed to load mods|Mod loading error has occurred|Forge Mod Loader has found a problem|FormattedException/i,
  },
  {
    id: "crashReport",
    severity: "error",
    generic: true,
    anyLevel: true,
    pattern:
      /---- Minecraft Crash Report ----|#@!@# Game crashed!|Crash report saved to|Saving crash report to|This crash report has been saved to/i,
  },
  {
    id: "exitCode",
    severity: "error",
    generic: true,
    anyLevel: true,
    pattern: /Process exited with code (?!0\b)\d+|exit(?:ed)? with code (?!0\b)\d+|Exit code: (?!0\b)\d+/i,
  },
];

const MOD_LOADING_CAUSES = new Set([
  "missingDependency",
  "dependencyVersion",
  "duplicateMods",
  "versionMismatch",
  "fabricLoader",
  "forgeVersion",
  "mixinConflict",
  "wrongJava",
  "corruptJar",
  "missingRegistries",
]);

function mergeRules(extra: AnalyzerRule[]): AnalyzerRule[] {
  if (!extra.length) return RULES;
  const byId = new Map(extra.map((r) => [r.id, r]));
  const merged = RULES.map((r) => byId.get(r.id) ?? r);
  const builtinIds = new Set(RULES.map((r) => r.id));
  const added = extra.filter((r) => !builtinIds.has(r.id));
  const firstGeneric = merged.findIndex((r) => r.generic);
  if (firstGeneric < 0) return [...merged, ...added];
  return [...merged.slice(0, firstGeneric), ...added, ...merged.slice(firstGeneric)];
}

const OPTIFINE_CONFLICT_RULE: AnalyzerRule = {
  id: "optifineConflict",
  severity: "error",
  i18nBase: "crashRules.optifineConflict",
  pattern: /(?!)/,
};

const MAX_SUBJECTS = 8;

type HitAccum = {
  count: number;
  sample: string;
  detail?: string;
  fixKey?: string;
  fixVars?: Record<string, string | number>;
  subjects: Set<string>;
  sources: Set<string>;
};

type Accumulator = Map<string, HitAccum>;

function truncateSample(line: string, max = 200): string {
  const trimmed = line.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

const LEVEL_RE = /\/(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\]/;
const STACK_FRAME_RE = /^\s*(?:at\s+[\w$./<>\-]+[.(]|\.\.\.\s*\d+\s+(?:more|common frames omitted))/;
const TIMESTAMP_PREFIX_RE = /^\s*\[[^\]]*\d{2}:\d{2}:\d{2}[^\]]*\]\s*/;
const COMMAND_LINE_RE = /\s-(?:cp|classpath)\s|-Djava\.library\.path=|--accessToken\s/;

function explicitLevel(line: string): LogLevel | null {
  if (line.includes("[STDERR]")) return "warn";
  const m = line.match(LEVEL_RE);
  if (!m) return null;
  const lvl = m[1].toLowerCase();
  return (lvl === "warning" ? "warn" : lvl) as LogLevel;
}

function isQuietLevel(level: LogLevel | null): boolean {
  return level === "info" || level === "debug" || level === "trace";
}

function normalizeForDedupe(line: string): string {
  return line.replace(TIMESTAMP_PREFIX_RE, "").replace(/\s+/g, " ").trim();
}

function recordHit(
  acc: Accumulator,
  ruleId: string,
  sampleLine: string,
  sourceLabel: string,
  extra?: RuleMatch & { detail?: string },
) {
  let hit = acc.get(ruleId);
  if (!hit) {
    hit = {
      count: 0,
      sample: truncateSample(sampleLine),
      subjects: new Set(),
      sources: new Set(),
    };
    acc.set(ruleId, hit);
  }
  hit.count += 1;
  hit.sources.add(sourceLabel);
  if (extra?.subject && hit.subjects.size < MAX_SUBJECTS) {
    hit.subjects.add(truncateSample(extra.subject, 120));
  }
  if (!hit.detail && extra?.detail) hit.detail = extra.detail;
  if (!hit.fixKey && extra?.fixKey) {
    hit.fixKey = extra.fixKey;
    hit.fixVars = extra.fixVars;
  }
}

type ScanState = {
  seenBefore: Set<string>;
  rules: AnalyzerRule[];
};

function scanLines(
  lines: string[],
  sourceLabel: string,
  acc: Accumulator,
  state: ScanState,
  opts: { structuredLog: boolean },
) {
  const seenHere = new Set<string>();
  let level: LogLevel | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    const own = explicitLevel(line);
    if (own) {
      level = own;
    } else if (/^\s*\[/.test(line)) {
      level = null;
    } else if (isQuietLevel(level)) {
      level = null;
    }

    if (STACK_FRAME_RE.test(line) || COMMAND_LINE_RE.test(line)) continue;

    const key = normalizeForDedupe(line);
    seenHere.add(key);
    if (state.seenBefore.has(key)) continue;

    const effective = opts.structuredLog ? level : null;
    for (const rule of state.rules) {
      if (!rule.anyLevel && isQuietLevel(effective)) continue;
      if (rule.strict && (isQuietLevel(effective) || effective === "warn")) continue;
      const m = line.match(rule.pattern);
      if (!m) continue;
      if (rule.exclude?.test(line)) continue;
      const extra = rule.inspect ? rule.inspect(line, m) : {};
      if (extra === null) continue;
      recordHit(acc, rule.id, line, sourceLabel, extra);
    }
  }

  for (const key of seenHere) state.seenBefore.add(key);
}

function extractCrashReportHints(text: string): {
  description?: string;
  suspectedMods?: string;
  exception?: string;
  causedBy?: string;
  modFiles: string[];
  mixinConfigs: string[];
} {
  const description = text.match(/^\s*Description:\s*(.+)$/im)?.[1]?.trim();
  const suspectedInline = text.match(/^\s*Suspected Mods?:\s*(.+)$/im)?.[1]?.trim();
  const suspectedBlock = text
    .match(/^\s*Suspected Mods?:\s*\n((?:[ \t]{2,}.+\n?)+)/im)?.[1]
    ?.split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");
  const suspectedRaw = suspectedInline || suspectedBlock;
  const suspected = suspectedRaw && !/^(?:unknown|none)$/i.test(suspectedRaw) ? suspectedRaw : undefined;

  const exception =
    text.match(/^\s*((?:[\w$]+\.)+[\w$]*(?:Exception|Error|Throwable)(?::\s*.+)?)\s*$/m)?.[1]?.trim() ??
    text.match(/---- Minecraft Crash Report ----[\s\S]*?\n([^\n]+Exception[^\n]*)/i)?.[1]?.trim();

  const causedBy = text.match(/Caused by:\s*([^\n]+)/i)?.[1]?.trim();

  const modFiles = [
    ...new Set(
      [...text.matchAll(/^\s*Mod File:\s*(.+)$/gim)]
        .map((m) => m[1].trim().split(/[\\/]/).pop() ?? "")
        .filter((f) => f && !/^(?:minecraft|forge|neoforge|client|server)[-\w.]*\.jar$/i.test(f)),
    ),
  ].slice(0, 4);

  const head = text.split(/\r?\n/).slice(0, 60).join("\n");
  const mixinConfigs = [
    ...new Set([...head.matchAll(/([\w\-]+)\.mixins?\.json/gi)].map((m) => m[1])),
  ]
    .filter((c) => !/^(?:mixins|minecraft|fabric-[\w-]+-v\d|forge|neoforge)$/i.test(c))
    .slice(0, 4);

  return {
    description: description ? truncateSample(description, 240) : undefined,
    suspectedMods: suspected ? truncateSample(suspected, 240) : undefined,
    exception: exception ? truncateSample(exception, 240) : undefined,
    causedBy: causedBy ? truncateSample(causedBy, 240) : undefined,
    modFiles,
    mixinConfigs,
  };
}

function buildCrashDetail(hints: ReturnType<typeof extractCrashReportHints>): string | undefined {
  const parts: string[] = [];
  if (hints.description) parts.push(hints.description);
  if (hints.exception && hints.exception !== hints.description) parts.push(hints.exception);
  if (hints.causedBy && hints.causedBy !== hints.exception) parts.push(`Caused by: ${hints.causedBy}`);
  return parts.length ? parts.join(" · ") : undefined;
}

function isLikelyCrashReport(text: string): boolean {
  return /---- Minecraft Crash Report ----/i.test(text) || /#@!@# Game crashed!/i.test(text);
}

function analyzeCrashBody(text: string, sourceLabel: string, acc: Accumulator, state: ScanState) {
  const hints = extractCrashReportHints(text);
  const sample =
    hints.description ||
    hints.exception ||
    text.split(/\r?\n/).find((l) => l.trim()) ||
    "Minecraft Crash Report";

  const culprits = [
    ...(hints.suspectedMods ? [hints.suspectedMods] : []),
    ...hints.modFiles,
    ...hints.mixinConfigs,
  ];
  recordHit(acc, "crashReport", sample, sourceLabel, { detail: buildCrashDetail(hints) });
  const crash = acc.get("crashReport");
  for (const c of culprits) {
    if (crash && crash.subjects.size < MAX_SUBJECTS) crash.subjects.add(c);
  }

  if (hints.description && /^Mod loading error has occurred/i.test(hints.description)) {
    recordHit(acc, "modIncompatible", hints.description, sourceLabel);
  }

  scanLines(splitLines(text), sourceLabel, acc, state, { structuredLog: false });
}

function analyzeJvmCrash(text: string, sourceLabel: string, acc: Accumulator, state: ScanState) {
  scanLines(splitLines(text), sourceLabel, acc, state, { structuredLog: false });
  const frame = text.match(/Problematic frame:\s*\r?\n#\s*\w\s+\[([^\]+]+)/i)?.[1]?.trim();
  if (!frame) return;
  const isDriver =
    /atio6axx|atig6|amdx|aticfx|nvoglv|nvd3d|libnvidia|ig\d+icd|igxel|igd\w*|radeonsi|iris_dri|i965|opengl32|lwjgl|glfw/i.test(
      frame,
    );
  const isJvm = /^(?:lib)?jvm\.(?:dll|so|dylib)$/i.test(frame);
  recordHit(acc, "nativeCrash", `Problematic frame: ${frame}`, sourceLabel, {
    subject: frame,
    fixKey: isDriver
      ? "play.console.analyzer.rules.nativeCrash.fixDriver"
      : isJvm
        ? "play.console.analyzer.rules.nativeCrash.fixJvm"
        : undefined,
    fixVars: { module: frame },
  });
}

export function analyzeGameLogs(
  lines: string[],
  diskSources: LogAnalyzerInputSource[] = [],
  extraRules: AnalyzerRule[] = [],
): LogAnalyzerFinding[] {
  const acc: Accumulator = new Map();
  const rules = mergeRules(extraRules);
  const state: ScanState = { seenBefore: new Set(), rules };

  const ordered = [...diskSources].sort((a, b) => rankSource(a) - rankSource(b));
  for (const src of ordered) {
    const text = src.text;
    if (!text.trim()) continue;
    if (src.id.startsWith("jvm")) {
      analyzeJvmCrash(text, src.label, acc, state);
    } else if (src.id.startsWith("crash") || isLikelyCrashReport(text)) {
      analyzeCrashBody(text, src.label, acc, state);
    } else {
      scanLines(splitLines(text), src.label, acc, state, { structuredLog: true });
    }
  }

  if (lines.length) {
    scanLines(lines, "console", acc, state, { structuredLog: true });
  }

  if (!acc.size) return [];

  const optifine = acc.get("optifinePresent");
  const optifineCause = acc.get("mixinConflict") ?? acc.get("apiMismatch");
  if (optifine && optifineCause) {
    acc.set("optifineConflict", {
      count: 1,
      sample: optifineCause.sample,
      subjects: new Set(["OptiFine"]),
      sources: new Set([...optifineCause.sources, ...optifine.sources]),
    });
  }

  const reportable = [...rules, OPTIFINE_CONFLICT_RULE].filter((r) => !r.hidden);
  const specificErrors = reportable
    .filter((r) => !r.generic && r.severity === "error" && acc.has(r.id))
    .map((r) => r.id);
  const hasModLoadingCause = specificErrors.some((id) => MOD_LOADING_CAUSES.has(id));

  const findings: LogAnalyzerFinding[] = [];
  for (const rule of reportable) {
    const hit = acc.get(rule.id);
    if (!hit) continue;
    if (rule.id === "exitCode" && (specificErrors.length > 0 || acc.has("crashReport"))) continue;
    if (rule.id === "modIncompatible" && hasModLoadingCause) continue;
    const base = rule.i18nBase ?? `play.console.analyzer.rules.${rule.id}`;
    findings.push({
      id: rule.id,
      severity: rule.severity,
      titleKey: `${base}.title`,
      fixKey: hit.fixKey ?? `${base}.fix`,
      title: rule.text?.title,
      fix: hit.fixKey ? undefined : rule.text?.fix,
      fixVars: hit.fixVars,
      matchCount: hit.count,
      sample: hit.sample,
      detail: hit.detail,
      subjects: hit.subjects.size ? [...hit.subjects] : undefined,
      sources: [...hit.sources],
    });
  }

  const severityRank: Record<LogAnalyzerSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  const genericIds = new Set(reportable.filter((r) => r.generic).map((r) => r.id));
  findings.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      Number(genericIds.has(a.id)) - Number(genericIds.has(b.id)) ||
      b.matchCount - a.matchCount,
  );

  return findings;
}

function rankSource(src: LogAnalyzerInputSource): number {
  if (src.id.startsWith("jvm")) return 0;
  if (src.id.startsWith("crash")) return 1;
  return 2;
}
