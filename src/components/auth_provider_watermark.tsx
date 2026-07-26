function MicrosoftMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#f25022" d="M2 2h9.5v9.5H2V2z" />
      <path fill="#00a4ef" d="M12.5 2H22v9.5h-9.5V2z" />
      <path fill="#7fba00" d="M2 12.5H11.5V22H2v-9.5z" />
      <path fill="#ffb900" d="M12.5 12.5H22V22h-9.5v-9.5z" />
    </svg>
  );
}

function ElyMark({ className }: { className?: string }) {
  return (
    <span
      className={`flex items-center justify-center rounded-md bg-[#2d7d46] font-black text-white ${className ?? ""}`}
      aria-hidden="true"
    >
      E
    </span>
  );
}

/** Soft blurred auth-provider mark for title-bar account chip. Offline → nothing. */
export function AuthProviderWatermark({ kind }: { kind: string }) {
  if (kind !== "microsoft" && kind !== "ely") return null;

  return (
    <span
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
      aria-hidden="true"
    >
      <span
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1 opacity-[0.45] blur-[5px] [mask-image:linear-gradient(90deg,transparent,black_35%)]"
      >
        {kind === "microsoft" ? (
          <MicrosoftMark className="h-11 w-11" />
        ) : (
          <ElyMark className="h-11 w-11 text-[1.35rem]" />
        )}
      </span>
    </span>
  );
}
