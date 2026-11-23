// TipuCek — anonymous visitor counter (Myuden 22 Nov 21:02).
//
// Privacy-first: ONLY a total visit count, no personal data. The
// Firestore document site_stats/visitors holds a single number
// field { count }. Each device is counted at most ONCE per day —
// the last counted LOCAL date lives in this device's own
// localStorage, so a refresh in the same day does not inflate the
// number. The write sends ONLY FieldValue.increment(1): no IP, no
// user agent, no device ID, nothing that identifies a visitor.
// The Firestore rules (firestore.rules) let anyone READ the count
// and allow an update ONLY when count rises by exactly 1 with no
// other field changed, so one write can never add more than 1.
//
// Honest limits: this is a per-device-per-day VISIT count, NOT a
// unique-people count. The 1×/day limit lives in the browser, so a
// determined actor can inflate the number (refresh + clear storage
// repeatedly) — that only makes the number bigger, never leaks data
// and never disturbs a check. Offline (Firestore unreachable) the
// footer line stays hidden — never a made-up number.

import { firebaseConfig, isFirebaseConfigured, connectEmulatorsIfEnabled } from "./firebase-config.js";

const LS_COUNTED_DATE_KEY = "tipucek_visitor_counted_date";

let dbReady = false;
let db = null;

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
    void cred;
    const { getFirestore } = await import("firebase/firestore");
    db = getFirestore(app);
    await connectEmulatorsIfEnabled(auth, db);
    dbReady = true;
    return db;
  } catch (e) {
    console.warn("[TipuCek] Visitor counter DB unavailable:", e?.message || e);
    return null;
  }
}

/** Local date key YYYY-MM-DD (the visitor's day, not UTC). Pure —
//  the date is injectable for tests. */
export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True when this device has not been counted yet today. Pure. */
export function shouldCountToday(lastCountedDate, today = todayKey()) {
  return lastCountedDate !== today;
}

export function readCountedDate() {
  try {
    return localStorage.getItem(LS_COUNTED_DATE_KEY) || null;
  } catch {
    return null;
  }
}

export function writeCountedDate(today = todayKey()) {
  try {
    localStorage.setItem(LS_COUNTED_DATE_KEY, today);
    return true;
  } catch {
    return false;
  }
}

/** Read the total visit count (null when Firestore is unreachable;
//  0 when the document does not exist yet). */
export async function readVisitorCount() {
  const database = await getDb();
  if (!database) return null;
  try {
    const { doc, getDoc } = await import("firebase/firestore");
    const snap = await getDoc(doc(database, "site_stats", "visitors"));
    return snap.exists() ? Number(snap.data().count || 0) : 0;
  } catch (e) {
    console.warn("[TipuCek] Visitor count read failed:", e?.message || e);
    return null;
  }
}

/**
 * Count this device once for today. Returns true when the count
 * rose by 1 (and today was stored), false otherwise. The write is
 * ONLY increment(1) — no personal data is sent. Callers check
 * shouldCountToday() first; calling twice in a day is harmless
 * (the date gate stops the second write) but wasteful.
 */
export async function incrementVisitorCount() {
  const database = await getDb();
  if (!database) return false;
  const today = todayKey();
  if (!shouldCountToday(readCountedDate(), today)) return false;
  try {
    const { doc, setDoc, increment } = await import("firebase/firestore");
    await setDoc(
      doc(database, "site_stats", "visitors"),
      { count: increment(1) },
      { merge: true },
    );
    writeCountedDate(today);
    return true;
  } catch (e) {
    console.warn("[TipuCek] Visitor count write failed:", e?.message || e);
    return false;
  }
}
