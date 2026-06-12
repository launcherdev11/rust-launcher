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
  refreshKey?: number;
  editable?: boolean;
  editTitle?: string;
  onEditClick?: () => void;
};

export function ProfileInstanceIcon({
  profile,
  className = "h-12 w-12 shrink-0",
  initialClassName = "text-sm",
  imageFit = "cover",
  refreshKey = 0,
  editable = false,
  editTitle,
  onEditClick,
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
  }, [profile.id, refreshKey]);

  const rootClassName = `relative flex items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-white/15 ${
    editable ? "group cursor-pointer" : ""
  } ${className}`;

  const content = (
    <>
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
      {editable ? (
        <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center rounded-xl bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
          <img
            src="/launcher-assets/edit.png"
            alt=""
            className="h-4 w-4 object-contain brightness-0 invert"
          />
        </div>
      ) : null}
    </>
  );

  if (editable) {
    return (
      <button
        type="button"
        onClick={onEditClick}
        title={editTitle ?? profile.name}
        className={`interactive-press shrink-0 border-0 bg-transparent p-0 ${rootClassName}`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={rootClassName} title={profile.name}>
      {content}
    </div>
  );
}
