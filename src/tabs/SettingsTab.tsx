import { open as openFile } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { JavaSettingsTab } from "./JavaSettings";
import { useT } from "../i18n";

type SettingsTabId = "directories" | "game" | "versions" | "launcher";

type Language = "ru" | "en";

type SidebarItemId = "play" | "settings" | "mods" | "modpacks";

type Settings = {
  ram_mb: number;
  show_console_on_launch: boolean;
  close_launcher_on_game_start: boolean;
  check_game_processes: boolean;
  resolution_width: number | null;
  resolution_height: number | null;
  show_snapshots: boolean;
  show_alpha_versions: boolean;
  notify_new_update: boolean;
  notify_new_message: boolean;
  notify_system_message: boolean;
  check_updates_on_start: boolean;
  auto_install_updates: boolean;
  open_launcher_on_profiles_tab: boolean;
  interface_language?: string;
  background_accent_color: string;
  background_image_url: string | null;
  background_blur_enabled: boolean;
};

type NotificationKind = "info" | "success" | "error" | "warning";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "up-to-date"
  | "error";

type SettingsTabProps = {
  settings: Settings | null;
  settingsTab: SettingsTabId;
  setSettingsTab: (id: SettingsTabId) => void;
  systemMemoryGb: number;
  updateSettings: (patch: Partial<Settings>) => void;
  showNotification: (kind: NotificationKind, message: string) => void;
  SettingsCard: typeof import("../settings-ui/SettingsComponents").SettingsCard;
  SettingsSlider: typeof import("../settings-ui/SettingsComponents").SettingsSlider;
  SettingsToggle: typeof import("../settings-ui/SettingsComponents").SettingsToggle;
  language: Language;
  setLanguage: (lang: Language) => void;
  sidebarOrder: SidebarItemId[];
  setSidebarOrder: (order: SidebarItemId[]) => void;
  updateStatus?: UpdateStatus;
  updateVersion?: string | null;
  updateDownloadPercent?: number | null;
  onCheckUpdate?: () => void;
  onInstallUpdate?: () => void;
};

type VersionSummary = {
  id: string;
  version_type: string;
  url: string;
  release_time: string;
};

type DownloadProgressPayload = {
  version_id: string;
  downloaded: number;
  total: number;
  percent: number;
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: h * 360, s: s * 100, v: v * 100 };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  v = Math.max(0, Math.min(100, v)) / 100;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (h < 60) {
    rp = c;
    gp = x;
  } else if (h < 120) {
    rp = x;
    gp = c;
  } else if (h < 180) {
    gp = c;
    bp = x;
  } else if (h < 240) {
    gp = x;
    bp = c;
  } else if (h < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

function hexWithHueFromWheel(baseHex: string, hueDeg: number): string {
  const rgb = hexToRgb(baseHex);
  if (!rgb) return baseHex;
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  const next = hsvToRgb(hueDeg, hsv.s, hsv.v);
  return rgbToHex(next.r, next.g, next.b);
}

function hueDegFromWheelClientPos(el: HTMLElement, clientX: number, clientY: number): number | null {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 4) return null;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (angleDeg + 90 + 360) % 360;
}

const ACCENT_HUE_RING_STYLE: CSSProperties = {
  backgroundImage: `conic-gradient(from 0deg, ${Array.from({ length: 72 }, (_, i) => {
    const h = (i * 360) / 72;
    return `hsl(${h} 95% 52%)`;
  }).join(", ")})`,
};

