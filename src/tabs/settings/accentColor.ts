import type { CSSProperties } from "react";

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: h * 360, s: s * 100, v: v * 100 };
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  v = Math.max(0, Math.min(100, v)) / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) {
    rp = c;
    gp = x;
  } else if (h < 120) {
    rp = x;
    gp = c;
  } else if (h < 180) {
    gp = c;
    bp = x;
  } else if (h < 240) {
    gp = x;
    bp = c;
  } else if (h < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

export function hexWithHueFromWheel(baseHex: string, hueDeg: number): string {
  const rgb = hexToRgb(baseHex);
  if (!rgb) return baseHex;
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const next = hsvToRgb(hueDeg, hsv.s, hsv.v);
  return rgbToHex(next.r, next.g, next.b);
}

export function hueDegFromWheelClientPos(el: HTMLElement, clientX: number, clientY: number): number | null {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 4) return null;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (angleDeg + 90 + 360) % 360;
}

export const ACCENT_WHITE = "#ffffff";
export const ACCENT_VIOLET = "#4a22a8";
export const DEFAULT_ACCENT_COLOR = ACCENT_WHITE;

export function accentTraits(hex: string): { neutral: boolean; light: boolean } {
  const rgb = hexToRgb(hex);
  if (!rgb) return { neutral: false, light: false };
  const { s } = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  return { neutral: s < 12, light: luminance > 0.55 };
}

export type AccentPreset = { id: string; hex: string };

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "white", hex: "#ffffff" },
  { id: "graphite", hex: "#9ca3af" },
  { id: "amethyst", hex: "#4a22a8" },
  { id: "violet", hex: "#7c3aed" },
  { id: "lavender", hex: "#a78bfa" },
  { id: "indigo", hex: "#4f46e5" },
  { id: "cobalt", hex: "#2563eb" },
  { id: "sky", hex: "#0ea5e9" },
  { id: "cyan", hex: "#0891b2" },
  { id: "teal", hex: "#0d9488" },
  { id: "emerald", hex: "#16a34a" },
  { id: "lime", hex: "#65a30d" },
  { id: "amber", hex: "#ca8a04" },
  { id: "orange", hex: "#ea580c" },
  { id: "scarlet", hex: "#dc2626" },
  { id: "raspberry", hex: "#e11d48" },
  { id: "pink", hex: "#db2777" },
  { id: "orchid", hex: "#c026d3" },
];

export function findAccentPreset(hex: string): AccentPreset | undefined {
  const needle = hex.trim().toLowerCase();
  return ACCENT_PRESETS.find((preset) => preset.hex === needle);
}

export function accentTweenStyle(hex: string): CSSProperties {
  return { "--accent-tween": hex, "--accent-color": "var(--accent-tween)" } as CSSProperties;
}

export const ACCENT_HUE_RING_STYLE: CSSProperties = {
  backgroundImage: `conic-gradient(from 0deg, ${Array.from({ length: 72 }, (_, i) => {
    const h = (i * 360) / 72;
    return `hsl(${h} 95% 52%)`;
  }).join(", ")})`,
};
