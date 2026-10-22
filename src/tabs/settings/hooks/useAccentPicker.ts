import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  hexToRgb,
  hexWithHueFromWheel,
  hsvToRgb,
  hueDegFromWheelClientPos,
  rgbToHex,
  rgbToHsv,
} from "../accentColor";
import { type Settings } from "../../../app/types";

type AccentPickerDeps = {
  settings: Settings | null;
  updateSettings: (patch: Partial<Settings>) => void;
};

export function useAccentPicker(deps: AccentPickerDeps) {
  const {
    settings,
    updateSettings,
  } = deps;

  const [accentInput, setAccentInput] = useState<string>("");
  const [isAccentPickerOpen, setIsAccentPickerOpen] = useState(false);
  const accentHueWheelRef = useRef<HTMLDivElement | null>(null);
  const accentHueDragBaseRef = useRef<string | null>(null);
  const accentSvPadRef = useRef<HTMLDivElement | null>(null);
  const accentSvDragHueRef = useRef<number | null>(null);
  const accentPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const current = settings?.background_accent_color ?? "#4a22a8";
    setAccentInput(current);
  }, [settings?.background_accent_color]);

  const accentColorHsv = useMemo(() => {
    const c = settings?.background_accent_color ?? "#4a22a8";
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
      accentHueDragBaseRef.current ?? settings?.background_accent_color ?? "#4a22a8";
    const next = hexWithHueFromWheel(base, hue);
    setAccentInput(next);
    updateSettings({ background_accent_color: next });
  };

  const handleAccentWheelPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    accentHueDragBaseRef.current = settings?.background_accent_color ?? "#4a22a8";
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
    const c = settings?.background_accent_color ?? "#4a22a8";
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
    }
  };

  const accentColor = settings?.background_accent_color ?? "#4a22a8";

  const applyAccentColor = (hex: string) => {
    setAccentInput(hex);
    updateSettings({ background_accent_color: hex });
  };

  return {
    accentInput,
    setAccentInput,
    isAccentPickerOpen,
    setIsAccentPickerOpen,
    accentHueWheelRef,
    accentSvPadRef,
    accentPickerRef,
    accentColorHsv,
    handleAccentWheelPointerDown,
    handleAccentWheelPointerMove,
    handleAccentWheelPointerEnd,
    handleAccentSvPointerDown,
    handleAccentSvPointerMove,
    handleAccentSvPointerEnd,
    accentColor,
    applyAccentColor,
  };
}
