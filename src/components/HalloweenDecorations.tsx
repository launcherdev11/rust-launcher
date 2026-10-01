export function HalloweenDecorations() {
  return (
    <div
      className="halloween-decor pointer-events-none absolute inset-0 z-[5] overflow-hidden"
      aria-hidden
    >
      <div className="halloween-decor__tint" />
      <div className="halloween-decor__vignette" />

      <svg
        className="halloween-decor__web halloween-decor__web--tl"
        viewBox="0 0 160 160"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M0 0 L160 0 M0 0 L0 160 M0 0 L140 50 M0 0 L100 100 M0 0 L50 140 M20 0 Q40 40 0 60 M45 0 Q70 55 0 95 M75 0 Q95 70 0 125 M0 25 Q45 50 55 0 M0 55 Q60 80 90 0 M0 90 Q70 105 120 0"
          stroke="rgba(255,255,255,0.14)"
          strokeWidth="1"
        />
      </svg>

      <svg
        className="halloween-decor__web halloween-decor__web--tr"
        viewBox="0 0 160 160"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M160 0 L0 0 M160 0 L160 160 M160 0 L20 50 M160 0 L60 100 M160 0 L110 140 M140 0 Q120 40 160 60 M115 0 Q90 55 160 95 M85 0 Q65 70 160 125 M160 25 Q115 50 105 0 M160 55 Q100 80 70 0 M160 90 Q90 105 40 0"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1"
        />
      </svg>

      <svg
        className="halloween-decor__web halloween-decor__web--br"
        viewBox="0 0 160 160"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M160 160 L0 160 M160 160 L160 0 M160 160 L20 110 M160 160 L60 60 M160 160 L110 20 M140 160 Q120 120 160 100 M115 160 Q90 105 160 65 M85 160 Q65 90 160 35 M160 135 Q115 110 105 160 M160 105 Q100 80 70 160 M160 70 Q90 55 40 160"
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="1"
        />
      </svg>

      <Bat className="halloween-decor__bat halloween-decor__bat--1" />
      <Bat className="halloween-decor__bat halloween-decor__bat--2" />
      <Bat className="halloween-decor__bat halloween-decor__bat--3" />
    </div>
  );
}

function Bat({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 28"
      fill="rgba(0,0,0,0.55)"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M32 14c-2.5 0-4.5-1.2-5.5-3.2-.4 1.4-1.6 2.4-3.1 2.4-1.2 0-2.2-.6-2.8-1.5C18.2 15.2 12 18 6 16c4.5 1.5 7.5 5 10.5 5 2.2 0 3.8-1.2 5-2.8.8 2.2 2.8 3.8 5.3 3.8h5.4c2.5 0 4.5-1.6 5.3-3.8 1.2 1.6 2.8 2.8 5 2.8 3 0 6-3.5 10.5-5-6 2-12.2-.8-14.6-4.3-.6.9-1.6 1.5-2.8 1.5-1.5 0-2.7-1-3.1-2.4C36.5 12.8 34.5 14 32 14z" />
    </svg>
  );
}
