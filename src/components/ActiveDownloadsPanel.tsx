import { AnimatePresence, motion } from "framer-motion";
import type { DownloadJob, DownloadJobKind } from "../hooks/useDownloadJobs";
import { formatByteSize, useT, type Language } from "../i18n";

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

type Tt = ReturnType<typeof useT>;

function formatEta(tt: Tt, seconds: number): string {
  if (seconds < 60) return tt("app.downloads.etaSeconds", { n: Math.max(1, seconds) });
  if (seconds < 3600) return tt("app.downloads.etaMinutes", { n: Math.round(seconds / 60) });
  return tt("app.downloads.etaHours", { h: Math.floor(seconds / 3600), m: Math.round((seconds % 3600) / 60) });
}

function progressFacts(job: DownloadJob, tt: Tt, language: Language) {
  const detail = job.detail;
  const amount = !detail
    ? null
    : detail.unit === "bytes"
      ? tt("app.downloads.bytesOf", {
          done: formatByteSize(language, detail.current),
          total: formatByteSize(language, detail.total),
        })
      : tt("app.downloads.filesOf", { done: detail.current, total: detail.total });
  const rate = [
    job.bytesPerSecond && job.bytesPerSecond > 0
      ? tt("app.downloads.speed", { value: formatByteSize(language, job.bytesPerSecond) })
      : null,
    job.etaSeconds != null ? tt("app.downloads.eta", { time: formatEta(tt, job.etaSeconds) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return { amount, rate };
}

export function ActiveDownloadsPanel({ jobs, language }: ActiveDownloadsPanelProps) {
  const tt = useT(language);

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(calc(100vw-2rem),21rem)] flex-col gap-2"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
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
          const facts = known && !paused ? progressFacts(job, tt, language) : null;

          return (
            <motion.div
              key={job.id}
              layout="position"
              initial={{ opacity: 0, x: 28, scale: 0.97 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.97, transition: { duration: 0.18, ease: "easeIn" } }}
              transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
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
                  className={`progress-fill h-full rounded-md ${
                    known
                      ? "w-full transition-transform duration-300 ease-out"
                      : "download-bar-indeterminate"
                  } ${paused ? "opacity-40" : ""}`}
                  style={known ? { transform: `translateX(${percent - 100}%)` } : undefined}
                />
              </div>
              {facts && (facts.amount || facts.rate) ? (
                <div className="-mt-1 flex items-center justify-between gap-3 text-[0.6875rem] tabular-nums text-white/45">
                  <span className="truncate">{facts.amount}</span>
                  <span className="shrink-0">{facts.rate}</span>
                </div>
              ) : null}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
