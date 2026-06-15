import { invoke } from "@tauri-apps/api/core";
import { isLinux } from "./lib/platform";

const NOTIFICATION_SRC = "/launcher-assets/sounds/notification.mp3";
const TAB_SWITCH_SRC =
  "/launcher-assets/sounds/" + encodeURIComponent("tab switch.mp3");

let didPrime = false;
let linuxUiAudioAvailable: boolean | null = null;
let linuxUiAudioProbe: Promise<boolean> | null = null;

async function probeLinuxUiAudio(): Promise<boolean> {
  if (!isLinux()) return true;
  if (linuxUiAudioAvailable !== null) return linuxUiAudioAvailable;
  if (!linuxUiAudioProbe) {
    linuxUiAudioProbe = invoke<boolean>("linux_ui_audio_available")
      .then((available) => {
        linuxUiAudioAvailable = available;
        return available;
      })
      .catch(() => {
        linuxUiAudioAvailable = false;
        return false;
      });
  }
  return linuxUiAudioProbe;
}

function canPlayUiAudio(): boolean {
  if (!isLinux()) return true;
  return linuxUiAudioAvailable === true;
}

function safePlay(src: string, volume: number) {
  if (!canPlayUiAudio()) return;
  try {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.volume = Math.min(1, Math.max(0, volume));
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {
  }
}

export async function initUiSoundsPlatform(): Promise<void> {
  await probeLinuxUiAudio();
}

export function primeUiSounds() {
  if (didPrime) return;
  didPrime = true;
  if (!canPlayUiAudio()) return;

  try {
    const a = new Audio(NOTIFICATION_SRC);
    a.preload = "auto";
    a.load();
  } catch {
  }

  try {
    const a = new Audio(TAB_SWITCH_SRC);
    a.preload = "auto";
    a.load();
  } catch {
  }
}

export function playNotificationSound() {
  safePlay(NOTIFICATION_SRC, 0.22);
}

export function playTabSwitchSound() {
  safePlay(TAB_SWITCH_SRC, 0.16);
}
