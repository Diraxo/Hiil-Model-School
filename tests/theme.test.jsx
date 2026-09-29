// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { ThemeProvider, useTheme } from "../src/context/ThemeContext";
import { AppearanceSettings } from "../src/components/AppearanceSettings";
import { Modal, Badge, Card, Field, Select } from "../src/components/ui";
import { THEME_KEY, resolveTheme, normalizeTheme } from "../src/utils/theme";
import { ToastProvider } from "../src/context/ToastContext";

// A controllable matchMedia so the device appearance can be flipped while the app is "running".
let listeners;
let prefersDark;
function installMatchMedia(initialDark) {
  prefersDark = initialDark;
  listeners = new Set();
  window.matchMedia = vi.fn((query) => ({
    get matches() { return query.includes("prefers-color-scheme: dark") ? prefersDark : false; },
    media: query,
    addEventListener: (_t, fn) => listeners.add(fn),
    removeEventListener: (_t, fn) => listeners.delete(fn),
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
  }));
}
function flipDevice(dark) {
  prefersDark = dark;
  act(() => { listeners.forEach((fn) => fn({ matches: dark })); });
}
const isDark = () => document.documentElement.classList.contains("dark");

function Probe() {
  const { mode, resolved } = useTheme();
  return <span data-testid="probe">{mode}:{resolved}</span>;
}
const app = () => (
  <ThemeProvider><ToastProvider><Probe /><AppearanceSettings /></ToastProvider></ThemeProvider>
);

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.style.colorScheme = "";
});
afterEach(() => cleanup());

describe("theme resolution", () => {
  it("defaults to System and ignores junk values", () => {
    expect(normalizeTheme(undefined)).toBe("system");
    expect(normalizeTheme("purple")).toBe("system");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("ThemeProvider (web)", () => {
  it("new user: System follows a dark device, and stores nothing", () => {
    installMatchMedia(true);
    render(app());
    expect(screen.getByTestId("probe").textContent).toBe("system:dark");
    expect(isDark()).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("System follows a light device", () => {
    installMatchMedia(false);
    render(app());
    expect(screen.getByTestId("probe").textContent).toBe("system:light");
    expect(isDark()).toBe(false);
  });

  it("System reacts live when the device appearance changes; explicit modes ignore it", () => {
    installMatchMedia(false);
    render(app());
    flipDevice(true);
    expect(isDark()).toBe(true);
    flipDevice(false);
    expect(isDark()).toBe(false);

    fireEvent.click(screen.getByRole("radio", { name: /^Light/ }));
    flipDevice(true);
    expect(isDark()).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: /^Dark/ }));
    flipDevice(false);
    expect(isDark()).toBe(true);
  });

  it("explicit Light and Dark work and mark the chosen radio", () => {
    installMatchMedia(true);
    render(app());
    fireEvent.click(screen.getByRole("radio", { name: /^Light/ }));
    expect(isDark()).toBe(false);
    expect(screen.getByRole("radio", { name: /^Light/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /^System/ }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("radio", { name: /^Dark/ }));
    expect(isDark()).toBe(true);
    expect(screen.getByRole("radio", { name: /^Dark/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("the choice persists across a reload (fresh mount) and can go back to System", () => {
    installMatchMedia(false);
    const first = render(app());
    fireEvent.click(screen.getByRole("radio", { name: /^Dark/ }));
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
    first.unmount();
    document.documentElement.className = "";

    render(app());
    expect(screen.getByTestId("probe").textContent).toBe("dark:dark");
    expect(isDark()).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /^System/ }));
    expect(screen.getByTestId("probe").textContent).toBe("system:light");
    expect(isDark()).toBe(false);
  });

  it("switching theme does not remount the app or lose local state", () => {
    installMatchMedia(false);
    function Counter() {
      const [n, setN] = React.useState(0);
      return <button onClick={() => setN(n + 1)}>count {n}</button>;
    }
    render(<ThemeProvider><Counter /><AppearanceSettings /></ThemeProvider>);
    fireEvent.click(screen.getByText("count 0"));
    fireEvent.click(screen.getByRole("radio", { name: /^Dark/ }));
    expect(screen.getByText("count 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /^Light/ }));
    expect(screen.getByText("count 1")).toBeTruthy();
  });

  it("a stored preference from another tab is picked up", () => {
    installMatchMedia(false);
    render(app());
    act(() => {
      window.localStorage.setItem(THEME_KEY, "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY, newValue: "dark" }));
    });
    expect(isDark()).toBe(true);
  });

  it("shared components (modal, form, table, badge) render in both themes", () => {
    installMatchMedia(false);
    for (const mode of ["light", "dark"]) {
      window.localStorage.setItem(THEME_KEY, mode);
      const { unmount } = render(
        <ThemeProvider>
          <Modal open title="Confirm" onClose={() => {}}>
            <Field label="Name"><input aria-label="name" defaultValue="Amina" /></Field>
            <Select value="Grade 1" onChange={() => {}} options={["Grade 1", "Grade 2"]} placeholder="Grade" />
            <table><thead><tr><th>Student</th></tr></thead><tbody><tr><td>Amina</td></tr></tbody></table>
            <Badge tone="green">Paid</Badge><Badge tone="red">Voided</Badge>
            <Card>panel</Card>
          </Modal>
        </ThemeProvider>
      );
      expect(isDark()).toBe(mode === "dark");
      expect(screen.getByText("Confirm")).toBeTruthy();
      expect(screen.getByLabelText("name").value).toBe("Amina");
      expect(screen.getByText("Voided")).toBeTruthy();
      expect(screen.getByRole("table")).toBeTruthy();
      unmount();
      document.documentElement.className = "";
    }
  });
});
