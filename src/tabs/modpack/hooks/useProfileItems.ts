import type { Language } from "../../../i18n";
import type { Dispatch, SetStateAction } from "react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ContentFilter,
  type ContentTab,
  type InstanceProfile,
  type NotificationKind,
  type ProfileContentUpdate,
  type ProfileItemEntry,
  type ProfileItemMetadata,
  type ViewId,
} from "../types";
import { useMarqueeSelection } from "../../../hooks/useMarqueeSelection";
import { invoke } from "@tauri-apps/api/core";
import { t } from "../../../i18n";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { disposeWhenResolved } from "../../../lib/tauriEvents";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { filterPathsForContentTab } from "../helpers";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

type ProfileItemsDeps = {
  selectedProfileId: string | null;
  activeView: ViewId;
  contentTab: ContentTab;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  language: Language;
  selectedProfile: InstanceProfile | null;
  isProfileSettingsOpen: boolean;
  setProfileConflictsRefreshToken: Dispatch<SetStateAction<number>>;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  refreshProfiles: (options?: { background?: boolean; }) => Promise<void>;
  setContentUpdatesAvailableFilenames: Dispatch<SetStateAction<Set<string>>>;
  setContentUpdatesAvailabilityLoading: Dispatch<SetStateAction<boolean>>;
};

