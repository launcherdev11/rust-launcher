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

