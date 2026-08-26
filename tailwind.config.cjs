/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        background: "rgba(26,26,26,0.85)",
        accentGreen: "#2ecc71",
        accentBlue: "#3498db",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      fontSize: {
        title: ["1.25rem", { lineHeight: "1.25", letterSpacing: "-0.02em" }],
        subtitle: ["0.9375rem", { lineHeight: "1.45" }],
        body: ["0.875rem", { lineHeight: "1.45" }],
        meta: ["0.8125rem", { lineHeight: "1.4" }],
        caption: ["0.75rem", { lineHeight: "1.35" }],
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      boxShadow: {
        soft: "0 18px 45px rgba(0,0,0,0.45)",
      },
    },
  },
  plugins: [],
};

