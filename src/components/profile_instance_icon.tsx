import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { profileIconInitial } from "../lib/profile-icon";

export type ProfileInstanceIconProps = {
  profile: {
    id: string;
    name: string;
  };
  className?: string;
  initialClassName?: string;
  imageFit?: "cover" | "contain";
};

export function ProfileInstanceIcon({
  profile,
  className = "h-12 w-12 shrink-0",
  initialClassName = "text-sm",
  imageFit = "cover",
}: ProfileInstanceIconProps) {
  const [iconSrc, setIconSrc] = useState<string | null>(null);
  const initial = profileIconInitial(profile.name);
  const fitClass = imageFit === "contain" ? "object-contain" : "object-cover";

  useEffect(() => {
    let cancelled = false;
    setIconSrc(null);

    void (async () => {
      try {
        const uri = await invoke<string | null>("get_profile_icon_data_uri", {
          profileId: profile.id,
        });
        if (!cancelled && uri) {
          setIconSrc(uri);
        }
      } catch {
        if (!cancelled) {
          setIconSrc(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profile.id]);

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-white/15 ${className}`}
      title={profile.name}
    >
      <span
        className={`flex h-full w-full items-center justify-center font-bold uppercase tracking-wide text-white ${initialClassName}`}
      >
        {initial}
      </span>
      {iconSrc ? (
        <img
          src={iconSrc}
          alt=""
          className={`absolute inset-0 z-[1] h-full w-full ${fitClass}`}
          onError={() => setIconSrc(null)}
        />
      ) : null}
    </div>
  );
}
