import { isAnimatedBackgroundPath } from "../lib/launcherBackground";

type Props = {
  imageUrl: string;
  blurEnabled?: boolean;
  animated?: boolean;
  className?: string;
};

function CoverImage({
  imageUrl,
  className,
  blurEnabled,
}: {
  imageUrl: string;
  className: string;
  blurEnabled: boolean;
}) {
  return (
    <div
      className={`absolute inset-0 overflow-hidden ${className}`.trim()}
      style={{ contain: "paint" }}
    >
      <img
        src={imageUrl}
        alt=""
        aria-hidden
        draggable={false}
        className={
          blurEnabled
            ? "pointer-events-none absolute left-1/2 top-1/2 h-[32%] w-[32%] max-w-none -translate-x-1/2 -translate-y-1/2 scale-[3.3] object-cover"
            : "pointer-events-none absolute inset-0 h-full w-full object-cover"
        }
      />
    </div>
  );
}

export function LauncherBackgroundImage({
  imageUrl,
  blurEnabled = true,
  animated,
  className = "",
}: Props) {
  const isAnimated = animated ?? isAnimatedBackgroundPath(imageUrl);

  return (
    <CoverImage
      imageUrl={imageUrl}
      className={className}
      blurEnabled={blurEnabled && !isAnimated}
    />
  );
}
