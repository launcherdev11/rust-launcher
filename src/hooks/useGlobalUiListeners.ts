import { useEffect } from "react";
import { primeUiSounds } from "../uiSounds";

export function useGlobalUiListeners() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    document.addEventListener("contextmenu", onContextMenu, true);
    return () => document.removeEventListener("contextmenu", onContextMenu, true);
  }, []);

  useEffect(() => {
    const onFirstGesture = () => primeUiSounds();
    window.addEventListener("pointerdown", onFirstGesture, { once: true });
    window.addEventListener("keydown", onFirstGesture, { once: true });
    return () => {
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
    };
  }, []);
}
