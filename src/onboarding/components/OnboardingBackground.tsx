type Props = {
  accentColor?: string;
  backgroundImageUrl?: string;
};

export function OnboardingBackground({
  accentColor = "#0b1530",
  backgroundImageUrl = "/launcher-assets/background.jpg",
}: Props) {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute inset-0 bg-center will-change-transform"
          style={{
            backgroundImage: `url(${backgroundImageUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            filter: "blur(22px)",
            transform: "scale(1.08)",
          }}
        />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-black/55" />
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute -top-24 -left-24 h-72 w-72 rounded-full blur-3xl"
          style={{
            background: `radial-gradient(circle at 30% 30%, ${accentColor}80, transparent 70%)`,
          }}
        />
        <div
          className="absolute top-1/3 -right-32 h-80 w-80 rounded-full blur-3xl"
          style={{
            background: `radial-gradient(circle at 70% 30%, ${accentColor}70, transparent 75%)`,
          }}
        />
        <div
          className="absolute bottom-[-6rem] left-1/4 h-64 w-64 rounded-full blur-3xl"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${accentColor}75, transparent 75%)`,
          }}
        />
      </div>
    </>
  );
}
