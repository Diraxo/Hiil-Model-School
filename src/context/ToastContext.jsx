import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from "react";
import { CircleAlert, Info, CheckCircle2 } from "lucide-react";
import { uid } from "../utils/helpers";

const ToastCtx = createContext(null);
function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, kind = "success") => {
    const id = uid("toast");
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 w-[92vw] max-w-sm">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-lg shadow-lg border px-4 py-3 flex items-start gap-2 bg-white ${t.kind === "error" ? "border-red-200" : t.kind === "info" ? "border-sky-200" : "border-emerald-200"}`}>
            {t.kind === "error" ? <CircleAlert size={18} className="text-red-600 mt-0.5 shrink-0" /> : t.kind === "info" ? <Info size={18} className="text-sky-600 mt-0.5 shrink-0" /> : <CheckCircle2 size={18} className="text-emerald-700 mt-0.5 shrink-0" />}
            <p className="text-sm text-slate-700 leading-snug">{t.msg}</p>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
function useToast() { return useContext(ToastCtx); }

export { ToastProvider, useToast };
