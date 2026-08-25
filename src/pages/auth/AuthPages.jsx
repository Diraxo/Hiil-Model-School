import React, { useState, useEffect, useMemo, useCallback, createContext, useContext, useRef } from "react";
import {
  LayoutDashboard, Users, GraduationCap, UserCog, School, BookOpen, CalendarDays,
  ClipboardCheck, ClipboardList, FileBarChart, AlertTriangle, MessageSquare, Bell,
  Settings, Search, Plus, X, Check, ChevronRight, ChevronDown, LogOut, Copy,
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
import { useData } from "../../context/DataContext";
import { useToast } from "../../context/ToastContext";


function LoginScreen() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const [mode, setMode] = useState("login"); // login | register | forgot
  const [error, setError] = useState(auth.sessionEndedMessage || "");

  useEffect(() => {
    if (auth.sessionEndedMessage) auth.clearSessionEndedMessage();
  }, []);

  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    if (!email.trim() || !password.trim()) { setError("Please enter your email and password."); return; }
    const res = auth.login(email, password);
    if (!res.ok) { setError(res.message); return; }
    setError("");
  }

  const demoAccounts = [
    { role: "Administrator", email: "admin@tilmaan-demo.com", desc: "Full school management access" },
    { role: "Teacher", email: "teacher@tilmaan-demo.com", desc: "Amina Hassan — English, Grade 3A & 3B" },
    { role: "Parent", email: "parent@tilmaan-demo.com", desc: "Mohamed Hassan — Ahmed (3A) & Aisha (1B)" },
  ];

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
            <button type="button" onClick={submit} className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">Sign in</button>
          </div>
          <button onClick={() => setMode("register")} className="w-full mt-3 text-center text-xs text-slate-500 hover:text-slate-700">
            New parent? <span className="text-sky-600 font-medium">Create an account</span>
          </button>
        </Card>

        <div className="mt-4">
          <button onClick={() => setShowDemo((s) => !s)} className="w-full text-xs text-slate-400 hover:text-slate-600 flex items-center justify-center gap-1 py-2">
            Demo accounts <ChevronDown size={14} className={`transition-transform ${showDemo ? "rotate-180" : ""}`} />
          </button>
          {showDemo && (
            <Card className="p-3 space-y-2">
              {demoAccounts.map((d) => (
                <button key={d.email} onClick={() => { setEmail(d.email); setPassword("Demo123!"); setError(""); }} className="w-full text-left rounded-lg border border-slate-100 hover:border-sky-200 hover:bg-sky-50/50 px-3 py-2 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">{d.role}</span>
                    <span className="text-[10px] text-sky-600 font-medium">Use this</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">{d.email}</p>
                  <p className="text-[11px] text-slate-400">{d.desc}</p>
                </button>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function RegisterScreen({ onBack }) {
  const data = useData();
  const auth = useAuth();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [phone, setPhone] = useState("");
  const [children, setChildren] = useState([{ studentId: "" }]);
  const [error, setError] = useState("");
  const [accountCreated, setAccountCreated] = useState(false);

  function updateChild(i, val) {
    setChildren((c) => c.map((ch, idx) => (idx === i ? { studentId: val } : ch)));
  }

  function submit(e) {
    e && e.preventDefault && e.preventDefault();
    setError("");
    if (!name.trim() || !email.trim() || !password.trim() || !phone.trim()) { setError("Please fill in all required fields."); return; }
    const cleaned = children.filter((c) => c.studentId.trim());
    if (cleaned.length === 0) { setError("Add at least one child's Student ID."); return; }
    const res = data.createParentAccount({ name, email, password, phone, children: cleaned });
    if (!res.ok) { setError(res.message); return; }
    setAccountCreated(true);
  }

  function continueToDashboard() {
    const login = auth.login(email, password);
    if (!login.ok) onBack();
  }

  if (accountCreated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Card className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="text-emerald-600" size={28} /></div>
            <h1 className="text-lg font-semibold text-slate-800 mb-1">Account created successfully!</h1>
            <p className="text-sm text-slate-400 mb-6">Welcome to Tilmaan Modern Academy, {name.split(" ")[0]}. Your account is ready.</p>
            <button onClick={continueToDashboard} className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-lg py-2.5 text-sm font-medium">Continue to Dashboard</button>
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
          <h1 className="mt-3 text-lg font-semibold text-slate-800">Create a parent account</h1>
          <p className="text-xs text-slate-400 mt-1">Connect your child using the Student ID given by the school</p>
        </div>
        <Card className="p-6">
          <div>
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

// Real, working password recovery: step 1 issues a one-time code against the account; step 2
// verifies it and actually updates the stored password. Phase 1 has no email server (see the
// README's Phase 4 roadmap), so the code is shown on-screen instead of emailed — clearly labeled
// as a demo stand-in for real delivery, never presented as if an email was actually sent.
function ForgotPasswordScreen({ onBack, initialEmail }) {
  const data = useData();
  const [step, setStep] = useState("email"); // email | reset | done
  const [email, setEmail] = useState(initialEmail || "");
  const [issuedCode, setIssuedCode] = useState("");
  const [code, setCode] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [error, setError] = useState("");

  function requestCode(e) {
    e && e.preventDefault && e.preventDefault();
    setError("");
    if (!email.trim()) { setError("Please enter your email address."); return; }
    const res = data.requestPasswordReset(email);
    if (!res.ok) { setError(res.message); return; }
    setIssuedCode(res.code);
    setStep("reset");
  }

  function submitReset(e) {
    e && e.preventDefault && e.preventDefault();
    setError("");
    if (!code.trim() || !newPw || !confirmPw) { setError("Please fill in the code and your new password."); return; }
    if (newPw !== confirmPw) { setError("New password and confirmation don't match."); return; }
    const res = data.resetPasswordWithCode(email, code, newPw);
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
            <p className="text-xs text-slate-400 mb-3">Enter the email address on your account. We'll issue a reset code for it.</p>
            <Field label="Email" required><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && requestCode(e)} className={inputCls} placeholder="you@school.com" /></Field>
            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">{error}</p>}
            <button type="button" onClick={requestCode} className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-lg py-2.5 text-sm font-medium">Send reset code</button>
          </Card>
        )}

        {step === "reset" && (
          <Card className="p-6">
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">
              This demo doesn't have a live email server yet (see the roadmap in the README), so instead of emailing your code, here it is directly. In a deployed school system, this code would arrive by email instead.
              <p className="mt-2 font-mono text-base font-semibold text-amber-800 tracking-widest">{issuedCode}</p>
            </div>
            <Field label="Reset code" required><input value={code} onChange={(e) => setCode(e.target.value)} className={inputCls} placeholder="6-digit code" /></Field>
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
            <button type="button" onClick={submitReset} className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-lg py-2.5 text-sm font-medium">Reset password</button>
            <button type="button" onClick={() => setStep("email")} className="w-full mt-2 text-center text-xs text-slate-500 hover:text-slate-700">Use a different email</button>
          </Card>
        )}

        {step === "done" && (
          <Card className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="text-emerald-600" size={28} /></div>
            <h2 className="text-base font-semibold text-slate-800 mb-1">Password reset</h2>
            <p className="text-sm text-slate-400 mb-6">Your password has been changed. Sign in with your new password.</p>
            <button onClick={onBack} className="w-full bg-sky-600 hover:bg-sky-700 text-white rounded-lg py-2.5 text-sm font-medium">Back to sign in</button>
          </Card>
        )}
      </div>
    </div>
  );
}


export { LoginScreen, RegisterScreen };
