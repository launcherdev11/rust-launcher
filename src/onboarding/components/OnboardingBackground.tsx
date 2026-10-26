type Props = {
  accentColor?: string;
  backgroundImageUrl?: string;
};

export function OnboardingBackground(_props: Props) {
  return <div className="pointer-events-none fixed inset-0 bg-ink-950" aria-hidden />;
}
