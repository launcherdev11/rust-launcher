import type { CSSProperties } from "react";
import { LauncherBackgroundImage } from "../../components/LauncherBackgroundImage";
import { DEFAULT_LAUNCHER_BACKGROUND } from "../../lib/launcherBackground";
import { useOnboardingBackgroundAnimated } from "../backgroundAnimatedContext";

type Props = {
  accentColor?: string;
  backgroundImageUrl?: string;
};

export function OnboardingBackground({
  accentColor = "#0b1530",
  backgroundImageUrl = DEFAULT_LAUNCHER_BACKGROUND,
}: Props) {
  const backgroundAnimated = useOnboardingBackgroundAnimated();

  return (
    <>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <LauncherBackgroundImage
          imageUrl={backgroundImageUrl}
          blurEnabled
          animated={backgroundAnimated}
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-black/55" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ "--accent-color": accentColor } as CSSProperties}
        aria-hidden
      />
    </>
  );
}
