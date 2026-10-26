import { convertFileSrc } from "@tauri-apps/api/core";
import { accentTraits } from "../tabs/settings/accentColor";

export type ThemeVariables = Record<string, string>;

export type ThemeInfo = {
  id: string;
  name: string;
  author: string;
  description: string;
  version: string;
  variables: ThemeVariables;
  preview: string | null;
};

export type ThemeDetails = ThemeInfo & {
  css: string;
  dir: string;
};

export const THEME_CHANGED_EVENT = "custom-theme-changed";
export const THEME_RELOAD_EVENT = "16l:custom-theme-reload";

const THEME_STYLE_ID = "custom-theme-style";
const ACCENT_STYLE_ID = "launcher-accent-style";

const VARIABLE_NAME_RE = /^--[A-Za-z0-9_-]+$/;

export function isValidVariableName(name: string): boolean {
  return VARIABLE_NAME_RE.test(name.trim());
}

export function isValidVariableValue(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && v.length <= 1024 && !/[{};]/.test(v);
}

export function cleanVariables(variables: ThemeVariables): ThemeVariables {
  const out: ThemeVariables = {};
  for (const [name, value] of Object.entries(variables)) {
    if (isValidVariableName(name) && isValidVariableValue(value)) {
      out[name.trim()] = value.trim();
    }
  }
  return out;
}

function rewriteThemeUrls(css: string, themeDir: string): string {
  const separator = themeDir.includes("\\") ? "\\" : "/";
  return css.replace(
    /url\(\s*(['"]?)(?!data:|https?:|asset:|blob:|#)(.*?)\1\s*\)/g,
    (match, _quote: string, path: string) => {
      if (!path || path.trim() === "") return match;
      const absolutePath = themeDir + separator + path.trim().replace(/[\\/]/g, separator);
      return `url("${convertFileSrc(absolutePath)}")`;
    },
  );
}

export function buildThemeStylesheet(theme: {
  css: string;
  dir: string;
  variables: ThemeVariables;
}): string {
  const vars = Object.entries(cleanVariables(theme.variables));
  const root = vars.length
    ? `:root {\n${vars.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n\n`
    : "";
  return rewriteThemeUrls(root + theme.css, theme.dir);
}

function upsertStyle(id: string, text: string, before?: HTMLElement | null) {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    if (before && before.parentNode === document.head) {
      document.head.insertBefore(el, before);
    } else {
      document.head.appendChild(el);
    }
  }
  if (el.textContent !== text) el.textContent = text;
}

export function applyAccentColor(color: string) {
  const { neutral, light } = accentTraits(color);
  upsertStyle(
    ACCENT_STYLE_ID,
    `:root {\n  --accent-color: ${color};\n  --on-accent: ${light ? "#0d0d10" : "#ffffff"};\n}\n`,
    document.getElementById(THEME_STYLE_ID),
  );
  const root = document.documentElement;
  if (neutral) root.dataset.accentNeutral = "";
  else delete root.dataset.accentNeutral;
  if (light) root.dataset.accentLight = "";
  else delete root.dataset.accentLight;
}

let previewActive = false;

function writeThemeStyle(text: string | null, themeId: string | null) {
  const root = document.documentElement;
  if (text == null) {
    document.getElementById(THEME_STYLE_ID)?.remove();
    delete root.dataset.customTheme;
    return;
  }
  upsertStyle(THEME_STYLE_ID, text);
  if (themeId) root.dataset.customTheme = themeId;
}

export function applySavedTheme(text: string | null, themeId: string | null) {
  if (previewActive) return;
  writeThemeStyle(text, themeId);
}

export function applyThemePreview(text: string, themeId: string) {
  previewActive = true;
  writeThemeStyle(text, themeId);
}

export function clearThemePreview() {
  if (!previewActive) return;
  previewActive = false;
  requestThemeReload();
}

export function requestThemeReload() {
  window.dispatchEvent(new Event(THEME_RELOAD_EVENT));
}

export type CssProblem = { line: number; kind: "unclosedBrace" | "extraBrace" | "unclosedComment" | "unclosedString" };

export function findCssProblem(css: string): CssProblem | null {
  const open: number[] = [];
  let line = 1;
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      const start = line;
      const end = css.indexOf("*/", i + 2);
      if (end === -1) return { line: start, kind: "unclosedComment" };
      line += (css.slice(i, end).match(/\n/g) ?? []).length;
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = line;
      let j = i + 1;
      while (j < css.length && css[j] !== ch) {
        if (css[j] === "\\") j++;
        else if (css[j] === "\n") return { line: start, kind: "unclosedString" };
        j++;
      }
      if (j >= css.length) return { line: start, kind: "unclosedString" };
      i = j + 1;
      continue;
    }
    if (ch === "{") open.push(line);
    if (ch === "}") {
      if (!open.length) return { line, kind: "extraBrace" };
      open.pop();
    }
    i++;
  }
  return open.length ? { line: open[open.length - 1], kind: "unclosedBrace" } : null;
}

