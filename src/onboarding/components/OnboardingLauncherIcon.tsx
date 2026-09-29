export const LAUNCHER_ICON_SRC = "/launcher-assets/icon.png";

type Props = {
  className?: string;
  size?: "welcome" | "finish";
};

const sizeClasses = {
  welcome: {
    wrap: "mb-5 h-14 w-14",
    img: "h-9 w-9",
  },
  finish: {
    wrap: "mb-4 h-12 w-12",
    img: "h-8 w-8",
  },
};

export function OnboardingLauncherIcon({ className = "", size = "welcome" }: Props) {
  const s = sizeClasses[size];

  return (
    <div
      className={[
        "glass-control flex items-center justify-center",
        s.wrap,
        className,
      ].join(" ")}
    >
      <img src={LAUNCHER_ICON_SRC} alt="" className={`${s.img} object-contain`} />
    </div>
  );
}
