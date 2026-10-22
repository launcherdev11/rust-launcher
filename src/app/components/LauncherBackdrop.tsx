import { HalloweenDecorations } from "../../components/HalloweenDecorations";
import { LauncherBackgroundImage } from "../../components/LauncherBackgroundImage";
import { LauncherGradientBackground } from "../../components/LauncherGradientBackground";
import { shouldShowThematicDecorations } from "../../lib/seasonalTheme";
import type { Settings } from "../types";

type Props = {
  settings: Settings | null;
  backgroundImageUrl: string;
  backgroundIsAnimated: boolean;
};

export function LauncherBackdrop({ settings, backgroundImageUrl, backgroundIsAnimated }: Props) {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        {settings?.background_image_url?.trim() ? (
          <LauncherBackgroundImage
            imageUrl={backgroundImageUrl}
            blurEnabled={settings?.background_blur_enabled ?? true}
            animated={backgroundIsAnimated}
          />
        ) : (
          <LauncherGradientBackground animated={!(settings?.background_animation_disabled ?? false)} />
        )}
      </div>
      <div
        className={`pointer-events-none absolute inset-0 ${
          settings?.background_image_url?.trim()
            ? "bg-gradient-to-b from-black/50 via-black/60 to-black/75"
            : "bg-transparent"
        }`}
      />
      {shouldShowThematicDecorations(settings?.thematic_decorations_disabled) && (
        <HalloweenDecorations />
      )}
    </>
  );
}