export function errorMessage(e: unknown, fallback: string): string {
  if (typeof e === "string" && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

export type ThemeVariableKind = "color" | "length" | "font" | "image" | "text";

export type ThemeVariableDef = {
  name: string;
  kind: ThemeVariableKind;
  fallback: string;
  max?: number;
};

export type ThemeVariableGroup = {
  id: "accent" | "surfaces" | "text" | "radius" | "font" | "background";
  vars: ThemeVariableDef[];
};

export const THEME_VARIABLE_GROUPS: ThemeVariableGroup[] = [
  {
    id: "accent",
    vars: [
      { name: "--accent-color", kind: "color", fallback: "" },
      { name: "--accent-from", kind: "color", fallback: "" },
      { name: "--accent-to", kind: "color", fallback: "" },
      { name: "--accent-hi", kind: "color", fallback: "" },
    ],
  },
  {
    id: "surfaces",
    vars: [
      { name: "--ink-0", kind: "color", fallback: "#0a0a0b" },
      { name: "--ink-1", kind: "color", fallback: "#121214" },
      { name: "--ink-2", kind: "color", fallback: "#19191c" },
      { name: "--ink-3", kind: "color", fallback: "#222226" },
      { name: "--ink-4", kind: "color", fallback: "#2b2b30" },
      { name: "--glass-bg", kind: "color", fallback: "rgba(18, 18, 20, 0.9)" },
      { name: "--glass-bg-strong", kind: "color", fallback: "rgba(14, 14, 16, 0.97)" },
      { name: "--glass-bg-popover", kind: "color", fallback: "#151517" },
      { name: "--seam", kind: "color", fallback: "rgba(255, 255, 255, 0.09)" },
      { name: "--seam-strong", kind: "color", fallback: "rgba(255, 255, 255, 0.16)" },
    ],
  },
  {
    id: "text",
    vars: [
      { name: "--fg", kind: "color", fallback: "#f1f1f3" },
      { name: "--fg-muted", kind: "color", fallback: "#a1a1aa" },
      { name: "--fg-faint", kind: "color", fallback: "#71717a" },
    ],
  },
  {
    id: "radius",
    vars: [
      { name: "--r-badge", kind: "length", fallback: "6px", max: 16 },
      { name: "--r-control", kind: "length", fallback: "10px", max: 24 },
      { name: "--r-card", kind: "length", fallback: "14px", max: 32 },
      { name: "--r-panel", kind: "length", fallback: "18px", max: 40 },
    ],
  },
  {
    id: "font",
    vars: [
      {
        name: "--font-sans",
        kind: "font",
        fallback: '"Onest Variable", "Onest", "Segoe UI", system-ui, sans-serif',
      },
    ],
  },
  {
    id: "background",
    vars: [{ name: "--launcher-bg-image", kind: "image", fallback: "none" }],
  },
];

export const KNOWN_THEME_VARIABLES = new Set(
  THEME_VARIABLE_GROUPS.flatMap((g) => g.vars.map((v) => v.name)),
);

export function toHexColor(value: string): string | null {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  }
  return null;
}

export function lengthToPx(value: string): number | null {
  const m = value.trim().match(/^(-?\d*\.?\d+)(px|rem)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "rem" ? n * 16 : n;
}

export type ThemeSnippet = {
  id: "panelBorder" | "tabScope" | "background" | "font" | "hideGrain" | "glass" | "navActive";
  css: string;
};

export const THEME_SNIPPETS: ThemeSnippet[] = [
  {
    id: "panelBorder",
    css: `.glass-panel,
.glass-modal {
  border-color: var(--accent-line);
}
`,
  },
  {
    id: "navActive",
    css: `.nav-item-active {
  color: var(--accent-hi);
}
`,
  },
  {
    id: "glass",
    css: `:root {
  --glass-bg: rgba(18, 18, 20, 0.55);
  --glass-bg-strong: rgba(14, 14, 16, 0.8);
}

.glass-panel,
.glass-modal {
  backdrop-filter: blur(14px) saturate(1.2);
}
`,
  },
  {
    id: "background",
    css: `/* Фон окна, когда в настройках не выбрано своё изображение */
:root {
  --launcher-bg-image: url(assets/background.jpg);
}
`,
  },
  {
    id: "tabScope",
    css: `/* Только на вкладке «Играть»: play, modpacks, mods, accounts, friends, rooms, settings */
[data-launcher-tab="play"] .launcher-gradient {
  filter: saturate(1.3);
}
`,
  },
  {
    id: "font",
    css: `@font-face {
  font-family: "MyFont";
  src: url(fonts/MyFont.woff2) format("woff2");
  font-display: swap;
}

:root {
  --font-sans: "MyFont", "Onest Variable", sans-serif;
}
`,
  },
  {
    id: "hideGrain",
    css: `.launcher-gradient-grain {
  display: none;
}
`,
  },
];
