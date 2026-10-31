import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { disposeWhenResolved } from "../../../lib/tauriEvents";
import type { InstanceProfile, NotificationKind, ViewId } from "../types";

type DroppedContentResult = {
  mods: number;
  resourcepacks: number;
  shaderpacks: number;
  skipped: string[];
};

type Deps = {
  activeView: ViewId;
  profiles: InstanceProfile[];
  tt: (key: string, vars?: Record<string, string | number>) => string;
  showNotification: (kind: NotificationKind, message: string) => void;
  refreshProfiles: (options?: { background?: boolean }) => Promise<void>;
};

const PROFILE_DROP_ATTR = "data-profile-drop-id";

function profileIdAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[${PROFILE_DROP_ATTR}]`);
  return el?.getAttribute(PROFILE_DROP_ATTR) ?? null;
}

export function useProfileCardDrop({ activeView, profiles, tt, showNotification, refreshProfiles }: Deps) {
  const [dropTargetProfileId, setDropTargetProfileId] = useState<string | null>(null);
  const depsRef = useRef({ profiles, tt, showNotification, refreshProfiles });
  depsRef.current = { profiles, tt, showNotification, refreshProfiles };

  useEffect(() => {
    if (activeView !== "list") return;
    const dispose = disposeWhenResolved(
      getCurrentWebview().onDragDropEvent(async (event) => {
        const p = event.payload;
        if (p.type === "leave") {
          setDropTargetProfileId(null);
          return;
        }
        if (p.type === "enter") return;
        const factor = await getCurrentWindow().scaleFactor();
        const pos = new PhysicalPosition(p.position.x, p.position.y).toLogical(factor);
        const profileId = profileIdAt(pos.x, pos.y);
        if (p.type === "over") {
          setDropTargetProfileId(profileId);
          return;
        }
        setDropTargetProfileId(null);
        // .mrpack импортирует отдельный обработчик
        const files = (p.paths ?? []).filter((f) => !f.toLowerCase().endsWith(".mrpack"));
        if (!profileId || files.length === 0) return;

        const { profiles: list, tt: t, showNotification: notify, refreshProfiles: refresh } = depsRef.current;
        const name = list.find((x) => x.id === profileId)?.name ?? "";
        try {
          const result = await invoke<DroppedContentResult>("add_dropped_profile_files", {
            id: profileId,
            files,
          });
          const parts = [
            result.mods ? t("modpacks.drop.mods", { count: result.mods }) : null,
            result.resourcepacks ? t("modpacks.drop.resourcepacks", { count: result.resourcepacks }) : null,
            result.shaderpacks ? t("modpacks.drop.shaderpacks", { count: result.shaderpacks }) : null,
          ].filter(Boolean);
          if (parts.length > 0) {
            notify("success", t("modpacks.drop.added", { name, summary: parts.join(", ") }));
            void refresh({ background: true });
          }
          if (result.skipped.length > 0) {
            notify("warning", t("modpacks.drop.skipped", { files: result.skipped.join(", ") }));
          }
        } catch (e) {
          console.error(e);
          notify("error", t("modpacks.toast.addFilesFailed"));
        }
      }),
    );
    return () => {
      setDropTargetProfileId(null);
      dispose();
    };
  }, [activeView]);

  return { dropTargetProfileId };
}
