import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { readStoredLanguage, t } from "../../i18n";
import {
  resolveRemoteNotificationBgStyle,
  resolveRemoteNotificationIconSrc,
  type Notification,
} from "../notifications";

type Props = {
  notifications: Notification[];
  setNotifications: Dispatch<SetStateAction<Notification[]>>;
  onDismiss: (id: number) => void;
};

export function NotificationToasts({ notifications, setNotifications, onDismiss }: Props) {
  return (
    <div className="pointer-events-none fixed top-11 left-0 right-0 z-30 flex flex-col items-center px-4">
      {notifications.map((n) => {
        const baseClasses =
          "pointer-events-auto group inline-flex w-max max-w-[min(36rem,calc(100vw-2rem))] cursor-pointer items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium leading-snug shadow-soft transition-colors hover:bg-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-accent-to/60";
        let bgClasses = "";
        let iconSrc = "";
        let style: CSSProperties | undefined;

        if (n.kind === "info") {
          bgClasses = "bg-ink-850 border border-white/15 border-l-[3px] border-l-accent-to text-white";
          iconSrc = "/launcher-assets/info.png";
        } else if (n.kind === "success") {
          bgClasses = "bg-ink-850 border border-white/15 border-l-[3px] border-l-emerald-400 text-white";
          iconSrc = "/launcher-assets/success.png";
        } else if (n.kind === "error") {
          bgClasses = "bg-ink-850 border border-danger-line/30 border-l-[3px] border-l-danger-line text-white";
          iconSrc = "/launcher-assets/errorIcon.png";
        } else if (n.kind === "warning") {
          bgClasses = "bg-ink-850 border border-warn-line/30 border-l-[3px] border-l-warn-line text-white";
          iconSrc = "/launcher-assets/warn.png";
        } else {
          const resolvedIcon = resolveRemoteNotificationIconSrc(n.iconMsg);
          iconSrc = resolvedIcon ?? "/launcher-assets/icon.png";
          const resolvedBg = resolveRemoteNotificationBgStyle(n.colorMsg);
          if (resolvedBg) {
            style = {
              backgroundColor: resolvedBg.background,
              border: `1px solid ${resolvedBg.border}`,
              color: resolvedBg.textColor === "black" ? "#000" : "#fff",
            };
          } else {
            bgClasses = "bg-ink-850 border border-white/15 text-white";
          }
        }

        if (n.iconMsg) {
          const resolvedIcon = resolveRemoteNotificationIconSrc(n.iconMsg);
          if (resolvedIcon) iconSrc = resolvedIcon;
        }

        const wrapperAnimationClass = n.leaving
          ? "animate-notification-slide-out overflow-hidden"
          : !n.entered
            ? "animate-notification-slide-in"
            : "";

        return (
          <div
            key={n.id}
            className={`mb-2 flex w-full justify-center last:mb-0 ${wrapperAnimationClass}`}
            onAnimationEnd={(e) => {
              if (e.currentTarget !== e.target || n.leaving || n.entered) return;
              if (!e.animationName.includes("notification-slide-down")) return;
              setNotifications((prev) =>
                prev.map((item) =>
                  item.id === n.id ? { ...item, entered: true } : item,
                ),
              );
            }}
          >
            <div
              role={n.kind === "error" ? "alert" : "status"}
              className={`${baseClasses} ${bgClasses}`}
              style={style}
              onClick={() => onDismiss(n.id)}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/15">
                <img src={iconSrc} alt="" className="h-4 w-4 object-contain" />
              </div>
              <span className="whitespace-pre-line break-words">{n.message}</span>
              {(n.count ?? 1) > 1 ? (
                <span className="shrink-0 pl-0.5 tabular-nums text-xs font-semibold leading-none opacity-85">
                  ×{n.count}
                </span>
              ) : null}
              {n.action ? (
                <button
                  type="button"
                  className="btn btn-soft btn-sm shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    n.action?.onClick();
                    onDismiss(n.id);
                  }}
                >
                  {n.action.label}
                </button>
              ) : null}
              <button
                type="button"
                className="icon-btn -mr-1.5 shrink-0"
                aria-label={t(readStoredLanguage() ?? "ru", "common.close")}
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(n.id);
                }}
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                  <path
                    d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
