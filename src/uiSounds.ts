const NOTIFICATION_SRC = "/launcher-assets/sounds/notification.mp3";
const TAB_SWITCH_SRC =
  "/launcher-assets/sounds/" + encodeURIComponent("tab switch.mp3");

const TAB_SWITCH_MIN_INTERVAL_MS = 120;

let didPrime = false;

const players = new Map<string, HTMLAudioElement>();
const lastPlayedAt = new Map<string, number>();

function getPlayer(src: string): HTMLAudioElement | null {
  const cached = players.get(src);
  if (cached) return cached;
  try {
    const audio = new Audio(src);
    audio.preload = "auto";
    players.set(src, audio);
    return audio;
  } catch {
    return null;
  }
}

function safePlay(src: string, volume: number, minIntervalMs = 0) {
  try {
    const now = performance.now();
    const last = lastPlayedAt.get(src) ?? -Infinity;
    if (now - last < minIntervalMs) return;
    lastPlayedAt.set(src, now);

    const audio = getPlayer(src);
    if (!audio) return;
    audio.volume = Math.min(1, Math.max(0, volume));
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {
  }
}

export function primeUiSounds() {
  if (didPrime) return;
  didPrime = true;

  getPlayer(NOTIFICATION_SRC)?.load();
  getPlayer(TAB_SWITCH_SRC)?.load();
}

export function playNotificationSound() {
  safePlay(NOTIFICATION_SRC, 0.22);
}

export function playTabSwitchSound() {
  safePlay(TAB_SWITCH_SRC, 0.16, TAB_SWITCH_MIN_INTERVAL_MS);
}
