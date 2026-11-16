import { AssetIcon } from "../../components/asset_icon";
import { useEffect, useState } from "react";
import { ModsIcon } from "./icons";
import type { ContentTab, ProfileItemMetadata } from "./types";

export function ProfileItemSourceIcon({
  source,
  title,
}: {
  source: string;
  title: string;
}) {
  const src =
    source === "modrinth"
      ? "/launcher-assets/modrinth.svg"
      : source === "curseforge"
        ? "/launcher-assets/curseforge.svg"
        : null;
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      title={title}
      className="h-3.5 w-3.5 shrink-0 object-contain opacity-80"
      aria-hidden="true"
    />
  );
}

export function ProfileItemDetails({
  contentTab,
  itemName,
  metadata,
  titleClassName,
  subtitleClassName,
  tt,
}: {
  contentTab: ContentTab;
  itemName: string;
  metadata?: ProfileItemMetadata | null;
  titleClassName: string;
  subtitleClassName: string;
  tt: (key: string) => string;
}) {
  const title = metadata?.title?.trim() || null;
  const displayTitle = title || itemName;
  const source = metadata?.source?.trim() || null;
  const sourceLabel =
    source === "modrinth"
      ? tt("mods.provider.modrinth")
      : source === "curseforge"
        ? tt("mods.provider.curseforge")
        : null;
  const showFilenameSubtitle = Boolean(title && title !== itemName);
  const showSourceIcon = contentTab === "mods" && Boolean(source && sourceLabel);

  return (
    <div className="min-w-0">
      <span className={`flex items-center gap-1 ${titleClassName}`} title={displayTitle}>
        {showSourceIcon && !showFilenameSubtitle ? (
          <ProfileItemSourceIcon source={source!} title={sourceLabel!} />
        ) : null}
        <span className="min-w-0 truncate">{displayTitle}</span>
      </span>
      {showFilenameSubtitle ? (
        <span className={`flex items-center gap-1 ${subtitleClassName}`} title={itemName}>
          {showSourceIcon ? (
            <ProfileItemSourceIcon source={source!} title={sourceLabel!} />
          ) : null}
          <span className="min-w-0 truncate">{itemName}</span>
        </span>
      ) : null}
    </div>
  );
}

export function ProfileItemIcon({
  contentTab,
  metadata,
}: {
  contentTab: ContentTab;
  metadata?: ProfileItemMetadata | null;
}) {
  const [broken, setBroken] = useState(false);
  const src =
    !broken && (metadata?.iconUrl?.trim() || metadata?.iconDataUri?.trim())
      ? (metadata?.iconUrl?.trim() || metadata?.iconDataUri?.trim() || null)
      : null;

  useEffect(() => {
    setBroken(false);
  }, [metadata?.iconUrl, metadata?.iconDataUri]);

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="h-7 w-7 shrink-0 rounded-lg bg-white/10 object-cover"
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[0.8125rem]">
      {contentTab === "mods" ? (
        <ModsIcon className="h-5 w-5" />
      ) : contentTab === "resourcepacks" ? (
        "R"
      ) : (
        "S"
      )}
    </span>
  );
}

export function PinItemButton({
  pinned,
  onToggle,
  tt,
}: {
  pinned: boolean;
  onToggle: () => void;
  tt: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={pinned}
      className={`interactive-press rounded-lg p-2 ${
        pinned
          ? "bg-accent-from/25 text-accent-hi hover:bg-accent-from/35"
          : "hidden bg-white/10 text-white/60 hover:bg-white/20 hover:text-white group-focus-within:block group-hover:block"
      }`}
      title={tt(pinned ? "modpacks.manage.unpinVersion" : "modpacks.manage.pinVersion")}
    >
      <AssetIcon name="pin" className="h-4 w-4" />
    </button>
  );
}
