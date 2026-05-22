import { useEffect, useState } from "react";
import {
  buildInitialAvatarDataUrl,
  getAvatarSrc,
  getElyAvatarByUsername,
  type ProfileAvatarInput,
} from "../lib/avatar";

export function accountKindAvatarRingClass(kind: string): string {
  if (kind === "microsoft") return "ring-1 ring-sky-400/25";
  if (kind === "ely") return "ring-1 ring-emerald-400/20";
  return "ring-1 ring-white/10";
}

export type AccountAvatarProps = {
  username: string;
  profile?: ProfileAvatarInput | null;
  kind?: string;
  size?: number;
  className?: string;
};

export function AccountAvatar({
  username,
  profile,
  kind,
  size = 64,
  className = "h-8 w-8 shrink-0 overflow-hidden rounded-full",
}: AccountAvatarProps) {
  const trimmed = username.trim();
  const fallback = buildInitialAvatarDataUrl(trimmed || "?");
  const [src, setSrc] = useState(fallback);

  useEffect(() => {
    let cancelled = false;
    const placeholder = buildInitialAvatarDataUrl(trimmed || "?");
    setSrc(placeholder);

    const load = async () => {
      try {
        const next = profile
          ? await getAvatarSrc(profile, placeholder, size)
          : await getElyAvatarByUsername(trimmed, placeholder, size);
        if (!cancelled) setSrc(next);
      } catch {
        if (!cancelled) setSrc(placeholder);
      }
    };

    if (!trimmed && !profile?.ely_username?.trim()) return;
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    trimmed,
    size,
    profile?.nickname,
    profile?.ely_username,
    profile?.ely_uuid,
    profile?.mc_uuid,
  ]);

  const ring = kind ? accountKindAvatarRingClass(kind) : "";

  return (
    <span className={`relative ${ring} ${className}`}>
      <img
        src={src}
        alt=""
        draggable={false}
        className="aspect-square h-full w-full object-cover object-center [image-rendering:pixelated]"
        onError={() => setSrc(fallback)}
      />
    </span>
  );
}
