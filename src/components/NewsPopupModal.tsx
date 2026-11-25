import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useT, type Language } from "../i18n";
import {
  findPrimaryLink,
  LinkifiedText,
  splitAnnouncement,
} from "../lib/linkifiedText";
import { resolveLauncherNewsAssetUrl } from "../lib/remoteMirrors";

export type NewsPopupNotice = {
  image?: string;
  msg: string;
};

type NewsPopupModalProps = {
  language: Language;
  notice: NewsPopupNotice;
  onClose: () => void;
};

export function NewsPopupModal({ language, notice, onClose }: NewsPopupModalProps) {
  const tt = useT(language);
  const imageUrl = notice.image?.trim()
    ? resolveLauncherNewsAssetUrl(notice.image.trim())
    : null;
  const message = notice.msg.trim();
  const { title: derivedTitle, body } = splitAnnouncement(message);
  const title = derivedTitle || tt("app.newsPopup.title");
  const bodyText = derivedTitle ? body : message;
  const primaryLink = findPrimaryLink(message);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        key="news-popup-overlay"
        className="glass-overlay motion-managed pointer-events-auto fixed inset-0 z-[350] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        onClick={onClose}
        role="presentation"
      >
        <motion.div
          className="glass-modal flex max-h-[min(90vh,44rem)] w-full max-w-[720px] flex-col overflow-hidden"
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14, ease: "easeIn" } }}
          transition={{ type: "spring", stiffness: 460, damping: 32, mass: 0.8 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="news-popup-title"
        >
          {imageUrl ? (
            <div className="relative min-h-[160px] w-full shrink-0 overflow-hidden sm:min-h-[220px]">
              <img
                src={imageUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/10" />
              <div className="relative z-10 flex h-full min-h-[160px] items-end px-6 py-5 sm:min-h-[220px] sm:px-8 sm:py-7">
                <h2
                  id="news-popup-title"
                  className="text-2xl font-semibold tracking-tight text-white sm:text-3xl"
                >
                  {title}
                </h2>
              </div>
            </div>
          ) : (
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.07] px-6 py-5 sm:px-8">
              <div className="min-w-0">
                <p className="ui-meta mb-1">{tt("app.newsPopup.kicker")}</p>
                <h2
                  id="news-popup-title"
                  className="text-xl font-semibold tracking-tight text-white sm:text-2xl"
                >
                  {title}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="icon-btn -mr-1 shrink-0"
                aria-label={tt("common.close")}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
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
          )}

          {bodyText ? (
            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5 sm:px-8 sm:py-6">
              <LinkifiedText
                text={bodyText}
                className="text-[0.9375rem] leading-relaxed text-white/80"
              />
            </div>
          ) : null}

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-white/[0.07] bg-black/25 px-5 py-3.5 sm:px-6">
            {primaryLink ? (
              <>
                <button type="button" onClick={onClose} className="btn btn-soft btn-sm">
                  {tt("common.close")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void openUrl(primaryLink.href).catch((err) => {
                      console.error("Failed to open news link:", err);
                    });
                  }}
                  className="btn btn-accent btn-sm"
                >
                  {primaryLink.label}
                  <span className="ml-1 text-[0.75rem] opacity-80">↗</span>
                </button>
              </>
            ) : (
              <button type="button" onClick={onClose} className="btn btn-accent btn-sm">
                {tt("common.close")}
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
