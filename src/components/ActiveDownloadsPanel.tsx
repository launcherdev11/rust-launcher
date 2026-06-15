import type { DownloadJob } from "../hooks/useDownloadJobs";
import { useT, type Language } from "../i18n";

type ActiveDownloadsPanelProps = {
  jobs: DownloadJob[];
  language: Language;
};

export function ActiveDownloadsPanel({ jobs, language }: ActiveDownloadsPanelProps) {
  const tt = useT(language);

  if (jobs.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex max-w-[min(100vw-2rem,20rem)] flex-col gap-2"
      aria-live="polite"
    >
      {jobs.map((job) => (
        <div
          key={job.id}
          className="pointer-events-auto rounded-xl border border-white/10 bg-black/70 px-3 py-2 shadow-lg backdrop-blur-md"
        >
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="min-w-0 truncate font-medium text-white/90">{job.label}</span>
            <span className="shrink-0 uppercase tracking-wide text-white/45">
              {job.status === "paused"
                ? tt("app.downloads.paused")
                : tt(`app.downloads.kind.${job.kind}`)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full accent-bg transition-[width] duration-200"
              style={{
                width: `${Math.max(0, Math.min(100, Math.round(job.percent ?? 0)))}%`,
              }}
            />
          </div>
          <div className="mt-0.5 text-right text-[10px] text-white/55">
            {job.percent != null && job.percent > 0
              ? `${Math.round(job.percent)}%`
              : tt("app.downloads.preparing")}
          </div>
        </div>
      ))}
    </div>
  );
}
