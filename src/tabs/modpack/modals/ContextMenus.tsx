import { ContextMenuPanel } from "../../../components/ContextMenuPanel";
import { ProfileInfoIcon } from "../../../components/profile_info_modal";
import {
  BackupIcon,
  EditIcon,
  ExportIcon,
  PlusIcon,
  SettingsIcon,
} from "../icons";
import { PROFILE_GROUP_COLOR_STYLES } from "../../../lib/profile-groups";
import { Check, FolderPlus, X } from "lucide-react";
import { DeleteIcon } from "../../../components/delete_icon";
import { HoldToConfirmButton } from "../../../components/ui";
import { invoke } from "@tauri-apps/api/core";
import type { ModpackController } from "../useModpackController";

type Props = { ctx: ModpackController };

export function ContextMenus({ ctx }: Props) {
  const {
    contextMenu,
    setContextMenu,
    profiles,
    setProfileInfoProfile,
    tt,
    openProfileSettings,
    handleChooseProfileIcon,
    handleDuplicateProfile,
    duplicateBusy,
    handleCreateDesktopShortcut,
    handleSaveBuildPresetFromProfile,
    handleCreateBackup,
    backupCreating,
    openBackupsModal,
    profileIdsForAction,
    profileGroups,
    moveProfilesToGroup,
    openCreateGroupModal,
    onTogglePinInSidebar,
    isPinnedInSidebar,
    setPendingBulkDeleteProfileIds,
    handleDeleteProfile,
    setSelectedProfileId,
    setEditorSection,
    setActiveView,
    setRenameValue,
    setIsRenaming,
    listContextMenu,
    setListContextMenu,
    groupContextMenu,
    setGroupContextMenu,
    openEditGroupModal,
    handleDeleteGroup,
  } = ctx;

  return (
    <>
      {contextMenu && (
        <ContextMenuPanel
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
            <button
              type="button"
              onClick={() => {
                const profile = profiles.find((p) => p.id === contextMenu.profileId);
                setContextMenu(null);
                if (!profile) return;
                setProfileInfoProfile(profile);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <ProfileInfoIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.profileInfo.menuItem")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profile = profiles.find((p) => p.id === contextMenu.profileId);
                setContextMenu(null);
                if (!profile) return;
                void openProfileSettings(profile.id);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.contextMenu.settings")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profile = profiles.find((p) => p.id === contextMenu.profileId);
                setContextMenu(null);
                if (!profile) return;
                void handleChooseProfileIcon(profile);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <img src="/launcher-assets/edit.png" alt="" className="h-3.5 w-3.5 object-contain" />
              <span>{tt("modpacks.profile.changeIconTitle")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profile = profiles.find((p) => p.id === contextMenu.profileId);
                setContextMenu(null);
                if (!profile) return;
                void handleDuplicateProfile(profile);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
              disabled={duplicateBusy}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              <span>
                {duplicateBusy
                  ? tt("modpacks.editor.duplicating")
                  : tt("modpacks.editor.duplicate")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profile = profiles.find((p) => p.id === contextMenu.profileId);
                setContextMenu(null);
                if (!profile) return;
                void handleCreateDesktopShortcut(profile);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <ExportIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.actions.createShortcut")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profile = profiles.find((p) => p.id === contextMenu.profileId);
                setContextMenu(null);
                if (!profile) return;
                void handleSaveBuildPresetFromProfile(profile);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.presets.saveFromProfile")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profileId = contextMenu.profileId;
                setContextMenu(null);
                void handleCreateBackup(profileId);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
              disabled={backupCreating}
            >
              <BackupIcon className="h-3.5 w-3.5" />
              <span>
                {backupCreating
                  ? tt("modpacks.backups.creating")
                  : tt("modpacks.contextMenu.createBackup")}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                const profileId = contextMenu.profileId;
                setContextMenu(null);
                void openBackupsModal(profileId);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <BackupIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.contextMenu.manageBackups")}</span>
            </button>
            {(() => {
              const ids = profileIdsForAction(contextMenu.profileId);
              const currentGroupId = profileGroups.find((g) =>
                g.profileIds.includes(contextMenu.profileId),
              )?.id;
              return (
                <>
                  <div className="mx-2 my-1 h-px bg-white/[0.06]" />
                  <div className="px-3 pb-0.5 pt-1 text-[0.75rem] text-white/45">
                    {tt("modpacks.contextMenu.moveToGroup")}
                  </div>
                  {profileGroups.map((group) => {
                    const isCurrent = group.id === currentGroupId;
                    return (
                      <button
                        key={group.id}
                        type="button"
                        disabled={isCurrent && ids.length === 1}
                        onClick={() => {
                          setContextMenu(null);
                          moveProfilesToGroup(group.id, ids);
                        }}
                        className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10 disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${PROFILE_GROUP_COLOR_STYLES[group.color].dot}`}
                        />
                        <span className="min-w-0 flex-1 truncate">{group.name}</span>
                        {isCurrent && <Check className="h-3.5 w-3.5 shrink-0 text-white/60" />}
                      </button>
                    );
                  })}
                  {currentGroupId && (
                    <button
                      type="button"
                      onClick={() => {
                        setContextMenu(null);
                        moveProfilesToGroup("ungrouped", ids);
                      }}
                      className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>{tt("modpacks.contextMenu.removeFromGroup")}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setContextMenu(null);
                      openCreateGroupModal(ids);
                    }}
                    className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    <span>{tt("modpacks.list.newGroup")}</span>
                  </button>
                  <div className="mx-2 my-1 h-px bg-white/[0.06]" />
                </>
              );
            })()}
            <button
              type="button"
              onClick={() => {
                const profile = profiles.find((p) => p.id === contextMenu.profileId);
                setContextMenu(null);
                if (!profile) return;
                onTogglePinInSidebar?.(profile);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              <span>
                {(() => {
                  const pinned = isPinnedInSidebar?.(contextMenu.profileId) ?? false;
                  return pinned
                    ? tt("modpacks.contextMenu.unpinFromSidebar")
                    : tt("modpacks.contextMenu.pinToSidebar");
                })()}
              </span>
            </button>
            {(() => {
              const count = profileIdsForAction(contextMenu.profileId).length;
              const className =
                "mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-danger-hi hover:bg-danger-strong/20";
              if (count > 1) {
                return (
                  <button
                    type="button"
                    onClick={() => {
                      const ids = profileIdsForAction(contextMenu.profileId);
                      setContextMenu(null);
                      setPendingBulkDeleteProfileIds(ids);
                    }}
                    className={className}
                  >
                    <DeleteIcon className="h-3.5 w-3.5" />
                    <span>{tt("modpacks.contextMenu.deleteSelectedProfiles", { count })}</span>
                  </button>
                );
              }
              return (
                <HoldToConfirmButton
                  holdHint={tt("common.holdToDelete")}
                  onConfirm={() => {
                    const profile = profiles.find((p) => p.id === contextMenu.profileId);
                    setContextMenu(null);
                    if (profile) void handleDeleteProfile(profile);
                  }}
                  className={className}
                >
                  <DeleteIcon className="h-3.5 w-3.5" />
                  <span>{tt("modpacks.contextMenu.deleteProfile")}</span>
                </HoldToConfirmButton>
              );
            })()}
            <button
              type="button"
              onClick={() => {
                const profile = profiles.find(
                  (p) => p.id === contextMenu.profileId,
                );
                setContextMenu(null);
                if (!profile) return;
                setSelectedProfileId(profile.id);
                setEditorSection("content");
                setActiveView("manage");
                setRenameValue(profile.name);
                setIsRenaming(true);
                void invoke("set_selected_profile", { id: profile.id });
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <EditIcon className="h-3.5 w-3.5" />
              <span>
                {tt("modpacks.contextMenu.renameProfile")}
              </span>
            </button>
        </ContextMenuPanel>
      )}

      {listContextMenu && (
        <ContextMenuPanel
          x={listContextMenu.x}
          y={listContextMenu.y}
          onClose={() => setListContextMenu(null)}
        >
            <button
              type="button"
              onClick={() => {
                setListContextMenu(null);
                openCreateGroupModal();
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.list.createGroupMenu")}</span>
            </button>
        </ContextMenuPanel>
      )}

      {groupContextMenu && (
        <ContextMenuPanel
          x={groupContextMenu.x}
          y={groupContextMenu.y}
          onClose={() => setGroupContextMenu(null)}
        >
            <button
              type="button"
              onClick={() => {
                const group = profileGroups.find((g) => g.id === groupContextMenu.groupId);
                setGroupContextMenu(null);
                if (!group) return;
                openEditGroupModal(group);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left hover:bg-white/10"
            >
              <EditIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.list.editGroupMenu")}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const groupId = groupContextMenu.groupId;
                setGroupContextMenu(null);
                handleDeleteGroup(groupId);
              }}
              className="mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-danger-hi hover:bg-danger-strong/20"
            >
              <DeleteIcon className="h-3.5 w-3.5" />
              <span>{tt("modpacks.list.deleteGroupMenu")}</span>
            </button>
        </ContextMenuPanel>
      )}
    </>
  );
}
