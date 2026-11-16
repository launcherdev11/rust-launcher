import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DownloadJobCard } from "./components/ActiveDownloadsPanel";
import { TooltipHost } from "./components/ui/TooltipHost";
import { t, useT, type Language } from "./i18n";
import { applyAccentColor } from "./lib/customTheme";
import {
  listenDownloadsSync,
  requestDownloadsSync,
  type DownloadsSyncPayload,
} from "./lib/downloadsWindow";

function EmptyState({ language }: { language: Language }) {
  const tt = useT(language);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <img src="/launcher-assets/download.png" alt="" className="h-10 w-10 object-contain opacity-40" />
      <div>
        <p className="text-sm font-semibold text-white/80">{tt("app.downloads.emptyTitle")}</p>
        <p className="mt-1 text-xs text-white/45">{tt("app.downloads.emptyHint")}</p>
      </div>
    </div>
  );
}

export function DownloadsApp() {
  const [sync, setSync] = useState<DownloadsSyncPayload | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const fn = await listenDownloadsSync(setSync);
        if (disposed) {
          fn();
          return;
        }
        unlisten = fn;
        await requestDownloadsSync();
      } catch {
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const language = sync?.language;
  const accentColor = sync?.accentColor;

  useEffect(() => {
    if (accentColor) applyAccentColor(accentColor);
  }, [accentColor]);

  useEffect(() => {
    if (!language) return;
    void getCurrentWindow()
      .setTitle(t(language, "app.downloads.windowTitle"))
      .catch(() => {});
  }, [language]);

  if (!sync) return <div className="h-screen w-screen bg-ink-950" />;

  return (
    <div className="flex h-screen w-screen flex-col gap-2 overflow-y-auto bg-ink-950 p-3" aria-live="polite">
      <TooltipHost />
      {sync.jobs.length === 0 ? <EmptyState language={sync.language} /> : null}
      <AnimatePresence initial={false}>
        {sync.jobs.map((job) => (
          <DownloadJobCard key={job.id} job={job} language={sync.language} />
        ))}
      </AnimatePresence>
    </div>
  );
}
