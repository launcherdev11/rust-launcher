export function AssetIcon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  return (
    <img
      src={`/launcher-assets/${name}.png`}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}

export function MicrosoftIcon({ className = "h-4 w-4" }: { className?: string }) {
  return <AssetIcon name="microsoft" className={className} />;
}

export function ElyByIcon({ className = "h-4 w-4 text-[0.6875rem]" }: { className?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded bg-[#2d7d46] font-bold leading-none text-white ${className}`}
      aria-hidden="true"
    >
      E
    </span>
  );
}

export function accountKindTagClass(kind: string): string {
  if (kind === "microsoft") return "bg-sky-500/25 text-sky-100";
  if (kind === "ely") return "bg-[#2d7d46]/35 text-emerald-100";
  return "bg-white/10 text-white/55";
}
