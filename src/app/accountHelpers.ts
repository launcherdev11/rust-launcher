export const NECO_ARC_SECRET_SOUND_SRC =
  "/launcher-assets/sounds/" + encodeURIComponent("secret (shhh...).mp3");
export const NECO_ARC_SECRET_SOUND_VOLUME = 0.05;

export function normalizeNicknameForSecretCheck(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export function accountKindAvatarClass(kind: string): string {
  if (kind === "microsoft") return "bg-sky-600/35 text-sky-100 ring-1 ring-sky-400/25";
  if (kind === "ely") return "bg-emerald-700/40 text-emerald-100 ring-1 ring-emerald-400/20";
  return "bg-white/10 text-white/80 ring-1 ring-white/10";
}
