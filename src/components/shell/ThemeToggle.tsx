import { useTheme } from "../../theme/useTheme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-[15px] text-muted hover:bg-panel hover:text-text"
      title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      aria-label="Toggle light/dark theme"
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
