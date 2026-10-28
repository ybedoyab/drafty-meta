/** @type {import('tailwindcss').Config} */
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
        accent: "#4f46e5",
      },
    },
  },
  plugins: [],
};
