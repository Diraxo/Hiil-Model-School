import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in."
  );
}

// --- Password-recovery URL snapshot ------------------------------------------------
// A Supabase Auth password-reset email link sends the user back to this app with the
// recovery outcome encoded in the URL (implicit flow, in the hash):
//   valid link:   #access_token=...&type=recovery&refresh_token=...
//   bad/old link: #error=access_denied&error_code=otp_expired&error_description=...
// supabase-js consumes that hash and strips it from the address bar during client
// init (`detectSessionInUrl`), and emits its one-shot `PASSWORD_RECOVERY` event
// *before* React has mounted and attached its `onAuthStateChange` listener. Relying
// on that event alone is therefore racy -- when it's missed the recovery-scoped
// session looks like an ordinary login and the user is dropped on the dashboard
// instead of the "set a new password" screen. To make the detection reliable we read
// the facts we need from the URL synchronously, here, before `createClient()` kicks
// off that processing. Only two booleans are kept; no token is read, stored, or logged.
function readRecoveryUrl() {
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search.replace(/^\?/, ""));
    const get = (k) => hash.get(k) || query.get(k);
    return {
      isRecovery: get("type") === "recovery",
      linkError: get("error_code") || get("error") || null,
    };
  } catch {
    return { isRecovery: false, linkError: null };
  }
}

export const recoveryUrlState = readRecoveryUrl();

// Drop any leftover auth params (tokens, error codes) from the address bar once the
// recovery flow is resolved -- so a refresh can't replay them and nothing sensitive
// lingers in browser history. supabase-js already scrubs the hash it consumed; this
// also clears the error-redirect query string and is a no-op when there's nothing there.
export function scrubAuthParamsFromUrl() {
  try {
    if (window.location.hash || window.location.search) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  } catch {
    /* history API unavailable -- non-fatal */
  }
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
