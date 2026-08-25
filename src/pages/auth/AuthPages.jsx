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
        <div className="flex flex-col items-center mb-7">
          <Logo size={68} />
          <h1 className="mt-4 text-xl font-semibold text-slate-800 tracking-tight">Tilmaan Modern Academy</h1>
          <p className="text-sm text-slate-400 mt-1">School Management Portal</p>
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
                <input type="checkbox" className="rounded border-slate-300 text-sky-600 focus:ring-sky-500" /> Remember me
              </label>
              <button type="button" onClick={() => setMode("forgot")} className="text-sky-600 font-medium hover:text-sky-700">Forgot password?</button>
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{error}</p>}
            <button type="button" disabled={submitting} onClick={submit} className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </div>
          <button onClick={() => setMode("register")} className="w-full mt-3 text-center text-xs text-slate-500 hover:text-slate-700">
            New parent? <span className="text-sky-600 font-medium">Create an account</span>
          </button>
        </Card>
      </div>
    </div>
  );
}

// Parent self-registration is temporarily disabled: it needs both a real Supabase Auth signUp
// AND a link to a real `students` row, and student data hasn't been converted from the mock
// database to Supabase yet (that's a later phase of the migration). The screen stays in place,
// disabled, rather than being deleted, since it comes back online once that phase lands.
function RegisterScreen({ onBack }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [phone, setPhone] = useState("");
  const [children, setChildren] = useState([{ studentId: "" }]);
  const [error] = useState("");

  function updateChild(i, val) {
    setChildren((c) => c.map((ch, idx) => (idx === i ? { studentId: val } : ch)));
  }

  function submit(e) {
    e && e.preventDefault && e.preventDefault();
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-4"><ArrowLeft size={15} /> Back to sign in</button>
        <div className="flex flex-col items-center mb-6">
          <Logo size={56} />
          <h1 className="mt-3 text-lg font-semibold text-slate-800">Create a parent account</h1>
          <p className="text-xs text-slate-400 mt-1">Connect your child using the Student ID given by the school</p>
        </div>
        <Card className="p-6">
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">
            Online registration is temporarily unavailable while the school switches to its new system. Please contact the school office to set up your parent account for now.
          </div>
          <div className="opacity-50 pointer-events-none">
            <Field label="Full name" required><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></Field>
            <Field label="Email" required><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></Field>
            <Field label="Password" required>
              <div className="relative">
                <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls + " pr-9"} />
                <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <Field label="Phone number" required><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="+252 61..." /></Field>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="block text-xs font-medium text-slate-500">Children</span>
              <button type="button" onClick={() => setChildren((c) => [...c, { studentId: "" }])} className="text-xs text-sky-600 font-medium flex items-center gap-1"><Plus size={13} /> Add another child</button>
            </div>
            {children.map((c, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input value={c.studentId} onChange={(e) => updateChild(i, e.target.value)} placeholder="e.g. TMA-2026-00031" className={inputCls} />
                {children.length > 1 && <button type="button" onClick={() => setChildren((arr) => arr.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500 px-2"><X size={16} /></button>}
              </div>
            ))}
            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-2 mb-1">{error}</p>}
            <button type="button" onClick={submit} className="w-full mt-4 bg-sky-600 hover:bg-sky-700 text-white rounded-lg py-2.5 text-sm font-medium">Create account</button>
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
            <button type="button" disabled={submitting} onClick={requestReset} className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium">
              {submitting ? "Sending…" : "Send reset link"}
            </button>
          </Card>
        )}

        {step === "done" && (
          <Card className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="text-emerald-600" size={28} /></div>
            <h2 className="text-base font-semibold text-slate-800 mb-1">Check your email</h2>
            <p className="text-sm text-slate-400 mb-6">If an account exists for {email}, a password reset link has been sent. Open it to choose a new password.</p>
            <button onClick={onBack} className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-lg py-2.5 text-sm font-medium">Back to sign in</button>
          </Card>
        )}
      </div>
    </div>
  );
}

// Reached when a Supabase Auth password-recovery email link lands the user back in the app --
// AuthContext detects the resulting PASSWORD_RECOVERY event and routes here instead of the
// normal login/dashboard split (see App.jsx's Root).
function PasswordRecoveryScreen() {
  const auth = useAuth();
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e && e.preventDefault && e.preventDefault();
    setError("");
    if (!newPw || !confirmPw) { setError("Please fill in your new password."); return; }
    if (newPw !== confirmPw) { setError("New password and confirmation don't match."); return; }
    setSubmitting(true);
    const res = await auth.completePasswordRecovery(newPw);
    setSubmitting(false);
    if (!res.ok) { setError(res.message); return; }
    setDone(true);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <Logo size={56} />
          <h1 className="mt-3 text-lg font-semibold text-slate-800">Choose a new password</h1>
        </div>

        {done ? (
          <Card className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="text-emerald-600" size={28} /></div>
            <h2 className="text-base font-semibold text-slate-800 mb-1">Password reset</h2>
            <p className="text-sm text-slate-400 mb-6">Your password has been changed. Continue to your dashboard.</p>
            <button onClick={() => window.location.reload()} className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-lg py-2.5 text-sm font-medium">Continue</button>
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
            <button type="button" disabled={submitting} onClick={submit} className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium">
              {submitting ? "Saving…" : "Reset password"}
            </button>
            <button type="button" onClick={auth.cancelPasswordRecovery} className="w-full mt-2 text-center text-xs text-slate-500 hover:text-slate-700">Cancel</button>
          </Card>
        )}
      </div>
    </div>
  );
}


export { LoginScreen, RegisterScreen, PasswordRecoveryScreen };
