import { useSyncExternalStore } from "react";

/** The viewer's choice. "system" follows the OS setting and is the default. */
export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const STORAGE_KEY = "drafty-theme";
const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Storage can be blocked; fall back to the system setting.
  }
  return "system";
}

let preference: ThemePreference = readPreference();

function resolve(pref: ThemePreference): Theme {
  if (pref === "system") return media?.matches ? "dark" : "light";
  return pref;
}

function apply() {
  document.documentElement.classList.toggle("dark", resolve(preference) === "dark");
  listeners.forEach((listener) => listener());
}

media?.addEventListener("change", () => {
  if (preference === "system") apply();
});

export function setThemePreference(next: ThemePreference) {
  preference = next;
  try {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not persisted; still applies for this page view.
  }
  apply();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, () => preference);
}

/** The theme actually on screen, for colors that can't come from CSS (three.js, canvas). */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => resolve(preference));
}
