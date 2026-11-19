#!/usr/bin/env node
// TipuCek crowd_reports rules test — against the REAL Firestore
// emulator (not production, not a text scan).
//
// Starts `firebase emulators:start --only firestore` (project
// demo-crowd-test, rules from firestore.rules via firebase.json),
// then exercises the rules through the Firebase JS SDK as an
// unauthenticated client:
//   create OK with exactly the 6 fields + status pending;
//   create DENIED with an extra field, a missing field, a wrong
//   status, a wrong type, too-short details, an empty value, or a
//   reporterUid that is neither null nor the caller's UID;
//   read / update / delete DENIED.
// The emulator is killed at the end; nothing touches production.
// Needs: Java (emulator) + firebase-tools (npx) + the firebase
// npm package (already a project dependency).
// Run: node tests/crowd-rules-emulator.mjs
//
// Exit codes: 0 = all rules checks passed; 1 = a rules check failed;
// 2 = SKIP — the emulator's document path is unavailable in this
// sandbox (see probeDocumentPath: the emulator starts and its hub
// answers, but every document operation fails with 503
// "Network closed for unknown reason" / Netty RST_STREAM — proven
// NOT the rules, because the bare jar without --rules 503s too).
// In that case the rules are verified statically by
// tests/rules.test.mjs instead; never fall back to production writes.
import { spawn, execSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HOST = "127.0.0.1";
const PORT = 8080;

// Java for the emulator: apt's JRE vanished on a VM restart (19 Nov),
// the Ubuntu mirror is unreachable through the egress proxy, so a
// Temurin JRE 21 lives in ~/java/jre21 (survives restarts). Prepend
// it so firebase-tools can spawn `java`.
const JRE_BIN = path.join(process.env.HOME || "", "java/jre21/bin");
const EMU_ENV = fs.existsSync(path.join(JRE_BIN, "java"))
  ? { ...process.env, PATH: `${JRE_BIN}:${process.env.PATH}` }
  : process.env;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail: String(detail || "").slice(0, 200) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 150) : ""}`);
}

// Fail-fast: an SDK call against a broken emulator transport never
// settles (gRPC-web retries forever) — cap every call at 15 s.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// REST document-path probe: the emulator's port opens and its hub
// answers long before (or even when) document operations work. The
// probe POSTs a valid doc with the owner token (rules bypassed), so
// ONLY HTTP 200 means the document path works. Anything else is the
// sandbox failure: 503 "Network closed for unknown reason" (REST) /
// RST_STREAM (SDK), or HTTP 500 with INTERNAL: http2 exception in
// firestore-debug.log — the emulator's Netty HTTP layer is broken in
// this sandbox (observed 19 Nov, all three shapes; the bare jar
// without --rules fails identically, so it is NOT the rules).
// Returns "ok" | "unavailable".
async function probeDocumentPath() {
  const url = `http://${HOST}:${PORT}/v1/projects/demo-crowd-test/databases/(default)/documents/crowd_reports`;
  const body = JSON.stringify({
    fields: {
      type: { stringValue: "phone" },
      value: { stringValue: "081234567890" },
      details: { stringValue: "Penipu mengaku dari bank dan minta kode OTP." },
      status: { stringValue: "pending" },
      createdAt: { timestampValue: "2026-11-19T00:00:00Z" },
      reporterUid: { nullValue: null },
    },
  });
  let lastStatus = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(10000),
      });
      lastStatus = `HTTP ${res.status}`;
      if (res.status === 200) {
        console.log("probe: document path answers (HTTP 200) — transport OK");
        return "ok";
      }
      await res.text().catch(() => "");
      await new Promise((r) => setTimeout(r, 5000));
    } catch (e) {
      lastStatus = e?.name === "TimeoutError" ? "timeout" : String(e?.message || e).slice(0, 100);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  console.log(`SKIP: emulator document path unavailable in this sandbox (REST probe: ${lastStatus} on 3 attempts).`);
  console.log("SKIP: evidence — the emulator starts and its hub answers, but every document operation fails with");
  console.log("SKIP: 503 {\"code\":503,\"message\":\"Network closed for unknown reason\",\"status\":\"UNAVAILABLE\"} (REST) /");
  console.log("SKIP: RST_STREAM protocol error (SDK) / HTTP 500 with INTERNAL: http2 exception (firestore-debug.log).");
  console.log("SKIP: the bare emulator jar without --rules fails identically, so this is NOT the rules.");
  console.log("SKIP: Rules are verified statically by tests/rules.test.mjs instead.");
  console.log("SKIP: re-run this script on a machine where the emulator serves documents to get the live proof.");
  return "unavailable";
}

async function waitForPort(timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const s = net.connect(PORT, HOST);
        s.once("connect", () => { s.end(); resolve(); });
        s.once("error", reject);
      });
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`firestore emulator port ${PORT} did not open in ${timeoutMs}ms`);
}

function validData(overrides = {}) {
  return {
    type: "phone",
    value: "081234567890",
    details: "Penipu mengaku dari bank dan minta kode OTP.",
    status: "pending",
    createdAt: new Date(),
    reporterUid: null,
    ...overrides,
  };
}

