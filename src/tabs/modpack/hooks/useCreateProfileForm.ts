import type { Language } from "../../../i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type LoaderId,
  type LoaderVersionChannel,
  type LoaderVersionOption,
  type NotificationKind,
  type VersionSummary,
  type ViewId,
} from "../types";
import { invoke } from "@tauri-apps/api/core";
import { defaultProfileName, pickDefaultLoaderVersion } from "../helpers";
import { t } from "../../../i18n";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";

type CreateProfileFormDeps = {
  showNotification: (kind: NotificationKind, message: string, options?: { sound?: boolean; }) => void;
  language: Language;
  tt: (key: string, vars?: Record<string, string | number>) => string;
  activeView: ViewId;
};

export function useCreateProfileForm(deps: CreateProfileFormDeps) {
  const {
    showNotification,
    language,
    tt,
    activeView,
  } = deps;

  const [createName, setCreateName] = useState("");
  const createNameUserEdited = useRef(false);
  const [createLoader, setCreateLoader] = useState<LoaderId>("fabric");
  const [createGameVersion, setCreateGameVersion] = useState("1.20.1");
  const [createLoaderVersion, setCreateLoaderVersion] = useState("");
  const [loaderVersionOptions, setLoaderVersionOptions] = useState<LoaderVersionOption[]>([]);
  const [loaderVersionsLoading, setLoaderVersionsLoading] = useState(false);
  const [isLoaderVersionDropdownOpen, setIsLoaderVersionDropdownOpen] = useState(false);
  const [createAllVersions, setCreateAllVersions] = useState(false);
  const [createIconPath, setCreateIconPath] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [versionOptions, setVersionOptions] = useState<VersionSummary[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [isVersionDropdownOpen, setIsVersionDropdownOpen] = useState(false);

  async function ensureVersionsLoaded() {
    if (versionOptions.length > 0 || versionsLoading) return;
    setVersionsLoading(true);
    try {
      const all = await invoke<VersionSummary[]>("fetch_all_versions");
      const filtered = all.filter((v) =>
        createAllVersions ? true : v.version_type === "release",
      );
      setVersionOptions(filtered);
      if (filtered.length > 0) {
        setCreateGameVersion(filtered[0].id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setVersionsLoading(false);
    }
  }

  const loadCreateLoaderVersions = useCallback(async () => {
    if (createLoader === "vanilla") {
      setLoaderVersionOptions([]);
      setCreateLoaderVersion("");
      return;
    }
    setLoaderVersionsLoading(true);
    try {
      let options: LoaderVersionOption[] = [];
      if (createLoader === "fabric") {
        options = await invoke<LoaderVersionOption[]>("fetch_fabric_loaders", {
          gameVersion: createGameVersion,
        });
      } else if (createLoader === "quilt") {
        options = await invoke<LoaderVersionOption[]>("fetch_quilt_loaders", {
          gameVersion: createGameVersion,
        });
      } else if (createLoader === "forge") {
        options = await invoke<LoaderVersionOption[]>("fetch_forge_builds_for_game", {
          gameVersion: createGameVersion,
        });
      } else if (createLoader === "neoforge") {
        options = await invoke<LoaderVersionOption[]>("fetch_neoforge_builds_for_game", {
          gameVersion: createGameVersion,
        });
      }
      setLoaderVersionOptions(options);
      const versionIds = options.map((o) => o.version);
      setCreateLoaderVersion((prev) =>
        prev && versionIds.includes(prev) ? prev : pickDefaultLoaderVersion(options),
      );
    } catch (e) {
      console.error(e);
      setLoaderVersionOptions([]);
      setCreateLoaderVersion("");
      const msg =
        e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
      showNotification("error", t(language, "modpacks.toast.loadLoaderVersionsFailed", { msg }));
    } finally {
      setLoaderVersionsLoading(false);
    }
  }, [createLoader, createGameVersion, language, showNotification]);

  const selectedLoaderVersionOption = useMemo(
    () => loaderVersionOptions.find((o) => o.version === createLoaderVersion) ?? null,
    [loaderVersionOptions, createLoaderVersion],
  );

  const loaderChannelLabel = useCallback(
    (channel: LoaderVersionChannel | null | undefined) => {
      if (!channel) return null;
      return tt(`modpacks.create.loaderChannel.${channel}`);
    },
    [tt],
  );

  useEffect(() => {
    if (activeView !== "create" || createLoader === "vanilla") {
      return;
    }
    void loadCreateLoaderVersions();
  }, [activeView, createLoader, createGameVersion, loadCreateLoaderVersions]);

  useEffect(() => {
    if (activeView !== "create" || createNameUserEdited.current) {
      return;
    }
    setCreateName(defaultProfileName(createLoader, createGameVersion));
  }, [activeView, createLoader, createGameVersion]);

  async function handleChooseIcon() {
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
      if (typeof path === "string") {
        setCreateIconPath(path);
      }
    } catch (e) {
      console.error(e);
    }
  }

  return {
    createName,
    setCreateName,
    createNameUserEdited,
    createLoader,
    setCreateLoader,
    createGameVersion,
    setCreateGameVersion,
    createLoaderVersion,
    setCreateLoaderVersion,
    loaderVersionOptions,
    setLoaderVersionOptions,
    loaderVersionsLoading,
    isLoaderVersionDropdownOpen,
    setIsLoaderVersionDropdownOpen,
    createAllVersions,
    setCreateAllVersions,
    createIconPath,
    setCreateIconPath,
    createBusy,
    setCreateBusy,
    versionOptions,
    setVersionOptions,
    versionsLoading,
    isVersionDropdownOpen,
    setIsVersionDropdownOpen,
    ensureVersionsLoaded,
    loadCreateLoaderVersions,
    selectedLoaderVersionOption,
    loaderChannelLabel,
    handleChooseIcon,
  };
}
