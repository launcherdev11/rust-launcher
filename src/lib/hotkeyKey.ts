const LATIN_LETTER = /^[a-z]$/;
const KEY_CODE_LETTER = /^Key([A-Z])$/;

const PUNCTUATION_CODES: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
};

export function hotkeyKey(e: KeyboardEvent): string {
  const key = e.key.toLowerCase();
  if (LATIN_LETTER.test(key)) return key;
  const letter = KEY_CODE_LETTER.exec(e.code);
  if (letter) return letter[1].toLowerCase();
  const punctuation = PUNCTUATION_CODES[e.code];
  if (punctuation) return punctuation;
  return e.key;
}

export function isHotkeyKey(e: KeyboardEvent, expected: string): boolean {
  return hotkeyKey(e).toLowerCase() === expected.toLowerCase();
}
