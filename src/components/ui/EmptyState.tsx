import type { ReactNode } from "react";

type Props = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
  compact = false,
}: Props) {
  return (
    <div
      className={[
        "glass-inset flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-5 py-10",
        className,
      ].join(" ")}
    >
      {icon ? (
        <div className="glass-control flex h-12 w-12 items-center justify-center text-white/55">
          {icon}
        </div>
      ) : null}
      <div className="max-w-sm space-y-1.5">
        <p className="text-sm font-semibold text-white/85">{title}</p>
        {description ? (
          <p className="text-xs leading-relaxed text-white/50">{description}</p>
        ) : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
