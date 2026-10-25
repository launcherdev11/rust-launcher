export const NICKNAME_MAX_LENGTH = 16;

export function sanitizeNicknameInput(raw: string): { value: string; changed: boolean } {
  const value = raw.replace(/[^A-Za-z0-9_]/g, "").slice(0, NICKNAME_MAX_LENGTH);
  return { value, changed: value !== raw };
}