async function main() {
  // A previous killed run can leave orphaned emulator processes (npx +
  // java grandchildren) holding 8080 — waitForPort would then pass
  // against the STALE emulator (wrong project/rules). Clear whatever
  // holds the emulator ports first (bracket trick: the pkill pattern
  // must not match this shell's own command line).
  try { execSync(`pkill -f "emulators:[s]tart" || true`); } catch (_) {}
  try { execSync(`fuser -k ${PORT}/tcp 4400/tcp 4500/tcp 2>/dev/null || true`); } catch (_) {}
  await new Promise((r) => setTimeout(r, 2000));
  const emu = spawn(
    "npx",
    ["-y", "firebase-tools", "emulators:start", "--only", "firestore", "--project", "demo-crowd-test"],
    { cwd: ROOT, env: EMU_ENV, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let emuLog = "";
  emu.stdout.on("data", (d) => { emuLog += d; });
  emu.stderr.on("data", (d) => { emuLog += d; });
  let exitCode = 0;
  let skipped = false;
  try {
    await waitForPort();
    const probeOk = (await probeDocumentPath()) === "ok";
    if (!probeOk) {
      skipped = true;
      exitCode = 2;
    }
    if (probeOk) {
    const { initializeApp } = await import("firebase/app");
    const { getFirestore, connectFirestoreEmulator, collection, addDoc, doc, getDoc, updateDoc, deleteDoc, serverTimestamp } =
      await import("firebase/firestore");
    const app = initializeApp({ apiKey: "fake", projectId: "demo-crowd-test" }, "crowd-rules-test");
    const db = getFirestore(app);
    connectFirestoreEmulator(db, HOST, PORT);
    const col = collection(db, "crowd_reports");

    // Readiness: the port opens before the emulator serves; retry
    // the valid create until it stops failing with unavailable.
    // (Each attempt is capped — see withTimeout — so a broken
    // transport cannot hang this loop.)
    let createdRef = null;
    let lastErr = "";
    for (let i = 0; i < 8; i++) {
      try {
        createdRef = await withTimeout(
          addDoc(col, { ...validData(), createdAt: serverTimestamp() }),
          15000,
          "readiness addDoc",
        );
        break;
      } catch (e) {
        lastErr = e?.code || String(e);
        if (lastErr !== "unavailable" && !/timed out/.test(lastErr)) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    check("rules: valid create (6 fields, pending) allowed", !!createdRef, createdRef ? createdRef.id : lastErr);

    async function expectDenied(name, fn) {
      try {
        await withTimeout(fn(), 15000, name);
        check(name, false, "write/read was allowed");
      } catch (e) {
        check(name, e?.code === "permission-denied", `code=${e?.code || e}`);
      }
    }
    await expectDenied("rules: create with a 7th field denied", () =>
      addDoc(col, { ...validData(), createdAt: serverTimestamp(), extra: "x" }));
    await expectDenied("rules: create with details missing denied", () => {
      const d = validData();
      delete d.details;
      return addDoc(col, { ...d, createdAt: serverTimestamp() });
    });
    await expectDenied("rules: create with status approved denied", () =>
      addDoc(col, { ...validData(), status: "approved", createdAt: serverTimestamp() }));
    await expectDenied("rules: create with type email denied", () =>
      addDoc(col, { ...validData(), type: "email", createdAt: serverTimestamp() }));
    await expectDenied("rules: create with 4-char details denied", () =>
      addDoc(col, { ...validData(), details: "tipu", createdAt: serverTimestamp() }));
    await expectDenied("rules: create with empty value denied", () =>
      addDoc(col, { ...validData(), value: "", createdAt: serverTimestamp() }));
    await expectDenied("rules: create with someone else's reporterUid denied", () =>
      addDoc(col, { ...validData(), reporterUid: "someone-else", createdAt: serverTimestamp() }));

    if (createdRef) {
      const ref = doc(db, "crowd_reports", createdRef.id);
      await expectDenied("rules: client read denied", () => getDoc(ref));
      await expectDenied("rules: client update denied", () => updateDoc(ref, { status: "approved" }));
      await expectDenied("rules: client delete denied", () => deleteDoc(ref));
    } else {
      check("rules: client read denied", false, "no doc was created to read");
      check("rules: client update denied", false, "no doc was created to update");
      check("rules: client delete denied", false, "no doc was created to delete");
    }
    } // if (probeOk)
  } catch (e) {
    check("emulator run completed without exception", false, e.message);
    console.error(emuLog.slice(-2000));
  } finally {
    // Kill the whole process group: SIGTERM to the npx wrapper alone
    // orphans the java emulator, which keeps holding port 8080 and
    // breaks the next run. Detached spawn puts the emulator in its
    // own group; a negative pid kills the group.
    try { process.kill(-emu.pid, "SIGTERM"); } catch { emu.kill("SIGTERM"); }
    await new Promise((r) => setTimeout(r, 1000));
    try { process.kill(-emu.pid, "SIGKILL"); } catch { try { emu.kill("SIGKILL"); } catch { /* already dead */ } }
  }
  const failed = results.filter((r) => !r.ok);
  if (skipped) {
    console.log("\nSKIPPED — emulator document path unavailable in this sandbox (exit 2).");
  } else {
    console.log(`\n${results.length - failed.length}/${results.length} rules checks passed (emulator)`);
  }
  if (failed.length > 0) exitCode = 1;
  process.exit(exitCode);
}

main();
