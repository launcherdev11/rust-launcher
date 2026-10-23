import type { ReactNode } from "react";
import { StateFrame } from "./StateView";

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
    <StateFrame compact={compact} className={className}>
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
    </StateFrame>
  );
}
