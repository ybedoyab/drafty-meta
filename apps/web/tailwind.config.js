/** @type {import('tailwindcss').Config} */
// Color system — 60 / 30 / 10:
//   60% white + slate-50 surfaces · 30% slate-950 ink (text, dark blocks, structure)
//   10% dark Meta blue (#1e40af, darker than the Meta logo's #0467DF): Meta AI, the
//   primary action, and the outcome — the eye's path. Dark fills always carry white text.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["IBM Plex Sans", "Segoe UI", "sans-serif"],
        mono: ["IBM Plex Mono", "Consolas", "monospace"],
      },
      colors: {
        ink: "#ffffff",
        panel: "#ffffff",
        line: "#e5e7eb",
        mist: "#6b7280",
        foam: "#111827",
        accent: "#1e40af",
        signal: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          700: "#1d4ed8",
          800: "#1e40af",
        },
      },
    },
  },
  plugins: [],
};
