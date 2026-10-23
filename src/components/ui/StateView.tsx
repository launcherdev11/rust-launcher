import type { ReactNode } from "react";
import { Spinner } from "./Spinner";

type FrameProps = {
  children: ReactNode;
  className?: string;
  compact?: boolean;
};

export function StateFrame({ children, className = "", compact = false }: FrameProps) {
  return (
    <div
      className={[
        "glass-inset flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-5 py-10",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

type LoadingStateProps = {
  label?: string;
  className?: string;
  compact?: boolean;
};

export function LoadingState({ label, className = "", compact = false }: LoadingStateProps) {
  return (
    <StateFrame compact={compact} className={className}>
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
        <Spinner className="h-5 w-5 text-white/60" />
        {label ? <p className="text-xs text-white/50">{label}</p> : null}
      </div>
    </StateFrame>
  );
}

type ErrorStateProps = {
  title: string;
  description?: string;
  details?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
};

export function ErrorState({
  title,
  description,
  details,
  action,
  className = "",
  compact = false,
}: ErrorStateProps) {
  return (
    <StateFrame compact={compact} className={`border border-red-400/20 ${className}`}>
      <div role="alert" className="flex flex-col items-center gap-3">
        <div className="glass-control flex h-12 w-12 items-center justify-center">
          <img src="/launcher-assets/errorIcon.png" alt="" className="h-6 w-6 object-contain" />
        </div>
        <div className="max-w-sm space-y-1.5">
          <p className="text-sm font-semibold text-white/90">{title}</p>
          {description ? (
            <p className="text-xs leading-relaxed text-white/55">{description}</p>
          ) : null}
          {details ? (
            <p className="break-words font-mono text-[11px] leading-snug text-white/35">
              {details}
            </p>
          ) : null}
        </div>
      </div>
      {action ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>
      ) : null}
    </StateFrame>
  );
}
