import { AssetIcon } from "./asset_icon";
import { accentTweenStyle } from "../tabs/settings/accentColor";

const NAV_ICONS = ["play", "mods", "modpack_icon", "room", "settings"];

const PROFILE_INITIALS = ["S", "C", "V", "R"];
const SELECTED_PROFILE = 1;

type Props = {
  color: string;
  playLabel: string;
  className?: string;
};

export function AccentPreview({ color, playLabel, className = "h-36" }: Props) {
  return (
    <div
      className={`accent-tween relative w-full select-none overflow-hidden rounded-xl border border-[var(--seam)] ${className}`}
      style={accentTweenStyle(color)}
      aria-hidden
    >
      <div className="launcher-gradient">
        <span className="launcher-gradient-sheen" />
      </div>

      <div className="relative flex h-full gap-1.5 p-1.5">
        <div className="flex w-[24%] max-w-[6.5rem] shrink-0 flex-col gap-0.5 rounded-lg border border-[var(--shell-line)] bg-[var(--shell-surface)] p-1">
          <div className="mb-0.5 flex items-center gap-1 rounded-md border border-[var(--shell-line)] bg-[var(--ink-2)] p-1">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px] bg-white/25" />
            <span className="h-1 flex-1 rounded-full bg-white/35" />
          </div>
          {NAV_ICONS.map((name, i) => (
            <div
              key={name}
              className={`relative flex max-h-5 min-h-0 flex-1 items-center gap-1 rounded-md px-1 ${
                i === 0
                  ? "bg-[var(--ink-3)] text-white shadow-[inset_0_0_0_1px_var(--seam)]"
                  : "text-white/35"
              }`}
            >
              <AssetIcon name={name} className="h-2.5 w-2.5" />
              <span className={`h-[3px] w-[55%] rounded-full ${i === 0 ? "bg-white/70" : "bg-white/15"}`} />
              {i === 0 && (
                <span className="absolute bottom-0.5 right-0 top-0.5 w-[2px] rounded-full bg-[linear-gradient(180deg,var(--accent-to),var(--accent-from))]" />
              )}
            </div>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="h-1 w-12 rounded-full bg-white/40" />
            <span className="h-1 w-6 rounded-full bg-white/15" />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1">
            {PROFILE_INITIALS.map((initial, i) => {
              const selected = i === SELECTED_PROFILE;
              return (
                <div
                  key={initial}
                  className={`flex min-h-0 items-center gap-1.5 rounded-lg border px-1.5 ${
                    selected
                      ? "border-[var(--accent-line)] bg-[var(--ink-2)]"
                      : "border-[var(--shell-line)] bg-[var(--shell-surface)]"
                  }`}
                >
                  <span className="flex aspect-square h-[62%] max-h-7 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/15 text-[0.5625rem] font-bold text-white">
                    {initial}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="h-1 w-[70%] rounded-full bg-white/50" />
                    <span className="h-[3px] w-[45%] rounded-full bg-white/20" />
                  </span>
                </div>
              );
            })}
          </div>

          <div className="relative flex items-center gap-1.5 overflow-hidden rounded-lg border border-[var(--shell-line)] bg-[var(--shell-surface)] p-1">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/15 text-[0.5rem] font-bold text-white">
              {PROFILE_INITIALS[SELECTED_PROFILE]}
            </span>
            <span className="h-3 w-9 rounded-[4px] border border-[var(--seam)] bg-black/30" />
            <span className="h-3 w-7 rounded-[4px] border border-[var(--seam)] bg-black/30" />
            <span className="accent-bg ml-auto rounded-md px-2.5 py-1 text-[0.5625rem] font-bold leading-none">
              {playLabel}
            </span>
            <span className="absolute inset-x-2 bottom-0 h-[2px] overflow-hidden rounded-full bg-white/10">
              <span className="progress-fill block h-full w-[58%] rounded-full" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
