export type ConfigFormat = "toml" | "json" | "properties" | "yaml" | "snbt" | "text";

export type TokenKind = "comment" | "key" | "string" | "number" | "bool" | "section" | "punct" | "plain";

export type Token = { text: string; kind: TokenKind };

export function formatFromPath(path: string): ConfigFormat {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "toml":
      return "toml";
    case "json":
    case "json5":
    case "jsonc":
    case "mcmeta":
      return "json";
    case "properties":
    case "cfg":
    case "conf":
    case "ini":
      return "properties";
    case "yaml":
    case "yml":
      return "yaml";
    case "snbt":
      return "snbt";
    default:
      return /(^|\/)options[\w]*\.txt$/.test(path.toLowerCase()) ? "properties" : "text";
  }
}

export const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: "text-white/35 italic",
  key: "text-accent-hi",
  string: "text-emerald-200/90",
  number: "text-amber-200/90",
  bool: "text-sky-200/90",
  section: "text-white font-semibold",
  punct: "text-white/45",
  plain: "text-white/85",
};

const VALUE_RE =
  /("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)|(-?\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[bBsSlLfFdD]?\b)|\b(true|false|null|on|off|yes|no)\b|([{}[\],:=])/g;

function tokenizeValue(text: string, out: Token[]) {
  let last = 0;
  VALUE_RE.lastIndex = 0;
  for (let m = VALUE_RE.exec(text); m; m = VALUE_RE.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), kind: "plain" });
    const kind: TokenKind = m[1] ? "string" : m[2] ? "number" : m[3] ? "bool" : "punct";
    out.push({ text: m[0], kind });
    last = m.index + m[0].length;
    if (m[0].length === 0) VALUE_RE.lastIndex++;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: "plain" });
}

function commentStart(line: string, markers: string[]): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    for (const m of markers) {
      if (line.startsWith(m, i)) return i;
    }
  }
  return -1;
}

function withComment(line: string, markers: string[], body: (part: string, out: Token[]) => void): Token[] {
  const out: Token[] = [];
  const c = commentStart(line, markers);
  body(c >= 0 ? line.slice(0, c) : line, out);
  if (c >= 0) out.push({ text: line.slice(c), kind: "comment" });
  return out;
}

function keyValue(part: string, out: Token[], separators: RegExp) {
  const m = part.match(separators);
  if (!m || m.index === undefined) {
    tokenizeValue(part, out);
    return;
  }
  const keyEnd = m.index;
  const key = part.slice(0, keyEnd);
  if (key.trim()) out.push({ text: key, kind: "key" });
  else if (key) out.push({ text: key, kind: "plain" });
  out.push({ text: m[0], kind: "punct" });
  tokenizeValue(part.slice(keyEnd + m[0].length), out);
}

export function tokenizeLine(line: string, format: ConfigFormat): Token[] {
  switch (format) {
    case "toml":
      return withComment(line, ["#"], (part, out) => {
        if (/^\s*\[\[?[^\]]*\]\]?\s*$/.test(part)) out.push({ text: part, kind: "section" });
        else keyValue(part, out, /\s*=\s*/);
      });
    case "properties":
      if (/^\s*[#;!]/.test(line)) return [{ text: line, kind: "comment" }];
      if (/^\s*\[[^\]]*\]\s*$/.test(line)) return [{ text: line, kind: "section" }];
      return withComment(line, [], (part, out) => keyValue(part, out, /\s*[=:]\s*/));
    case "yaml":
      return withComment(line, ["#"], (part, out) => keyValue(part, out, /:\s+|:$/));
    case "json":
    case "snbt":
      return withComment(line, ["//"], (part, out) => {
        const m = part.match(/^(\s*)("(?:[^"\\]|\\.)*"|[\w.\-+]+)(\s*:)/);
        if (m) {
          if (m[1]) out.push({ text: m[1], kind: "plain" });
          out.push({ text: m[2], kind: "key" });
          out.push({ text: m[3], kind: "punct" });
          tokenizeValue(part.slice(m[0].length), out);
        } else {
          tokenizeValue(part, out);
        }
      });
    default:
      return [{ text: line, kind: "plain" }];
  }
}

export type JsonProblem = { line: number; message: string };

export function checkJson(text: string): JsonProblem | null {
  if (!text.trim()) return null;
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const pos = Number(message.match(/position (\d+)/)?.[1]);
    const lineFromPos = Number.isFinite(pos) ? text.slice(0, pos).split("\n").length : NaN;
    const lineDirect = Number(message.match(/line (\d+)/)?.[1]);
    const line = Number.isFinite(lineDirect) ? lineDirect : Number.isFinite(lineFromPos) ? lineFromPos : 1;
    return { line, message };
  }
}
