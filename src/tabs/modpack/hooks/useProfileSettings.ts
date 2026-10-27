import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import {
  type EditorSection,
  type NotificationKind,
  type Settings,
  type ViewId,
} from "../types";
import { invoke } from "@tauri-apps/api/core";

type ProfileSettingsDeps = {
  setSelectedProfileId: Dispatch<SetStateAction<string | null>>;
  setActiveView: Dispatch<SetStateAction<ViewId>>;
  setEditorSection: Dispatch<SetStateAction<EditorSection>>;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  tt: (key: string, vars?: Record<string, string | number>) => string;
};

export function useProfileSettings(deps: ProfileSettingsDeps) {
  const {
    setSelectedProfileId,
    setActiveView,
    setEditorSection,
    showNotification,
    tt,
  } = deps;

  const [isProfileSettingsOpen, setIsProfileSettingsOpen] = useState(false);
  const [profileSettingsTab, setProfileSettingsTab] = useState<"general" | "java">("general");
  const [profileEffectiveSettings, setProfileEffectiveSettings] = useState<Settings | null>(null);
  const [profileResolutionWidth, setProfileResolutionWidth] = useState("");
  const [profileResolutionHeight, setProfileResolutionHeight] = useState("");
  const [systemMemoryGb, setSystemMemoryGb] = useState<number>(16);
  const profileRamSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileRamPendingRef = useRef<{ profileId: string; mb: number } | null>(null);

  async function loadProfileLaunchSettings(profileId: string) {
    try {
      const totalGb = await invoke<number>("get_system_memory_gb");
      if (typeof totalGb === "number" && Number.isFinite(totalGb) && totalGb >= 1) {
        setSystemMemoryGb(Math.max(1, Math.min(64, Math.round(totalGb))));
      }
    } catch {
      setSystemMemoryGb(16);
    }
    try {
      const s = await invoke<Settings>("get_effective_settings", { profileId });
      setProfileEffectiveSettings(s);
      setProfileResolutionWidth(
        s.resolution_width != null ? String(s.resolution_width) : "",
      );
      setProfileResolutionHeight(
        s.resolution_height != null ? String(s.resolution_height) : "",
      );
    } catch (e) {
      console.error(e);
      setProfileEffectiveSettings(null);
    }
  }

  async function openProfileSettings(profileId: string) {
    profileRamPendingRef.current = null;
    if (profileRamSaveTimerRef.current !== null) {
      clearTimeout(profileRamSaveTimerRef.current);
      profileRamSaveTimerRef.current = null;
    }
    setSelectedProfileId(profileId);
    setActiveView("manage");
    setEditorSection("launch");
    setProfileSettingsTab("general");
    setIsProfileSettingsOpen(false);
    try {
      void invoke("set_selected_profile", { id: profileId });
    } catch {
    }
    await loadProfileLaunchSettings(profileId);
  }

  async function patchProfileGameSettings(
    profileId: string,
    patch: Partial<Settings>,
    opts?: { notifySuccess?: boolean },
  ) {
    const notifySuccess = opts?.notifySuccess !== false;
    setProfileEffectiveSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    const profilePatch: Record<string, unknown> = {};
    if (patch.ram_mb !== undefined) profilePatch.ram_mb = patch.ram_mb;
    if (patch.show_console_on_launch !== undefined)
      profilePatch.show_console_on_launch = patch.show_console_on_launch;
    if (patch.close_launcher_on_game_start !== undefined)
      profilePatch.close_launcher_on_game_start = patch.close_launcher_on_game_start;
    if (patch.check_game_processes !== undefined)
      profilePatch.check_game_processes = patch.check_game_processes;
    if (patch.resolution_width !== undefined)
      profilePatch.resolution_width = patch.resolution_width;
    if (patch.resolution_height !== undefined)
      profilePatch.resolution_height = patch.resolution_height;
    try {
      await invoke("update_profile_settings", { id: profileId, patch: profilePatch });
      if (notifySuccess) {
        showNotification("success", tt("modpacks.profileSettings.saved"));
      }
    } catch (e) {
      console.error(e);
      showNotification(
        "error",
        tt("modpacks.profileSettings.saveFailed"),
      );
    }
  }

  function commitProfileResolution(profileId: string) {
    const wRaw = profileResolutionWidth.trim();
    const hRaw = profileResolutionHeight.trim();
    if (!wRaw && !hRaw) {
      void patchProfileGameSettings(profileId, {
        resolution_width: null,
        resolution_height: null,
      });
      return;
    }
    const w = Number.parseInt(wRaw, 10);
    const h = Number.parseInt(hRaw, 10);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 320 || h < 240) {
      showNotification("warning", tt("modpacks.profileSettingsModal.resolution"));
      return;
    }
    void patchProfileGameSettings(profileId, {
      resolution_width: w,
      resolution_height: h,
    });
  }

  function clearProfileRamSaveDebounce() {
    if (profileRamSaveTimerRef.current !== null) {
      clearTimeout(profileRamSaveTimerRef.current);
      profileRamSaveTimerRef.current = null;
    }
  }

  function scheduleProfileRamSave(profileId: string, ramMb: number) {
    profileRamPendingRef.current = { profileId, mb: ramMb };
    clearProfileRamSaveDebounce();
    profileRamSaveTimerRef.current = setTimeout(() => {
      profileRamSaveTimerRef.current = null;
      const pending = profileRamPendingRef.current;
      if (!pending) return;
      profileRamPendingRef.current = null;
      void patchProfileGameSettings(pending.profileId, { ram_mb: pending.mb });
    }, 450);
  }

  function commitProfileRamSaveNow(profileId: string, ramMb: number) {
    clearProfileRamSaveDebounce();
    profileRamPendingRef.current = null;
    void patchProfileGameSettings(profileId, { ram_mb: ramMb });
  }

  function closeProfileSettingsModal() {
    clearProfileRamSaveDebounce();
    const pending = profileRamPendingRef.current;
    profileRamPendingRef.current = null;
    if (pending) {
      void patchProfileGameSettings(pending.profileId, { ram_mb: pending.mb });
    }
    setIsProfileSettingsOpen(false);
  }

  useEffect(() => () => clearProfileRamSaveDebounce(), []);

  return {
    isProfileSettingsOpen,
    profileSettingsTab,
    setProfileSettingsTab,
    profileEffectiveSettings,
    setProfileEffectiveSettings,
    profileResolutionWidth,
    setProfileResolutionWidth,
    profileResolutionHeight,
    setProfileResolutionHeight,
    systemMemoryGb,
    loadProfileLaunchSettings,
    openProfileSettings,
    patchProfileGameSettings,
    commitProfileResolution,
    scheduleProfileRamSave,
    commitProfileRamSaveNow,
    closeProfileSettingsModal,
  };
}
