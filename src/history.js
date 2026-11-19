// PesanAman — check history.
//
// Storage strategy (graceful degradation, never crashes the app):
//  1. If Firebase is configured: try Firestore (anonymous auth +
//     collection "checks"), newest first.
//  2. Otherwise — or whenever Firestore is unavailable / not configured /
//     the write fails: fall back to localStorage ("pesanaman_history_v1").
// Reads always merge localStorage entries so nothing is ever lost when
// the app switches between modes.

import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const LS_KEY = "pesanaman_history_v1";
const MAX_ENTRIES = 50;

let firestoreReady = false;
let firestoreDb = null;

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLocal(list) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage full / private mode: history is best-effort, never fatal.
  }
}

async function initFirestore() {
  if (firestoreReady) return firestoreDb;
  if (!isFirebaseConfigured()) return null;
  try {
    const { initializeApp, getApps, getApp } = await import("firebase/app");
    const app =
      getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    const { getAuth, signInAnonymously } = await import("firebase/auth");
    await signInAnonymously(getAuth(app));
    const { getFirestore } = await import("firebase/firestore");
    firestoreDb = getFirestore(app);
    firestoreReady = true;
    return firestoreDb;
  } catch (e) {
    console.warn("[PesanAman] Firestore unavailable, using localStorage:", e?.message || e);
    return null;
  }
}

/** Save one check result. Returns "firestore" | "local" (where it landed). */
export async function saveCheck(entry) {
  const record = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  // Always keep a local copy: the safety net if Firestore is down.
  const local = readLocal();
  local.unshift(record);
  writeLocal(local);

  const db = await initFirestore();
  if (db) {
    try {
      const { collection, addDoc } = await import("firebase/firestore");
      await addDoc(collection(db, "checks"), {
        message: record.message,
        status: record.status,
        riskScore: record.riskScore,
        redFlags: record.redFlags,
        summary: record.summary,
        source: record.source,
        createdAt: record.createdAt,
      });
      return "firestore";
    } catch (e) {
      console.warn("[PesanAman] Firestore write failed, kept locally:", e?.message || e);
    }
  }
  return "local";
}

/** Load history (newest first). Never throws. */
export async function loadHistory() {
  const local = readLocal();
  const db = await initFirestore();
  if (!db) return local;
  try {
    const { collection, query, orderBy, limit, getDocs } = await import(
      "firebase/firestore"
    );
    const snap = await getDocs(
      query(collection(db, "checks"), orderBy("createdAt", "desc"), limit(MAX_ENTRIES)),
    );
    const remote = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Merge: remote first, then any local-only entries not in remote.
    const seen = new Set(remote.map((r) => `${r.createdAt}|${r.message}`));
    const merged = [
      ...remote,
      ...local.filter((l) => !seen.has(`${l.createdAt}|${l.message}`)),
    ];
    return merged.slice(0, MAX_ENTRIES);
  } catch (e) {
    console.warn("[PesanAman] Firestore read failed, using local history:", e?.message || e);
    return local;
  }
}

/** Clear local history. (Firestore entries are kept; they belong to the account.) */
export function clearLocalHistory() {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}
