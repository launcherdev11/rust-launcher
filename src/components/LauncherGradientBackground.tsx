export function LauncherGradientBackground(_props: { animated?: boolean }) {
  return (
    <div className="launcher-gradient" aria-hidden="true">
      <span className="launcher-gradient-sheen" />
      <span className="launcher-gradient-grain" />
    </div>
  );
}
