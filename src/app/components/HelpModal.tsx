import { openUrl } from "@tauri-apps/plugin-opener";
import { DISCORD_LINK } from "../notifications";
import { modKeyLabel } from "../../lib/hotkeyKey";
import type { Tt } from "../types";

type Props = {
  tt: Tt;
  onClose: () => void;
  onReplayTour: () => void;
};

export function HelpModal({ tt, onClose, onReplayTour }: Props) {
  return (
    <div
      className="glass-overlay pointer-events-auto fixed inset-0 z-[300] flex items-center justify-center"
      onClick={() => onClose()}
    >
      <div
        className="glass-modal w-[min(90vw,28rem)] max-h-[85vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <img src="/launcher-assets/help.png" alt="" className="h-8 w-8 object-contain opacity-90" />
          <h2 className="text-base font-semibold text-white">{tt("app.help.title")}</h2>
        </div>
        <div className="space-y-4 text-sm text-white/90 leading-relaxed">
          <p>{tt("app.help.mainInfo")}</p>
          <p>{tt("app.help.paletteHint", { keys: `${modKeyLabel()}+K` })}</p>
          <p>
            {tt("app.help.icons")}{" "}
            <button
              type="button"
              className="text-warn-line hover:text-warn-hi underline bg-transparent border-none cursor-pointer p-0 font-inherit text-inherit"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await openUrl("https://icons8.ru/icons");
                } catch (err) {
                  console.error("Failed to open link:", err);
                }
              }}
            >
              icons8.ru
            </button>
          </p>
          <p className="text-xs text-white/70 whitespace-pre-line">
            {tt("app.help.mojangDisclaimer")}
          </p>
          <p className="text-white/80">
            {tt("app.help.apis")}
          </p>
          <p>
            <button
              type="button"
              className="text-warn-line hover:text-warn-hi underline bg-transparent border-none cursor-pointer p-0 font-inherit text-inherit"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await openUrl(DISCORD_LINK);
                } catch (err) {
                  console.error("Failed to open link:", err);
                }
              }}
            >
              {tt("app.help.reportBug")}
            </button>
          </p>
        </div>
        <div className="mt-5 flex flex-col items-stretch gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => {
              onClose();
              onReplayTour();
            }}
            className="interactive-press rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/12"
          >
            {tt("productTour.replay")}
          </button>
          <button
            type="button"
            onClick={() => onClose()}
            className="interactive-press rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
          >
            {tt("app.help.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
