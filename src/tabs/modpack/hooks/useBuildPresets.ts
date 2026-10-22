import type { Dispatch, SetStateAction } from "react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type BuildPreset,
  type InstanceProfile,
  type LoaderId,
  type LoaderVersionOption,
  type NotificationKind,
} from "../types";
import { invoke } from "@tauri-apps/api/core";
import { BUILD_PRESETS_UI_ENABLED } from "../helpers";

type BuildPresetsDeps = {
  setCreateLoader: Dispatch<SetStateAction<LoaderId>>;
  setCreateGameVersion: Dispatch<SetStateAction<string>>;
  setCreateLoaderVersion: Dispatch<SetStateAction<string>>;
  setLoaderVersionOptions: Dispatch<SetStateAction<LoaderVersionOption[]>>;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  createName: string;
  createLoader: LoaderId;
  createLoaderVersion: string;
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  createGameVersion: string;
  createIconPath: string | null;
};

export function useBuildPresets(deps: BuildPresetsDeps) {
  const {
    setCreateLoader,
    setCreateGameVersion,
    setCreateLoaderVersion,
    setLoaderVersionOptions,
    tt,
    createName,
    createLoader,
    createLoaderVersion,
    showNotification,
    createGameVersion,
    createIconPath,
  } = deps;

  const [buildPresets, setBuildPresets] = useState<BuildPreset[]>([]);
  const [buildPresetsLoading, setBuildPresetsLoading] = useState(false);
  const [createSelectedPresetId, setCreateSelectedPresetId] = useState<string | null>(null);
  const [isPresetsModalOpen, setIsPresetsModalOpen] = useState(false);
  const [presetIconUris, setPresetIconUris] = useState<Record<string, string>>({});

  const selectedCreatePreset = useMemo(
    () => buildPresets.find((p) => p.id === createSelectedPresetId) ?? null,
    [buildPresets, createSelectedPresetId],
  );

  const refreshBuildPresets = useCallback(async () => {
    setBuildPresetsLoading(true);
    try {
      const list = await invoke<BuildPreset[]>("list_build_presets");
      setBuildPresets(list);
    } catch (e) {
      console.error(e);
    } finally {
      setBuildPresetsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!BUILD_PRESETS_UI_ENABLED) return;
    void refreshBuildPresets();
  }, [refreshBuildPresets]);

  useEffect(() => {
    if (!BUILD_PRESETS_UI_ENABLED) return;
    let cancelled = false;
    (async () => {
      for (const preset of buildPresets) {
        try {
          const uri = await invoke<string | null>("get_build_preset_icon_data_uri", {
            presetId: preset.id,
          });
          if (cancelled || !uri) continue;
          setPresetIconUris((prev) =>
            prev[preset.id] ? prev : { ...prev, [preset.id]: uri },
          );
        } catch {
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buildPresets]);

  function applyBuildPresetToCreateForm(preset: BuildPreset) {
    const loader = preset.loader as LoaderId;
    if (
      loader === "vanilla" ||
      loader === "fabric" ||
      loader === "forge" ||
      loader === "quilt" ||
      loader === "neoforge"
    ) {
      setCreateLoader(loader);
    }
    setCreateGameVersion(preset.game_version);
    setCreateLoaderVersion(preset.loader_version ?? "");
    setLoaderVersionOptions([]);
    setCreateSelectedPresetId(preset.id);
  }

  function clearCreatePresetSelection() {
    setCreateSelectedPresetId(null);
  }

  async function handleSaveBuildPresetFromForm() {
    const presetName = window.prompt(tt("modpacks.presets.namePrompt"), createName.trim() || "");
    if (!presetName?.trim()) return;
    const loaderVersion =
      createLoader === "vanilla" ? null : createLoaderVersion.trim() || null;
    if (createLoader !== "vanilla" && !loaderVersion) {
      showNotification("warning", tt("modpacks.toast.selectLoaderBeforePreset"));
      return;
    }
    try {
      const preset = await invoke<BuildPreset>("save_build_preset", {
        id: null,
        name: presetName.trim(),
        gameVersion: createGameVersion,
        loader: createLoader,
        loaderVersion,
        settings: selectedCreatePreset?.settings ?? null,
        iconSourcePath: createIconPath,
      });
      await refreshBuildPresets();
      setCreateSelectedPresetId(preset.id);
      showNotification("success", tt("modpacks.presets.saved"));
    } catch (e) {
      console.error(e);
      showNotification("error", tt("modpacks.presets.saveFailed"));
    }
  }

  async function handleSaveBuildPresetFromProfile(profile: InstanceProfile) {
    const presetName = window.prompt(tt("modpacks.presets.namePrompt"), profile.name);
    if (!presetName?.trim()) return;
    try {
      await invoke<BuildPreset>("create_build_preset_from_profile", {
        profileId: profile.id,
        name: presetName.trim(),
      });
      await refreshBuildPresets();
      showNotification("success", tt("modpacks.presets.saved"));
    } catch (e) {
      console.error(e);
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      showNotification("error", `${tt("modpacks.presets.saveFailed")} ${msg}`);
    }
  }

  async function handleDeleteBuildPreset(preset: BuildPreset) {
    const ok = window.confirm(tt("modpacks.presets.deleteConfirm", { name: preset.name }));
    if (!ok) return;
    try {
      await invoke("delete_build_preset", { presetId: preset.id });
      if (createSelectedPresetId === preset.id) {
        clearCreatePresetSelection();
      }
      setPresetIconUris((prev) => {
        const next = { ...prev };
        delete next[preset.id];
        return next;
      });
      await refreshBuildPresets();
      showNotification("success", tt("modpacks.presets.deleted"));
    } catch (e) {
      console.error(e);
      showNotification("error", tt("modpacks.presets.deleteFailed"));
    }
  }

  return {
    buildPresets,
    buildPresetsLoading,
    createSelectedPresetId,
    isPresetsModalOpen,
    setIsPresetsModalOpen,
    presetIconUris,
    selectedCreatePreset,
    refreshBuildPresets,
    applyBuildPresetToCreateForm,
    clearCreatePresetSelection,
    handleSaveBuildPresetFromForm,
    handleSaveBuildPresetFromProfile,
    handleDeleteBuildPreset,
  };
}
