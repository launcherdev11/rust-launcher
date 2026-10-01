export function clampMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  padding = 8,
): { top: number; left: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : menuWidth;
  const vh = typeof window !== "undefined" ? window.innerHeight : menuHeight;

  let left = x;
  let top = y;

  if (left + menuWidth > vw - padding) {
    left = Math.max(padding, vw - menuWidth - padding);
  }
  if (left < padding) {
    left = padding;
  }

  if (top + menuHeight > vh - padding) {
    top = Math.max(padding, vh - menuHeight - padding);
  }
  if (top < padding) {
    top = padding;
  }

  return { top, left };
}
