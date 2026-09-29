import React from "react";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { Card } from "./ui";

const OPTIONS = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function AppearanceSettings() {
  const { mode, resolved, setMode } = useTheme();
  return (
    <Card className="p-5 mb-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-1">Appearance</h3>
      <p className="text-xs text-slate-400 mb-3">
        Choose Light or Dark, or follow this device{mode === "system" ? ` (currently ${resolved})` : ""}. Saved on this device only.
      </p>
      <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-2 max-w-sm">
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const selected = mode === value;
          return (
            <button key={value} type="button" role="radio" aria-checked={selected} onClick={() => setMode(value)}
              className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg text-sm font-medium border focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${selected ? "bg-brand-600 text-white border-brand-600" : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"}`}>
              <Icon size={15} />{label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
