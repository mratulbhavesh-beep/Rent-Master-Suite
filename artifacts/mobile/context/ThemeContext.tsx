import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";

export type ThemePreference = "light" | "dark" | "system";

interface ThemeContextType {
  themePreference: ThemePreference;
  effectiveScheme: "light" | "dark";
  setThemePreference: (preference: ThemePreference) => Promise<void>;
}

const THEME_STORAGE_KEY = "theme_preference";

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const deviceScheme = useColorScheme();
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((stored) => {
        if (stored === "light" || stored === "dark" || stored === "system") {
          setThemePreferenceState(stored);
        }
      })
      .catch(() => {});
  }, []);

  const setThemePreference = useCallback(async (preference: ThemePreference) => {
    setThemePreferenceState(preference);
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // storage failure is non-critical; in-memory state is already updated
    }
  }, []);

  const effectiveScheme: "light" | "dark" =
    themePreference === "system"
      ? deviceScheme === "dark"
        ? "dark"
        : "light"
      : themePreference;

  return (
    <ThemeContext.Provider value={{ themePreference, effectiveScheme, setThemePreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
