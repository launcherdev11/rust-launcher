import { convertFileSrc } from "@tauri-apps/api/core";
import type { ThemeVariables } from "../../lib/customTheme";

type Props = {
  name: string;
  subtitle?: string;
  title?: string;
  selected: boolean;
  disabled?: boolean;
  /** Absolute path to preview.png; without one the card draws a mock-up from the theme's colours. */
  preview?: string | null;
  variables?: ThemeVariables;
  accentColor: string;
  onClick: () => void;
};

export function ThemeCard({
  name,
  subtitle,
  title,
  selected,
  disabled,
  preview,
  variables = {},
  accentColor,
  onClick,
}: Props) {
  const ink0 = variables["--ink-0"] || "#0b0910";
  const ink1 = variables["--ink-1"] || "#14111b";
  const fg = variables["--fg"] || "#eee9f6";
  const accent = variables["--accent-color"] || accentColor;
  const radius = variables["--r-card"] || "6px";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={selected}
      className={`interactive-press flex min-w-0 flex-col overflow-hidden rounded-2xl border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "seg-on border-transparent"
          : "border-white/10 bg-black/25 hover:border-white/20 hover:bg-black/40"
      }`}
    >
      <div className="relative h-16 w-full overflow-hidden" style={{ background: ink0 }}>
        {preview ? (
          <img
            src={convertFileSrc(preview)}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className="absolute inset-x-3 bottom-0 top-3 flex flex-col gap-1.5 p-2"
            style={{ background: ink1, borderTopLeftRadius: radius, borderTopRightRadius: radius }}
            aria-hidden="true"
          >
            <span className="h-1.5 w-2/3 rounded-full opacity-80" style={{ background: fg }} />
            <span className="h-1.5 w-1/3 rounded-full opacity-40" style={{ background: fg }} />
            <span className="mt-auto h-2.5 w-10 rounded" style={{ background: accent }} />
          </div>
        )}
      </div>
      <div className="min-w-0 px-3 py-2">
        <div className="truncate text-xs font-semibold text-white">{name}</div>
        {subtitle ? <div className="truncate text-[0.6875rem] text-white/50">{subtitle}</div> : null}
      </div>
    </button>
  );
}
