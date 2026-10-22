import { type InstanceProfile, type LoaderId } from "../types";
import {
  BUILD_PRESETS_UI_ENABLED,
  countLabel,
  formatLastPlayedAt,
  loaderLabels,
} from "../helpers";
import { invoke } from "@tauri-apps/api/core";
import { ProfileCardIconBackdrop, ProfileInstanceIcon } from "../../../components/profile_instance_icon";
import { formatByteSize, formatPlaytimeShort } from "../../../i18n";
import {
  GridViewIcon,
  ImageIcon,
  ListViewIcon,
  ModsIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  WeightIcon,
} from "../icons";
import {
  ChevronDown,
  FolderPlus,
  History,
  MoreHorizontal,
  Play,
  UploadCloud,
  X,
} from "lucide-react";
import { PROFILE_GROUP_COLOR_STYLES } from "../../../lib/profile-groups";
import { createPortal } from "react-dom";
import { InputClearButton } from "../../../components/ui";
import { DeleteIcon } from "../../../components/delete_icon";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function ListView({ ctx }: Props) {
  const {
    selectedProfileId,
    isPinnedInSidebar,
    multiSelectedProfileIds,
    profileDrag,
    profileIconRevisions,
    language,
    handleProfilePointerDown,
    profileDragSuppressClickRef,
    setMultiSelectedProfileIds,
    setSelectedProfileId,
    setEditorSection,
    setActiveView,
    setContextMenu,
    tt,
    onPlaySelectedProfile,
    handleSelectProfile,
    profilesLayout,
    visibleProfileGroups,
    dragOverGroupId,
    setGroupContextMenu,
    toggleGroupCollapsed,
    profilesById,
    profileDragGhostRef,
    fillPane,
    handleListAreaContextMenuCapture,
    search,
    setSearch,
    refreshBuildPresets,
    setIsPresetsModalOpen,
    handleOpenCreateView,
    handleOpenImportView,
    refreshProfiles,
    setProfilesLayout,
    profiles,
    setPendingBulkDeleteProfileIds,
    loadingProfiles,
    openCreateGroupModal,
    profilesScrollRef,
    handleProfilesMarqueePointerDown,
    ungroupedProfiles,
    profileGroups,
    filteredProfiles,
  } = ctx;

  const profilesGridClass = "grid grid-cols-[repeat(auto-fill,minmax(21rem,1fr))] gap-2.5";

  function renderProfileCard(p: InstanceProfile) {
    const isSelected = selectedProfileId === p.id;
    const isPinned = isPinnedInSidebar?.(p.id) ?? false;
    const isMultiSelected = multiSelectedProfileIds.has(p.id);
    const isDragged = profileDrag?.ids.includes(p.id) ?? false;
    const iconRevision = profileIconRevisions[p.id] ?? 0;
    const lastPlayed = formatLastPlayedAt(p.last_played_at, language);
    return (
      <div
        key={p.id}
        data-profile-card
        data-marquee-key={p.id}
        onPointerDown={(e) => handleProfilePointerDown(p.id, e)}
        onDragStart={(e) => e.preventDefault()}
        className={`relative flex cursor-pointer select-none items-center gap-3 overflow-hidden rounded-2xl border px-3 py-2.5 transition ${
          isMultiSelected
            ? "border-accent-to/70 bg-accent-from/15 ring-1 ring-accent-to/40"
            : isSelected
              ? "border-accent-to/55 bg-ink-900/95 ring-1 ring-accent-to/25"
              : "border-white/[0.07] bg-ink-900/90 hover:border-white/15 hover:bg-ink-850"
        } ${isDragged ? "opacity-40" : ""}`}
        onClick={(e) => {
          if (profileDragSuppressClickRef.current) return;
          if (e.ctrlKey || e.metaKey) {
            e.stopPropagation();
            setMultiSelectedProfileIds((prev) => {
              const next = new Set(prev);
              if (next.has(p.id)) next.delete(p.id);
              else next.add(p.id);
              return next;
            });
            return;
          }
          setSelectedProfileId(p.id);
          setEditorSection("content");
          setActiveView("manage");
          void invoke("set_selected_profile", { id: p.id });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({
            profileId: p.id,
            x: e.clientX,
            y: e.clientY,
          });
        }}
      >
        <ProfileCardIconBackdrop profileId={p.id} refreshKey={iconRevision} />
        <ProfileInstanceIcon
          profile={p}
          refreshKey={iconRevision}
          className="z-[1] h-12 w-12 shrink-0"
        />
        <div className="relative z-[1] min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-white">{p.name}</span>
            {isPinned && (
              <img
                src="/launcher-assets/favorite.png"
                alt=""
                className="h-3.5 w-3.5 shrink-0 object-contain opacity-90"
              />
            )}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <span className="tag shrink-0">{p.game_version}</span>
            <span className="tag shrink-0">
              {loaderLabels[p.loader as LoaderId] ?? p.loader}
            </span>
            {isSelected && (
              <span className="tag tag-accent truncate">{tt("modpacks.list.activeBadge")}</span>
            )}
          </div>
          <div className="mt-1.5 flex h-4 flex-wrap items-center gap-x-3 overflow-hidden text-caption text-white/50">
            <span className="flex h-4 items-center gap-1" title={tt("modpacks.list.playtimeLabel")}>
              <img
                src="/launcher-assets/cllock.png"
                alt=""
                className="h-3 w-3 object-contain opacity-70"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.dataset.failedOnce !== "1") {
                    img.dataset.failedOnce = "1";
                    img.src = "/launcher-assets/clock.png";
                    return;
                  }
                  img.style.display = "none";
                }}
              />
              {formatPlaytimeShort(language, p.play_time_seconds)}
            </span>
            <span className="flex h-4 items-center gap-1">
              <ModsIcon className="h-3 w-3" />
              {countLabel(p.mods_count, language)}
            </span>
            <span className="flex h-4 items-center gap-1">
              <WeightIcon className="h-3 w-3" />
              {formatByteSize(language, p.total_size_bytes)}
            </span>
            <span
              className="flex h-4 items-center gap-1"
              title={tt("modpacks.list.lastPlayed", { date: lastPlayed })}
            >
              <History className="h-3 w-3" />
              {lastPlayed}
            </span>
          </div>
        </div>
        <div className="relative z-[1] flex shrink-0 items-center gap-1">
          {isSelected ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPlaySelectedProfile?.();
                }}
                className="btn btn-accent btn-sm"
                title={tt("modpacks.list.playSelectedTitle")}
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                {tt("modpacks.actions.play")}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleSelectProfile(p);
                }}
                className="icon-btn"
                title={tt("modpacks.actions.unselect")}
                aria-label={tt("modpacks.actions.unselect")}
              >
                <X className="h-4 w-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleSelectProfile(p);
              }}
              className="btn btn-soft btn-sm"
            >
              {tt("modpacks.actions.select")}
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderProfilesGrid(list: InstanceProfile[]) {
    return (
      <div className={profilesLayout === "grid" ? profilesGridClass : "flex flex-col gap-2"}>
        {list.map((p) => renderProfileCard(p))}
      </div>
    );
  }

  function renderGroupSection(group: (typeof visibleProfileGroups)[number]) {
    const styles = PROFILE_GROUP_COLOR_STYLES[group.color];
    const isOver = dragOverGroupId === group.id;
    return (
      <section
        key={group.id}
        data-group-drop={group.id}
        className={`rounded-2xl p-1.5 transition ${isOver ? `${styles.headerBg} ring-2 ${styles.ring}` : ""}`}
      >
        <div
          data-group-header
          className="group/header flex h-9 items-center gap-2"
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setGroupContextMenu({ groupId: group.id, x: e.clientX, y: e.clientY });
          }}
        >
          <button
            type="button"
            onClick={() => toggleGroupCollapsed(group.id)}
            className="interactive-press flex min-w-0 items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-white/[0.05]"
            aria-expanded={!group.collapsed}
          >
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-white/45 transition ${group.collapsed ? "-rotate-90" : ""}`}
            />
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${styles.dot}`} />
            <span className="truncate text-sm font-semibold text-white">{group.name}</span>
            <span className="tag shrink-0">{group.profileIds.length}</span>
          </button>
          <div className="h-px min-w-4 flex-1 bg-white/[0.06]" />
          <button
            type="button"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setGroupContextMenu({ groupId: group.id, x: rect.left, y: rect.bottom + 4 });
            }}
            className="icon-btn h-7 w-7 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/header:opacity-100"
            title={tt("modpacks.list.groupActions")}
            aria-label={tt("modpacks.list.groupActions")}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
        {!group.collapsed && (
          <div className="mt-1.5">
            {group.profiles.length > 0 ? (
              renderProfilesGrid(group.profiles)
            ) : (
              <div className="rounded-2xl border border-dashed border-white/[0.12] px-3 py-4 text-center text-meta text-white/45">
                {tt("modpacks.list.dropHint")}
              </div>
            )}
          </div>
        )}
      </section>
    );
  }

  function renderProfileDragGhost() {
    if (!profileDrag) return null;
    const first = profilesById.get(profileDrag.ids[0]);
    return createPortal(
      <div
        ref={profileDragGhostRef}
        className="pointer-events-none fixed left-0 top-0 z-[100]"
        style={{ transform: `translate(${profileDrag.x + 14}px, ${profileDrag.y + 12}px)` }}
      >
        <div className="glass-popover flex max-w-[16rem] items-center gap-2 px-2.5 py-1.5 text-sm font-semibold text-white">
          {first && (
            <ProfileInstanceIcon
              profile={first}
              className="h-7 w-7 shrink-0"
              initialClassName="text-xs"
            />
          )}
          <span className="truncate">
            {profileDrag.ids.length > 1
              ? tt("modpacks.list.dragCount", { count: profileDrag.ids.length })
              : first?.name}
          </span>
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <div
      className={`flex w-full min-h-0 flex-1 flex-col gap-3 ${
        fillPane ? "h-full" : ""
      }`}
      onContextMenuCapture={handleListAreaContextMenuCapture}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="glass-toolbar flex min-w-0 flex-1 basis-[22rem] items-center gap-3 px-4 py-2.5">
          <SearchIcon className="h-4 w-4" />
          <input
            type="text"
            data-hotkey-search
            placeholder={tt("modpacks.list.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 w-full bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
          <InputClearButton
            value={search}
            onClear={() => setSearch("")}
            aria-label={tt("common.clear")}
          />
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 lg:w-auto">
          {BUILD_PRESETS_UI_ENABLED && (
            <button
              type="button"
              onClick={() => {
                void refreshBuildPresets();
                setIsPresetsModalOpen(true);
              }}
              className="interactive-press inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-white/20"
            >
              <span>{tt("modpacks.presets.manage")}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleOpenCreateView}
            className="interactive-press inline-flex items-center gap-2 rounded-xl border border-white/15 accent-bg px-4 py-2 text-sm font-semibold text-white shadow-soft hover:opacity-90"
          >
            <PlusIcon className="h-4 w-4" />
            <span>{tt("modpacks.actions.create")}</span>
          </button>
          <button
            type="button"
            onClick={handleOpenImportView}
            className="interactive-press inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white shadow-soft hover:bg-white/20"
          >
            <UploadCloud className="h-4 w-4" />
            <span>{tt("modpacks.actions.import")}</span>
          </button>
          <button
            type="button"
            onClick={() => void refreshProfiles()}
            className="interactive-press inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/40 px-4 py-2 text-sm font-semibold text-white/80 shadow-soft hover:bg-black/60"
          >
            <RefreshIcon className="h-4 w-4" />
            <span>{tt("modpacks.actions.refresh")}</span>
          </button>
          <div className="flex items-center gap-1 rounded-2xl border border-white/15 bg-black/40 p-1">
            <button
              type="button"
              onClick={() => {
                setProfilesLayout("list");
                try {
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem("modpacks_profiles_layout", "list");
                  }
                } catch {
                  //ignore
                }
              }}
              className={`interactive-press rounded-xl p-1.5 ${
                profilesLayout === "list"
                  ? "seg-on"
                  : "text-white/70 hover:bg-white/10"
              }`}
              title={tt("modpacks.list.layout.list")}
            >
              {profilesLayout === "list" ? (
                <ImageIcon
                  src="/launcher-assets/list-black.png"
                  className="h-4 w-4 object-contain"
                />
              ) : (
                <ListViewIcon className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setProfilesLayout("grid");
                try {
                  if (typeof window !== "undefined") {
                    window.localStorage.setItem("modpacks_profiles_layout", "grid");
                  }
                } catch {
                  //ignore
                }
              }}
              className={`interactive-press rounded-xl p-1.5 ${
                profilesLayout === "grid"
                  ? "seg-on"
                  : "text-white/70 hover:bg-white/10"
              }`}
              title={tt("modpacks.list.layout.grid")}
            >
              {profilesLayout === "grid" ? (
                <ImageIcon
                  src="/launcher-assets/grid-black.png"
                  className="h-4 w-4 object-contain"
                />
              ) : (
                <GridViewIcon className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="glass-panel relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] py-2 pl-4 pr-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-white">
              {tt("modpacks.list.title")}
            </span>
            <span className="tag shrink-0">{profiles.length}</span>
            {multiSelectedProfileIds.size > 0 && (
              <span className="tag tag-accent shrink-0 pr-1">
                {tt("modpacks.list.selectedCount", { count: multiSelectedProfileIds.size })}
                <button
                  type="button"
                  onClick={() => setPendingBulkDeleteProfileIds([...multiSelectedProfileIds])}
                  className="rounded p-0.5 text-red-300 hover:bg-red-600/25"
                  title={tt("modpacks.list.deleteSelected")}
                  aria-label={tt("modpacks.list.deleteSelected")}
                >
                  <DeleteIcon className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setMultiSelectedProfileIds(new Set())}
                  className="rounded p-0.5 hover:bg-white/10"
                  title={tt("modpacks.list.clearSelection")}
                  aria-label={tt("modpacks.list.clearSelection")}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {loadingProfiles && (
              <span className="ui-caption shrink-0">{tt("modpacks.common.loading")}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => openCreateGroupModal()}
            className="btn btn-ghost btn-sm"
          >
            <FolderPlus className="h-4 w-4" />
            {tt("modpacks.list.newGroup")}
          </button>
        </div>
        <div
          ref={profilesScrollRef}
          onPointerDown={handleProfilesMarqueePointerDown}
          className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5"
        >
          <div className="flex flex-col gap-2">
            {visibleProfileGroups.map((group) =>
              search.trim() && group.profiles.length === 0 ? null : renderGroupSection(group),
            )}

            {(ungroupedProfiles.length > 0 ||
              profileGroups.length === 0 ||
              profileDrag !== null) && (
              <section
                data-group-drop="ungrouped"
                className={`rounded-2xl p-1.5 transition ${
                  dragOverGroupId === "ungrouped" ? "bg-white/[0.04] ring-2 ring-white/25" : ""
                }`}
              >
                {profileGroups.length > 0 && (
                  <div className="mb-1.5 flex h-9 items-center gap-2 pl-1">
                    <span className="h-4 w-4 shrink-0" />
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/35" />
                    <span className="text-sm font-semibold text-white/70">
                      {tt("modpacks.list.ungroupedTitle")}
                    </span>
                    <span className="tag shrink-0">{ungroupedProfiles.length}</span>
                    <div className="ml-2 h-px flex-1 bg-white/[0.06]" />
                  </div>
                )}
                {ungroupedProfiles.length > 0 ? (
                  renderProfilesGrid(ungroupedProfiles)
                ) : (
                  profileDrag !== null && (
                    <div className="rounded-2xl border border-dashed border-white/[0.12] px-3 py-4 text-center text-meta text-white/45">
                      {tt("modpacks.list.dropHint")}
                    </div>
                  )
                )}
              </section>
            )}

            {!loadingProfiles && filteredProfiles.length === 0 && (
              <div className="mt-2 rounded-2xl border border-dashed border-white/15 bg-black/40 px-4 py-6 text-center text-sm text-white/70">
                {tt("modpacks.list.empty")}
              </div>
            )}
          </div>
        </div>
      </div>
      {renderProfileDragGhost()}
    </div>
  );
}
