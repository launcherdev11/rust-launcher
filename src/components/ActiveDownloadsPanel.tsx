import type { DownloadJob, DownloadJobKind } from "../hooks/useDownloadJobs";
import { useT, type Language } from "../i18n";

type ActiveDownloadsPanelProps = {
  jobs: DownloadJob[];
  language: Language;
};

const KIND_ICON: Record<DownloadJobKind, string> = {
  version: "download.png",
  modpack: "modpack_icon.png",
  mod: "mods.png",
  file: "file.png",
};

export function ActiveDownloadsPanel({ jobs, language }: ActiveDownloadsPanelProps) {
  const tt = useT(language);

  if (jobs.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(calc(100vw-2rem),21rem)] flex-col gap-2"
      aria-live="polite"
    >
      {jobs.map((job) => {
        const paused = job.status === "paused";
        const known = job.percent != null && job.percent > 0;
        const percent = Math.max(0, Math.min(100, Math.round(job.percent ?? 0)));
        const kindLabel = tt(`app.downloads.kind.${job.kind}`);
        const statusLabel = paused
          ? tt("app.downloads.paused")
          : known
            ? kindLabel
            : `${kindLabel} · ${tt("app.downloads.preparing")}`;

        return (
          <div
            key={job.id}
            className="pointer-events-auto glass-panel flex flex-col gap-2.5 rounded-2xl px-3.5 py-3"
          >
            <div className="flex items-center gap-3">
              <div className="glass-control flex h-9 w-9 shrink-0 items-center justify-center">
                <img
                  src={`/launcher-assets/${KIND_ICON[job.kind]}`}
                  alt=""
                  className="h-5 w-5 object-contain opacity-80"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.8125rem] font-semibold text-white/90" title={job.label}>
                  {job.label}
                </p>
                <p className="mt-0.5 truncate text-xs text-white/50">{statusLabel}</p>
              </div>
              {known ? (
                <span className="shrink-0 text-sm font-semibold tabular-nums text-white/85">
                  {percent}%
                </span>
              ) : null}
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-md bg-white/10"
              role="progressbar"
              aria-label={job.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={known ? percent : undefined}
            >
              <div
                className={`progress-fill h-full rounded-md transition-[width] duration-200 ${
                  known ? "" : "download-bar-indeterminate"
                } ${paused ? "opacity-40" : ""}`}
                style={known ? { width: `${percent}%` } : undefined}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
