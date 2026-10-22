export type LogAnalyzerSeverity = "error" | "warning" | "info";

export type LogAnalyzerFinding = {
  id: string;
  severity: LogAnalyzerSeverity;
  titleKey: string;
  fixKey: string;
  matchCount: number;
  sample?: string;
  detail?: string;
  sources?: string[];
};

export type LogAnalyzerInputSource = {
  id: string;
  label: string;
  text: string;
};

type AnalyzerRule = {
  id: string;
  severity: LogAnalyzerSeverity;
  pattern: RegExp;
};

const RULES: AnalyzerRule[] = [
  {
    id: "oom",
    severity: "error",
    pattern: /OutOfMemoryError|Java heap space|GC overhead limit exceeded|Metaspace/i,
  },
  {
    id: "wrongJava",
    severity: "error",
    pattern:
      /UnsupportedClassVersionError|class file version|has been compiled by a more recent version of the Java Runtime|Unsupported Java detected|This Java version is unrecognized|Unsupported class file major version/i,
  },
  {
    id: "mixinConflict",
    severity: "error",
    pattern:
      /Mixin apply failed|mixin\.injection|Critical injection failure|MixinPrepareError|MixinTransformerError|@Mixin\([^)]+\).*failed|Unable to apply mixin|Mixin apply for callback/i,
  },
  {
    id: "modIncompatible",
    severity: "error",
    pattern:
      /Incompatible mods? found|ModResolutionException|failed to load mod|Duplicate Mods Found|Mod Loading has failed|net\.minecraftforge\.fml\.ModLoadingException|LoaderException|ModLoadingException|Failed to load mods/i,
  },
  {
    id: "missingDependency",
    severity: "error",
    pattern:
      /missing (required )?mod|requires? .+ (of|version)|Mod .+ requires|dependency .+ (was not found|is missing)|No providers? available|Mod .+ is missing|requires .+ which is missing/i,
  },
  {
    id: "versionMismatch",
    severity: "error",
    pattern:
      /version mismatch|was designed for (Minecraft|version)|mod was made for|requires Minecraft|needs Minecraft|incompatible with (Minecraft|game version)/i,
  },
  {
    id: "corruptJar",
    severity: "error",
    pattern:
      /Invalid or corrupt jarfile|zip END header not found|Error opening zip file|ZipException|truncated ZIP|Unexpected end of ZLIB|Error reading zip|Not a valid zip/i,
  },
  {
    id: "openglGlfw",
    severity: "error",
    pattern:
      /GLFW error|Failed to create the GLFW window|Failed to create window|No OpenGL context|Pixel format not accelerated|GLXBadFBConfig|Couldn't set pixel format|Failed to create Display|lwjgl\.opengl/i,
  },
  {
    id: "authFailed",
    severity: "error",
    pattern:
      /Invalid session|Failed to login|authentication (failed|error)|Not authenticated|ForbiddenOperationException|multiplayer\.disconnect\.unverified_username|Invalid token/i,
  },
  {
    id: "exitCode",
    severity: "error",
    pattern: /Process exited with code (?!0\b)\d+|exit(?:ed)? with code (?!0\b)\d+|Exit code: (?!0\b)\d+/i,
  },
  {
    id: "diskSpace",
    severity: "error",
    pattern: /No space left on device|ENOSPC|not enough space|disk (is )?full/i,
  },
  {
    id: "accessDenied",
    severity: "warning",
    pattern: /Access is denied|Permission denied|AccessDeniedException|операция не разрешена/i,
  },
  {
    id: "nativeCrash",
    severity: "error",
    pattern:
      /EXCEPTION_ACCESS_VIOLATION|SIGSEGV|SIGABRT|hs_err_pid|Problematic frame:|# Problematic frame|A fatal error has been detected by the Java Runtime Environment/i,
  },
  {
    id: "fabricLoader",
    severity: "error",
    pattern:
      /Incompatible Fabric Loader|needs Fabric Loader|requires Fabric API|Fabric Loader \d|net\.fabricmc\.loader\.impl\.FormattedException/i,
  },
  {
    id: "forgeVersion",
    severity: "error",
    pattern:
      /Forge Mod Loader has found a problem|missing or wrong version of Forge|requires Forge|NeoForge.*incompatible|requires NeoForge/i,
  },
  {
    id: "crashReport",
    severity: "error",
    pattern:
      /---- Minecraft Crash Report ----|#@!@# Game crashed!|Crash report saved to|Saving crash report to/i,
  },
  {
    id: "worldCorruption",
    severity: "error",
    pattern:
      /Failed to load level|Exception loading world|Chunk.*(?:corrupt|failed)|Region file.*(?:corrupt|invalid)|Unexpected end of ZLIB input stream.*region/i,
  },
  {
    id: "shaderCrash",
    severity: "error",
    pattern:
      /Shader.*(?:error|failed|compile)|Iris.*(?:crash|error)|Failed to (?:load|compile) shader|sodium.*crash/i,
  },
];

type HitAccum = {
  count: number;
  sample: string;
  detail?: string;
  sources: Set<string>;
};

