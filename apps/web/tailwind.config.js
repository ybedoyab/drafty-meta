/** @type {import('tailwindcss').Config} */
import defaultColors from "tailwindcss/colors";
import plugin from "tailwindcss/plugin";

// Color system — 60 / 30 / 10:
//   60% white + slate-50 surfaces · 30% slate-950 ink (text, dark blocks, structure)
//   10% dark Meta blue (#1e40af, darker than the Meta logo's #0467DF): Meta AI, the
//   primary action, and the outcome — the eye's path. Dark fills always carry white text.
//
// Dark mode — the palette itself is themed, so components keep plain classes
// (`bg-white`, `text-slate-600`, `bg-blue-800`) and never need `dark:` variants.
// Every themed color resolves to a CSS variable. Light values are Tailwind's own, so
// light mode is unchanged; under `html.dark` the variables point at a remapped shade.
// Text/borders and backgrounds remap differently: `text-slate-950` must turn light,
// while `bg-slate-950` (a dark block carrying white text) must stay dark.

const NEUTRAL = ["gray", "slate"];
const CHROMATIC = ["blue", "red", "rose", "amber", "emerald", "indigo", "green", "yellow", "orange", "sky"];
const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

// Dark-mode shade for each light shade, per role.
const DARK = {
  neutral: {
    fg: { 50: 950, 100: 800, 200: 800, 300: 700, 400: 500, 500: 400, 600: 300, 700: 200, 800: 200, 900: 100, 950: 50 },
    bg: { 50: 950, 100: 800, 200: 700, 300: 600, 400: 600, 500: 500, 600: 400, 700: 600, 800: 600, 900: 700, 950: 700 },
  },
  chromatic: {
    fg: { 50: 950, 100: 900, 200: 800, 300: 700, 400: 500, 500: 400, 600: 400, 700: 300, 800: 300, 900: 200, 950: 100 },
    bg: { 50: 950, 100: 900, 200: 800, 300: 700, 400: 500, 500: 500, 600: 600, 700: 600, 800: 700, 900: 800, 950: 900 },
  },
};

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};
const ref = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

function themedPalette(role) {
  const palette = { white: ref(role === "fg" ? "white" : "surface") };
  for (const scale of [...NEUTRAL, ...CHROMATIC]) {
    palette[scale] = Object.fromEntries(SHADES.map((s) => [s, ref(`${role}-${scale}-${s}`)]));
  }
  return palette;
}

function themeVariables() {
  const light = { "--c-white": rgb("#ffffff"), "--c-surface": rgb("#ffffff"), "--c-page": rgb(defaultColors.slate[100]) };
  const dark = { "--c-white": rgb(defaultColors.slate[900]), "--c-surface": rgb(defaultColors.slate[900]), "--c-page": rgb(defaultColors.slate[950]) };
  for (const [kind, scales] of [["neutral", NEUTRAL], ["chromatic", CHROMATIC]]) {
    for (const scale of scales) {
      for (const s of SHADES) {
        for (const role of ["fg", "bg"]) {
          light[`--c-${role}-${scale}-${s}`] = rgb(defaultColors[scale][s]);
          dark[`--c-${role}-${scale}-${s}`] = rgb(defaultColors[scale][DARK[kind][role][s]]);
        }
      }
    }
  }
  return { light, dark };
}

const fg = themedPalette("fg");
const bg = themedPalette("bg");

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["IBM Plex Sans", "Segoe UI", "sans-serif"],
        mono: ["IBM Plex Mono", "Consolas", "monospace"],
      },
      colors: {
        ...fg,
        page: ref("page"),
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
      // `text-white` only ever sits on a dark fill, so it stays white in both themes.
      textColor: { white: "#ffffff" },
      backgroundColor: bg,
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      const { light, dark } = themeVariables();
      addBase({
        ":root": { ...light, colorScheme: "light" },
        ":root.dark": { ...dark, colorScheme: "dark" },
      });
    }),
  ],
};
