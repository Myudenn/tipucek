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
// Audit 8: the list itself is capped (below), but the HERO counts
// must never drop because an old entry was trimmed — the auditor
// watched the scam count fall 32 → 31 when one new check arrived.
// So the cap is raised 50 → 200 AND the counts live in a separate
// aggregate that only ever grows (see getStatsTotals below).
const MAX_ENTRIES = 200;

// Scoring-rule version stamped on every saved check (audit 10).
// 1 = the rules before 22 Nov 10:28 WIB (no identity-mismatch
// bonus); 2 = audit-7 identity-mismatch logic and later. Bump this
// whenever a scoring rule changes materially, so old entries can be
// told apart from new ones without rewriting history.
export const SCORING_VERSION = 2;

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
    return true;
  } catch {
    // Storage full / private mode: history is best-effort, never fatal.
    // The caller MUST know: a failed write must not bump the totals.
    return false;
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

/** Save one check result. Returns "firestore" | "local" | "off" (where it landed).
 * COUNTING RULE, unified for every tool (audit 10): a check is counted
 * exactly ONCE, at the moment its final verdict is rendered — every
 * handler renders first and calls saveCheck right after, so the totals
 * bump here is the render's shadow, never a separate event. A check
 * whose verdict never renders (superseded run, offline preview,
 * error) is never counted; a check that renders is counted exactly
 * once. The timing differs between tools only because verdicts take
 * different times to produce (AI cloud round-trip vs on-device
 * scoring) — never because the rule differs. */
export async function saveCheck(entry) {
  // Privacy setting (21 Nov 01:19): when history saving is off,
  // store nothing at all — neither local nor cloud.
  if (!isHistorySavingEnabled()) return "off";
  const record = {
    ...entry,
    // Audit 10: scoring-rule version this verdict was computed with
    // (2 = audit-7 identity-mismatch logic and later). Entries saved
    // before this stamp are version 1 — the history annotation for
    // those uses their stored checks, not this field, to decide
    // whether the mismatch rule was counted.
    scoreVersion: SCORING_VERSION,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  // Audit 16: the totals are DERIVED from the history list (see
  // getStatsTotals) — there is no separate per-check increment to
  // lose. The only bookkeeping here is the trim: when the new record
  // pushes entries past MAX_ENTRIES, the dropped entries' counts move
  // into the trimmed bucket, atomically with the list write (same
  // synchronous block) and only if the write succeeded — a failed
  // write must not leave the totals claiming a check never saved.
  const local = readLocal();
  local.unshift(record);
  const dropped = local.length > MAX_ENTRIES ? local.slice(MAX_ENTRIES) : [];
  if (writeLocal(local) && dropped.length > 0) absorbTrimmed(dropped);

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
    // Same for `kind` (audit 10): the cloud record has no tool label,
    // but the local copy does — copy it over so the history row can
    // show which tool produced the check in both storage modes.
    // (A fresh-device cloud-only entry has no local twin, so its
    // kind stays unknown and the row shows no tool badge.)
    const localByKey = new Map(local.map((l) => [keyOf(l), l]));
    for (const entry of merged) {
      if (!entry.model) {
        const model = localByKey.get(keyOf(entry))?.model;
        if (model) entry.model = model;
      }
      if (!entry.kind) {
        const kind = localByKey.get(keyOf(entry))?.kind;
        if (kind) entry.kind = kind;
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
    // Audit 8: clearing the history resets the counts too — a
    // deliberate clear is not a silent trim, and the hero cards
    // must not claim checks that the user just deleted.
    localStorage.removeItem(LS_TRIMMED_KEY);
    localStorage.removeItem(LS_TOTALS_KEY_LEGACY);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Aggregate stats (22 Nov audit 8, rewritten audit 16) — the hero
// "checked / caught" cards, the badges and the 7-day chart must NEVER
// drop when a new check trims the oldest history entry, and must NEVER
// lose a check to a lost-update race.
//
// DESIGN (audit 16): the totals are DERIVED from the history list
// (the source of truth — every saved check is an entry in the list),
// PLUS a durable "trimmed" bucket for checks that are no longer in
// the list (dropped when the list exceeded MAX_ENTRIES, or present
// only in the cloud). There is NO separate mutable total incremented
// per check: the audit-13 bumpTotalsFrom increment (read-modify-write
// on a stored aggregate) lost updates in the auditor's 12-check
// sequence (hero 104/51 instead of 115/54, stored 103/51 after
// reload) — the list grew 47→59 but the aggregate never moved,
// because the increment is a separate write that can be lost while
// the list write succeeds. Deriving from the list makes that loss
// impossible: a saved check IS an entry, so it IS counted. The
// trimmed bucket only changes when entries leave the list (atomic
// with the list write, via absorbTrimmed) or when a cloud merge
// reveals entries the local list lacks (seedTotalsFromList, max-only)
// — so counts never fall. Shape of the trimmed bucket:
//   { checked, scams, days: { "YYYY-MM-DD": { c, s } } }
// The only reset is a deliberate clearLocalHistory().
// ---------------------------------------------------------------------------
const LS_TRIMMED_KEY = "tipucek_stats_trimmed_v1";
// Old aggregate key (audit 8–13): a mutable total incremented per
// check. Kept only for the one-time migration in readTrimmed(), then
// deleted.
const LS_TOTALS_KEY_LEGACY = "tipucek_stats_totals_v1";

/** Local-date key "YYYY-MM-DD" for a Date (or ISO string). */
export function localDayKey(d) {
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    return `${dt.getFullYear()}-${m}-${day}`;
  } catch {
    return null;
  }
}

function daysFromEntries(list) {
  const days = {};
  for (const e of list || []) {
    const k = localDayKey(e.createdAt);
    if (!k) continue;
    const b = days[k] || (days[k] = { c: 0, s: 0 });
    b.c += 1;
    if (e.status === "scam") b.s += 1;
  }
  return days;
}

/** Sum two per-day bucket maps (the list and the trimmed bucket hold
 *  DISJOINT sets of checks, so their day counts ADD, never max).
 *  The chart only shows 7 days — drop buckets older than 8 days so
 *  the record stays small. */
function addDays(a, b) {
  const out = {};
  for (const src of [a, b]) {
    if (!src || typeof src !== "object") continue;
    for (const [k, v] of Object.entries(src)) {
      const cur = out[k] || (out[k] = { c: 0, s: 0 });
      cur.c += Number(v?.c) || 0;
      cur.s += Number(v?.s) || 0;
    }
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 8);
  const cutoffKey = localDayKey(cutoff);
  for (const k of Object.keys(out)) if (cutoffKey && k < cutoffKey) delete out[k];
  return out;
}

function deriveTotals(list) {
  return {
    checked: (list || []).length,
    scams: (list || []).filter((e) => e.status === "scam").length,
    days: daysFromEntries(list),
  };
}

/** Read the trimmed bucket (counts for checks no longer in the local
 *  list). Migrates the old mutable aggregate once: the legacy total
 *  counted ALL checks (list + trimmed), so the bucket is seeded as
 *  (legacy − derived from the current list), clamped at 0. This also
 *  RECOVERS increments the old aggregate lost — the list still holds
 *  those checks, so deriving from it counts them again (auditor
 *  baseline 103/51 + 12 new checks in a 59-entry list → 115/54,
 *  where the legacy aggregate still said 103/51). After migration the
 *  legacy key is deleted; later calls just read the bucket. */
function readTrimmed() {
  let trimmed = null;
  try {
    trimmed = JSON.parse(localStorage.getItem(LS_TRIMMED_KEY) || "null");
  } catch {
    trimmed = null;
  }
  if (trimmed && typeof trimmed === "object") return trimmed;
  let legacy = null;
  try {
    legacy = JSON.parse(localStorage.getItem(LS_TOTALS_KEY_LEGACY) || "null");
  } catch {
    legacy = null;
  }
  const derived = deriveTotals(readLocal());
  if (legacy && typeof legacy === "object") {
    const days = {};
    const legacyDays = legacy.days && typeof legacy.days === "object" ? legacy.days : {};
    for (const [k, v] of Object.entries(legacyDays)) {
      const d = derived.days[k];
      const c = Math.max(0, (Number(v?.c) || 0) - (d ? d.c : 0));
      const s = Math.max(0, (Number(v?.s) || 0) - (d ? d.s : 0));
      if (c > 0 || s > 0) days[k] = { c, s };
    }
    trimmed = {
      checked: Math.max(0, (Number(legacy.checked) || 0) - derived.checked),
      scams: Math.max(0, (Number(legacy.scams) || 0) - derived.scams),
      days,
    };
  } else {
    trimmed = { checked: 0, scams: 0, days: {} };
  }
  try {
    localStorage.setItem(LS_TRIMMED_KEY, JSON.stringify(trimmed));
    localStorage.removeItem(LS_TOTALS_KEY_LEGACY);
  } catch {
    /* best-effort */
  }
  return trimmed;
}

function writeTrimmed(trimmed) {
  try {
    localStorage.setItem(LS_TRIMMED_KEY, JSON.stringify(trimmed));
    return true;
  } catch {
    return false;
  }
}

/** Absorb entries that just fell off the capped list into the trimmed
 *  bucket (called by saveCheck, only after the list write succeeds).
 *  ADD, not max — the dropped entries are disjoint from the list. */
function absorbTrimmed(dropped) {
  try {
    const d = deriveTotals(dropped);
    const trimmed = readTrimmed();
    trimmed.checked += d.checked;
    trimmed.scams += d.scams;
    trimmed.days = addDays(trimmed.days, d.days);
    writeTrimmed(trimmed);
  } catch {
    /* best-effort: stats never break a check */
  }
}

/** All-time totals for this device. Never throws. */
export function getStatsTotals() {
  const derived = deriveTotals(readLocal());
  const trimmed = readTrimmed();
  return {
    checked: derived.checked + (Number(trimmed.checked) || 0),
    scams: derived.scams + (Number(trimmed.scams) || 0),
    days: addDays(derived.days, trimmed.days),
  };
}

/**
 * Cover checks a LOADED list has that the local list lacks (22 Nov
 * audit 8, cloud mode): loadHistory() merges cloud entries too — on a
 * fresh device (or after a clear) the merged list can hold checks the
 * local list never saw, and the hero must count them. The trimmed
 * bucket is raised (max-only, never lowered) to cover the extra
 * (merged − local, clamped at 0) per field and per day bucket. Call it
 * wherever a merged list is loaded (boot, cross-tab).
 * Note: an entry trimmed from local AND present in the cloud is
 * counted once via the trim path and can also appear in the extra
 * here — the max keeps that overcount to at most that entry, and only
 * in cloud mode. The local-only path (default) is exact.
 */
export function seedTotalsFromList(list) {
  try {
    const merged = deriveTotals(list);
    const local = deriveTotals(readLocal());
    const trimmed = readTrimmed();
    trimmed.checked = Math.max(trimmed.checked, Math.max(0, merged.checked - local.checked));
    trimmed.scams = Math.max(trimmed.scams, Math.max(0, merged.scams - local.scams));
    const days = {};
    for (const [k, v] of Object.entries(merged.days)) {
      const l = local.days[k];
      const extraC = Math.max(0, (Number(v?.c) || 0) - (l ? l.c : 0));
      const extraS = Math.max(0, (Number(v?.s) || 0) - (l ? l.s : 0));
      const t = trimmed.days[k] || { c: 0, s: 0 };
      days[k] = { c: Math.max(t.c, extraC), s: Math.max(t.s, extraS) };
    }
    for (const [k, v] of Object.entries(trimmed.days)) {
      if (!days[k]) days[k] = v;
    }
    trimmed.days = days;
    writeTrimmed(trimmed);
  } catch {
    /* best-effort: stats never break a load */
  }
}

// Privacy settings (21 Nov 01:19) — both stored in localStorage,
// both honoured without a login, like the rest of history.
// "Save check history" — ON by default. When OFF, saveCheck stores
// nothing at all (neither local nor cloud).
const LS_SAVE_HISTORY_KEY = "tipucek_save_history";
export function isHistorySavingEnabled() {
  try {
    const v = localStorage.getItem(LS_SAVE_HISTORY_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}
export function setHistorySavingEnabled(on) {
  try {
    localStorage.setItem(LS_SAVE_HISTORY_KEY, on ? "1" : "0");
  } catch {
    /* private mode — the choice just won't persist */
  }
}

// "Hide message text in history" — OFF by default. When ON, the
// history list shows only label + score + time, no message snippet.
const LS_HIDE_HISTORY_TEXT_KEY = "tipucek_hide_history_text";
export function isHistoryTextHidden() {
  try {
    return localStorage.getItem(LS_HIDE_HISTORY_TEXT_KEY) === "1";
  } catch {
    return false;
  }
}
export function setHistoryTextHidden(on) {
  try {
    localStorage.setItem(LS_HIDE_HISTORY_TEXT_KEY, on ? "1" : "0");
  } catch {
    /* private mode — the choice just won't persist */
  }
}

// Display masking: never show a sensitive number whole in a history
// snippet or a re-opened result card — OTP/verification codes (4–8
// digits), phone numbers and account numbers become bullets. The
// stored entry keeps the real text (needed for re-check and for the
// deliberate "report this number" action); only the DISPLAY is
// masked. A 4-digit run that is really a year is masked too —
// privacy first: a snippet must never leak a code, and a code and a
// year look identical in a snippet.
export function maskSensitive(text) {
  if (!text) return "";
  let out = String(text);
  // Proportional mask (22 Nov audit 7): the number of dots follows
  // the number of digits hidden — a 6-digit OTP reads as 6 dots, a
  // 12-digit phone as 12, so the mask hints at the length instead
  // of always showing the same 6 dots. Capped at 20 dots so an
  // absurdly long run cannot flood the card.
  const dots = (n) => "•".repeat(Math.min(Math.max(n, 1), 20));
  // Audit 14: alphanumeric CODE tokens ("abc123", "XK7Q2P") — a word
  // that mixes letters AND digits is a code, not an ordinary word
  // (ordinary words have no digits; pure numbers are covered below).
  // Masked whole, proportionally, BEFORE the digit passes — otherwise
  // the digit pass would mask only the digits and leave the letters
  // visible ("abc••••••"). Currency amounts ("Rp100000") are NOT
  // codes and are left alone.
  out = out.replace(
    /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{4,}\b/g,
    (m) => (/^(rp|usd|idr|eur|sgd|gbp)\d+$/i.test(m) ? m : dots(m.length)),
  );
  // Phone-like runs with separators first (+62 812-3456-7890,
  // 0812 3456 7890): a digit, then 7+ digits/spaces/dashes/parens.
  // The dot count follows the DIGITS in the run (separators collapse).
  out = out.replace(/\+?\d[\d\s\-()]{7,}\d/g, (m) =>
    dots((m.match(/\d/g) || []).length),
  );
  // Any remaining digit run of 4 or more (OTP codes, account numbers).
  out = out.replace(/\d{4,}/g, (m) => dots(m.length));
  return out;
}
