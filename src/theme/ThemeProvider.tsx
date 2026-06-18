import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { resolveTheme, THEME_KEY, type Theme } from "./theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function persist(t: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    resolveTheme(
      typeof localStorage !== "undefined" ? localStorage.getItem(THEME_KEY) : null,
      systemPrefersDark(),
    ),
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    persist(t);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      persist(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}
