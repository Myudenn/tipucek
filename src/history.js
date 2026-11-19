// TipuCek — check history.
//
// Storage strategy (graceful degradation, never crashes the app):
//  1. Local first: every check is always kept in localStorage
//     ("pesanaman_history_v1") WITH the full message text, so the
//     history on this device is always complete.
//  2. Cloud (opt-in, OFF by default): if the user turns off
//     "local only", the check result is ALSO written to Firestore
//     (anonymous auth + collection "checks"), newest first. Every
//     cloud record is tagged with the owner's anonymous UID
//     (ownerUid) and the Firestore rules only let that same UID read
//     it back — your history is yours alone.
//  3. The cloud NEVER receives the raw message text — only the
//     verdict (status, riskScore, redFlags, summary), the source and
//     the timestamp. Even if a rule ever failed, there is no message
//     content in the cloud to leak. Reads merge localStorage entries
//     so nothing is ever lost when the app switches between modes.

import { firebaseConfig, isFirebaseConfigured, connectEmulatorsIfEnabled } from "./firebase-config.js";

const LS_KEY = "pesanaman_history_v1";
const MAX_ENTRIES = 50;

// "Save history only on this device" — ON by default (safest for a
// lay user: nothing leaves the device unless they opt into cloud
// history). Stored as "1" / "0".
const LS_LOCAL_ONLY_KEY = "tipucek_local_only";

export function isLocalOnly() {
  try {
    const v = localStorage.getItem(LS_LOCAL_ONLY_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function setLocalOnly(on) {
  try {
    localStorage.setItem(LS_LOCAL_ONLY_KEY, on ? "1" : "0");
  } catch {
    /* private mode — the choice just won't persist */
  }
}

let firestoreReady = false;
let firestoreDb = null;
let currentUid = null; // anonymous Auth UID — owner of this browser's checks

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
    const auth = getAuth(app);
    const cred = auth.currentUser
      ? { user: auth.currentUser }
      : await signInAnonymously(auth);
    currentUid = cred.user.uid;
    const { getFirestore } = await import("firebase/firestore");
    firestoreDb = getFirestore(app);
    await connectEmulatorsIfEnabled(auth, firestoreDb);
    firestoreReady = true;
    return firestoreDb;
  } catch (e) {
    console.warn("[TipuCek] Firestore unavailable, using localStorage:", e?.message || e);
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
  // Always keep a local copy WITH the full message: the safety net if
  // Firestore is down, and the only place the message text lives.
  const local = readLocal();
  local.unshift(record);
  writeLocal(local);

  // Local-only mode (default): never touch Firestore at all.
  if (isLocalOnly()) return "local";

  const db = await initFirestore();
  // Without a UID the Firestore rules refuse the write (create
  // requires ownerUid == auth.uid) — keep the local copy only.
  if (db && currentUid) {
    try {
      const { collection, addDoc } = await import("firebase/firestore");
      // PRIVACY: the raw message is NEVER sent to the cloud — only
      // the verdict (status, score, red flags, summary), the source,
      // the timestamp and the owner UID.
      await addDoc(collection(db, "checks"), {
        status: record.status,
        riskScore: record.riskScore,
        redFlags: record.redFlags,
        summary: record.summary,
        source: record.source,
        createdAt: record.createdAt,
        ownerUid: currentUid,
      });
      return "firestore";
    } catch (e) {
      console.warn("[TipuCek] Firestore write failed, kept locally:", e?.message || e);
    }
  }
  return "local";
}

/** Load history (newest first). Never throws. */
export async function loadHistory() {
  const local = readLocal();
  // Local-only mode (default): history lives in this browser only —
  // never read the cloud, so no cloud traffic happens at all.
  if (isLocalOnly()) return local;
  const db = await initFirestore();
  if (!db || !currentUid) return local;
  try {
    // Only this account's checks: the rules reject any query that is
    // not scoped to the caller's own UID, so the where() is load-
    // bearing, not cosmetic. No orderBy in the query (that would need
    // a composite index) — newest-first sorting happens client-side
    // after the merge.
    const { collection, query, where, limit, getDocs } = await import(
      "firebase/firestore"
    );
    const snap = await getDocs(
      query(
        collection(db, "checks"),
        where("ownerUid", "==", currentUid),
        limit(MAX_ENTRIES),
      ),
    );
    const remote = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Merge: remote first, then any local-only entries not in remote.
    // Cloud records carry NO message text, so the dedup key is
    // createdAt + status + score (identical in both copies of a check).
    const keyOf = (r) => `${r.createdAt}|${r.status}|${r.riskScore}`;
    const seen = new Set(remote.map(keyOf));
    const merged = [
      ...remote,
      ...local.filter((l) => !seen.has(keyOf(l))),
    ];
    // The cloud record carries only the 7 verdict fields (the rules
    // forbid more), so a synced entry has no model — but the local
    // copy of the same check does. Copy the model over so the history
    // shows which model answered in both storage modes.
    const localByKey = new Map(local.map((l) => [keyOf(l), l]));
    for (const entry of merged) {
      if (!entry.model) {
        const model = localByKey.get(keyOf(entry))?.model;
        if (model) entry.model = model;
      }
    }
    merged.sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
    );
    return merged.slice(0, MAX_ENTRIES);
  } catch (e) {
    console.warn("[TipuCek] Firestore read failed, using local history:", e?.message || e);
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