function truncateSample(line: string, max = 200): string {
  const trimmed = line.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function extractCrashReportHints(text: string): {
  description?: string;
  suspectedMods?: string;
  exception?: string;
  causedBy?: string;
} {
  const description = text.match(/^\s*Description:\s*(.+)$/im)?.[1]?.trim();
  const suspected =
    text.match(/^\s*Suspected Mods:\s*(.+)$/im)?.[1]?.trim() ??
    text.match(/^\s*Suspected Mods:\s*\n((?:\s{2,}.+\n?)+)/im)?.[1]
      ?.split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 8)
      .join(", ");

  const exception =
    text.match(
      /^\s*([a-zA-Z0-9_.$]*(?:Exception|Error|Throwable)(?::\s*.+)?)\s*$/m,
    )?.[1]?.trim() ??
    text.match(/---- Minecraft Crash Report ----[\s\S]*?\n([^\n]+Exception[^\n]*)/i)?.[1]?.trim();

  const causedBy = text
    .match(/Caused by:\s*([^\n]+)/i)?.[1]
    ?.trim();

  return {
    description: description ? truncateSample(description, 240) : undefined,
    suspectedMods: suspected ? truncateSample(suspected, 240) : undefined,
    exception: exception ? truncateSample(exception, 240) : undefined,
    causedBy: causedBy ? truncateSample(causedBy, 240) : undefined,
  };
}

function buildCrashDetail(hints: ReturnType<typeof extractCrashReportHints>): string | undefined {
  const parts: string[] = [];
  if (hints.description) parts.push(hints.description);
  if (hints.exception && hints.exception !== hints.description) parts.push(hints.exception);
  if (hints.causedBy) parts.push(`Caused by: ${hints.causedBy}`);
  if (hints.suspectedMods) parts.push(`Mods: ${hints.suspectedMods}`);
  return parts.length ? parts.join(" · ") : undefined;
}

function isLikelyCrashReport(text: string): boolean {
  return (
    /---- Minecraft Crash Report ----/i.test(text) ||
    /^\s*Description:\s+/im.test(text) ||
    /#@!@# Game crashed!/i.test(text)
  );
}

function recordHit(
  counts: Map<string, HitAccum>,
  ruleId: string,
  sampleLine: string,
  sourceLabel: string,
  detail?: string,
) {
  const prev = counts.get(ruleId);
  if (prev) {
    prev.count += 1;
    prev.sources.add(sourceLabel);
    if (!prev.detail && detail) prev.detail = detail;
  } else {
    counts.set(ruleId, {
      count: 1,
      sample: truncateSample(sampleLine),
      detail,
      sources: new Set([sourceLabel]),
    });
  }
}

function scanLines(
  lines: string[],
  sourceLabel: string,
  counts: Map<string, HitAccum>,
) {
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue;
      recordHit(counts, rule.id, line, sourceLabel);
    }
  }
}

function analyzeCrashBody(
  text: string,
  sourceLabel: string,
  counts: Map<string, HitAccum>,
) {
  const hints = extractCrashReportHints(text);
  const detail = buildCrashDetail(hints);
  const sample =
    hints.description ||
    hints.exception ||
    text.split(/\r?\n/).find((l) => l.trim()) ||
    "Minecraft Crash Report";

  recordHit(counts, "crashReport", sample, sourceLabel, detail);

  // Also run normal rules on crash body — often has the real exception.
  scanLines(splitLines(text), sourceLabel, counts);

  // Heuristic: mixin / mod load often appear only in crash Description.
  if (hints.description) {
    if (/mixin|injection/i.test(hints.description)) {
      recordHit(counts, "mixinConflict", hints.description, sourceLabel, detail);
    }
    if (/mod|incompatible|loading/i.test(hints.description)) {
      recordHit(counts, "modIncompatible", hints.description, sourceLabel, detail);
    }
    if (/OutOfMemory|heap space/i.test(hints.description)) {
      recordHit(counts, "oom", hints.description, sourceLabel, detail);
    }
    if (/OpenGL|GLFW|graphics|render/i.test(hints.description)) {
      recordHit(counts, "openglGlfw", hints.description, sourceLabel, detail);
    }
  }
}

export function analyzeGameLogs(
  lines: string[],
  diskSources: LogAnalyzerInputSource[] = [],
): LogAnalyzerFinding[] {
  const counts = new Map<string, HitAccum>();

  if (lines.length) {
    scanLines(lines, "console", counts);
  }

  for (const src of diskSources) {
    const text = src.text;
    if (!text.trim()) continue;
    if (isLikelyCrashReport(text) || src.id.startsWith("crash")) {
      analyzeCrashBody(text, src.label, counts);
    } else {
      scanLines(splitLines(text), src.label, counts);
    }
  }

  if (!counts.size) return [];

  const findings: LogAnalyzerFinding[] = [];
  for (const rule of RULES) {
    const hit = counts.get(rule.id);
    if (!hit) continue;
    // Don't surface generic "exit code" if we already have a concrete crash.
    if (rule.id === "exitCode" && counts.has("crashReport")) continue;
    findings.push({
      id: rule.id,
      severity: rule.severity,
      titleKey: `play.console.analyzer.rules.${rule.id}.title`,
      fixKey: `play.console.analyzer.rules.${rule.id}.fix`,
      matchCount: hit.count,
      sample: hit.sample,
      detail: hit.detail,
      sources: [...hit.sources],
    });
  }

  const severityRank: Record<LogAnalyzerSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  };
  findings.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      b.matchCount - a.matchCount,
  );

  return findings;
}
