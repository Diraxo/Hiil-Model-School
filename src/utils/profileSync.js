// Bridge between the single authenticated Realtime channel (owned by DataContext.jsx) and
// AuthContext.jsx, which sits INSIDE DataProvider and so cannot be reached through React context
// the other way round.
//
// DataContext's `comms:<uid>` subscription is the one place the app listens for `profiles` row
// changes. When the changed row is the *currently signed-in* user's own row (their photo / name /
// status was edited from another session -- e.g. an Owner changing a Finance Director's photo),
// DataContext calls `profileSyncStore.bump()`. AuthContext subscribes here and reloads
// `currentUser` so the top-bar avatar and the user's own profile page update without a browser
// refresh. Mirrors the module-level `presenceStore` pattern in src/utils/presence.js -- no extra
// Realtime channel, no whole-tree re-render.
const listeners = new Set();

export const profileSyncStore = {
  bump() {
    listeners.forEach((fn) => {
      try { fn(); } catch { /* a bad listener must not stop the others */ }
    });
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
