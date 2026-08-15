import { openUrl } from "@tauri-apps/plugin-opener";
import { useT, type Language } from "../i18n";
import {
  resolveBannerImageUrl,
  type LauncherBannerData,
} from "../lib/launcherBanners";

type UpdatePopupModalProps = {
  language: Language;
  banner: LauncherBannerData;
  version?: string | null;
  busy?: boolean;
  onUpdate: () => void;
  onClose: () => void;
};

export function UpdatePopupModal({
  language,
  banner,
  version,
  busy = false,
  onUpdate,
  onClose,
}: UpdatePopupModalProps) {
  const tt = useT(language);
  const title =
    banner.title?.trim() ||
    (version
      ? tt("settings.updates.released", { version })
      : tt("settings.updates.popup.defaultTitle"));
  const subtitle = banner.subtitle?.trim() || undefined;
  const changelogUrl = banner.link?.trim() || undefined;

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[360] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="glass-panel flex w-full max-w-[720px] flex-col overflow-hidden rounded-3xl border border-white/15 bg-[#12121a]/95 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-popup-title"
      >
        <div className="relative min-h-[220px] w-full overflow-hidden sm:min-h-[300px]">
          <img
            src={resolveBannerImageUrl(banner.imageUrl)}
            alt={title}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10" />
          <div className="relative z-10 flex h-full min-h-[220px] flex-col justify-end px-6 py-5 sm:min-h-[300px] sm:px-8 sm:py-7">
            <h2
              id="update-popup-title"
              className="text-2xl font-semibold tracking-wide text-white sm:text-3xl"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="mt-2 max-w-2xl text-sm text-white/80 sm:text-base">
                {subtitle}
              </p>
            )}
            {version && (
              <p className="mt-2 text-xs font-medium uppercase tracking-[0.14em] text-white/55">
                {tt("settings.updates.popup.versionLabel", { version })}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 bg-black/35 px-4 py-3 sm:px-5">
          {changelogUrl && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void openUrl(changelogUrl).catch((err) => {
                  console.error("Failed to open changelog link:", err);
                });
              }}
              className="interactive-press rounded-xl border border-white/15 bg-white/8 px-4 py-2 text-sm font-semibold text-white/85 hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {tt("settings.updates.popup.viewChanges")}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onUpdate}
            className="interactive-press rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-lg hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy
              ? tt("settings.updates.popup.updating")
              : tt("settings.updates.popup.update")}
          </button>
        </div>
      </div>
    </div>
  );
}
