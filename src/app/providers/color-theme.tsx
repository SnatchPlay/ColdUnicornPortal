import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type ColorTheme = "default" | "contrast";

interface ColorThemeContextValue {
  theme: ColorTheme;
  isContrast: boolean;
  toggleTheme: () => void;
}

const ColorThemeContext = createContext<ColorThemeContextValue>({
  theme: "default",
  isContrast: false,
  toggleTheme: () => {},
});

const STORAGE_KEY = "pdca-color-theme";

export function ColorThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ColorTheme>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "default" ? "default" : "contrast";
    } catch {
      return "contrast";
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "contrast") {
      root.setAttribute("data-color-theme", "contrast");
    } else {
      root.removeAttribute("data-color-theme");
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  function toggleTheme() {
    setTheme((prev) => (prev === "contrast" ? "default" : "contrast"));
  }

  return (
    <ColorThemeContext.Provider value={{ theme, isContrast: theme === "contrast", toggleTheme }}>
      {children}
    </ColorThemeContext.Provider>
  );
}

export function useColorTheme(): ColorThemeContextValue {
  return useContext(ColorThemeContext);
}
