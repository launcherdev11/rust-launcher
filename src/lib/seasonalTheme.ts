export function isHalloweenSeason(now: Date = new Date()): boolean {
  const month = now.getMonth();
  const day = now.getDate();
  return (month === 9 && day >= 1) || (month === 10 && day === 1);
}

export function isSeasonalThemePeriod(now: Date = new Date()): boolean {
  return isHalloweenSeason(now);
}

export function shouldShowThematicDecorations(
  disabled: boolean | undefined,
  now: Date = new Date(),
): boolean {
  return isSeasonalThemePeriod(now) && !disabled;
}
