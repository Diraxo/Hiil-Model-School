// Appearance preference: "system" (default) | "light" | "dark". Device-local (localStorage) only;
// nothing about it is sent to the backend. Kept free of React so it can also be used pre-render.
export const THEME_KEY = "hiil-theme";
export const THEME_MODES = ["system", "light", "dark"];
export const DEFAULT_THEME = "system";
export const THEME_COLORS = { light: "#f8fafc", dark: "#0b1220" };

export function normalizeTheme(value) {
  return THEME_MODES.includes(value) ? value : DEFAULT_THEME;
}

export function readStoredTheme() {
  try { return normalizeTheme(window.localStorage.getItem(THEME_KEY)); } catch { return DEFAULT_THEME; }
}

export function storeTheme(mode) {
  try { window.localStorage.setItem(THEME_KEY, normalizeTheme(mode)); } catch { /* private mode: keep for this session only */ }
}

export function systemPrefersDark() {
  try { return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); } catch { return false; }
}

// The concrete theme ("light" | "dark") a preference resolves to.
export function resolveTheme(mode, prefersDark) {
  const m = normalizeTheme(mode);
  return m === "system" ? (prefersDark ? "dark" : "light") : m;
}

export function applyResolvedTheme(resolved, doc = document) {
  const root = doc.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[resolved]);
}
