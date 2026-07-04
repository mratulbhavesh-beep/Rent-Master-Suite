import { useTheme } from "@/context/ThemeContext";
import colors from "@/constants/colors";

/**
 * Returns the design tokens for the currently active theme.
 *
 * Reads the user-selected theme from ThemeContext (light / dark / system).
 * All screens that call useColors() will re-render instantly when the theme
 * changes — no restart required.
 */
export function useColors() {
  const { effectiveScheme } = useTheme();
  const palette = effectiveScheme === "dark" ? colors.dark : colors.light;
  return { ...palette, radius: colors.radius };
}
