// Public Firebase Web configuration (safe for the browser by design). Vite exposes only VITE_*
// variables to client code. NOTHING private goes here: the service-account key and any server
// credential live in Supabase Edge Function secrets, never in a VITE_ variable.
const env = import.meta.env || {};

export function getFirebaseConfig() {
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
}

export function getVapidKey() {
  return env.VITE_FIREBASE_VAPID_KEY;
}

/** Push is offered only when every value FCM needs to mint a web token is present. */
export function isFirebaseConfigured() {
  const c = getFirebaseConfig();
  return !!(c.apiKey && c.projectId && c.messagingSenderId && c.appId && getVapidKey());
}