export function useProfileItems(deps: ProfileItemsDeps) {
  const {
    selectedProfileId,
    activeView,
    contentTab,
    showNotification,
    language,
    selectedProfile,
    isProfileSettingsOpen,
    setProfileConflictsRefreshToken,
    tt,
    refreshProfiles,
    setContentUpdatesAvailableFilenames,
    setContentUpdatesAvailabilityLoading,
  } = deps;

  const [items, setItems] = useState<ProfileItemEntry[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);

  const [itemMetadataByFilename, setItemMetadataByFilename] = useState<
    Record<string, ProfileItemMetadata>

  >({});

  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [itemsSearch, setItemsSearch] = useState("");
  const [contentFilter, setContentFilter] = useState<ContentFilter>("all");
  const [selectedContentNames, setSelectedContentNames] = useState<Set<string>>(new Set());
  const manageDropZoneRef = useRef<HTMLDivElement | null>(null);
  const [isManageDropTarget, setIsManageDropTarget] = useState(false);

  const handleContentMarqueePointerDown = useMarqueeSelection({
    containerRef: manageDropZoneRef,
    selected: selectedContentNames,
    onChange: setSelectedContentNames,
  });

  useEffect(() => {
    if (!selectedProfileId) {
      setItems([]);
      return;
    }
    if (activeView === "manage") {
      void refreshItems(selectedProfileId, contentTab);
    }
  }, [selectedProfileId, contentTab, activeView]);

  const profileItemsKey = useMemo(
    () => items.map((item) => item.name).sort().join("\0"),
    [items],
  );

  useEffect(() => {
    if (!selectedProfileId || activeView !== "manage" || items.length === 0) {
      setItemMetadataByFilename({});
      return;
    }

    const category =
      contentTab === "mods"
        ? "mods"
        : contentTab === "resourcepacks"
          ? "resourcepacks"
          : "shaderpacks";

    let cancelled = false;
    void (async () => {
      try {
        const metadata = await invoke<ProfileItemMetadata[]>(
          "resolve_profile_item_metadata",
          {
            profileId: selectedProfileId,
            category,
          },
        );
        if (cancelled) return;
        const next: Record<string, ProfileItemMetadata> = {};
        for (const entry of metadata) {
          next[entry.filename] = entry;
        }
        setItemMetadataByFilename(next);
      } catch (e) {
        console.error(e);
        if (!cancelled) setItemMetadataByFilename({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProfileId, contentTab, activeView, profileItemsKey]);

  async function refreshItems(id: string, tab: ContentTab) {
    setItemsLoading(true);
    try {
      const category =
        tab === "mods"
          ? "mods"
          : tab === "resourcepacks"
            ? "resourcepacks"
            : "shaderpacks";
      const files = await invoke<ProfileItemEntry[]>("list_profile_items", {
        id,
        category,
      });
      setItems(files);
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.loadFilesFailed"));
    } finally {
      setItemsLoading(false);
    }
  }

  async function addProfileFilesFromPaths(paths: string[]) {
    if (!selectedProfile || paths.length === 0) return;
    try {
      const category =
        contentTab === "mods"
          ? "mods"
          : contentTab === "resourcepacks"
            ? "resourcepacks"
            : "shaderpacks";
      await invoke("add_profile_files", {
        id: selectedProfile.id,
        category,
        files: paths,
      });
      await refreshItems(selectedProfile.id, contentTab);
      showNotification("success", t(language, "modpacks.toast.filesAdded"));
      if (category === "mods" && isProfileSettingsOpen) {
        setProfileConflictsRefreshToken((v) => v + 1);
      }
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.addFilesFailed"));
    }
  }

  useEffect(() => {
    if (activeView !== "manage" || !selectedProfile) return;
    const webview = getCurrentWebview();
    const disposeDragDrop = disposeWhenResolved(
      webview.onDragDropEvent(async (event) => {
        const p = event.payload;
        if (p.type === "leave") {
          setIsManageDropTarget(false);
          return;
        }
        if (p.type === "enter") {
          return;
        }
        const factor = await getCurrentWindow().scaleFactor();
        const el = manageDropZoneRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const pos = new PhysicalPosition(p.position.x, p.position.y).toLogical(factor);
        const inside =
          pos.x >= rect.left &&
          pos.x <= rect.right &&
          pos.y >= rect.top &&
          pos.y <= rect.bottom;
        if (p.type === "over") {
          setIsManageDropTarget(inside);
          return;
        }
        if (p.type === "drop") {
          setIsManageDropTarget(false);
          if (!inside || !p.paths?.length) return;
          const filtered = filterPathsForContentTab(contentTab, p.paths);
          if (filtered.length === 0) {
            showNotification("warning", t(language, "modpacks.toast.noMatchingFiles"));
            return;
          }
          await addProfileFilesFromPaths(filtered);
        }
      }),
    );
    return () => {
      setIsManageDropTarget(false);
      disposeDragDrop();
    };
  }, [activeView, selectedProfile?.id, contentTab, language]);

  async function handleAddFilesFromPc() {
    if (!selectedProfile) return;
    try {
      const paths = await openFileDialog({
        multiple: true,
        directory: false,
        filters: [
          {
            name: "Files",
            extensions:
              contentTab === "mods"
                ? ["jar"]
                : contentTab === "shaderpacks"
                  ? ["zip"]
                  : ["zip", "rar", "7z", "mcpack"],
          },
        ],
      });
      const arr =
        typeof paths === "string"
          ? [paths]
          : Array.isArray(paths)
            ? (paths as string[])
            : [];
      if (arr.length === 0) return;
      await addProfileFilesFromPaths(arr);
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.addFilesFailed"));
    }
  }

  async function handleDeleteItem(item: ProfileItemEntry) {
    if (!selectedProfile) return;
    try {
      const category =
        contentTab === "mods"
          ? "mods"
          : contentTab === "resourcepacks"
            ? "resourcepacks"
            : "shaderpacks";
      await invoke("delete_item", {
        id: selectedProfile.id,
        category,
        filename: item.name,
      });
      setItems((prev) => prev.filter((f) => f.name !== item.name));
      if (category === "mods") {
        setProfileConflictsRefreshToken((v) => v + 1);
      }
      setSelectedContentNames((prev) => {
        if (!prev.has(item.name)) return prev;
        const next = new Set(prev);
        next.delete(item.name);
        return next;
      });
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.deleteFileFailed"));
    }
  }

  async function handleToggleItemEnabled(item: ProfileItemEntry) {
    if (!selectedProfile) return;
    const nextEnabled = !item.enabled;
    try {
      const category =
        contentTab === "mods"
          ? "mods"
          : contentTab === "resourcepacks"
            ? "resourcepacks"
            : "shaderpacks";
      await invoke("set_profile_item_enabled", {
        id: selectedProfile.id,
        category,
        filename: item.name,
        enabled: nextEnabled,
      });
      setItems((prev) =>
        prev.map((entry) =>
          entry.name === item.name ? { ...entry, enabled: nextEnabled } : entry,
        ),
      );
      if (category === "resourcepacks" || category === "shaderpacks") {
        await refreshItems(selectedProfile.id, contentTab);
      }
      if (category === "mods") {
        setProfileConflictsRefreshToken((v) => v + 1);
      }
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("modpacks.manage.toggleFailed"),
      );
    }
  }

  function contentCategory(): "mods" | "resourcepacks" | "shaderpacks" {
    return contentTab === "mods"
      ? "mods"
      : contentTab === "resourcepacks"
        ? "resourcepacks"
        : "shaderpacks";
  }

  function toggleContentSelected(name: string) {
    setSelectedContentNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function handleContentRowClick(name: string, e: React.MouseEvent<HTMLDivElement>) {
    if (!(e.ctrlKey || e.metaKey)) return;
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    e.preventDefault();
    toggleContentSelected(name);
  }

  async function handleBulkSetEnabled(enabled: boolean) {
    if (!selectedProfile || selectedContentNames.size === 0) return;
    const category = contentCategory();
    const names = [...selectedContentNames];
    try {
      for (const filename of names) {
        await invoke("set_profile_item_enabled", {
          id: selectedProfile.id,
          category,
          filename,
          enabled,
        });
      }
      await refreshItems(selectedProfile.id, contentTab);
      setSelectedContentNames(new Set());
      if (category === "mods") setProfileConflictsRefreshToken((v) => v + 1);
    } catch (e) {
      console.error(e);
      showNotification("error", tt("modpacks.manage.toggleFailed"));
    }
  }

  async function handleBulkDelete() {
    if (!selectedProfile || selectedContentNames.size === 0) return;
    const count = selectedContentNames.size;
    if (!window.confirm(tt("modpacks.editor.bulkDeleteConfirm", { count }))) return;
    const category = contentCategory();
    const names = [...selectedContentNames];
    try {
      for (const filename of names) {
        await invoke("delete_item", {
          id: selectedProfile.id,
          category,
          filename,
        });
      }
      await refreshItems(selectedProfile.id, contentTab);
      setSelectedContentNames(new Set());
      if (category === "mods") setProfileConflictsRefreshToken((v) => v + 1);
      void refreshProfiles();
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.deleteFileFailed"));
    }
  }

  useEffect(() => {
    if (!selectedProfile) {
      setContentUpdatesAvailableFilenames(new Set());
      setContentUpdatesAvailabilityLoading(false);
      return;
    }
    if (contentTab !== "mods") return;

    let cancelled = false;
    setContentUpdatesAvailabilityLoading(true);
    (async () => {
      try {
        const updates = await invoke<ProfileContentUpdate[]>("check_profile_content_updates", {
          profileId: selectedProfile.id,
          category: "mods",
        });
        if (cancelled) return;
        setContentUpdatesAvailableFilenames(new Set(updates.map((u) => u.filename)));
      } catch {
        if (cancelled) return;
        setContentUpdatesAvailableFilenames(new Set());
      } finally {
        if (!cancelled) setContentUpdatesAvailabilityLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProfile?.id, contentTab]);

  return {
    items,
    setItems,
    itemsLoading,
    itemMetadataByFilename,
    isAddMenuOpen,
    setIsAddMenuOpen,
    itemsSearch,
    setItemsSearch,
    contentFilter,
    setContentFilter,
    selectedContentNames,
    setSelectedContentNames,
    manageDropZoneRef,
    isManageDropTarget,
    handleContentMarqueePointerDown,
    refreshItems,
    handleAddFilesFromPc,
    handleDeleteItem,
    handleToggleItemEnabled,
    toggleContentSelected,
    handleContentRowClick,
    handleBulkSetEnabled,
    handleBulkDelete,
  };
}
