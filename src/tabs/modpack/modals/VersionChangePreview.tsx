import { AssetIcon } from "../../../components/asset_icon";
import { Spinner } from "../../../components/ui";
import type { VersionChangeItemStatus, VersionChangePreviewItem } from "../types";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

const GROUPS: { status: VersionChangeItemStatus; labelKey: string; toneClass: string }[] = [
  {
    status: "incompatible",
    labelKey: "modpacks.changeVersion.preview.incompatible",
    toneClass: "text-warn-fg",
  },
  {
    status: "unknown",
    labelKey: "modpacks.changeVersion.preview.unknown",
    toneClass: "text-white/70",
  },
  {
    status: "update",
    labelKey: "modpacks.changeVersion.preview.update",
    toneClass: "text-accent-hi",
  },
  {
    status: "compatible",
    labelKey: "modpacks.changeVersion.preview.compatible",
    toneClass: "text-emerald-300",
  },
];

function PreviewRow({ item, pinnedTitle }: { item: VersionChangePreviewItem; pinnedTitle: string }) {
  const versions =
    item.currentVersion && item.latestVersion
      ? `${item.currentVersion} → ${item.latestVersion}`
      : item.currentVersion;
  return (
    <li
      className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs ${
        item.enabled ? "text-white/85" : "text-white/40"
      }`}
      title={item.filename}
    >
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {item.pinned ? (
        <span title={pinnedTitle} className="text-accent-hi">
          <AssetIcon name="pin" className="h-3.5 w-3.5" />
        </span>
      ) : null}
      {versions ? (
        <span className="max-w-[45%] shrink-0 truncate text-[0.75rem] text-white/45">{versions}</span>
      ) : null}
    </li>
  );
}

export function VersionChangePreview({ ctx }: Props) {
  const { tt, migratePreview, migratePreviewLoading, migratePreviewFailed, migrateGameVersion } = ctx;

  if (migratePreviewLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-white/60">
        <Spinner />
        <span>{tt("modpacks.changeVersion.preview.checking")}</span>
      </div>
    );
  }
  if (migratePreviewFailed) {
    return <p className="text-xs text-warn-fg">{tt("modpacks.changeVersion.preview.failed")}</p>;
  }
  if (!migratePreview) return null;
  if (migratePreview.modsIgnoredByVanilla > 0) {
    return (
      <p className="text-xs text-white/60">
        {tt("modpacks.changeVersion.preview.vanilla", {
          count: migratePreview.modsIgnoredByVanilla,
        })}
      </p>
    );
  }
  if (migratePreview.items.length === 0) return null;

  const hasUnknown = migratePreview.items.some((item) => item.status === "unknown");

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-white/70">
        {tt("modpacks.changeVersion.preview.title", { version: migrateGameVersion })}
      </span>
      {migratePreview.lookupFailed ? (
        <p className="text-xs text-warn-fg">{tt("modpacks.changeVersion.preview.lookupFailed")}</p>
      ) : null}
      <div className="flex max-h-56 flex-col gap-2.5 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-2">
        {GROUPS.map((group) => {
          const items = migratePreview.items.filter((item) => item.status === group.status);
          if (items.length === 0) return null;
          return (
            <section key={group.status} className="flex flex-col gap-0.5">
              <p className={`px-2 text-xs font-semibold ${group.toneClass}`}>
                {tt(group.labelKey)} · {items.length}
              </p>
              <ul className="flex flex-col">
                {items.map((item) => (
                  <PreviewRow
                    key={item.filename}
                    item={item}
                    pinnedTitle={tt("modpacks.changeVersion.preview.pinned")}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {hasUnknown ? (
        <p className="text-[0.75rem] text-white/50">
          {tt("modpacks.changeVersion.preview.unknownHint")}
        </p>
      ) : null}
    </div>
  );
}
