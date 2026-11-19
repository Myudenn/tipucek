// TipuCek — community report database (Firestore collection "reports").
//
// Privacy-first design: the database stores ONLY the SHA-256 hash of
// a NORMALIZED value (phone number, bank account, file name, or file
// content hash) — never the raw value. A document is { kind, count,
// firstSeen, lastSeen } keyed by its hash. Anyone can read the
// aggregates (a count is not personal data); only signed-in users
// (anonymous auth) can write, and the rules only allow the exact
// shape below (see firestore.rules).
//
// Honest limits: this is a community count, not a verdict and not a
// blocklist. A count of 0 proves nothing, and a high count only means
// "other users reported this". Server-side rate limiting per user is
// not possible in Firestore rules alone (no Cloud Functions on the
// free Spark plan), so writes are throttled per device in localStorage
// (one report per hash per 24 h) + App Check + auth + strict rules.

import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

let dbReady = false;
let db = null;
let uid = null;

async function getDb() {
  if (dbReady) return db;
  if (!isFirebaseConfigured()) return null;
  try {
    const { initializeApp, getApps, getApp } = await import("firebase/app");
    const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    const { getAuth, signInAnonymously } = await import("firebase/auth");
    const auth = getAuth(app);
    const cred = auth.currentUser
      ? { user: auth.currentUser }
      : await signInAnonymously(auth);
    uid = cred.user.uid;
    const { getFirestore } = await import("firebase/firestore");
    db = getFirestore(app);
    dbReady = true;
    return db;
  } catch (e) {
    console.warn("[TipuCek] Reports DB unavailable:", e?.message || e);
    return null;
  }
}

/** SHA-256 hex of a string (null when crypto.subtle is unavailable). */
export async function sha256Hex(text) {
  if (!("crypto" in globalThis) || !crypto.subtle) return null;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(String(text)),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Normalize a value before hashing, so the same number/file in any
 *  spelling maps to one hash. */
export function normalizeReportValue(kind, value) {
  const v = String(value || "");
  if (kind === "phone") {
    return v.replace(/[^\d]/g, "").replace(/^62/, "0");
  }
  if (kind === "account") {
    return v.replace(/[^\d]/g, "");
  }
  if (kind === "filename" || kind === "filehash") {
    return v.trim().toLowerCase();
  }
  return v.trim().toLowerCase();
}

/** Hash of a normalized value, or null when hashing is unavailable.
 *  For kind "filehash" the value already IS a SHA-256 hex (computed
 *  locally from the file bytes) — it is used as-is, so the report
 *  lookup and the report write hit the same document. */
export async function reportHash(kind, value) {
  const normalized = normalizeReportValue(kind, value);
  if (!normalized) return null;
  if (kind === "filehash") return normalized;
  return sha256Hex(normalized);
}

/** How many times this hash was reported (0 = never, null = unknown). */
export async function getReportCount(hash) {
  if (!hash) return null;
  const database = await getDb();
  if (!database) return null;
  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(database, "reports", hash));
    return snap.exists() ? Number(snap.data().count || 0) : 0;
  } catch (e) {
    console.warn("[TipuCek] Report lookup failed:", e?.message || e);
    return null;
  }
}

/**
 * Report one value. Returns "ok" | "already" (this device already
 * reported this hash in the last 24 h) | "failed".
 */
export async function submitReport(kind, value) {
  const hash = await reportHash(kind, value);
  if (!hash) return "failed";
  const throttleKey = `tipucek_reported_${hash}`;
  try {
    const last = Number(localStorage.getItem(throttleKey) || 0);
    if (last && Date.now() - last < 24 * 60 * 60 * 1000) return "already";
  } catch {
    /* private mode — throttle just won't persist */
  }
  const database = await getDb();
  if (!database || !uid) return "failed";
  try {
    const { doc, runTransaction, serverTimestamp } = await import(
      "firebase/firestore"
    );
    const ref = doc(database, "reports", hash);
    await runTransaction(database, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) {
        tx.update(ref, {
          count: Number(snap.data().count || 0) + 1,
          lastSeen: serverTimestamp(),
        });
      } else {
        tx.set(ref, {
          kind,
          count: 1,
          firstSeen: serverTimestamp(),
          lastSeen: serverTimestamp(),
        });
      }
    });
    try {
      localStorage.setItem(throttleKey, String(Date.now()));
    } catch {
      /* ignore */
    }
    return "ok";
  } catch (e) {
    console.warn("[TipuCek] Report submit failed:", e?.message || e);
    return "failed";
  }
}
