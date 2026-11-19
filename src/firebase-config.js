// Firebase configuration for TipuCek.
//
// Real values live in `.env.local` (Vite reads VITE_FIREBASE_*; the file
// is git-ignored, so real credentials never reach the public repo).
// While every value below is still the "YOUR_..." placeholder, the app
// runs in Demo mode: a local heuristic analyzer checks the message so the
// whole UI flow can be tested end-to-end without Firebase. The production
// path (Firebase AI Logic, hybrid on-device / in-cloud inference) is only
// used once a real config is present.
//
// To configure: copy `.env.local.example` to `.env.local` and fill in the
// values from Firebase Console > Project settings > Your apps > Web app.
// NEVER commit `.env.local`, and never paste credentials into chat.

const env = import.meta.env || {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain:
    env.VITE_FIREBASE_AUTH_DOMAIN || "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket:
    env.VITE_FIREBASE_STORAGE_BUCKET || "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId:
    env.VITE_FIREBASE_MESSAGING_SENDER_ID || "YOUR_MESSAGING_SENDER_ID",
  appId: env.VITE_FIREBASE_APP_ID || "YOUR_APP_ID",
  // Optional: reCAPTCHA Enterprise site key for Firebase App Check.
  // Provider reCAPTCHA v3 klasik sudah deprecated di console (formnya
  // dinonaktifkan) — App Check memakai Fraud Defense / reCAPTCHA
  // Enterprise, dan key Enterprise ini mencakup domain localhost.
  // Leave as placeholder to skip App Check. On localhost without a key
  // the debug provider is used instead (see src/ai.js) — no key needed
  // there, but the debug token must be registered in the console.
  appCheckSiteKey:
    env.VITE_FIREBASE_APPCHECK_SITE_KEY || "YOUR_RECAPTCHA_ENTERPRISE_SITE_KEY",
};

/** True when the config still holds placeholders (=> Demo mode). */
export function isFirebaseConfigured() {
  return (
    typeof firebaseConfig.apiKey === "string" &&
    firebaseConfig.apiKey !== "" &&
    !firebaseConfig.apiKey.startsWith("YOUR_") &&
    typeof firebaseConfig.projectId === "string" &&
    !firebaseConfig.projectId.startsWith("YOUR_")
  );
}

let emulatorsConnected = false;

/**
 * Test-only: when VITE_USE_FIRESTORE_EMULATOR=1, point Auth +
 * Firestore at the local emulator suite (127.0.0.1:9099 / :8080)
 * instead of production — so Playwright and rules tests never write
 * to the live project. The flag is never set in production builds,
 * so this is inert there. Safe to call from every Firestore init
 * site: it connects at most once per page load.
 */
export async function connectEmulatorsIfEnabled(auth, db) {
  if (emulatorsConnected) return;
  if ((import.meta.env || {}).VITE_USE_FIRESTORE_EMULATOR !== "1") return;
  const { connectAuthEmulator } = await import("firebase/auth");
  const { connectFirestoreEmulator } = await import("firebase/firestore");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  emulatorsConnected = true;
}
