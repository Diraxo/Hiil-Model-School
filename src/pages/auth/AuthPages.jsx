import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from "react";
import {
  LayoutDashboard, Users, GraduationCap, UserCog, School, BookOpen, CalendarDays,
  ClipboardCheck, ClipboardList, FileBarChart, AlertTriangle, MessageSquare, Bell,
  Settings, Search, Plus, X, Check, ChevronRight, LogOut, Copy,
  Camera, Trash2, Edit2, ArrowLeft, Menu, Send, Eye, EyeOff, Filter,
  TrendingUp, Loader2, RefreshCw, ShieldAlert,
  Megaphone, ClipboardEdit, ChevronLeft, CheckCircle2, CircleAlert, Info, UserPlus,
  Wallet, Bus, ImagePlus, BellRing
} from "lucide-react";
import {
  inputCls, Logo, Badge, statusTone, resultTotals, Avatar, Modal, ConfirmDialog, EmptyState,
  CopyIdChip, Field, Card, StatCard, SimpleBar, todayKeyStr, shiftDateKey, dateKeyLabel, DateNav,
  Toolbar, SearchInput, Select, PrimaryButton, GhostButton,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useMutationGuard } from "../../hooks/useMutationGuard";
import { createParentService } from "../../services/parentService";

const parentService = createParentService();


function LoginScreen() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [mode, setMode] = useState("login"); // login | register | forgot
  const [error, setError] = useState(auth.sessionEndedMessage || "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (auth.sessionEndedMessage) auth.clearSessionEndedMessage();
  }, []);

  async function submit(e) {
    e && e.preventDefault && e.preventDefault();
    if (!email.trim() || !password.trim()) { setError("Please enter your email and password."); return; }
    setSubmitting(true);
    const res = await auth.login(email, password);
    setSubmitting(false);
    if (!res.ok) { setError(res.message); return; }
    setError("");
  }

  if (mode === "register") return <RegisterScreen onBack={() => setMode("login")} />;
  if (mode === "forgot") return <ForgotPasswordScreen onBack={() => setMode("login")} initialEmail={email} />;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl bg-brand-600 border-b-4 border-gold-400 px-6 py-7 mb-4 flex flex-col items-center text-center shadow-sm">
          <div className="bg-white rounded-2xl p-2 shadow-sm">
            <Logo size={60} />
          </div>
          <h1 className="mt-3 text-xl font-bold text-white tracking-tight">Hiil Model School</h1>
          <p className="text-xs text-gold-200 mt-1 font-medium uppercase tracking-wide">Center of Excellence</p>
        </div>

        <Card className="p-6 shadow-sm">
          <div onKeyDown={(e) => { if (e.key === "Enter") submit(e); }}>
            <Field label="Email" required>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@school.com" />
            </Field>
            <Field label="Password" required>
              <div className="relative">
                <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls + " pr-9"} placeholder="••••••••" />
                <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <div className="flex items-center justify-between mb-4 text-xs">
              <label className="flex items-center gap-1.5 text-slate-500">
                <input type="checkbox" className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" /> Remember me
              </label>
              <button type="button" onClick={() => setMode("forgot")} className="text-brand-600 font-medium hover:text-brand-700">Forgot password?</button>
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{error}</p>}
            <button type="button" disabled={submitting} onClick={submit} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </div>
          <button onClick={() => setMode("register")} className="w-full mt-3 text-center text-xs text-slate-500 hover:text-slate-700">
            New parent? <span className="text-brand-600 font-medium">Create an account</span>
          </button>
        </Card>
        <p className="mt-5 text-center text-[11px] text-slate-400">
          Powered by{" "}
          <a href="https://www.hirgaliye.online/" target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-brand-600 font-medium">
            Hirgaliye
          </a>
        </p>
      </div>
    </div>
  );
}

