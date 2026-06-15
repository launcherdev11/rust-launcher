import { isAnimatedBackgroundPath } from "../lib/launcherBackground";
import { isLinux } from "../lib/platform";

type Props = {
  imageUrl: string;
  blurEnabled?: boolean;
  animated?: boolean;
  className?: string;
};

export function LauncherBackgroundImage({
  imageUrl,
  blurEnabled = true,
  animated,
  className = "",
}: Props) {
  const isAnimated = animated ?? isAnimatedBackgroundPath(imageUrl);
  const useSafeBlur = isLinux();

  if (isAnimated && !useSafeBlur) {
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
              backdropFilter: "blur(22px)",
              WebkitBackdropFilter: "blur(22px)",
            }}
          />
        ) : null}
      </div>
    );
  }

  if (isAnimated && useSafeBlur) {
    const blurStyle = blurEnabled
      ? { filter: "blur(22px)", transform: "scale(1.08)" }
      : {};

    return (
      <img
        src={imageUrl}
        alt=""
        aria-hidden
        className={`absolute inset-0 h-full w-full object-cover ${className}`.trim()}
        style={blurStyle}
      />
    );
  }

  const blurStyle = blurEnabled
    ? { filter: "blur(22px)", transform: "scale(1.08)" }
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
