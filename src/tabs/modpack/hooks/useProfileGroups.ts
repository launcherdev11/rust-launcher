import type { Dispatch, SetStateAction, RefObject } from "react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  assignProfilesToGroup,
  dedupeProfileGroupAssignments,
  loadProfileGroups,
  newProfileGroupId,
  type ProfileGroup,
  type ProfileGroupColor,
  sanitizeProfileGroups,
  saveProfileGroups,
  ungroupProfiles,
} from "../../../lib/profile-groups";
import { type InstanceProfile, type NotificationKind } from "../types";

type ProfileGroupsDeps = {
  resourcePackReorderListenersRef: RefObject<(() => void) | null>;
  filteredProfiles: InstanceProfile[];
  profiles: InstanceProfile[];
  search: string;
  profilesById: Map<string, InstanceProfile>;
  profilesLoadedRef: RefObject<boolean>;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  setMultiSelectedProfileIds: Dispatch<SetStateAction<Set<string>>>;
  multiSelectedProfileIds: Set<string>;
  profilesScrollRef: RefObject<HTMLDivElement | null>;
  setListContextMenu: Dispatch<SetStateAction<{ x: number; y: number; } | null>>;
};

export function useProfileGroups(deps: ProfileGroupsDeps) {
  const {
    resourcePackReorderListenersRef,
    filteredProfiles,
    profiles,
    search,
    profilesById,
    profilesLoadedRef,
    showNotification,
    tt,
    setMultiSelectedProfileIds,
    multiSelectedProfileIds,
    profilesScrollRef,
    setListContextMenu,
  } = deps;

  const [profileGroups, setProfileGroups] = useState<ProfileGroup[]>(() => loadProfileGroups());
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupFormName, setGroupFormName] = useState("");
  const [groupFormColor, setGroupFormColor] = useState<ProfileGroupColor>("purple");
  const [groupFormProfileIds, setGroupFormProfileIds] = useState<Set<string>>(new Set());
  const [isGroupProfilesDropdownOpen, setIsGroupProfilesDropdownOpen] = useState(false);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

  const [profileDrag, setProfileDrag] = useState<{ ids: string[]; x: number; y: number } | null>(
    null,
  );

  const profilePointerDragRef = useRef<{
    ids: string[];
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);

  const profileDragListenersRef = useRef<(() => void) | null>(null);
  const profileDragGhostRef = useRef<HTMLDivElement | null>(null);
  const profileDragSuppressClickRef = useRef(false);
  const groupProfilesDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      resourcePackReorderListenersRef.current?.();
      resourcePackReorderListenersRef.current = null;
      profileDragListenersRef.current?.();
      profileDragListenersRef.current = null;
    };
  }, []);

  const groupedProfileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of profileGroups) {
      for (const id of group.profileIds) ids.add(id);
    }
    return ids;
  }, [profileGroups]);

  const ungroupedProfiles = useMemo(
    () => filteredProfiles.filter((p) => !groupedProfileIds.has(p.id)),
    [filteredProfiles, groupedProfileIds],
  );

  const profileIdsSignature = useMemo(
    () => profiles.map((p) => p.id).sort().join("\0"),
    [profiles],
  );

  const visibleProfileGroups = useMemo(() => {
    const query = search.trim();
    return profileGroups.map((group) => ({
      ...group,
      profiles: group.profileIds
        .map((id) => profilesById.get(id))
        .filter((p): p is InstanceProfile => !!p)
        .filter((p) =>
          !query ||
          p.name.toLowerCase().includes(query.toLowerCase()) ||
          p.game_version.toLowerCase().includes(query.toLowerCase()),
        ),
    }));
  }, [profileGroups, profilesById, search]);

  useEffect(() => {
    if (!profilesLoadedRef.current || profileIdsSignature.length === 0) return;
    const validIds = new Set(profileIdsSignature.split("\0"));
    setProfileGroups((prev) => {
      const sanitized = sanitizeProfileGroups(prev, validIds);
      const next = dedupeProfileGroupAssignments(sanitized);
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        saveProfileGroups(next);
        return next;
      }
      return prev;
    });
  }, [profileIdsSignature]);

  useEffect(() => {
    if (!isGroupProfilesDropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = groupProfilesDropdownRef.current;
      if (el && !el.contains(e.target as Node)) {
        setIsGroupProfilesDropdownOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isGroupProfilesDropdownOpen]);

  function openCreateGroupModal(initialProfileIds: string[] = []) {
    setEditingGroupId(null);
    setGroupFormName("");
    setGroupFormColor("purple");
    setGroupFormProfileIds(new Set(initialProfileIds));
    setIsGroupProfilesDropdownOpen(false);
    setIsGroupModalOpen(true);
  }

  function openEditGroupModal(group: ProfileGroup) {
    setEditingGroupId(group.id);
    setGroupFormName(group.name);
    setGroupFormColor(group.color);
    setGroupFormProfileIds(new Set(group.profileIds));
    setIsGroupProfilesDropdownOpen(false);
    setIsGroupModalOpen(true);
  }

  function handleSaveGroup() {
    const name = groupFormName.trim();
    if (!name) {
      showNotification("warning", tt("modpacks.groups.nameRequired"));
      return;
    }
    const profileIds = [...groupFormProfileIds];
    const editingId = editingGroupId;
    let savedAsEdit = false;

    setProfileGroups((prev) => {
      const isEditing =
        editingId != null && prev.some((group) => group.id === editingId);

      if (isEditing && editingId) {
        savedAsEdit = true;
        const next = dedupeProfileGroupAssignments(
          ungroupProfiles(prev, profileIds).map((group) =>
            group.id === editingId
              ? { ...group, name, color: groupFormColor, profileIds }
              : group,
          ),
        );
        saveProfileGroups(next);
        return next;
      }

      const cleaned = profileIds.length > 0 ? ungroupProfiles(prev, profileIds) : prev;
      const newGroup: ProfileGroup = {
        id: newProfileGroupId(),
        name,
        color: groupFormColor,
        profileIds,
        collapsed: false,
      };
      const next = dedupeProfileGroupAssignments([...cleaned, newGroup]);
      saveProfileGroups(next);
      return next;
    });

    showNotification(
      "success",
      savedAsEdit
        ? tt("modpacks.groups.updated", { name })
        : tt("modpacks.groups.created", { name }),
    );
    setEditingGroupId(null);
    setIsGroupModalOpen(false);
  }

  function handleDeleteGroup(groupId: string) {
    setProfileGroups((prev) => {
      const next = prev.filter((group) => group.id !== groupId);
      saveProfileGroups(next);
      return next;
    });
    if (editingGroupId === groupId) {
      setEditingGroupId(null);
      setIsGroupModalOpen(false);
    }
    showNotification("info", tt("modpacks.groups.deleted"));
  }

  function toggleGroupCollapsed(groupId: string) {
    setProfileGroups((prev) => {
      const next = prev.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g));
      saveProfileGroups(next);
      return next;
    });
  }

  function moveProfilesToGroup(groupId: string | "ungrouped", ids: string[]) {
    if (ids.length === 0) return;
    setProfileGroups((prev) => {
      const next =
        groupId === "ungrouped"
          ? ungroupProfiles(prev, ids)
          : dedupeProfileGroupAssignments(assignProfilesToGroup(prev, groupId, ids));
      saveProfileGroups(next);
      return next;
    });
    setMultiSelectedProfileIds(new Set());
  }

  function profileIdsForAction(profileId: string): string[] {
    return multiSelectedProfileIds.has(profileId) ? [...multiSelectedProfileIds] : [profileId];
  }

  function handleProfilePointerDown(profileId: string, e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    profileDragListenersRef.current?.();
    profilePointerDragRef.current = {
      ids: profileIdsForAction(profileId),
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };

    const groupAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      return el?.closest<HTMLElement>("[data-group-drop]")?.dataset.groupDrop ?? null;
    };

    const onMove = (ev: PointerEvent) => {
      const drag = profilePointerDragRef.current;
      if (!drag) return;
      if (!drag.active) {
        if (Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < 6) return;
        drag.active = true;
        document.body.style.userSelect = "none";
        setProfileDrag({ ids: drag.ids, x: ev.clientX, y: ev.clientY });
      }
      const ghost = profileDragGhostRef.current;
      if (ghost) {
        ghost.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 12}px)`;
      }
      setDragOverGroupId(groupAt(ev.clientX, ev.clientY));
      const scroller = profilesScrollRef.current;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        if (ev.clientY < rect.top + 48) scroller.scrollBy(0, -16);
        else if (ev.clientY > rect.bottom - 48) scroller.scrollBy(0, 16);
      }
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      profilePointerDragRef.current = null;
      profileDragListenersRef.current = null;
      document.body.style.userSelect = "";
      setProfileDrag(null);
      setDragOverGroupId(null);
    };

    const finish = (point: { x: number; y: number } | null) => {
      const drag = profilePointerDragRef.current;
      cleanup();
      if (!drag?.active) return;
      profileDragSuppressClickRef.current = true;
      window.setTimeout(() => {
        profileDragSuppressClickRef.current = false;
      }, 0);
      const target = point ? groupAt(point.x, point.y) : null;
      if (target) moveProfilesToGroup(target, drag.ids);
    };

    const onUp = (ev: PointerEvent) => finish({ x: ev.clientX, y: ev.clientY });
    const onCancel = () => finish(null);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") finish(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    profileDragListenersRef.current = cleanup;
  }

  function handleListAreaContextMenuCapture(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-profile-card]")) return;
    if (target.closest("[data-group-header]")) return;
    if (target.closest("button, input, textarea, select, a, label")) return;
    e.preventDefault();
    e.stopPropagation();
    setListContextMenu({ x: e.clientX, y: e.clientY });
  }

  return {
    profileGroups,
    isGroupModalOpen,
    setIsGroupModalOpen,
    editingGroupId,
    setEditingGroupId,
    groupFormName,
    setGroupFormName,
    groupFormColor,
    setGroupFormColor,
    groupFormProfileIds,
    setGroupFormProfileIds,
    isGroupProfilesDropdownOpen,
    setIsGroupProfilesDropdownOpen,
    dragOverGroupId,
    profileDrag,
    profileDragGhostRef,
    profileDragSuppressClickRef,
    groupProfilesDropdownRef,
    ungroupedProfiles,
    visibleProfileGroups,
    openCreateGroupModal,
    openEditGroupModal,
    handleSaveGroup,
    handleDeleteGroup,
    toggleGroupCollapsed,
    moveProfilesToGroup,
    profileIdsForAction,
    handleProfilePointerDown,
    handleListAreaContextMenuCapture,
  };
}
