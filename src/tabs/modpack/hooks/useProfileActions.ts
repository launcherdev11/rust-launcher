import type { Language } from "../../../i18n";
import type { DownloadJobKind } from "../../../hooks/useDownloadJobs";
import type { Dispatch, SetStateAction, RefObject } from "react";
import { useState } from "react";
import {
  type BuildPreset,
  type ForgeVersionSummary,
  type InstanceProfile,
  type LoaderId,
  type LoaderVersionOption,
  type NotificationKind,
  type VersionSummary,
  type ViewId,
} from "../types";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { BUILD_PRESETS_UI_ENABLED, defaultProfileName } from "../helpers";
import type { useLazyMods } from "./useLazyMods";
import { t } from "../../../i18n";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

type ProfileActionsDeps = {
  selectedProfile: InstanceProfile | null;
  setProfiles: Dispatch<SetStateAction<InstanceProfile[]>>;
  onProfilesChange: ((profiles: InstanceProfile[]) => void) | undefined;
  setProfileIconRevisions: Dispatch<SetStateAction<Record<string, number>>>;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  createName: string;
  createLoader: LoaderId;
  createGameVersion: string;
  createLoaderVersion: string;
  language: Language;
  setCreateBusy: Dispatch<SetStateAction<boolean>>;
  versionOptions: VersionSummary[];
  createIconPath: string | null;
  selectedCreatePreset: BuildPreset | null;
  prepareInstallConsole: ((profileId?: string | null) => void) | undefined;
  registerDownloadJob: ((params: { id: string; label: string; kind: DownloadJobKind; percent?: number | null; }) => void) | undefined;
  finishDownloadJob: ((id: string) => void) | undefined;
  createNameUserEdited: RefObject<boolean>;
  setCreateName: Dispatch<SetStateAction<string>>;
  setCreateIconPath: Dispatch<SetStateAction<string | null>>;
  setCreateLoaderVersion: Dispatch<SetStateAction<string>>;
  setLoaderVersionOptions: Dispatch<SetStateAction<LoaderVersionOption[]>>;
  clearCreatePresetSelection: () => void;
  lazy: ReturnType<typeof useLazyMods>;
  setActiveView: Dispatch<SetStateAction<ViewId>>;
  setSelectedProfileId: Dispatch<SetStateAction<string | null>>;
  selectedProfileId: string | null;
  activeView: ViewId;
  setMultiSelectedProfileIds: Dispatch<SetStateAction<Set<string>>>;
};