// Real parent self-registration (20260907000000_parent_self_registration.sql): creates a real
// Supabase Auth account + profiles row, then atomically connects every submitted Student ID via
// self_register_link_children. Student ID existence/availability is checked live per-field
// (check_student_ids, anon-callable, reveals nothing but a status) and re-validated server-side on
// submit -- see AuthContext.signUp for the full flow and its handling of Supabase's email-
// confirmation setting.
function RegisterScreen({ onBack }) {
  const auth = useAuth();
  const { busy, run } = useMutationGuard();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [phone, setPhone] = useState("");
  const [children, setChildren] = useState([{ studentId: "", status: null, error: "" }]);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null); // { pendingConfirmation, message } once signUp succeeds

  function updateChild(i, val) {
    setChildren((c) => c.map((ch, idx) => (idx === i ? { studentId: val, status: null, error: "" } : ch)));
  }

  async function checkChild(i) {
    const id = (children[i]?.studentId || "").trim();
    if (!id) return;
    try {
      const statuses = await parentService.checkStudentIds([id]);
      const status = statuses.get(id) || null;
      setChildren((c) => c.map((ch, idx) => {
        if (idx !== i || ch.studentId.trim() !== id) return ch;
        return {
          ...ch,
          status,
          error: status === "not_found" ? "Student ID not found." : status === "already_linked" ? "This student is already linked to a parent account." : "",
        };
      }));
    } catch {
      // Live pre-check is a convenience only -- submit() re-validates server-side regardless.
    }
  }

  async function submit(e) {
    e && e.preventDefault && e.preventDefault();
    setError("");
    if (!fullName.trim()) { setError("Full name is required."); return; }
    if (!email.trim()) { setError("Email is required."); return; }
    if (!password) { setError("Password is required."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (!phone.trim()) { setError("Phone number is required."); return; }
    const ids = [...new Set(children.map((c) => c.studentId.trim()).filter(Boolean))];
    if (ids.length === 0) { setError("Enter a valid Student ID."); return; }

    await run(async () => {
      const res = await auth.signUp({ fullName, email, password, phone, studentIds: ids });
      if (!res.ok) { setError(res.message); return; }
      if (res.fieldErrors) {
        setChildren((c) => c.map((ch) => {
          const trimmed = ch.studentId.trim();
          const key = Object.keys(res.fieldErrors).find((k) => k.toLowerCase() === trimmed.toLowerCase());
          return key ? { ...ch, error: res.fieldErrors[key] } : ch;
        }));
        setError(res.message);
        return;
      }
      setDone({ pendingConfirmation: !!res.pendingConfirmation, message: res.message });
    });
  }

  if (done) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-6">
            <Logo size={56} />
          </div>
          <Card className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="text-emerald-600" size={28} /></div>
            <h2 className="text-base font-semibold text-slate-800 mb-1">Account created</h2>
            <p className="text-sm text-slate-400 mb-6">{done.message}</p>
            {done.pendingConfirmation && (
              <button onClick={onBack} className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2.5 text-sm font-medium">Back to sign in</button>
            )}
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"><ArrowLeft size={15} /> Back to sign in</button>
        <div className="flex flex-col items-center mb-6">
          <Logo size={56} />
          <h1 className="mt-3 text-lg font-semibold text-slate-800">Create your parent account</h1>
          <p className="text-xs text-slate-400 mt-1">Connect your child using the Student ID given by the school</p>
        </div>
        <Card className="p-6">
          <div onKeyDown={(e) => { if (e.key === "Enter") submit(e); }}>
            <Field label="Full name" required><input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} /></Field>
            <Field label="Email" required><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@example.com" /></Field>
            <Field label="Password" required>
              <div className="relative">
                <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls + " pr-9"} placeholder="At least 6 characters" />
                <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <Field label="Phone number" required><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="+252 61..." /></Field>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="block text-xs font-medium text-slate-500">Children</span>
              <button type="button" onClick={() => setChildren((c) => [...c, { studentId: "", status: null, error: "" }])} className="text-xs text-brand-600 font-medium flex items-center gap-1"><Plus size={13} /> Add another child</button>
            </div>
            {children.map((c, i) => (
              <div key={i} className="mb-2">
                <div className="flex gap-2">
                  <input
                    value={c.studentId}
                    onChange={(e) => updateChild(i, e.target.value)}
                    onBlur={() => checkChild(i)}
                    placeholder="e.g. TMA-2026-00031"
                    className={inputCls + (c.error ? " border-red-300" : c.status === "available" ? " border-emerald-300" : "")}
                  />
                  {children.length > 1 && <button type="button" onClick={() => setChildren((arr) => arr.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500 px-2"><X size={16} /></button>}
                </div>
                {c.error && <span className="block text-xs text-red-500 mt-1">{c.error}</span>}
              </div>
            ))}
            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-2 mb-1">{error}</p>}
            <button type="button" disabled={busy} onClick={submit} className="w-full mt-4 bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
              {busy ? "Creating account…" : "Create account"}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

// Real password recovery via Supabase Auth: step 1 emails the account a real recovery link;
// step 2 (PasswordRecoveryScreen, below) runs when that link lands the user back in this app
// with a recovery-scoped session already established.
function ForgotPasswordScreen({ onBack, initialEmail }) {
  const auth = useAuth();
  const [step, setStep] = useState("email"); // email | done
  const [email, setEmail] = useState(initialEmail || "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function requestReset(e) {
    e && e.preventDefault && e.preventDefault();
    setError("");
    if (!email.trim()) { setError("Please enter your email address."); return; }
    setSubmitting(true);
    const res = await auth.requestPasswordReset(email);
    setSubmitting(false);
    if (!res.ok) { setError(res.message); return; }
    setStep("done");
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"><ArrowLeft size={15} /> Back to sign in</button>
        <div className="flex flex-col items-center mb-6">
          <Logo size={56} />
          <h1 className="mt-3 text-lg font-semibold text-slate-800">Reset your password</h1>
        </div>

        {step === "email" && (
          <Card className="p-6">
            <p className="text-xs text-slate-400 mb-3">Enter the email address on your account. We'll send a password reset link to it.</p>
            <Field label="Email" required><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && requestReset(e)} className={inputCls} placeholder="you@school.com" /></Field>
            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{error}</p>}
            <button type="button" disabled={submitting} onClick={requestReset} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium">
              {submitting ? "Sending…" : "Send reset link"}
            </button>
          </Card>
        )}

        {step === "done" && (
          <Card className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="text-emerald-600" size={28} /></div>
            <h2 className="text-base font-semibold text-slate-800 mb-1">Check your email</h2>
            <p className="text-sm text-slate-400 mb-6">If an account exists for {email}, a password reset link has been sent. Open it to choose a new password.</p>
            <button onClick={onBack} className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2.5 text-sm font-medium">Back to sign in</button>
          </Card>
        )}
      </div>
    </div>
  );
}

// Reached when a Supabase Auth password-recovery email link lands the user back in the app.
// AuthContext detects the recovery landing (URL snapshot in supabaseClient.js, backed up by the
// PASSWORD_RECOVERY event) and routes here instead of the normal login/dashboard split -- see
// App.jsx's Root. The recovery-scoped session is never allowed to fall through to the dashboard;
// the user must set a new password (or cancel) first.
function PasswordRecoveryScreen() {
  const auth = useAuth();
  const { busy, run } = useMutationGuard();
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e) {
    e && e.preventDefault && e.preventDefault();
    setError("");
    if (!newPw || !confirmPw) { setError("Enter and confirm your new password."); return; }
    if (newPw !== confirmPw) { setError("The two passwords don't match."); return; }
    if (newPw.length < 6) { setError("Use a password of at least 6 characters."); return; }
    await run(async () => {
      const res = await auth.completePasswordRecovery(newPw, confirmPw);
      if (!res.ok) { setError(res.message); return; }
      setDone(true);
    }, { key: "password-recovery-update" });
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <Logo size={56} />
          <h1 className="mt-3 text-lg font-semibold text-slate-800">Reset your password</h1>
          {!done && <p className="text-xs text-slate-400 mt-1">Enter a new password for your Hiil Model School account.</p>}
        </div>

        {done ? (
          <Card className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="text-emerald-600" size={28} /></div>
            <h2 className="text-base font-semibold text-slate-800 mb-1">Password updated successfully</h2>
            <p className="text-sm text-slate-400 mb-6">Your password has been changed. You can now sign in with your new password.</p>
            <button onClick={auth.finalizePasswordRecovery} className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2.5 text-sm font-medium">Back to sign in</button>
          </Card>
        ) : (
          <Card className="p-6">
            <Field label="New password" required>
              <div className="relative">
                <input type={showPw ? "text" : "password"} value={newPw} onChange={(e) => setNewPw(e.target.value)} className={inputCls + " pr-9"} placeholder="At least 6 characters" />
                <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <Field label="Confirm new password" required>
              <div className="relative">
                <input type={showConfirmPw ? "text" : "password"} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} className={inputCls + " pr-9"} />
                <button type="button" onClick={() => setShowConfirmPw((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showConfirmPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{error}</p>}
            <button type="button" disabled={busy} onClick={submit} className="w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium">
              {busy ? "Saving…" : "Set new password"}
            </button>
            <button type="button" onClick={auth.cancelPasswordRecovery} className="w-full mt-2 text-center text-xs text-slate-500 hover:text-slate-700">Cancel</button>
          </Card>
        )}
      </div>
    </div>
  );
}

// Shown when the emailed reset link is expired, already used, or malformed -- Supabase
// established no recovery session, so there is nothing to reset. AuthContext sets
// `recoveryLinkInvalid` (see App.jsx's Root).
function InvalidRecoveryLinkScreen() {
  const auth = useAuth();
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <Logo size={56} />
          <h1 className="mt-3 text-lg font-semibold text-slate-800">Reset your password</h1>
        </div>
        <Card className="p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4"><CircleAlert className="text-amber-600" size={28} /></div>
          <h2 className="text-base font-semibold text-slate-800 mb-1">This link can't be used</h2>
          <p className="text-sm text-slate-400 mb-6">This password reset link is invalid or has expired. Please request a new one.</p>
          <button onClick={auth.dismissInvalidRecoveryLink} className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2.5 text-sm font-medium">Back to sign in</button>
        </Card>
      </div>
    </div>
  );
}


export { LoginScreen, RegisterScreen, PasswordRecoveryScreen, InvalidRecoveryLinkScreen };
