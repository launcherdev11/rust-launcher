import { useCallback, useRef, useState } from "react";

export type DownloadJobKind = "version" | "modpack" | "mod" | "file";

export type DownloadJobDetail = {
  current: number;
  total: number;
  unit: "bytes" | "files";
};

export type DownloadJob = {
  id: string;
  label: string;
  kind: DownloadJobKind;
  percent: number | null;
  status: "running" | "paused";
  detail?: DownloadJobDetail | null;
  etaSeconds?: number | null;
  bytesPerSecond?: number | null;
};

type ProgressSample = { at: number; percent: number; current: number | null };

const RATE_WINDOW_MS = 10_000;
const RATE_MIN_SPAN_MS = 2_000;
const PUBLISH_INTERVAL_MS = 1_000;

function roundPercent(percent: number | null): number | null {
  return percent == null ? null : Math.round(percent);
}

function estimateRate(samples: ProgressSample[] | undefined) {
  if (!samples || samples.length < 2) return { etaSeconds: null, unitsPerSecond: null };
  const first = samples[0];
  const last = samples[samples.length - 1];
  const span = last.at - first.at;
  if (span < RATE_MIN_SPAN_MS) return { etaSeconds: null, unitsPerSecond: null };
  const percentPerMs = (last.percent - first.percent) / span;
  const etaSeconds =
    percentPerMs > 0 && last.percent < 99.5 ? Math.round((100 - last.percent) / percentPerMs / 1000) : null;
  const unitsPerSecond =
    first.current != null && last.current != null && last.current >= first.current
      ? ((last.current - first.current) / span) * 1000
      : null;
  return { etaSeconds, unitsPerSecond };
}

export function useDownloadJobs() {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const counterRef = useRef(0);
  const samplesRef = useRef(new Map<string, ProgressSample[]>());
  const publishedAtRef = useRef(new Map<string, number>());

  const forgetSamples = (id: string) => {
    samplesRef.current.delete(id);
    publishedAtRef.current.delete(id);
  };

  const startJob = useCallback(
    (params: {
      id: string;
      label: string;
      kind: DownloadJobKind;
      percent?: number | null;
    }) => {
      forgetSamples(params.id);
      setJobs((prev) => {
        const next = prev.filter((j) => j.id !== params.id);
        return [
          ...next,
          {
            id: params.id,
            label: params.label,
            kind: params.kind,
            percent: params.percent ?? null,
            status: "running",
          },
        ];
      });
    },
    [],
  );

  const updateJobProgress = useCallback(
    (id: string, percent: number | null, detail?: DownloadJobDetail | null) => {
      const now = performance.now();
      if (percent != null) {
        const samples = samplesRef.current.get(id) ?? [];
        const last = samples[samples.length - 1];
        // откат назад — новая фаза или повтор
        if (last && (percent < last.percent || (detail && last.current != null && detail.current < last.current))) {
          samples.length = 0;
        }
        samples.push({ at: now, percent, current: detail?.current ?? null });
        while (samples.length > 2 && now - samples[0].at > RATE_WINDOW_MS) samples.shift();
        samplesRef.current.set(id, samples);
      }
      const due = now - (publishedAtRef.current.get(id) ?? 0) >= PUBLISH_INTERVAL_MS;

      setJobs((prev) => {
        const current = prev.find((j) => j.id === id);
        if (!current) return prev;
        if (roundPercent(current.percent) === roundPercent(percent) && !due) return prev;
        publishedAtRef.current.set(id, now);
        const rate = estimateRate(samplesRef.current.get(id));
        const nextDetail = detail ?? current.detail ?? null;
        return prev.map((j) =>
          j.id === id
            ? {
                ...j,
                percent,
                detail: nextDetail,
                etaSeconds: rate.etaSeconds,
                bytesPerSecond: nextDetail?.unit === "bytes" ? rate.unitsPerSecond : null,
              }
            : j,
        );
      });
    },
    [],
  );

  const setJobPaused = useCallback((id: string, paused: boolean) => {
    if (!paused) forgetSamples(id);
    setJobs((prev) =>
      prev.map((j) =>
        j.id === id ? { ...j, status: paused ? "paused" : "running" } : j,
      ),
    );
  }, []);

  const finishJob = useCallback((id: string) => {
    forgetSamples(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  const makeJobId = useCallback((prefix: string) => {
    counterRef.current += 1;
    return `${prefix}-${Date.now()}-${counterRef.current}`;
  }, []);

  return {
    jobs,
    startJob,
    updateJobProgress,
    setJobPaused,
    finishJob,
    makeJobId,
  };
}
