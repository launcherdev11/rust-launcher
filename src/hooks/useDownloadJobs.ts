import { useCallback, useRef, useState } from "react";

export type DownloadJobKind = "version" | "modpack" | "mod" | "file";

export type DownloadJob = {
  id: string;
  label: string;
  kind: DownloadJobKind;
  percent: number | null;
  status: "running" | "paused";
};

export function useDownloadJobs() {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const counterRef = useRef(0);

  const startJob = useCallback(
    (params: {
      id: string;
      label: string;
      kind: DownloadJobKind;
      percent?: number | null;
    }) => {
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

  const updateJobProgress = useCallback((id: string, percent: number | null) => {
    setJobs((prev) =>
      prev.map((j) => (j.id === id ? { ...j, percent } : j)),
    );
  }, []);

  const setJobPaused = useCallback((id: string, paused: boolean) => {
    setJobs((prev) =>
      prev.map((j) =>
        j.id === id ? { ...j, status: paused ? "paused" : "running" } : j,
      ),
    );
  }, []);

  const finishJob = useCallback((id: string) => {
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
