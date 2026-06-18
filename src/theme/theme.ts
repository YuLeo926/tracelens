export type Theme = "light" | "dark";

export const THEME_KEY = "tracelens.theme";

/** Pick the active theme from any stored value plus the system preference. */
export function resolveTheme(stored: string | null, systemPrefersDark: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return systemPrefersDark ? "dark" : "light";
}
