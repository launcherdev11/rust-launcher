import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type Settings } from "../../../app/types";

type RamResolutionDeps = {
  settings: Settings | null;
  systemMemoryGb: number;
  updateSettings: (patch: Partial<Settings>) => void;
  label: (key: string) => string;
  tt: (key: string, vars?: Record<string, string | number>) => string;
};

export function useRamResolution(deps: RamResolutionDeps) {
  const {
    settings,
    systemMemoryGb,
    updateSettings,
    tt,
  } = deps;

  const [isRamEditing, setIsRamEditing] = useState(false);
  const [ramInputMb, setRamInputMb] = useState("");
  const ramInputRef = useRef<HTMLInputElement | null>(null);

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

  const [graphicsAdapters, setGraphicsAdapters] = useState<string[]>([]);
  const [resolutionWidthInput, setResolutionWidthInput] = useState<string>("");
  const [resolutionHeightInput, setResolutionHeightInput] = useState<string>("");

  useEffect(() => {
    void invoke<string[]>("get_graphics_adapters")
      .then((adapters) => setGraphicsAdapters(Array.isArray(adapters) ? adapters : []))
      .catch(() => setGraphicsAdapters([]));
  }, []);

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

  const resetResolutionInputs = () => {
    setResolutionWidthInput(
      settings?.resolution_width != null ? String(settings.resolution_width) : "",
    );
    setResolutionHeightInput(
      settings?.resolution_height != null ? String(settings.resolution_height) : "",
    );
  };

  const graphicsAdapterOptions = [
    { value: "", label: tt("settings.game.graphicsAdapter.auto") },
    ...graphicsAdapters.map((adapter) => ({ value: adapter, label: adapter })),
    ...(settings?.graphics_adapter && !graphicsAdapters.includes(settings.graphics_adapter)
      ? [{ value: settings.graphics_adapter, label: settings.graphics_adapter }]
      : []),
  ];

  return {
    isRamEditing,
    setIsRamEditing,
    ramInputMb,
    setRamInputMb,
    ramInputRef,
    currentRamGbRounded,
    ramMinMb,
    ramMaxMb,
    ramSliderMaxGb,
    ramSliderLocal,
    setRamSliderLocal,
    displayRamGb,
    commitRamMb,
    cancelRamEditing,
    resolutionWidthInput,
    setResolutionWidthInput,
    resolutionHeightInput,
    setResolutionHeightInput,
    commitResolution,
    resetResolutionInputs,
    graphicsAdapterOptions,
  };
}
