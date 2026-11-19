// TipuCek local-rules benchmark (DEMO path only).
//
// Measures analyzeWithHeuristic — the keyword-rule fallback used when no
// Firebase config is present — against a small labeled set (7 scam-intent,
// 7 safe-intent, Indonesian + English, incl. the built-in samples).
// Primary metric: FLAGGED accuracy (scam-intent -> scam|suspicious,
// safe-intent -> safe). This is NOT the AI verdict accuracy: the production
// AI path (Gemini Nano on-device / gemini-3.5-flash-lite cloud) cannot be
// benchmarked in this build without a live Firebase config, and this file
// must never be quoted as AI accuracy.
//
// Run: node tests/benchmark-local-rules.mjs
// Writes: tests/benchmark-local-rules.json
import { writeFileSync } from "node:fs";
import { analyzeWithHeuristic } from "../src/ai.js";

const CASES = [
  { id: "scam-prize", intent: "scam", text: "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam. Hubungi customer service kami segera!" },
  { id: "scam-bca-block", intent: "scam", text: "Akun Anda akan DIBLOKIR dalam 24 jam karena aktivitas mencurigakan. Verifikasi sekarang di https://bca-secure-verify.xyz/login atau Anda kehilangan akses." },
  { id: "scam-otp", intent: "scam", text: "BCA: Kode OTP Anda 482916. Jangan berikan kode ini ke siapapun termasuk petugas bank. Jika Anda tidak merasa melakukan transaksi, segera hubungi 0812-9876-5432." },
  { id: "scam-job-fee", intent: "scam", text: "Lowongan kerja dari rumah, gaji Rp 15 juta per bulan, tanpa pengalaman. Daftar sekarang, bayar biaya pendaftaran Rp 100.000." },
  { id: "scam-family", intent: "scam", text: "Halo ini aku, ini nomor baru. Mama kecelakaan, kirim uang Rp 5 juta segera!" },
  { id: "scam-apk", intent: "scam", text: "Download aplikasi undangan pernikahan kami di sini: http://bit.ly/undangan-apk — install APK-nya ya!" },
  { id: "scam-invest", intent: "scam", text: "Investasi dijamin profit 30% per hari, guaranteed profit! Daftar sekarang, kirim dana Rp 500 ribu." },
  { id: "safe-office", intent: "safe", text: "Hi Budi, this is Sari from the office. The team meeting is moved to Thursday 10:00 in room 3B. Please bring the Q3 report. See you there!" },
  { id: "safe-meeting-id", intent: "safe", text: "Halo, ini Budi. Rapat besok jam 10 di kantor lantai 3." },
  { id: "safe-package", intent: "safe", text: "Paket Anda sudah sampai di rumah, terima kasih." },
  { id: "safe-bill", intent: "safe", text: "Jangan lupa bayar listrik bulan ini ya." },
  { id: "safe-birthday", intent: "safe", text: "Selamat ulang tahun! Semoga sehat selalu." },
  { id: "safe-transfer", intent: "safe", text: "Transfer Rp 200.000 ke BCA 1234567890 untuk bayar kos." },
  { id: "safe-courier-en", intent: "safe", text: "Hi, this is DHL. Your package is out for delivery." },
];

const rows = CASES.map((c) => {
  const v = analyzeWithHeuristic(c.text, "en");
  const flagged = v.status !== "safe";
  const correct = c.intent === "scam" ? flagged : !flagged;
  return { ...c, status: v.status, score: v.riskScore, flagged, correct };
});
const scamRows = rows.filter((r) => r.intent === "scam");
const safeRows = rows.filter((r) => r.intent === "safe");
const correct = rows.filter((r) => r.correct).length;
const mean = (xs) => xs.reduce((a, x) => a + x.score, 0) / xs.length;
const result = {
  path: "DEMO local rules (analyzeWithHeuristic) — NOT AI accuracy",
  cases: rows.length,
  flaggedAccuracy: `${correct}/${rows.length}`,
  falsePositives: `${safeRows.filter((r) => r.flagged).length}/${safeRows.length}`,
  falseNegatives: `${scamRows.filter((r) => !r.flagged).length}/${scamRows.length}`,
  meanScoreScam: +mean(scamRows).toFixed(1),
  meanScoreSafe: +mean(safeRows).toFixed(1),
  rows: rows.map(({ id, intent, status, score, flagged, correct }) => ({ id, intent, status, score, flagged, correct })),
};
console.log("TipuCek local-rules benchmark (DEMO path — not AI accuracy)");
console.log("=".repeat(64));
for (const r of result.rows) {
  console.log(`${r.correct ? "OK  " : "MISS"} ${r.id.padEnd(18)} intent=${r.intent.padEnd(4)} -> ${r.status.padEnd(11)} ${r.score}/100`);
}
console.log("-".repeat(64));
console.log(`Flagged accuracy : ${result.flaggedAccuracy}`);
console.log(`False positives  : ${result.falsePositives} (safe messages flagged)`);
console.log(`False negatives  : ${result.falseNegatives} (scam messages missed)`);
console.log(`Mean score scam  : ${result.meanScoreScam} | safe: ${result.meanScoreSafe}`);
writeFileSync(new URL("./benchmark-local-rules.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log("Wrote tests/benchmark-local-rules.json");
