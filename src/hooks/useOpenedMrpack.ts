import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SplittableTabId } from "../splitView";

export function useOpenedMrpack(activateSidebarTab: (tab: SplittableTabId) => void) {
  const [openedMrpackPath, setOpenedMrpackPath] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const pending = await invoke<string | null>("take_pending_mrpack_open");
        const p = pending?.trim();
        if (p) {
          activateSidebarTab("modpacks");
          setOpenedMrpackPath(p);
        }
      } catch {
        //ignore
      }

      try {
        unlisten = await listen<{ path: string }>("mrpack-open-request", (event) => {
          const p = event.payload.path?.trim();
          if (!p) return;
          activateSidebarTab("modpacks");
          setOpenedMrpackPath(p);
        });
      } catch {
        //ignore
      }
    })();

    return () => {
      unlisten?.();
    };
  }, [activateSidebarTab]);

  return { openedMrpackPath, setOpenedMrpackPath };
}
