import { isAnimatedBackgroundPath } from "../lib/launcherBackground";

type Props = {
  imageUrl: string;
  blurEnabled?: boolean;
  animated?: boolean;
  className?: string;
};

function backgroundBlurPx(): number {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("launcher-linux")) {
    return 10;
  }
  return 22;
}

export function LauncherBackgroundImage({
  imageUrl,
  blurEnabled = true,
  animated,
  className = "",
}: Props) {
  const isAnimated = animated ?? isAnimatedBackgroundPath(imageUrl);
  const blurPx = backgroundBlurPx();

  if (isAnimated) {
    return (
      <div
        className={`absolute inset-0 overflow-hidden ${className}`.trim()}
        style={blurEnabled ? { transform: "scale(1.08)" } : undefined}
      >
        <img
          src={imageUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
        />
        {blurEnabled ? (
          <div
            className="absolute inset-0"
            style={{
              backdropFilter: `blur(${blurPx}px)`,
              WebkitBackdropFilter: `blur(${blurPx}px)`,
            }}
          />
        ) : null}
      </div>
    );
  }

  const blurStyle = blurEnabled
    ? { filter: `blur(${blurPx}px)`, transform: "scale(1.08)" }
    : {};

  return (
    <div
      className={`absolute inset-0 bg-center will-change-transform ${className}`.trim()}
      style={{
        backgroundImage: `url(${imageUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        ...blurStyle,
      }}
    />
  );
}
