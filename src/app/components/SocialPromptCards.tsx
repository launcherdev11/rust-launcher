import type { Dispatch, SetStateAction } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  DISCORD_LINK,
  TELEGRAM_LINK,
  splitTitleAndSubtitle,
  type BottomSocialNotification,
} from "../notifications";
import type { Tt } from "../types";
import { SocialIcon } from "./SocialIcon";

type Props = {
  items: BottomSocialNotification[];
  setItems: Dispatch<SetStateAction<BottomSocialNotification[]>>;
  tt: Tt;
};

export function SocialPromptCards({ items, setItems, tt }: Props) {
  return (
    <div className="pointer-events-auto fixed bottom-6 right-6 z-50 flex w-[360px] flex-col gap-3">
      {items.map((n) => {
        const text = n.messageKey ? tt(n.messageKey) : (n.textMsg ?? "");
        const { title, subtitle } = splitTitleAndSubtitle(text);
        const hexForShadow =
          typeof n.colorMsg === "string" && n.colorMsg.trim().startsWith("#")
            ? n.colorMsg.trim()
            : null;

        const primaryLabel =
          n.kind === "discord" ? tt("app.social.joinButton") : tt("app.social.subscribeButton");
        const laterLabel = tt("app.social.laterButton");
        const link = n.kind === "discord" ? DISCORD_LINK : TELEGRAM_LINK;

        return (
          <div
            key={n.id}
            className={`relative rounded-2xl border border-white/10 bg-ink-900/90 p-4 ${
              n.leaving ? "animate-notification-slide-out" : "animate-notification-slide-in"
            }`}
            style={{
              borderColor: hexForShadow ? `${hexForShadow}33` : undefined,
              boxShadow: hexForShadow ? `0 0 14px ${hexForShadow}33` : undefined,
            }}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                <SocialIcon kind={n.kind} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold leading-tight">{title}</div>
                {subtitle && (
                  <div className="mt-1 whitespace-pre-line text-xs leading-snug text-white/70">
                    {subtitle}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="interactive-press flex-1 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setItems((prev) =>
                    prev.map((x) => (x.id === n.id ? { ...x, leaving: true } : x)),
                  );
                  window.setTimeout(() => {
                    setItems((prev) => prev.filter((x) => x.id !== n.id));
                  }, 180);
                  try {
                    await openUrl(link);
                  } catch (err) {
                    console.error("Failed to open link:", err);
                  }
                }}
              >
                {primaryLabel}
              </button>

              <button
                type="button"
                className="interactive-press flex-1 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setItems((prev) =>
                    prev.map((x) => (x.id === n.id ? { ...x, leaving: true } : x)),
                  );
                  window.setTimeout(() => {
                    setItems((prev) => prev.filter((x) => x.id !== n.id));
                  }, 180);
                }}
              >
                {laterLabel}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
