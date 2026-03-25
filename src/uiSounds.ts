const NOTIFICATION_SRC = "/launcher-assets/sounds/notification.mp3";
const TAB_SWITCH_SRC =
  "/launcher-assets/sounds/" + encodeURIComponent("tab switch.mp3");

let didPrime = false;

function safePlay(src: string, volume: number) {
  try {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.volume = Math.min(1, Math.max(0, volume));
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {
  }
}

export function primeUiSounds() {
  if (didPrime) return;
  didPrime = true;

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

