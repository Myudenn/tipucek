// TipuCek gap-fix tests — the 4 holes found by live testing on
// 19 Nov 2026 (all test inputs are fake):
//   1. .txt files were "unknown type" with no score — now read + scored.
//   2. A phone number alone errored "paste a message first" — now a
//      number-only check (official match / format / reports).
//   3. QRIS — REMOVED 19 Nov by Myuden's order ("Qris tidak usah kalau
//      tidak bisa"): the merchant cannot be verified (no official
//      QRIS registry), so the whole feature was deleted — no module,
//      no parsing, no QRIS text anywhere. A pasted QRIS payload is now
//      ordinary text. The old parse/guard tests were deleted with it.
//   4. Link tracking had no visible module — the standalone module
//      is wired in main.js + index.html (its helpers are covered by
//      the domain tests; the UI is covered by Playwright run 24+).
//   5. Call voice (19 Nov, Myuden: "Kalau telepon suara sudah bisa
//      terdeteksi?"): record via microphone or upload a recording —
//      transcribed in the cloud, transcript scored like a message.
// Run: node --test tests/gaps.test.mjs (also in `npm test`).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inspectFile } from "../src/filecheck.js";
import { analyzeCall, mergeCallVerdict } from "../src/callcheck.js";
import { analyzeWithHeuristic, resolveAudioMimeType, validateAudioFile, MAX_AUDIO_BYTES } from "../src/ai.js";

describe("call voice: audio MIME + validation (gap 5)", () => {
  it("resolves the reported type, strips codec params", () => {
    assert.equal(resolveAudioMimeType({ type: "audio/mpeg", name: "x.mp3" }), "audio/mpeg");
    assert.equal(resolveAudioMimeType({ type: "audio/webm;codecs=opus", name: "rec.webm" }), "audio/webm");
    assert.equal(resolveAudioMimeType({ type: "audio/x-wav", name: "a.wav" }), "audio/x-wav");
  });
  it("falls back to the extension when the browser reports no type", () => {
    assert.equal(resolveAudioMimeType({ type: "", name: "rekaman.m4a" }), "audio/mp4");
    assert.equal(resolveAudioMimeType({ type: "", name: "rekaman.webm" }), "audio/webm");
    assert.equal(resolveAudioMimeType({ type: "", name: "rekaman.flac" }), "audio/flac");
  });
  it("rejects non-audio and unknown extensions", () => {
    assert.equal(resolveAudioMimeType({ type: "video/mp4", name: "x.mp4" }), null);
    assert.equal(resolveAudioMimeType({ type: "", name: "x.txt" }), null);
    assert.equal(resolveAudioMimeType({ type: "text/plain", name: "x.txt" }), null);
  });
  it("validateAudioFile: ok / too big / wrong type", () => {
    assert.equal(validateAudioFile({ name: "a.mp3", type: "audio/mpeg", size: 1000 }), null);
    assert.equal(validateAudioFile({ name: "a.mp3", type: "audio/mpeg", size: MAX_AUDIO_BYTES + 1 }), "callAudioTooBig");
    assert.equal(validateAudioFile({ name: "a.txt", type: "text/plain", size: 100 }), "callAudioType");
    assert.equal(validateAudioFile(null), "callAudioType");
  });
});

