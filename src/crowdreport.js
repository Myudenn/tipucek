// TipuCek — crowdsourced scam reports (Firestore collection
// "crowd_reports"), added 19 Nov 2026 on Myuden's approval.
//
// A report is EXACTLY { type, value, details, status, createdAt,
// reporterUid } — enforced by firestore.rules. status is always
// "pending": a report is NEVER trusted outright and NEVER shown to
// the public until a human on the TipuCek team reviews it. There is
// no public list of reports anywhere in the app.
//
// Privacy: only what the user typed in the form is sent — the
// reported number/account/mode + the description. No check history,
// no personal data. The form says so in plain language, and the
// success box repeats it. reporterUid is null: the app signs in
// anonymously, but no UID is stored with the report.
//
// A local copy is also kept in localStorage
// ("tipucek_crowd_reports_v1") so the user sees their own sent
// reports in the history panel (local-only, like check history).

import {
  firebaseConfig,
  isFirebaseConfigured,
  connectEmulatorsIfEnabled,
} from "./firebase-config.js";

export const CROWD_TYPES = ["phone", "account", "mode"];
export const CROWD_DETAILS_MIN = 10;
export const CROWD_DETAILS_MAX = 500;
export const CROWD_MODE_VALUE_MIN = 3;
export const CROWD_MODE_VALUE_MAX = 100;

const LS_KEY = "tipucek_crowd_reports_v1";
const MAX_LOCAL = 50;

/** Strip spaces, dashes, dots, parentheses from a phone number. */
export function normalizeCrowdPhone(raw) {
  return String(raw || "").replace(/[\s\-().]/g, "");
}

/** Strip spaces and dashes from an account number. */
export function normalizeCrowdAccount(raw) {
  return String(raw || "").replace(/[\s\-]/g, "");
}

function validCrowdPhone(raw) {
  const p = normalizeCrowdPhone(raw);
  if (!/^\+?\d+$/.test(p)) return false;
  const digits = p.replace(/^\+/, "");
  if (digits.length < 9 || digits.length > 15) return false;
  // Indonesian mobile: +62 / 62 / 0 prefix, then 8...
  if (p.startsWith("+62") || p.startsWith("62")) return digits[2] === "8";
  if (p.startsWith("0")) return digits[1] === "8";
  return false;
}

/**
 * Validate one report. Returns {} when valid, else an object with
 * i18n error keys (crowdErr*) per field: { value?: key, details?: key }.
 */
export function validateCrowdReport({ type, value, details }) {
  const errors = {};
  const v = String(value || "").trim();
  const d = String(details || "").trim();
  if (!CROWD_TYPES.includes(type)) {
    errors.value = "crowdErrValueRequired";
  } else if (!v) {
    errors.value = "crowdErrValueRequired";
  } else if (type === "phone") {
    if (!validCrowdPhone(v)) errors.value = "crowdErrPhone";
  } else if (type === "account") {
    if (!/^\d{8,20}$/.test(normalizeCrowdAccount(v))) {
      errors.value = "crowdErrAccount";
    }
  } else if (type === "mode") {
    if (v.length < CROWD_MODE_VALUE_MIN || v.length > CROWD_MODE_VALUE_MAX) {
      errors.value = "crowdErrMode";
    }
  }
  if (d.length < CROWD_DETAILS_MIN || d.length > CROWD_DETAILS_MAX) {
    errors.details = "crowdErrDetails";
  }
  return errors;
}

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
    if (!auth.currentUser) await signInAnonymously(auth);
    const { getFirestore } = await import("firebase/firestore");
    db = getFirestore(app);
    await connectEmulatorsIfEnabled(auth, db);
    dbReady = true;
    return db;
  } catch (e) {
    console.warn("[TipuCek] Crowd-report DB unavailable:", e?.message || e);
    return null;
  }
}

/** Local-only copy of the user's own sent reports (newest first). */
export function loadLocalReports() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function recordLocalReport(entry) {
  try {
    const list = loadLocalReports();
    list.unshift({ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_LOCAL)));
  } catch {
    /* private mode / storage full — best-effort, never fatal */
  }
}

/**
 * Submit one crowd report. Returns { ok: true, id } on success,
 * { ok: false, errors } on validation failure, or
 * { ok: false, submitFailed: true } when the write fails
 * (demo mode, offline, or a rules rejection).
 */
export async function submitCrowdReport({ type, value, details }) {
  const errors = validateCrowdReport({ type, value, details });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const database = await getDb();
  if (!database) return { ok: false, submitFailed: true };
  const clean =
    type === "phone"
      ? normalizeCrowdPhone(String(value).trim())
      : type === "account"
        ? normalizeCrowdAccount(String(value).trim())
        : String(value).trim();
  try {
    const { collection, addDoc, serverTimestamp } = await import(
      "firebase/firestore"
    );
    const ref = await addDoc(collection(database, "crowd_reports"), {
      type,
      value: clean,
      details: String(details).trim(),
      status: "pending",
      createdAt: serverTimestamp(),
      reporterUid: null,
    });
    recordLocalReport({
      type,
      value: clean,
      details: String(details).trim(),
      createdAt: new Date().toISOString(),
    });
    return { ok: true, id: ref.id };
  } catch (e) {
    console.warn("[TipuCek] Crowd-report submit failed:", e?.message || e);
    return { ok: false, submitFailed: true };
  }
}
