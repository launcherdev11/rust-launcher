import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BOOSTY_LINK,
  DISCORD_LINK,
  TELEGRAM_LINK,
  TIKTOK_LINK,
} from "../notifications";

const SOCIALS = [
  { id: "telegram", label: "Telegram", icon: "tg.png", href: TELEGRAM_LINK },
  { id: "discord", label: "Discord", icon: "ds.png", href: DISCORD_LINK },
  { id: "tiktok", label: "TikTok", icon: "tiktok.svg", href: TIKTOK_LINK },
  { id: "boosty", label: "Boosty", icon: "boosty.svg", href: BOOSTY_LINK },
] as const;

export function TitleBarSocials() {
  return (
    <div className="ml-1 flex items-center gap-0.5 border-l border-white/10 pl-2">
      {SOCIALS.map((s) => (
        <button
          key={s.id}
          type="button"
          className="icon-btn h-7 w-7"
          title={s.label}
          aria-label={s.label}
          data-no-drag
          onClick={() => {
            openUrl(s.href).catch((err) => console.error("Failed to open link:", err));
          }}
        >
          <img
            src={`/launcher-assets/${s.icon}`}
            alt=""
            draggable={false}
            className={`titlebar-social-icon object-contain ${
              s.id === "boosty" ? "h-5 w-5" : "h-4 w-4"
            }`}
          />
        </button>
      ))}
    </div>
  );
}