export function SettingsTab({
  settings,
  settingsTab,
  setSettingsTab,
  systemMemoryGb,
  updateSettings,
  showNotification,
  SettingsCard,
  SettingsSlider,
  SettingsToggle,
  language,
  setLanguage,
  sidebarOrder,
  setSidebarOrder,
  updateStatus = "idle",
  updateVersion = null,
  updateDownloadPercent = null,
  onCheckUpdate,
  onInstallUpdate,
}: SettingsTabProps) {
  const tt = useT(language);
  const [gameSubTab, setGameSubTab] = useState<"general" | "java">("general");
  const [isRamEditing, setIsRamEditing] = useState(false);
  const [ramInputMb, setRamInputMb] = useState("");
  const ramInputRef = useRef<HTMLInputElement | null>(null);

  const [availableVersions, setAvailableVersions] = useState<VersionSummary[] | null>(null);
  const [installedVersions, setInstalledVersions] = useState<string[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [installingVersionId, setInstallingVersionId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgressPayload>>(
    {},
  );

  const settingsTabRefs = useRef<
    Partial<Record<SettingsTabId, HTMLButtonElement | null>>
  >({});
  const [settingsIndicator, setSettingsIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });
  const gameSubTabRefs = useRef<
    Partial<Record<"general" | "java", HTMLButtonElement | null>>
  >({});
  const [gameSubIndicator, setGameSubIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });
  const languageTabRefs = useRef<
    Partial<Record<Language, HTMLButtonElement | null>>
  >({});
  const languageToggleContainerRef = useRef<HTMLDivElement | null>(null);
  const [languageIndicator, setLanguageIndicator] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });
  const [accentInput, setAccentInput] = useState<string>("");
  const [isAccentPickerOpen, setIsAccentPickerOpen] = useState(false);
  const accentHueWheelRef = useRef<HTMLDivElement | null>(null);
  const accentHueDragBaseRef = useRef<string | null>(null);
  const accentSvPadRef = useRef<HTMLDivElement | null>(null);
  const accentSvDragHueRef = useRef<number | null>(null);
  const [cacheSizeBytes, setCacheSizeBytes] = useState<number | null>(null);
  const [isCacheLoading, setIsCacheLoading] = useState(false);
  const [isResettingSettings, setIsResettingSettings] = useState(false);

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const el = settingsTabRefs.current[settingsTab];
      if (el) {
        setSettingsIndicator({
          left: el.offsetLeft,
          width: el.offsetWidth,
        });
      }
    };

    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [settingsTab]);

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const el = gameSubTabRefs.current[gameSubTab];
      if (el) {
        setGameSubIndicator({
          left: el.offsetLeft,
          width: el.offsetWidth,
        });
      }
    };

    updateIndicator();
    window.addEventListener("resize", updateIndicator);
    return () => window.removeEventListener("resize", updateIndicator);
  }, [gameSubTab, settingsTab]);

  useLayoutEffect(() => {
    let raf = 0;
    let cancelled = false;

    const updateIndicator = () => {
      if (cancelled) return;
      const btnEl = languageTabRefs.current[language];
      const containerEl = languageToggleContainerRef.current;
      if (!btnEl || !containerEl) return;

      const btnRect = btnEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();
      setLanguageIndicator({
        left: btnRect.left - containerRect.left,
        width: btnRect.width,
      });
    };

    const scheduleUpdate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateIndicator);
    };

    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);

    if (typeof document !== "undefined" && (document as any).fonts?.ready) {
      void (document as any).fonts.ready
        .then(() => {
          if (!cancelled) scheduleUpdate();
        })
        .catch(() => {
          if (!cancelled) scheduleUpdate();
        });
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [language, settingsTab]);

  useEffect(() => {
    const current = settings?.background_accent_color ?? "#0b1530";
    setAccentInput(current);
  }, [settings?.background_accent_color]);

  const accentColorHsv = useMemo(() => {
    const c = settings?.background_accent_color ?? "#0b1530";
    const rgb = hexToRgb(c);
    if (!rgb) return { h: 0, s: 0, v: 0 };
    return rgbToHsv(rgb.r, rgb.g, rgb.b);
  }, [settings?.background_accent_color]);

  const applyAccentHueFromPointer = (clientX: number, clientY: number) => {
    const el = accentHueWheelRef.current;
    if (!el) return;
    const hue = hueDegFromWheelClientPos(el, clientX, clientY);
    if (hue === null) return;
    const base =
      accentHueDragBaseRef.current ?? settings?.background_accent_color ?? "#0b1530";
    const next = hexWithHueFromWheel(base, hue);
    setAccentInput(next);
    updateSettings({ background_accent_color: next });
  };

  const handleAccentWheelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    accentHueDragBaseRef.current = settings?.background_accent_color ?? "#0b1530";
    e.currentTarget.setPointerCapture(e.pointerId);
    applyAccentHueFromPointer(e.clientX, e.clientY);
  };

  const handleAccentWheelPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    applyAccentHueFromPointer(e.clientX, e.clientY);
  };

  const handleAccentWheelPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    accentHueDragBaseRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
  };

  const applyAccentSvFromPointer = (clientX: number, clientY: number) => {
    const el = accentSvPadRef.current;
    if (!el) return;
    const h =
      accentSvDragHueRef.current !== null
        ? accentSvDragHueRef.current
        : accentColorHsv.h;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const s = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const v = Math.max(0, Math.min(100, (1 - (clientY - rect.top) / rect.height) * 100));
    const next = hsvToRgb(h, s, v);
    const hex = rgbToHex(next.r, next.g, next.b);
    setAccentInput(hex);
    updateSettings({ background_accent_color: hex });
  };

  const handleAccentSvPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const c = settings?.background_accent_color ?? "#0b1530";
    const rgb = hexToRgb(c);
    accentSvDragHueRef.current = rgb ? rgbToHsv(rgb.r, rgb.g, rgb.b).h : accentColorHsv.h;
    e.currentTarget.setPointerCapture(e.pointerId);
    applyAccentSvFromPointer(e.clientX, e.clientY);
  };

  const handleAccentSvPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    applyAccentSvFromPointer(e.clientX, e.clientY);
  };

  const handleAccentSvPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    accentSvDragHueRef.current = null;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (settingsTab !== "launcher") return;
    let cancelled = false;
    setIsCacheLoading(true);
    invoke<number>("get_launcher_cache_size")
      .then((bytes) => {
        if (!cancelled) {
          setCacheSizeBytes(bytes);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCacheSizeBytes(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCacheLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [settingsTab, language]);

  const currentRamMb = settings?.ram_mb ?? 4096;
  const currentRamGbRounded = Math.max(1, Math.round(currentRamMb / 1024));
  const ramMinMb = 1024;
  const ramMaxMb = systemMemoryGb * 1024; 
  const ramSliderMaxGb = systemMemoryGb;

  const [ramSliderLocal, setRamSliderLocal] = useState<number | null>(null);
  const displayRamGb = ramSliderLocal ?? currentRamGbRounded;

  useEffect(() => {
    if (!isRamEditing) {
      setRamInputMb(String(currentRamMb));
    }
  }, [currentRamMb, isRamEditing]);

  useEffect(() => {
    setRamSliderLocal(null);
  }, [currentRamMb]);

  useEffect(() => {
    if (isRamEditing) {
      ramInputRef.current?.focus();
      ramInputRef.current?.select();
    }
  }, [isRamEditing]);

  useEffect(() => {
    let isMounted = true;

    const refreshInstalled = async () => {
      try {
        const ids = await invoke<string[]>("list_installed_versions");
        if (!isMounted) return;
        setInstalledVersions(ids);
      } catch (e) {
        console.error("Failed to fetch installed versions list:", e);
      }
    };

    const refreshAvailable = async () => {
      if (settingsTab !== "versions") return;
      setIsLoadingVersions(true);
      try {
        const all = await invoke<VersionSummary[]>("fetch_all_versions");
        if (!isMounted) return;
        const showSnapshots = settings?.show_snapshots ?? false;
        const showAlpha = settings?.show_alpha_versions ?? false;
        const filtered = all.filter((v) => {
          if (v.version_type === "release") return true;
          if (v.version_type === "snapshot") return showSnapshots;
          if (v.version_type === "old_beta" || v.version_type === "old_alpha") {
            return showAlpha;
          }
          return false;
        });
        setAvailableVersions(filtered);
        await refreshInstalled();
      } catch (e) {
        console.error("Failed to load versions list:", e);
        if (isMounted) {
          showNotification(
            "error",
            tt("settings.versions.loadFailed"),
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingVersions(false);
        }
      }
    };

    void refreshAvailable();

    return () => {
      isMounted = false;
    };
  }, [settingsTab, settings?.show_snapshots, settings?.show_alpha_versions, language]);

  useEffect(() => {
    let unlistenPromise: Promise<() => void> | null = null;

    unlistenPromise = listen<DownloadProgressPayload>("download-progress", (event) => {
      const payload = event.payload;
      setDownloadProgress((prev) => ({
        ...prev,
        [payload.version_id]: payload,
      }));
    });

    return () => {
      if (unlistenPromise) {
        unlistenPromise.then((unlisten) => {
          try {
            unlisten();
          } catch {
            // ignore
          }
        });
      }
    };
  }, []);

  const handleInstallVersion = async (version: VersionSummary) => {
    try {
      setInstallingVersionId(version.id);
      await invoke("install_version", {
        version_id: version.id,
        version_url: version.url,
      });
      showNotification(
        "success",
        tt("settings.versions.installSuccess", { version: version.id }),
      );
      const ids = await invoke<string[]>("list_installed_versions");
      setInstalledVersions(ids);
    } catch (e) {
      console.error("Failed to install version:", e);
      showNotification(
        "error",
        tt("settings.versions.installFailed", { version: version.id }),
      );
    } finally {
      setInstallingVersionId(null);
    }
  };

  const commitRamMb = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setRamInputMb(String(currentRamMb));
      setIsRamEditing(false);
      return;
    }
    const rounded = Math.round(parsed);
    const clamped = Math.min(ramMaxMb, Math.max(ramMinMb, rounded));
    updateSettings({ ram_mb: clamped });
    setRamInputMb(String(clamped));
    setIsRamEditing(false);
  };

  const cancelRamEditing = () => {
    setRamInputMb(String(currentRamMb));
    setIsRamEditing(false);
  };

  const [resolutionWidthInput, setResolutionWidthInput] = useState<string>("");
  const [resolutionHeightInput, setResolutionHeightInput] = useState<string>("");

  useEffect(() => {
    setResolutionWidthInput(
      settings?.resolution_width != null ? String(settings.resolution_width) : "",
    );
    setResolutionHeightInput(
      settings?.resolution_height != null ? String(settings.resolution_height) : "",
    );
  }, [settings?.resolution_width, settings?.resolution_height]);

  const commitResolution = () => {
    const wRaw = resolutionWidthInput.trim();
    const hRaw = resolutionHeightInput.trim();
    if (!wRaw && !hRaw) {
      updateSettings({ resolution_width: null, resolution_height: null });
      return;
    }

    const w = Number(wRaw);
    const h = Number(hRaw);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    const wi = Math.round(w);
    const hi = Math.round(h);
    if (wi <= 0 || hi <= 0) return;

    const clamp = (v: number) => Math.min(7680, Math.max(320, v));
    const wc = clamp(wi);
    const hc = clamp(hi);
    updateSettings({ resolution_width: wc, resolution_height: hc });
    setResolutionWidthInput(String(wc));
    setResolutionHeightInput(String(hc));
  };

  const formatCacheSize = (bytes: number | null): string => {
    if (bytes == null) {
      return tt("settings.launcher.cache.sizeUnknown");
    }
    if (bytes < 1024) {
      return tt("settings.launcher.cache.bytes", { value: bytes });
    }
    const kb = bytes / 1024;
    if (kb < 1024) {
      return tt("settings.launcher.cache.kb", { value: Math.round(kb) });
    }
    const mb = kb / 1024;
    if (mb < 1024) {
      return tt("settings.launcher.cache.mb", { value: Math.round(mb * 10) / 10 });
    }
    const gb = mb / 1024;
    return tt("settings.launcher.cache.gb", { value: Math.round(gb * 10) / 10 });
  };

  const handleClearCache = async () => {
    setIsCacheLoading(true);
    try {
      await invoke("clear_launcher_cache");
      const next = await invoke<number>("get_launcher_cache_size").catch(() => null);
      setCacheSizeBytes(next ?? 0);
      showNotification(
        "success",
        tt("settings.launcher.cache.cleared"),
      );
    } catch {
      showNotification(
        "error",
        tt("settings.launcher.cache.clearFailed"),
      );
    } finally {
      setIsCacheLoading(false);
    }
  };

  const handleResetSettings = async () => {
    setIsResettingSettings(true);
    try {
      try {
        await invoke("set_background_image", { sourcePath: null as string | null });
      } catch {
      }
      const defaults = await invoke<Settings>("reset_settings_to_default");
      updateSettings(defaults);
      setSidebarOrder(["play", "settings", "mods", "modpacks"]);
      try {
        window.localStorage.removeItem("sidebar_order");
      } catch {
        // ignore
      }
      showNotification(
        "success",
        tt("settings.launcher.resetSettings.success"),
      );
    } catch {
      showNotification(
        "error",
        tt("settings.launcher.resetSettings.failed"),
      );
    } finally {
      setIsResettingSettings(false);
    }
  };

  const moveSidebarItem = (id: SidebarItemId, direction: "up" | "down") => {
    const current = sidebarOrder;
    const idx = current.indexOf(id);
    if (idx === -1) return;
    const next = current.slice();
    if (direction === "up" && idx > 0) {
      const tmp = next[idx - 1];
      next[idx - 1] = next[idx];
      next[idx] = tmp;
    } else if (direction === "down" && idx < next.length - 1) {
      const tmp = next[idx + 1];
      next[idx + 1] = next[idx];
      next[idx] = tmp;
    } else {
      return;
    }
    setSidebarOrder(next);
    try {
      window.localStorage.setItem("sidebar_order", JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex w-full max-w-3xl flex-1 min-h-0 flex-col">
      <div className="flex flex-1 min-h-0 w-full items-center justify-center overflow-hidden">
        <div className="w-full min-h-0 overflow-y-auto">
          <div className="glass-panel w-full px-6 py-5">
          {settingsTab === "game" && (
            <SettingsCard title={tt("settings.card.game")}>
              <div className="mb-4 flex items-center gap-2 rounded-full bg-white/10 p-1 relative overflow-hidden">
                <div
                  className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-white/90 transition-all duration-200 ease-out"
                  style={{
                    left: `${gameSubIndicator.left}px`,
                    width: `${gameSubIndicator.width}px`,
                  }}
                />
                <button
                  type="button"
                  ref={(el) => {
                    gameSubTabRefs.current.general = el;
                  }}
                  onClick={() => setGameSubTab("general")}
                  className={`interactive-press relative z-10 flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    gameSubTab === "general" ? "text-black" : "text-white/70 hover:text-white"
                  }`}
                >
                  {tt("settings.game.subtab.general")}
                </button>
                <button
                  type="button"
                  ref={(el) => {
                    gameSubTabRefs.current.java = el;
                  }}
                  onClick={() => setGameSubTab("java")}
                  className={`interactive-press relative z-10 flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    gameSubTab === "java" ? "text-black" : "text-white/70 hover:text-white"
                  }`}
                >
                  {tt("settings.game.subtab.java")}
                </button>
              </div>
              {gameSubTab === "general" ? (
                <>
                  <SettingsToggle
                    label={tt("settings.game.showConsoleOnLaunch.label")}
                    yesLabel={tt("settings.common.toggle.on")}
                    noLabel={tt("settings.common.toggle.off")}
                    value={settings?.show_console_on_launch ?? false}
                    onChange={(value: boolean) => updateSettings({ show_console_on_launch: value })}
                  />
                  <SettingsToggle
                    label={tt("settings.game.closeLauncherOnStart.label")}
                    yesLabel={tt("settings.common.yes")}
                    noLabel={tt("settings.common.no")}
                    value={settings?.close_launcher_on_game_start ?? false}
                    onChange={(value: boolean) => updateSettings({ close_launcher_on_game_start: value })}
                  />
                  <SettingsToggle
                    label={tt("settings.game.checkGameProcesses.label")}
                    yesLabel={tt("settings.common.yes")}
                    noLabel={tt("settings.common.no")}
                    value={settings?.check_game_processes ?? true}
                    onChange={(value: boolean) => updateSettings({ check_game_processes: value })}
                  />

                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-white/90">
                      {tt("settings.game.windowSize.label")}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={320}
                        max={7680}
                        placeholder={tt("settings.game.windowSize.widthPlaceholder")}
                        value={resolutionWidthInput}
                        onChange={(e) => setResolutionWidthInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitResolution();
                          if (e.key === "Escape") {
                            setResolutionWidthInput(
                              settings?.resolution_width != null
                                ? String(settings.resolution_width)
                                : "",
                            );
                            setResolutionHeightInput(
                              settings?.resolution_height != null
                                ? String(settings.resolution_height)
                                : "",
                            );
                          }
                        }}
                        onBlur={commitResolution}
                        className="no-number-spin h-9 w-28 rounded-xl border border-white/15 bg-black/40 px-3 text-xs font-semibold text-white/90 outline-none focus:border-white/35"
                      />
                      <span className="text-xs text-white/50">×</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={320}
                        max={7680}
                        placeholder={tt("settings.game.windowSize.heightPlaceholder")}
                        value={resolutionHeightInput}
                        onChange={(e) => setResolutionHeightInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitResolution();
                          if (e.key === "Escape") {
                            setResolutionWidthInput(
                              settings?.resolution_width != null
                                ? String(settings.resolution_width)
                                : "",
                            );
                            setResolutionHeightInput(
                              settings?.resolution_height != null
                                ? String(settings.resolution_height)
                                : "",
                            );
                          }
                        }}
                        onBlur={commitResolution}
                        className="no-number-spin h-9 w-28 rounded-xl border border-white/15 bg-black/40 px-3 text-xs font-semibold text-white/90 outline-none focus:border-white/35"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <SettingsSlider
                    label={tt("settings.game.ram.label")}
                    min={1}
                    max={ramSliderMaxGb}
                    value={displayRamGb}
                    onChange={(value: number) => setRamSliderLocal(Math.min(ramSliderMaxGb, Math.max(1, value)))}
                    onChangeCommitted={(value: number) => {
                      const clamped = Math.min(ramSliderMaxGb, Math.max(1, value));
                      updateSettings({ ram_mb: clamped * 1024 });
                      setRamSliderLocal(null);
                    }}
                    right={
                      isRamEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            ref={ramInputRef}
                            type="number"
                            inputMode="numeric"
                            min={ramMinMb}
                            max={ramMaxMb}
                            value={ramInputMb}
                            onChange={(e) => setRamInputMb(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") commitRamMb(ramInputMb); if (e.key === "Escape") cancelRamEditing(); }}
                            onBlur={() => commitRamMb(ramInputMb)}
                            className="no-number-spin h-7 w-28 rounded-lg border border-white/15 bg-black/25 px-2 text-right text-sm font-semibold text-white/90 outline-none focus:border-white/30"
                          />
                          <span className="text-xs font-semibold text-white/70">
                            {tt("settings.game.ram.mbUnit")}
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setIsRamEditing(true)}
                          className="interactive-press text-sm font-semibold text-white/90 hover:text-white"
                          title={tt("settings.game.ram.editInMbHint")}
                        >
                          {tt("settings.game.ram.gbValue", { gb: currentRamGbRounded })}
                        </button>
                      )
                    }
                  />
                  <JavaSettingsTab language={language} systemMemoryGb={systemMemoryGb} showNotification={showNotification} />
                </>
              )}
            </SettingsCard>
          )}

          {settingsTab === "versions" && (
            <SettingsCard title={tt("settings.card.versions")}>
              <SettingsToggle
                label={tt("settings.versions.showSnapshots.label")}
                yesLabel={tt("settings.common.yes")}
                noLabel={tt("settings.common.no")}
                value={settings?.show_snapshots ?? false}
                onChange={(value: boolean) => updateSettings({ show_snapshots: value })}
              />
              <SettingsToggle
                label={tt("settings.versions.showAlpha.label")}
                yesLabel={tt("settings.common.yes")}
                noLabel={tt("settings.common.no")}
                value={settings?.show_alpha_versions ?? false}
                onChange={(value: boolean) => updateSettings({ show_alpha_versions: value })}
              />
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-sm text-white/90">
                  {tt("settings.versions.available.label")}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      try {
                        const all = await invoke<VersionSummary[]>("fetch_all_versions");
                        const showSnapshots = settings?.show_snapshots ?? false;
                        const showAlpha = settings?.show_alpha_versions ?? false;
                        const filtered = all.filter((v) => {
                          if (v.version_type === "release") return true;
                          if (v.version_type === "snapshot") return showSnapshots;
                          if (v.version_type === "old_beta" || v.version_type === "old_alpha") {
                            return showAlpha;
                          }
                          return false;
                        });
                        setAvailableVersions(filtered);
                        const ids = await invoke<string[]>("list_installed_versions");
                        setInstalledVersions(ids);
                      } catch (e) {
                        console.error("Failed to refresh versions list:", e);
                        showNotification(
                          "error",
                          tt("settings.versions.refreshFailed"),
                        );
                      }
                    })();
                  }}
                  className="interactive-press rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white/80 hover:border-white/40 hover:text-white"
                >
                  {tt("settings.versions.refresh")}
                </button>
              </div>
              <div className="mt-3 h-48 overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-2">
                {isLoadingVersions && (
                  <div className="flex h-full items-center justify-center text-sm text-white/70">
                    {tt("settings.versions.loading")}
                  </div>
                )}
                {!isLoadingVersions && (!availableVersions || availableVersions.length === 0) && (
                  <div className="flex h-full items-center justify-center text-sm text-white/60">
                    {tt("settings.versions.noneFound")}
                  </div>
                )}
                {!isLoadingVersions && availableVersions && availableVersions.length > 0 && (
                  <div className="space-y-1.5">
                    {availableVersions.map((v) => {
                      const installed = installedVersions.includes(v.id);
                      const progress = downloadProgress[v.id];
                      const percent =
                        progress && progress.total > 0 ? Math.round(progress.percent) : null;
                      return (
                        <div
                          key={v.id}
                          className="group relative overflow-hidden rounded-xl bg-white/5 px-3 py-2 text-xs text-white/90"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-semibold">{v.id}</span>
                                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-white/70">
                                  {v.version_type}
                                </span>
                                {installed && (
                                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                                    {tt("settings.versions.installedBadge")}
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 text-[11px] text-white/60">
                                {new Date(v.release_time).toLocaleString(
                                  language === "ru" ? "ru-RU" : "en-US",
                                )}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              {percent !== null && (
                                <div className="w-32">
                                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                                    <div
                                      className="h-full rounded-full bg-emerald-400 transition-[width]"
                                      style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                                    />
                                  </div>
                                  <div className="mt-0.5 text-[10px] text-white/70">
                                    {percent}%
                                  </div>
                                </div>
                              )}
                              <button
                                type="button"
                                disabled={installingVersionId === v.id}
                                onClick={() => void handleInstallVersion(v)}
                                className={`interactive-press rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                                  installingVersionId === v.id
                                    ? "cursor-default bg-white/10 text-white/60"
                                    : "bg-white/90 text-black hover:bg-white"
                                }`}
                              >
                                {installingVersionId === v.id
                                  ? tt("settings.versions.action.installing")
                                  : installed
                                    ? tt("settings.versions.action.reinstall")
                                    : tt("settings.versions.action.install")}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </SettingsCard>
          )}

          {settingsTab === "launcher" && (
            <SettingsCard title={tt("settings.card.launcher")}>
              <div className="max-h-[310px] overflow-y-auto pr-1 space-y-3">
              {onCheckUpdate && (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3 space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
                    {tt("settings.card.updates")}
                  </span>
                  <SettingsToggle
                    label={tt("settings.updates.checkOnStart.label")}
                    yesLabel={tt("settings.common.toggle.on")}
                    noLabel={tt("settings.common.toggle.off")}
                    value={settings?.check_updates_on_start ?? true}
                    onChange={(v) => updateSettings({ check_updates_on_start: v })}
                  />
                  <SettingsToggle
                    label={tt("settings.updates.autoInstall.label")}
                    yesLabel={tt("settings.common.toggle.on")}
                    noLabel={tt("settings.common.toggle.off")}
                    value={settings?.auto_install_updates ?? false}
                    onChange={(v) => updateSettings({ auto_install_updates: v })}
                  />
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <span className="text-xs text-white/70">
                      {updateStatus === "checking" && tt("settings.updates.checking")}
                      {updateStatus === "downloading" &&
                        tt("settings.updates.downloading", {
                          percent: updateDownloadPercent ?? 0,
                        })}
                      {updateStatus === "installing" && tt("settings.updates.installing")}
                      {updateStatus === "available" &&
                        updateVersion &&
                        tt("settings.updates.available", { version: updateVersion })}
                      {updateStatus === "up-to-date" && tt("settings.updates.upToDate")}
                      {updateStatus === "error" && tt("settings.updates.checkFailed")}
                      {updateStatus === "idle" && "\u00A0"}
                    </span>
                    <div className="flex gap-2">
                      {updateStatus === "available" && onInstallUpdate && (
                        <button
                          type="button"
                          onClick={() => void onInstallUpdate()}
                          className="interactive-press rounded-full bg-emerald-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                        >
                          {tt("settings.updates.installNow")}
                        </button>
                      )}
                      {(updateStatus === "idle" ||
                        updateStatus === "up-to-date" ||
                        updateStatus === "error" ||
                        updateStatus === "available" ||
                        updateStatus === "checking") && (
                        <button
                          type="button"
                          disabled={updateStatus === "checking"}
                          onClick={() => void onCheckUpdate()}
                          className="interactive-press rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white/80 hover:border-white/40 hover:text-white disabled:opacity-50"
                        >
                          {tt("settings.updates.checkNow")}
                        </button>
                      )}
                    </div>
                  </div>
                  {updateStatus === "downloading" && updateDownloadPercent != null && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-emerald-400 transition-[width]"
                        style={{
                          width: `${Math.min(100, Math.max(0, updateDownloadPercent))}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
              <SettingsToggle
                label={tt("settings.launcher.openOnProfilesTab.label")}
                yesLabel={tt("settings.launcher.openOnProfilesTab.yes")}
                noLabel={tt("settings.launcher.openOnProfilesTab.no")}
                value={settings?.open_launcher_on_profiles_tab ?? false}
                onChange={(value: boolean) =>
                  updateSettings({ open_launcher_on_profiles_tab: value })
                }
              />
              <div className="mt-3 flex items-center justify-between gap-4">
                <span className="text-sm text-white/90">
                  {tt("settings.launcher.interfaceLanguage.label")}
                </span>
                <div
                  ref={languageToggleContainerRef}
                  className="relative flex rounded-full bg-white/10 p-0.5 overflow-hidden"
                >
                  <div
                    className="pointer-events-none absolute top-0.5 bottom-0.5 rounded-full bg-white/90 transition-all duration-200 ease-out"
                    style={{
                      left: `${languageIndicator.left}px`,
                      width: `${languageIndicator.width}px`,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setLanguage("ru");
                      updateSettings({ interface_language: "ru" });
                    }}
                    ref={(el) => {
                      languageTabRefs.current.ru = el;
                    }}
                    className={`interactive-press relative z-10 min-w-[80px] rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                      language === "ru" ? "text-black" : "text-white/70 hover:text-white"
                    }`}
                  >
                    {tt("settings.launcher.interfaceLanguage.ru")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLanguage("en");
                      updateSettings({ interface_language: "en" });
                    }}
                    ref={(el) => {
                      languageTabRefs.current.en = el;
                    }}
                    className={`interactive-press relative z-10 min-w-[80px] rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                      language === "en" ? "text-black" : "text-white/70 hover:text-white"
                    }`}
                  >
                    {tt("settings.launcher.interfaceLanguage.en")}
                  </button>
                </div>
              </div>
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-white/90">
                    {tt("settings.launcher.accentColor.label")}
                  </span>
                  <div className="relative flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setIsAccentPickerOpen((v) => !v)}
                      className="interactive-press flex h-8 w-16 items-center justify-center rounded-full border border-white/30 bg-black/40 shadow-soft"
                    >
                      <span
                        className="h-5 w-10 rounded-full"
                        style={{
                          background:
                            settings?.background_accent_color ?? "#0b1530",
                        }}
                      />
                    </button>
                    <span className="text-xs text-white/60">
                      {settings?.background_accent_color ?? "#0b1530"}
                    </span>
                    {isAccentPickerOpen && (
                      <div className="absolute right-0 bottom-full z-40 mb-2 w-80 rounded-2xl border border-white/15 bg-black/90 px-3 py-3 text-xs text-white shadow-soft backdrop-blur-xl">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-[11px] uppercase tracking-[0.16em] text-white/50">
                            {tt("settings.launcher.accentColor.popupTitle")}
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsAccentPickerOpen(false)}
                            className="interactive-press rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80 hover:bg-white/20"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="mb-2 flex items-center gap-3">
                          <div
                            ref={accentHueWheelRef}
                            role="slider"
                            tabIndex={0}
                            aria-label={tt("settings.launcher.accentColor.pickColorAria")}
                            aria-valuemin={0}
                            aria-valuemax={360}
                            aria-valuenow={Math.round(accentColorHsv.h)}
                            className="relative h-14 w-14 shrink-0 cursor-crosshair touch-none select-none rounded-full"
                            style={{
                              boxShadow:
                                "0 0 0 1px rgba(255,255,255,0.12), 0 0 0 1px rgba(0,0,0,0.45) inset, 0 8px 28px rgba(0,0,0,0.55), 0 0 32px rgba(0,0,0,0.35)",
                            }}
                            onPointerDown={handleAccentWheelPointerDown}
                            onPointerMove={handleAccentWheelPointerMove}
                            onPointerUp={handleAccentWheelPointerEnd}
                            onPointerCancel={handleAccentWheelPointerEnd}
                            onKeyDown={(e) => {
                              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                              e.preventDefault();
                              const cur = settings?.background_accent_color ?? "#0b1530";
                              const rgb = hexToRgb(cur);
                              if (!rgb) return;
                              const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
                              const delta = e.key === "ArrowRight" ? 3 : -3;
                              const next = hsvToRgb((hsv.h + delta + 360) % 360, hsv.s, hsv.v);
                              const hex = rgbToHex(next.r, next.g, next.b);
                              setAccentInput(hex);
                              updateSettings({ background_accent_color: hex });
                            }}
                          >
                            <div
                              className="pointer-events-none absolute inset-0 overflow-hidden rounded-full [transform:translateZ(0)] [backface-visibility:hidden]"
                              style={{
                                ...ACCENT_HUE_RING_STYLE,
                                filter: "saturate(1.05) brightness(1.02)",
                              }}
                            />
                            <div
                              className="pointer-events-none absolute inset-0 rounded-full"
                              style={{
                                boxShadow:
                                  "inset 0 0 0 1px rgba(255,255,255,0.1), inset 0 -12px 20px rgba(0,0,0,0.35)",
                              }}
                            />
                            <div className="pointer-events-none absolute inset-[10px] rounded-full shadow-[inset_0_2px_6px_rgba(0,0,0,0.45)] ring-1 ring-white/10">
                              <div
                                className="h-full w-full rounded-full ring-1 ring-black/50"
                                style={{
                                  backgroundColor:
                                    settings?.background_accent_color ?? "#0b1530",
                                  backgroundImage: [
                                    "radial-gradient(circle at 32% 26%, rgba(255,255,255,0.16), transparent 52%)",
                                    "linear-gradient(155deg, rgba(255,255,255,0.07), transparent 48%)",
                                  ].join(", "),
                                }}
                              />
                            </div>
                            <div
                              className="pointer-events-none absolute left-1/2 top-1/2 z-10"
                              style={{ width: 0, height: 0 }}
                            >
                              <div
                                style={{ transform: `rotate(${accentColorHsv.h}deg) translateY(-23px)` }}
                              >
                                <div
                                  className="h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/95 bg-white shadow-[0_0_12px_rgba(255,255,255,0.55),0_2px_8px_rgba(0,0,0,0.55)] ring-1 ring-black/40"
                                  aria-hidden
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="text-[11px] text-white/60">
                              {tt("settings.launcher.accentColor.currentLabel")}
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[11px] text-white/85">
                                {settings?.background_accent_color ?? "#0b1530"}
                              </span>
                              <input
                                type="text"
                                maxLength={7}
                                value={accentInput}
                                onChange={(e) => setAccentInput(e.target.value)}
                                onBlur={(e) => {
                                  const raw = e.target.value.trim();
                                  if (!raw) {
                                    const fallback = settings?.background_accent_color ?? "#0b1530";
                                    setAccentInput(fallback);
                                    return;
                                  }
                                  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
                                  const match = /^#[0-9a-fA-F]{6}$/.test(withHash);
                                  if (!match) {
                                    const fallback = settings?.background_accent_color ?? "#0b1530";
                                    setAccentInput(fallback);
                                    return;
                                  }
                                  const normalized = withHash.toLowerCase();
                                  setAccentInput(normalized);
                                  updateSettings({ background_accent_color: normalized });
                                }}
                                className="h-6 w-[7.25rem] rounded-lg border border-white/25 bg-black/60 px-2 text-[11px] font-mono text-white/85 outline-none focus:border-white/50"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="mb-2">
                          <div className="mb-1.5 text-[10px] text-white/45">
                            {tt("settings.launcher.accentColor.svPadLabel")}
                          </div>
                          <div
                            ref={accentSvPadRef}
                            className="relative h-24 w-full cursor-crosshair touch-none select-none overflow-hidden rounded-xl ring-1 ring-white/12"
                            style={{
                              boxShadow:
                                "inset 0 0 0 1px rgba(0,0,0,0.4), 0 6px 20px rgba(0,0,0,0.35)",
                              backgroundImage: `linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, hsl(${accentColorHsv.h} 100% 50%))`,
                            }}
                            aria-label={tt("settings.launcher.accentColor.svPadAria")}
                            onPointerDown={handleAccentSvPointerDown}
                            onPointerMove={handleAccentSvPointerMove}
                            onPointerUp={handleAccentSvPointerEnd}
                            onPointerCancel={handleAccentSvPointerEnd}
                          >
                            <div
                              className="pointer-events-none absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/95 bg-white/95 shadow-[0_0_10px_rgba(255,255,255,0.35),0_2px_8px_rgba(0,0,0,0.45)] ring-1 ring-black/35"
                              style={{
                                left: `${accentColorHsv.s}%`,
                                top: `${100 - accentColorHsv.v}%`,
                              }}
                              aria-hidden
                            />
                          </div>
                        </div>
                        <div className="mt-1 text-[11px] text-white/55">
                          {tt("settings.launcher.accentColor.helpText")}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm text-white/90">
                    {tt("settings.launcher.backgroundImage.label")}
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const path = await openFile({
                            multiple: false,
                            directory: false,
                            filters: [
                              {
                                name: tt("settings.common.imagesFilterName"),
                                extensions: ["png", "jpg", "jpeg", "webp"],
                              },
                            ],
                          });
                          if (!path) return;
                          const stored = await invoke<string | null>(
                            "set_background_image",
                            { sourcePath: path },
                          );
                          updateSettings({
                            background_image_url: stored,
                          });
                        } catch (e) {
                          console.error(e);
                        }
                      }}
                      className="interactive-press inline-flex items-center gap-2 rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-xs font-semibold text-white/85 hover:border-white/40 hover:bg-black/60"
                    >
                      <span>
                        {tt("settings.launcher.backgroundImage.choose")}
                      </span>
                    </button>
                    {settings?.background_image_url && (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await invoke("set_background_image", {
                              sourcePath: null,
                            });
                            updateSettings({
                              background_image_url: null,
                            });
                          } catch (e) {
                            console.error(e);
                          }
                        }}
                        className="interactive-press rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/20"
                      >
                        {tt("settings.common.reset")}
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-white/45">
                    {tt("settings.launcher.backgroundImage.hint")}
                  </p>
                  <SettingsToggle
                    label={tt("settings.launcher.backgroundBlur.label")}
                    yesLabel={tt("settings.common.toggle.on")}
                    noLabel={tt("settings.common.toggle.off")}
                    value={settings?.background_blur_enabled ?? true}
                    onChange={(v) => updateSettings({ background_blur_enabled: v })}
                  />
                </div>
                <div className="pt-2 border-t border-white/10 mt-4 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-col">
                      <span className="text-sm text-white/90">
                        {tt("settings.launcher.cache.label")}
                      </span>
                      <span className="text-xs text-white/60">
                        {isCacheLoading
                          ? tt("settings.launcher.cache.loading")
                          : tt("settings.launcher.cache.sizeLabel", {
                              size: formatCacheSize(cacheSizeBytes),
                            })}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleClearCache()}
                      disabled={isCacheLoading}
                      className="interactive-press rounded-full border border-white/25 px-3 py-1.5 text-xs font-semibold text-white/85 hover:border-white/40 hover:text-white disabled:opacity-60"
                    >
                      {tt("settings.launcher.cache.clearButton")}
                    </button>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm text-white/90">
                      {tt("settings.launcher.sidebarOrder.label")}
                    </span>
                    <div className="space-y-1.5 rounded-2xl border border-white/10 bg-black/25 p-2">
                      {sidebarOrder.map((id) => (
                        <div
                          key={id}
                          className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-1.5 text-xs text-white/85"
                        >
                          <span>
                            {tt(
                              id === "play"
                                ? "app.sidebar.play"
                                : id === "settings"
                                  ? "app.sidebar.settings"
                                  : id === "mods"
                                    ? "app.sidebar.mods"
                                    : "app.sidebar.modpacks",
                            )}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => moveSidebarItem(id, "up")}
                              className="interactive-press rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80 hover:bg-white/20"
                              aria-label={tt("settings.launcher.sidebarOrder.moveUp")}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveSidebarItem(id, "down")}
                              className="interactive-press rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80 hover:bg-white/20"
                              aria-label={tt("settings.launcher.sidebarOrder.moveDown")}
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => void handleResetSettings()}
                      disabled={isResettingSettings}
                      className="interactive-press inline-flex items-center justify-center rounded-2xl border border-white/25 px-4 py-2 text-xs font-semibold text-white/85 hover:border-white/45 hover:text-white disabled:opacity-60"
                    >
                      {tt("settings.launcher.resetSettings.button")}
                    </button>
                  </div>
                </div>
              </div>
              </div>
            </SettingsCard>
          )}

          {settingsTab === "directories" && (
            <SettingsCard title={tt("settings.card.directories")}>
              <p className="text-sm text-white/70">
                {tt("settings.directories.comingSoon")}
              </p>
            </SettingsCard>
          )}
          </div>
        </div>
      </div>

      <div className="mt-4 mb-6 flex items-center justify-center">
        <div className="relative flex items-center gap-0 rounded-full border border-white/12 bg-black/50 p-1 shadow-soft backdrop-blur-xl overflow-hidden">
          <div
            className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-white/90 transition-all duration-200 ease-out"
            style={{
              left: `${settingsIndicator.left}px`,
              width: `${settingsIndicator.width}px`,
            }}
          />
          {(
            [
              {
                id: "directories",
                label: tt("settings.tab.directories"),
              },
              { id: "game", label: tt("settings.tab.game") },
              {
                id: "versions",
                label: tt("settings.tab.versions"),
              },
              {
                id: "launcher",
                label: tt("settings.tab.launcher"),
              },
            ] as { id: SettingsTabId; label: string }[]
          ).map((tab) => {
            const active = settingsTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                ref={(el) => {
                  settingsTabRefs.current[tab.id] = el;
                }}
                onClick={() => setSettingsTab(tab.id)}
                className={`interactive-press relative z-10 rounded-full px-4 py-1.5 text-xs font-semibold text-center transition-colors ${
                  active
                    ? "text-black"
                    : "text-white/70 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}