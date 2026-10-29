const mixed = (cssColor) =>
  `color-mix(in srgb, ${cssColor} calc(<alpha-value> * 100%), transparent)`;

module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        background: "rgba(18, 18, 20,0.92)",
        accentGreen: "#2ecc71",
        accentBlue: "#3498db",
        accent: {
          DEFAULT: mixed("var(--accent-color)"),
          from: mixed("var(--accent-from)"),
          to: mixed("var(--accent-to)"),
          hi: mixed("var(--accent-hi)"),
        },
        warn: {
          DEFAULT: mixed("var(--warn)"),
          line: mixed("var(--warn-line)"),
          hi: mixed("var(--warn-hi)"),
          fg: mixed("var(--warn-fg)"),
        },
        danger: {
          DEFAULT: mixed("var(--danger)"),
          strong: mixed("var(--danger-strong)"),
          line: mixed("var(--danger-line)"),
          hi: mixed("var(--danger-hi)"),
          fg: mixed("var(--danger-fg)"),
        },
        ink: {
          950: mixed("var(--ink-0)"),
          900: mixed("var(--ink-1)"),
          850: mixed("var(--ink-2)"),
          800: mixed("var(--ink-3)"),
          700: mixed("var(--ink-4)"),
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
      },
      fontSize: {
        title: ["1.25rem", { lineHeight: "1.25", letterSpacing: "-0.015em" }],
        subtitle: ["0.9375rem", { lineHeight: "1.45" }],
        body: ["0.875rem", { lineHeight: "1.45" }],
        meta: ["0.8125rem", { lineHeight: "1.4" }],
        caption: ["0.75rem", { lineHeight: "1.35" }],
      },
      borderRadius: {
        sm: "0.25rem",
        DEFAULT: "0.375rem",
        md: "0.5rem",
        lg: "0.625rem",
        xl: "0.625rem",
        "2xl": "0.875rem",
        "3xl": "1.125rem",
        xl2: "1.125rem",
      },
      boxShadow: {
        soft: "0 12px 32px rgba(0,0,0,0.45)",
      },
    },
  },
  plugins: [],
};