export function useProfileActions(deps: ProfileActionsDeps) {
  const {
    selectedProfile,
    setProfiles,
    onProfilesChange,
    setProfileIconRevisions,
    showNotification,
    tt,
    createName,
    createLoader,
    createGameVersion,
    createLoaderVersion,
    language,
    setCreateBusy,
    versionOptions,
    createIconPath,
    selectedCreatePreset,
    prepareInstallConsole,
    registerDownloadJob,
    finishDownloadJob,
    createNameUserEdited,
    setCreateName,
    setCreateIconPath,
    setCreateLoaderVersion,
    setLoaderVersionOptions,
    clearCreatePresetSelection,
    lazy,
    setActiveView,
    setSelectedProfileId,
    selectedProfileId,
    activeView,
    setMultiSelectedProfileIds,
  } = deps;

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const [pendingBulkDeleteProfileIds, setPendingBulkDeleteProfileIds] = useState<string[] | null>(
    null,
  );

  const [duplicateBusy, setDuplicateBusy] = useState(false);

  const [iconPickerProfile, setIconPickerProfile] = useState<InstanceProfile | null>(null);

  function handleChooseProfileIcon(profileOverride?: InstanceProfile) {
    const profile = profileOverride ?? selectedProfile;
    if (profile) setIconPickerProfile(profile);
  }

  function applyProfileIconChange(profile: InstanceProfile, iconPath: string | null) {
    setProfiles((prev) => {
      const next = prev.map((p) =>
        p.id === profile.id ? { ...p, icon_path: iconPath ?? p.icon_path } : p,
      );
      onProfilesChange?.(next);
      return next;
    });
    setProfileIconRevisions((prev) => ({
      ...prev,
      [profile.id]: (prev[profile.id] ?? 0) + 1,
    }));
    showNotification("success", tt("modpacks.profile.iconChanged"));
  }

  async function handleApplyTextureIcon(
    profile: InstanceProfile,
    textureId: string,
    background: string | null,
  ) {
    try {
      const iconPath = await invoke<string | null>("set_profile_icon_from_texture", {
        profileId: profile.id,
        textureId,
        background,
      });
      applyProfileIconChange(profile, iconPath);
      setIconPickerProfile(null);
    } catch (e) {
      console.error(e);
      showNotification("error", tt("modpacks.profile.iconChangeFailed"));
    }
  }

  async function handleChooseProfileIconFile(profile: InstanceProfile) {
    try {
      const path = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "webp"],
          },
        ],
      });
      if (typeof path !== "string") return;

      const iconPath = await invoke<string | null>("set_profile_icon_from_file", {
        profileId: profile.id,
        iconSourcePath: path,
      });

      applyProfileIconChange(profile, iconPath);
      setIconPickerProfile(null);
    } catch (e) {
      console.error(e);
      showNotification("error", tt("modpacks.profile.iconChangeFailed"));
    }
  }

  async function handleCreateProfile() {
    const name = (
      createName.trim() || defaultProfileName(createLoader, createGameVersion)
    ).slice(0, 50);
    const loaderVersion =
      createLoader === "vanilla" ? null : createLoaderVersion.trim() || null;
    if (createLoader !== "vanilla" && !loaderVersion) {
      showNotification("warning", t(language, "modpacks.toast.selectLoaderVersion"));
      return;
    }
    setCreateBusy(true);
    try {
      let versionUrl: string | null = null;
      const fromLoaded = versionOptions.find((v) => v.id === createGameVersion);
      if (fromLoaded?.url) {
        versionUrl = fromLoaded.url;
      } else {
        try {
          const all = await invoke<VersionSummary[]>("fetch_all_versions");
          const found = all.find((v) => v.id === createGameVersion);
          if (found?.url) versionUrl = found.url;
        } catch (e) {
          console.error(e);
        }
      }
      if (!versionUrl) {
        throw new Error(t(language, "modpacks.toast.manifestUrlFailed", { version: createGameVersion }));
      }

      const profile = await invoke<InstanceProfile>("create_profile", {
        name,
        gameVersion: createGameVersion,
        loader: createLoader,
        loaderVersion,
        iconSourcePath: createIconPath,
        initialSettings: BUILD_PRESETS_UI_ENABLED
          ? (selectedCreatePreset?.settings ?? null)
          : null,
      });

      try {
        try {
          await invoke("reset_download_cancel");
        } catch (e) {
          console.error(e);
        }

        prepareInstallConsole?.(profile.id);

        const installed = await invoke<string[]>("list_installed_versions");
        const isInstalled = installed.includes(createGameVersion);
        if (!isInstalled) {
          const versionJobId = `version:${createGameVersion}`;
          registerDownloadJob?.({
            id: versionJobId,
            label: createGameVersion,
            kind: "version",
          });
          showNotification("info", t(language, "modpacks.toast.versionNotInstalled", { version: createGameVersion }));
          try {
            await invoke("install_version", {
              versionId: createGameVersion,
              versionUrl,
            });
          } finally {
            finishDownloadJob?.(versionJobId);
          }
          showNotification("success", t(language, "modpacks.toast.versionInstalled", { version: createGameVersion }));
        }

        if (createLoader === "fabric" && loaderVersion) {
          showNotification("info", t(language, "modpacks.toast.installingFabric", { version: loaderVersion }));
          await invoke("install_fabric", {
            gameVersion: createGameVersion,
            loaderVersion,
          });
        } else if (createLoader === "quilt" && loaderVersion) {
          showNotification("info", t(language, "modpacks.toast.installingQuilt", { version: loaderVersion }));
          await invoke("install_quilt", {
            gameVersion: createGameVersion,
            loaderVersion,
          });
        } else if (createLoader === "forge" && loaderVersion) {
          const forgeList = await invoke<ForgeVersionSummary[]>("fetch_forge_versions");
          const match = forgeList.find(
            (v) => v.mc_version === createGameVersion && v.forge_build === loaderVersion,
          );
          const versionId =
            match?.id ?? `${createGameVersion}-forge-${loaderVersion}`;
          const installerUrl =
            match?.installer_url ??
            `https://forgemvn.lumintomc.ru/net/minecraftforge/forge/${createGameVersion}-${loaderVersion}/forge-${createGameVersion}-${loaderVersion}-installer.jar`;
          showNotification("info", t(language, "modpacks.toast.installingForge", { version: loaderVersion }));
          await invoke("install_forge", { versionId, installerUrl });
        } else if (createLoader === "neoforge" && loaderVersion) {
          const versionId = `${createGameVersion}-neoforge-${loaderVersion}`;
          showNotification("info", t(language, "modpacks.toast.installingNeoForge", { version: loaderVersion }));
          await invoke("install_neoforge", { versionId });
        }
      } catch (e) {
        console.error(e);
        const msg =
          e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
        showNotification("warning", t(language, "modpacks.toast.profileCreatedInstallFailed", { msg }));
      }

      if (lazy.createSelectedIds.length > 0) {
        const lazyJobId = `lazy:${profile.id}`;
        registerDownloadJob?.({
          id: lazyJobId,
          label: t(language, "modpacks.lazy.applyJob"),
          kind: "mod",
        });
        try {
          await lazy.applyToProfile(profile.id, lazy.createSelectedIds);
        } finally {
          finishDownloadJob?.(lazyJobId);
        }
      }
      lazy.resetCreateSelection();

      setProfiles((prev) => [...prev, profile]);
      createNameUserEdited.current = false;
      setCreateName("");
      setCreateIconPath(null);
      setCreateLoaderVersion("");
      setLoaderVersionOptions([]);
      clearCreatePresetSelection();
      setActiveView("manage");
      setSelectedProfileId(profile.id);
      try {
        await invoke("set_selected_profile", { id: profile.id });
      } catch (e) {
        console.error(e);
      }
      showNotification("success", t(language, "modpacks.toast.profileCreated"));
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "string"
            ? e
            : JSON.stringify(e);
      showNotification("error", t(language, "modpacks.toast.createProfileFailed", { msg }));
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleCreateDesktopShortcut(profile: InstanceProfile) {
    try {
      const path = await invoke<string>("create_profile_desktop_shortcut", {
        profileId: profile.id,
      });
      showNotification(
        "success",
        path
          ? `${tt("modpacks.shortcut.created")} (${path})`
          : tt("modpacks.shortcut.created"),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      showNotification("error", tt("modpacks.shortcut.failed", { msg }));
    }
  }

  async function handleSelectProfile(profile: InstanceProfile) {
    const isAlreadySelected = selectedProfileId === profile.id;
    try {
      if (isAlreadySelected) {
        await invoke("set_selected_profile", { id: null });
        setSelectedProfileId(null);
        showNotification("info", t(language, "modpacks.toast.profileUnselected", { name: profile.name }));
      } else {
        await invoke("set_selected_profile", { id: profile.id });
        setSelectedProfileId(profile.id);
        showNotification("success", t(language, "modpacks.toast.profileSelected", { name: profile.name }));
      }
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.selectProfileFailed"));
    }
  }

  async function handleDeleteProfile(profile: InstanceProfile) {
    try {
      await invoke("delete_profile", { id: profile.id });
      setProfiles((prev) => prev.filter((p) => p.id !== profile.id));

      if (selectedProfileId === profile.id) {
        setSelectedProfileId(null);
        try {
          await invoke("set_selected_profile", { id: null });
        } catch (e) {
          console.error(e);
        }
        if (activeView === "manage") {
          setActiveView("list");
        }
      }

      showNotification("success", t(language, "modpacks.toast.profileDeleted"));
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.deleteProfileFailed"));
    }
  }

  async function handleBulkDeleteProfiles(ids: string[]) {
    const deleted = new Set<string>();
    for (const id of ids) {
      try {
        await invoke("delete_profile", { id });
        deleted.add(id);
      } catch (e) {
        console.error(e);
      }
    }
    if (deleted.size > 0) {
      setProfiles((prev) => prev.filter((p) => !deleted.has(p.id)));
      setMultiSelectedProfileIds((prev) => new Set([...prev].filter((id) => !deleted.has(id))));
      if (selectedProfileId && deleted.has(selectedProfileId)) {
        setSelectedProfileId(null);
        try {
          await invoke("set_selected_profile", { id: null });
        } catch (e) {
          console.error(e);
        }
        if (activeView === "manage") {
          setActiveView("list");
        }
      }
    }
    if (deleted.size < ids.length) {
      showNotification("error", t(language, "modpacks.toast.deleteProfilesPartial", {
        failed: ids.length - deleted.size,
      }));
    } else {
      showNotification("success", t(language, "modpacks.toast.profilesDeleted", {
        count: deleted.size,
      }));
    }
  }

  async function handleDuplicateProfile(profile: InstanceProfile) {
    if (duplicateBusy) return;
    setDuplicateBusy(true);
    try {
      const created = await invoke<InstanceProfile>("duplicate_profile", {
        profileId: profile.id,
      });
      setProfiles((prev) => {
        const next = [created, ...prev.filter((p) => p.id !== created.id)];
        onProfilesChange?.(next);
        return next;
      });
      showNotification(
        "success",
        tt("modpacks.editor.duplicated", { name: created.name }),
      );
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : String(e);
      showNotification("error", tt("modpacks.editor.duplicateFailed", { msg }));
    } finally {
      setDuplicateBusy(false);
    }
  }

  async function handleOpenFolder() {
    if (!selectedProfile) return;
    try {
      await revealItemInDir(selectedProfile.directory);
    } catch (e) {
      console.error(e);
      showNotification("error", t(language, "modpacks.toast.openFolderFailed"));
    }
  }

  async function handleRenameConfirm() {
    if (!selectedProfile) return;
    const next = renameValue.trim();
    if (!next || next === selectedProfile.name) {
      setIsRenaming(false);
      return;
    }
    try {
      await invoke("rename_profile", { id: selectedProfile.id, name: next });
      setProfiles((prev) =>
        prev.map((p) => (p.id === selectedProfile.id ? { ...p, name: next } : p)),
      );
      showNotification(
        "success",
        tt("modpacks.profile.renamed"),
      );
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("modpacks.profile.renameFailed"),
      );
    } finally {
      setIsRenaming(false);
    }
  }

  return {
    isRenaming,
    setIsRenaming,
    renameValue,
    setRenameValue,
    pendingBulkDeleteProfileIds,
    setPendingBulkDeleteProfileIds,
    duplicateBusy,
    handleChooseProfileIcon,
    iconPickerProfile,
    setIconPickerProfile,
    handleApplyTextureIcon,
    handleChooseProfileIconFile,
    handleCreateProfile,
    handleCreateDesktopShortcut,
    handleSelectProfile,
    handleDeleteProfile,
    handleBulkDeleteProfiles,
    handleDuplicateProfile,
    handleOpenFolder,
    handleRenameConfirm,
  };
}
