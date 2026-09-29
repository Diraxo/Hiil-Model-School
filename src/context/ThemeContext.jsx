import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import {
  readStoredTheme, storeTheme, normalizeTheme, resolveTheme, systemPrefersDark, applyResolvedTheme, THEME_KEY,
} from "../utils/theme";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readStoredTheme);
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

  // Follow the browser/OS appearance live while the app is open.
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e) => setPrefersDark(e.matches);
    if (mq.addEventListener) mq.addEventListener("change", onChange); else mq.addListener(onChange);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", onChange); else mq.removeListener(onChange); };
  }, []);

  // Keep several open tabs in step.
  useEffect(() => {
    const onStorage = (e) => { if (e.key === THEME_KEY) setModeState(normalizeTheme(e.newValue)); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const resolved = resolveTheme(mode, prefersDark);
  useEffect(() => { applyResolvedTheme(resolved); }, [resolved]);

  const setMode = useCallback((next) => { const m = normalizeTheme(next); storeTheme(m); setModeState(m); }, []);
  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