describe("call voice: merge AI transcript verdict with local analysis (gap 5)", () => {
  const aiScam = { status: "scam", riskScore: 95, redFlags: ["Fake prize"], summary: "Penipuan hadiah.", source: "IN_CLOUD" };
  const localSuspicious = { status: "suspicious", riskScore: 30, redFlags: ["Only the number was checked"], summary: "Lokal.", source: "LOCAL" };
  it("AI scam + local suspicious -> scam 95, union flags, AI summary + source", () => {
    const m = mergeCallVerdict(aiScam, localSuspicious);
    assert.equal(m.status, "scam");
    assert.equal(m.riskScore, 95);
    assert.deepEqual(m.redFlags, ["Fake prize", "Only the number was checked"]);
    assert.equal(m.summary, "Penipuan hadiah.");
    assert.equal(m.source, "IN_CLOUD");
  });
  it("AI safe + local scam (patterns on the transcript) -> scam, local score wins", () => {
    const m = mergeCallVerdict(
      { status: "safe", riskScore: 0, redFlags: [], summary: "", source: "IN_CLOUD" },
      { status: "scam", riskScore: 80, redFlags: ["Asks for an OTP"], summary: "Local summary.", source: "LOCAL" },
    );
    assert.equal(m.status, "scam");
    assert.equal(m.riskScore, 80);
    assert.deepEqual(m.redFlags, ["Asks for an OTP"]);
    assert.equal(m.summary, "Local summary.");
    assert.equal(m.source, "IN_CLOUD");
  });
  it("duplicate flags appear once; AI suspicious + local safe stays suspicious", () => {
    const m = mergeCallVerdict(
      { status: "suspicious", riskScore: 40, redFlags: ["Asks for an OTP"], summary: "Mencurigakan.", source: "IN_CLOUD" },
      { status: "safe", riskScore: 0, redFlags: ["Asks for an OTP"], summary: "", source: "LOCAL" },
    );
    assert.equal(m.status, "suspicious");
    assert.equal(m.riskScore, 40);
    assert.deepEqual(m.redFlags, ["Asks for an OTP"]);
  });
});

describe("text file check (gap 1)", () => {
  const SCAM_TXT =
    "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam.";
  it(".txt with scam text is kind 'text' and its content is scored", async () => {
    const info = await inspectFile(new File([new TextEncoder().encode(SCAM_TXT)], "pesan.txt"));
    assert.equal(info.kind, "text");
    assert.equal(info.level, "low");
    assert.ok(info.textContent.includes("Rp 50.000.000"));
    const local = analyzeWithHeuristic(info.textContent, "en");
    assert.equal(local.status, "scam");
    assert.ok(local.riskScore >= 60, `score ${local.riskScore}`);
  });
  it(".md/.csv are text too; .bin stays unknown", async () => {
    const md = await inspectFile(new File([new TextEncoder().encode("# halo\n")], "catatan.md"));
    assert.equal(md.kind, "text");
    const csv = await inspectFile(new File([new TextEncoder().encode("a,b\n1,2\n")], "data.csv"));
    assert.equal(csv.kind, "text");
    const bin = await inspectFile(new File([new Uint8Array([0x01, 0x02, 0x03, 0x04])], "misteri.bin"));
    assert.equal(bin.kind, "unknown");
    assert.equal(bin.textContent, null);
  });
});

describe("call check, number only (gap 2)", () => {
  it("a number alone no longer errors — suspicious 30, honest flag", async () => {
    const { verdict, reportCount } = await analyzeCall({ number: "081234567890", said: "" }, "en");
    assert.equal(reportCount, null);
    assert.equal(verdict.status, "suspicious");
    assert.equal(verdict.riskScore, 30);
    assert.ok(
      verdict.redFlags.some((f) => /Only the number was checked/i.test(f)),
      JSON.stringify(verdict.redFlags),
    );
  });
  it("an official number alone is safe, with the official flag", async () => {
    const { verdict } = await analyzeCall({ number: "1500888", said: "" }, "en");
    assert.equal(verdict.status, "safe");
    assert.equal(verdict.riskScore, 0);
    assert.ok(verdict.redFlags.some((f) => /BCA/.test(f)), JSON.stringify(verdict.redFlags));
  });
  it("a malformed number alone is suspicious, not safe", async () => {
    const { verdict } = await analyzeCall({ number: "123", said: "" }, "en");
    assert.equal(verdict.status, "suspicious");
    assert.ok(verdict.redFlags.some((f) => /format/i.test(f)), JSON.stringify(verdict.redFlags));
  });
});
