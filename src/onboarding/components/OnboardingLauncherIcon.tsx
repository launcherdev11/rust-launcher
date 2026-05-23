export const LAUNCHER_ICON_SRC = "/launcher-assets/icon.png";

type Props = {
  className?: string;
  size?: "welcome" | "finish";
};

const sizeClasses = {
  welcome: {
    wrap: "mb-8 h-24 w-24 rounded-2xl",
    img: "h-[4.25rem] w-[4.25rem]",
  },
  finish: {
    wrap: "mb-6 h-20 w-20 rounded-2xl",
    img: "h-14 w-14",
  },
};

export function OnboardingLauncherIcon({ className = "", size = "welcome" }: Props) {
  const s = sizeClasses[size];

  return (
    <div
      className={[
        "flex items-center justify-center border border-white/12 bg-black/40 shadow-soft backdrop-blur-md",
        s.wrap,
        className,
      ].join(" ")}
    >
      <img src={LAUNCHER_ICON_SRC} alt="" className={`${s.img} object-contain drop-shadow-md`} />
    </div>
  );
}
