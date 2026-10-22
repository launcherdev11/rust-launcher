import type { CSSProperties, Dispatch, SetStateAction } from "react";
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
          bgClasses = "bg-ink-850 border border-red-400/30 border-l-[3px] border-l-red-400 text-white";
          iconSrc = "/launcher-assets/errorIcon.png";
        } else if (n.kind === "warning") {
          bgClasses = "bg-ink-850 border border-amber-400/30 border-l-[3px] border-l-amber-400 text-white";
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
              role="button"
              tabIndex={0}
              className={`${baseClasses} ${bgClasses}`}
              style={style}
              onClick={() => onDismiss(n.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onDismiss(n.id);
                }
              }}
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
            </div>
          </div>
        );
      })}
    </div>
  );
}
