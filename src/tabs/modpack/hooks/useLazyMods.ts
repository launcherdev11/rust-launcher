import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  type ContentTab,
  type LazyApplyReport,
  type LazyContentType,
  type LazyModItem,
  type LazyModSet,
  type NotificationKind,
  type ProfileItemMetadata,
} from "../types";

type LazyModsDeps = {
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  tt: (key: string, vars?: Record<string, string | number>) => string;
};

export type LazyModal =
  | { mode: "manage" }
  | { mode: "add"; items: LazyModItem[]; skipped: number }
  | { mode: "apply"; profileId: string };

const TAB_CONTENT_TYPE: Record<ContentTab, LazyContentType> = {
  mods: "mod",
  resourcepacks: "resourcepack",
  shaderpacks: "shader",
};

const REPORT_NAMES_LIMIT = 3;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
}

function namesList(names: string[]): string {
  const shown = names.slice(0, REPORT_NAMES_LIMIT).join(", ");
  return names.length > REPORT_NAMES_LIMIT ? `${shown}…` : shown;
}

export function lazyItemsFromFiles(
  filenames: Iterable<string>,
  metadata: Record<string, ProfileItemMetadata>,
  contentTab: ContentTab,
): { items: LazyModItem[]; skipped: number } {
  const items: LazyModItem[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const filename of filenames) {
    const meta = metadata[filename];
    const provider = meta?.source;
    if (!meta?.projectId || (provider !== "modrinth" && provider !== "curseforge")) {
      skipped += 1;
      continue;
    }
    const key = `${provider}:${meta.projectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      provider,
      project_id: meta.projectId,
      content_type: TAB_CONTENT_TYPE[contentTab],
      title: meta.title ?? filename,
      icon_url: meta.iconUrl ?? null,
    });
  }
  return { items, skipped };
}

export function useLazyMods(deps: LazyModsDeps) {
  const { showNotification, tt } = deps;
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const [sets, setSets] = useState<LazyModSet[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<LazyModal | null>(null);
  const [applying, setApplying] = useState(false);
  const [createSelection, setCreateSelection] = useState<string[] | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSets(await invoke<LazyModSet[]>("list_lazy_mod_sets"));
    } catch (e) {
      console.error(e);
      depsRef.current.showNotification("error", depsRef.current.tt("modpacks.lazy.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSelectedIds = useMemo(() => {
    const known = new Set(sets.map((s) => s.id));
    if (createSelection === null) {
      return sets.filter((s) => s.auto_apply).map((s) => s.id);
    }
    return createSelection.filter((id) => known.has(id));
  }, [sets, createSelection]);

  function toggleCreateSet(setId: string) {
    setCreateSelection(
      createSelectedIds.includes(setId)
        ? createSelectedIds.filter((id) => id !== setId)
        : [...createSelectedIds, setId],
    );
  }

  function resetCreateSelection() {
    setCreateSelection(null);
  }

  async function saveSet(
    id: string | null,
    name: string,
    autoApply: boolean,
    items?: LazyModItem[],
  ): Promise<LazyModSet | null> {
    try {
      const saved = await invoke<LazyModSet>("save_lazy_mod_set", {
        id,
        name,
        autoApply,
        items: items ?? null,
      });
      await refresh();
      return saved;
    } catch (e) {
      console.error(e);
      showNotification("error", `${tt("modpacks.lazy.saveFailed")} ${errorText(e)}`);
      return null;
    }
  }

  async function deleteSet(set: LazyModSet) {
    if (!window.confirm(tt("modpacks.lazy.deleteConfirm", { name: set.name }))) return;
    try {
      await invoke("delete_lazy_mod_set", { setId: set.id });
      await refresh();
    } catch (e) {
      console.error(e);
      showNotification("error", errorText(e));
    }
  }

  async function removeItem(set: LazyModSet, item: LazyModItem) {
    try {
      await invoke("remove_lazy_mod_item", {
        setId: set.id,
        provider: item.provider,
        projectId: item.project_id,
      });
      await refresh();
    } catch (e) {
      console.error(e);
      showNotification("error", errorText(e));
    }
  }

  async function addItemsToSet(set: LazyModSet, items: LazyModItem[], skipped: number) {
    try {
      await invoke("add_lazy_mod_items", { setId: set.id, items });
      await refresh();
      notifyAdded(set.name, items.length, skipped);
      return true;
    } catch (e) {
      console.error(e);
      showNotification("error", errorText(e));
      return false;
    }
  }

  async function createSetWithItems(name: string, items: LazyModItem[], skipped: number) {
    const saved = await saveSet(null, name, false, items);
    if (saved) notifyAdded(saved.name, items.length, skipped);
    return saved;
  }

  function notifyAdded(name: string, count: number, skipped: number) {
    const base = tt("modpacks.lazy.addedToast", { name, count });
    showNotification(
      "success",
      skipped > 0 ? `${base}. ${tt("modpacks.lazy.addedSkipped", { skipped })}` : base,
    );
  }

  function openAddModal(items: LazyModItem[], skipped: number) {
    if (items.length === 0) {
      showNotification("warning", tt("modpacks.lazy.nothingRecognized"));
      return;
    }
    setModal({ mode: "add", items, skipped });
  }

  async function applyToProfile(
    profileId: string,
    setIds: string[],
  ): Promise<LazyApplyReport | null> {
    if (setIds.length === 0) return null;
    setApplying(true);
    try {
      const report = await invoke<LazyApplyReport>("apply_lazy_mod_sets", {
        profileId,
        setIds,
      });
      const parts = [
        tt("modpacks.lazy.appliedToast", {
          installed: report.installed,
          present: report.already_present,
        }),
      ];
      if (report.unavailable.length > 0) {
        parts.push(
          tt("modpacks.lazy.appliedUnavailable", { names: namesList(report.unavailable) }),
        );
      }
      if (report.failed.length > 0) {
        parts.push(
          tt("modpacks.lazy.appliedFailed", {
            names: namesList(report.failed.map((f) => f.title)),
          }),
        );
      }
      const problem = report.unavailable.length > 0 || report.failed.length > 0;
      showNotification(problem ? "warning" : "success", parts.join(". "));
      return report;
    } catch (e) {
      console.error(e);
      showNotification("error", tt("modpacks.lazy.applyFailed", { msg: errorText(e) }));
      return null;
    } finally {
      setApplying(false);
    }
  }

  return {
    sets,
    loading,
    modal,
    setModal,
    applying,
    createSelectedIds,
    toggleCreateSet,
    resetCreateSelection,
    refresh,
    saveSet,
    deleteSet,
    removeItem,
    addItemsToSet,
    createSetWithItems,
    openAddModal,
    applyToProfile,
  };
}
