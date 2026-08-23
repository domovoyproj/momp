"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { WebThemeConfig } from "@/lib/settings-api";

export type ThemePreference = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

type ThemeState = {
  preference: ThemePreference;
  theme: ResolvedTheme;
};

type ToggleOrigin = { x: number; y: number };

const STORAGE_KEY = "pi-theme";
const PREFERENCE_CYCLE: ThemePreference[] = ["light", "dark", "auto"];
const SERVER_SNAPSHOT: ThemeState = { preference: "auto", theme: "light" };

const THEME_MODE_KEY = "omp-theme";
const THEME_CONFIG_KEY = "omp-theme-config";
let themeConfig: WebThemeConfig | null = null;
let themeRequestId = 0;

const listeners = new Set<() => void>();
let state: ThemeState | null = null;
let systemListening = false;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "auto") return value;
    // Legacy omp-web key: a stored mode keeps meaning as that preference so
    // existing dark-mode users do not silently flip to auto on upgrade.
    const legacy = localStorage.getItem(THEME_MODE_KEY);
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
  return "auto";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "auto" ? getSystemTheme() : preference;
}

/**
 * Apply the resolved theme to the DOM: omp's palette CSS variables when the
 * theme config is loaded, the `.dark` class otherwise. The mode is also
 * persisted under the legacy key so the SSR bootstrap script paints the same
 * theme before hydration.
 */
function applyOmpPalette(theme: ResolvedTheme): void {
  const root = document.documentElement;
  const palette = themeConfig?.palettes[theme];
  root.dataset.ompThemeMode = theme;
  root.classList.toggle("dark", palette ? palette.colorScheme === "dark" : theme === "dark");
  if (palette) {
    for (const [name, value] of Object.entries(palette.variables)) {
      root.style.setProperty(name, value);
    }
    root.dataset.ompThemeName = palette.name;
    root.style.colorScheme = palette.colorScheme;
  }
  try {
    localStorage.setItem(THEME_MODE_KEY, theme);
  } catch {
    // The in-memory state still applies when storage is unavailable.
  }
}

function ensureState(): ThemeState {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  if (state) return state;

  const preference = readStoredPreference();
  const theme = resolveTheme(preference);
  applyOmpPalette(theme);
  state = { preference, theme };
  return state;
}

function setThemeState(preference: ThemePreference, theme: ResolvedTheme, persist: boolean): void {
  applyOmpPalette(theme);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }
  state = { preference, theme };
  emit();
}

function syncAutoThemeFromSystem(): void {
  const current = ensureState();
  if (current.preference !== "auto") return;
  const theme = getSystemTheme();
  if (theme === current.theme) return;
  setThemeState("auto", theme, false);
}

function ensureSystemListener(): void {
  if (systemListening || typeof window === "undefined" || !window.matchMedia) return;

  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", syncAutoThemeFromSystem);
  // Some browsers delay or miss scheme events while backgrounded.
  window.addEventListener("focus", syncAutoThemeFromSystem);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncAutoThemeFromSystem();
  });
  systemListening = true;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  ensureState();
  ensureSystemListener();
  syncAutoThemeFromSystem();
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ThemeState {
  return ensureState();
}

function getServerSnapshot(): ThemeState {
  return SERVER_SNAPSHOT;
}

function nextPreference(preference: ThemePreference): ThemePreference {
  const index = PREFERENCE_CYCLE.indexOf(preference);
  return PREFERENCE_CYCLE[(index + 1) % PREFERENCE_CYCLE.length];
}

export async function refreshOmpTheme(cwd?: string | null): Promise<void> {
  const requestId = ++themeRequestId;
  const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
  const response = await fetch(`/api/theme${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Theme request failed (${response.status})`);
  const nextConfig = await response.json() as WebThemeConfig;
  if (requestId !== themeRequestId) return;
  themeConfig = nextConfig;
  try {
    localStorage.setItem(THEME_CONFIG_KEY, JSON.stringify(themeConfig));
  } catch {
    // The in-memory configuration still applies when storage is unavailable.
  }
  applyOmpPalette(ensureState().theme);
}

export function useTheme(options?: { cwd?: string | null; syncWithOmp?: boolean }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!options?.syncWithOmp) return;
    let cancelled = false;
    void refreshOmpTheme(options.cwd).catch(() => {
      if (cancelled) return;
      try {
        const cached = localStorage.getItem(THEME_CONFIG_KEY);
        if (cached) {
          themeConfig = JSON.parse(cached) as WebThemeConfig;
          applyOmpPalette(ensureState().theme);
        }
      } catch {
        // Keep the built-in CSS fallback when neither endpoint nor cache works.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [options?.cwd, options?.syncWithOmp]);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    const current = ensureState();
    const nextPref = nextPreference(current.preference);
    const nextTheme = resolveTheme(nextPref);

    const apply = () => {
      setThemeState(nextPref, nextTheme, true);
    };

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";

    if (!supportsVT || reduceMotion) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 450,
            easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        // transition cancelled — ignore
      });
  }, []);

  return {
    theme: snapshot.theme,
    preference: snapshot.preference,
    toggleTheme,
    isDark: snapshot.theme === "dark",
  };
}
