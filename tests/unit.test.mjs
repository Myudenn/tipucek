// TipuCek unit tests — pure local logic only (no network, no Firebase).
// Run: node --test tests/unit.test.mjs
// These pin the behaviour the Devpost description cites: the local
// rule engine, the link/number analysis, the outbound guard, the chat
// export scanner, the file-structure check and the quiz bank.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { t, LANGUAGES, demoSummary, formatElapsed } from "../src/i18n.js";
import {
  validateCrowdReport,
  normalizeCrowdPhone,
  normalizeCrowdAccount,
  loadLocalReports,
  recordLocalReport,
} from "../src/crowdreport.js";
import { analyzeWithHeuristic, codeOnlyVerdict, generateWithFailover, buildPrompt, applySafetyFloor, CLOUD_MODEL, BACKUP_CLOUD_MODEL } from "../src/ai.js";
import { redactForAI } from "../src/redact.js";
import { analyzeLink, analyzeLinks, extractNumbers } from "../src/risks.js";
import { maskDigits, analyzeOutgoing } from "../src/outbound.js";
import { parseChatExport, parseChatExportWithFormat, scanChatLog, CHATLOG_MAX_BYTES } from "../src/chatlog.js";
import { inspectFile, analyzeFileName, sha256HexOfBlob, fileTypeDisplay } from "../src/filecheck.js";
import { analyzeFiles } from "../src/files.js";
import { getQuizQuestions } from "../src/quiz.js";
import { registrableDomain, resolveShortLink, normalizeLinkInput } from "../src/domain.js";
import { analyzeEmail } from "../src/emailcheck.js";
import { analyzeCall, mergeCallVerdict, currentMismatch } from "../src/callcheck.js";
import { saveCheck, loadHistory, maskSensitive, getStatsTotals, seedTotalsFromList, clearLocalHistory, localDayKey, SCORING_VERSION } from "../src/history.js";
import { todayKey, shouldCountToday, readCountedDate, writeCountedDate } from "../src/visitors.js";
import { detectQuestionLanguage } from "../src/assistant.js";
import { planCardContent, scoreNumberLayout } from "../src/sharecard.js";

const SCAM_PRIZE =
  "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam. Hubungi customer service kami segera!";
const SAFE_OFFICE =
  "Hi Budi, this is Sari from the office. The team meeting is moved to Thursday 10:00 in room 3B. Please bring the Q3 report. See you there!";
const OTP_SAMPLE =
  "BCA: Kode OTP Anda 482916. Jangan berikan kode ini ke siapapun termasuk petugas bank. Jika Anda tidak merasa melakukan transaksi, segera hubungi 0812-9876-5432.";

describe("analyzeWithHeuristic (demo local rules)", () => {
  it("prize + short link + fee + deadline = scam, score >= 60", () => {
    const v = analyzeWithHeuristic(SCAM_PRIZE, "en");
    assert.equal(v.status, "scam");
    assert.ok(v.riskScore >= 60, `score ${v.riskScore}`);
    assert.equal(v.source, "DEMO");
    assert.ok(v.redFlags.length >= 2);
  });
  it("ordinary office message = safe, score 0", () => {
    const v = analyzeWithHeuristic(SAFE_OFFICE, "en");
    assert.equal(v.status, "safe");
    assert.equal(v.riskScore, 0);
  });
  it("OTP phishing sample = scam 60 (urgency + OTP ask + call-a-mobile-number)", () => {
    // Was pinned suspicious 40 (19 Nov: "the rules cannot know BCA's
    // real number, so this is suspicious, not scam. Do not inflate
    // it."). Superseded 23 Nov 2026 regression: the fix is NOT a
    // database lookup of the number — it is the structural signal that
    // a genuine bank OTP never tells you to call a mobile number (a
    // real bank gives its official hotline, Halo BCA 1500888, or a
    // branch). "Segera hubungi 0812-..." is the scam's action, so the
    // contactNumber rule (+20) lifts urgency 18 + moneyOtp 22 to 60.
    // The AI benchmark expects this exact text to be "scam" too.
    const v = analyzeWithHeuristic(OTP_SAMPLE, "en");
    assert.equal(v.status, "scam");
    assert.equal(v.riskScore, 60);
  });
  it("empty message = safe 0", () => {
    const v = analyzeWithHeuristic("   ", "en");
    assert.equal(v.status, "safe");
    assert.equal(v.riskScore, 0);
  });
  it("job scam 'Pak Reza' (21 Nov 2026 false negative) = scam, score >= 60", () => {
    // Real case: a job seeker transferred Rp 480.000 to "Pak Reza" and
    // was told to "standby" and "check email" — the cloud model judged
    // it Safe 0/100 and these rules scored 0 too. The fix: a job that
    // demands payment is a scam — money flows FROM the seeker TO the
    // employer. The OCR text of the WhatsApp screenshot, as the model
    // read it.
    const chat =
      "Pak Reza\nJumlah Total Rp 480.000\nNo. Transaksi 2026011743008130078713\n" +
      "udah di tf pak\nBaik\nBesok standby ya jam 14.00\nbaik pak\n" +
      "Bsk cek email ya\nbaik pak terimakasih\nFaqih udah selesai... No 1724";
    const v = analyzeWithHeuristic(chat, "id");
    assert.equal(v.status, "scam");
    assert.equal(v.riskScore, 66);
    assert.ok(
      v.redFlags.some((f) => /Penipuan lowongan kerja/.test(f)),
      `job-scam flag missing (id): ${v.redFlags.join(" | ")}`,
    );
    // Same verdict in English, flag in English.
    const vEn = analyzeWithHeuristic(chat, "en");
    assert.equal(vEn.status, "scam");
    assert.equal(vEn.riskScore, 66);
    assert.ok(
      vEn.redFlags.some((f) => /Job scam/.test(f)),
      `job-scam flag missing (en): ${vEn.redFlags.join(" | ")}`,
    );
  });
  it("genuine job message with no payment = safe (no overcorrection)", () => {
    // Same trigger word ("Lowongan") but no payment condition: an
    // interview invitation / official HR info must stay safe.
    const v = analyzeWithHeuristic(
      "Lowongan: Admin toko, gaji Rp 4,5 juta/bulan, jam kerja 09:00-17:00. Kirim CV ke tokoabadi@gmail.com.",
      "id",
    );
    assert.equal(v.status, "safe");
    assert.equal(v.riskScore, 16);
  });
  it("genuine job invite with a street address stays safe (J2 fix 21 Nov)", () => {
    // "Jl. Sudirman No. 12" is a street address, not a task number —
    // the bare "No <digits>" pattern needs 3+ digits, so it must not
    // fire here. The greeting "Selamat pagi" also scores nothing
    // since audit 4 (a bare "selamat" is a greeting, not a prize
    // promise), so the whole message is clean 0.
    const v = analyzeWithHeuristic(
      "Selamat pagi, kami dari PT Maju Bersama mengundang Anda untuk wawancara kerja hari Senin jam 10 di kantor kami Jl. Sudirman No. 12. Harap bawa CV dan KTP. Terima kasih.",
      "id",
    );
    assert.equal(v.status, "safe");
    assert.equal(v.riskScore, 0);
    assert.ok(
      !v.redFlags.some((f) => /nomor tugas|member-number|task \/ member/i.test(f)),
      `J2 fired on a street address: ${v.redFlags.join(" | ")}`,
    );
  });
  // Per-pattern checklist (21 Nov 2026, demo reference): the same
  // fixed rule set, each entry found or clean — the result card's
  // checklist + meta pills read this, never a second rule set.
  it("checks: 23 fixed entries, found count matches redFlags", () => {
    const v = analyzeWithHeuristic(SCAM_PRIZE, "en");
    assert.equal(v.checks.length, 23);
    assert.equal(
      v.checks.filter((c) => c.found).length,
      v.redFlags.length,
    );
    assert.deepEqual(
      v.checks.filter((c) => c.found).map((c) => c.flag).sort(),
      [...v.redFlags].sort(),
    );
  });
  it("checks: fired rows carry a short evidence quote", () => {
    const v = analyzeWithHeuristic(SCAM_PRIZE, "en");
    for (const c of v.checks.filter((c) => c.found)) {
      assert.ok(
        c.evidence.length > 0 && c.evidence.length <= 130,
        `${c.id}: evidence ${JSON.stringify(c.evidence)}`,
      );
    }
  });
  it("a bare 'Selamat pagi' greeting is not a prize promise (21 Nov, audit 4)", () => {
    // The prize pattern once had a bare "sELAMAT" alternative that
    // matched any greeting under the /i flag — an OTP call script
    // starting "Selamat pagi" was flagged "Janji hadiah" (22 points)
    // with no prize promise anywhere in it.
    const v = analyzeWithHeuristic("Selamat pagi, apa kabar?", "id");
    assert.equal(v.riskScore, 0);
    assert.equal(v.redFlags.length, 0);
    assert.equal(v.checks.find((c) => c.id === "prize").found, false);
  });
  it("a real prize promise still fires (SELAMAT + memenangkan + hadiah)", () => {
    const v = analyzeWithHeuristic(SCAM_PRIZE, "id");
    assert.equal(v.checks.find((c) => c.id === "prize").found, true);
    assert.equal(v.redFlags.length, 6);
  });
  it("checks: empty message = all 23 clean, score 0", () => {
    const v = analyzeWithHeuristic("   ", "en");
    assert.equal(v.checks.length, 23);
    assert.equal(v.checks.filter((c) => c.found).length, 0);
    assert.equal(new Set(v.checks.map((c) => c.id)).size, 23);
  });
});

// 23 Nov 2026 regression (full-regression round): the local rules
// scored 14/25 on the AI-benchmark texts — two scam messages were
// called Safe and one real OTP was called suspicious. Every case
// below is pinned at its fixed score so a future weight change shows
// up here instead of silently in production. The one benchmark text
// NOT pinned here is hard-job-real ("Lowongan: Admin toko, gaji Rp
// 4,5 juta/bulan..."): the AI benchmark expects it "suspicious" but
// the project's own local benchmark pins the identical text SAFE
// (safe-job-real, 16) — the two benchmarks disagree on that text by
// design, and the rules follow their own benchmark.
describe("23 Nov 2026 regression: local-rules verdicts (AI-benchmark texts)", () => {
  it("guaranteed-profit investment is scam 64, not Safe 16", () => {
    const v = analyzeWithHeuristic(
      "INVESTASI CRYPTO dijamin profit 30% per minggu! Modal minimal Rp 500.000, withdraw kapan saja. Join grup VIP sekarang, slot terbatas 20 orang!",
      "id",
    );
    assert.equal(v.status, "scam");
    assert.equal(v.riskScore, 64);
    assert.equal(v.checks.find((c) => c.id === "investGuarantee").found, true);
  });
  it("Spanish prize scam is scam 60, not Safe 20", () => {
    const v = analyzeWithHeuristic(
      "¡Felicidades! Has ganado un iPhone 16 en nuestro sorteo. Paga la tarifa de envío de $15 para reclamarlo aquí: http://bit.ly/premio-iphone-16",
      "es",
    );
    assert.equal(v.status, "scam");
    assert.equal(v.riskScore, 60);
  });
  it("POLRES money-laundering threat is scam 64, not suspicious 40", () => {
    const v = analyzeWithHeuristic(
      "Dari POLRES: Akun rekening Anda terindikasi terlibat pencucian uang. Segera transfer seluruh saldo ke rekening aman 1234567890 atas nama penyidikan, atau Anda akan ditangkap hari ini juga.",
      "id",
    );
    assert.equal(v.status, "scam");
    assert.equal(v.riskScore, 64);
  });
  it("POLRES arrest-threat variant is scam 64, not Safe 22", () => {
    const v = analyzeWithHeuristic(
      "Dari POLRES: transfer seluruh saldo ke rekening aman 1234567890 atau Anda akan ditangkap hari ini juga.",
      "id",
    );
    assert.equal(v.status, "scam");
    assert.equal(v.riskScore, 64);
  });
  it("family new-number + transfer demand is scam 70, not suspicious 54", () => {
    const v = analyzeWithHeuristic(
      "Ma, ini nomor baru aku. HP lama hilang. Tolong transfer Rp 2.000.000 ke rekening 9876543210 sekarang ya, urgent banget, nanti aku jelasin.",
      "id",
    );
    assert.equal(v.status, "scam");
    assert.equal(v.riskScore, 70);
  });
  it("online-loan + upfront fee is scam 62, not suspicious 38", () => {
    const v = analyzeWithHeuristic(
      "PINJAMAN ONLINE tanpa jaminan, cair 5 menit! Limit sampai Rp 20 juta. Bayar biaya admin di muka Rp 250.000, dana langsung cair ke rekening Anda.",
      "id",
    );
    assert.equal(v.status, "scam");
    assert.equal(v.riskScore, 62);
  });
  it("courier clearance-fee phishing is scam 60, not suspicious 58", () => {
    const v = analyzeWithHeuristic(
      "Hi, this is DHL courier. Your package is held at customs and needs a small clearance fee. Please verify your details here: https://dhl-track-parcel-verify.xyz/update — thanks.",
      "en",
    );
    assert.equal(v.status, "scam");
    assert.equal(v.riskScore, 60);
  });
  it("job-deposit scam is scam 74, not suspicious 54", () => {
    const v = analyzeWithHeuristic(
      "LOWONGAN KERJA PARUH WAKTU! Gaji Rp 500.000/hari, kerja dari rumah, hanya like & subscribe video YouTube. Daftar sekarang, bayar deposit Rp 100.000 untuk aktivasi akun. Hubungi WA 0812-3456-7890.",
      "id",
    );
    assert.equal(v.status, "scam");
    assert.equal(v.riskScore, 74);
  });
  it("real Tokopedia OTP is safe 0, not suspicious 32 (pure-OTP guard)", () => {
    const v = analyzeWithHeuristic(
      "Kode verifikasi Tokopedia Anda: 482916. Jangan berikan kode ini kepada siapa pun, termasuk karyawan Tokopedia.",
      "id",
    );
    assert.equal(v.status, "safe");
    assert.equal(v.riskScore, 0);
    // The excused rules show as clean (they ran, were excused).
    assert.equal(v.checks.find((c) => c.id === "moneyOtp").found, false);
    assert.equal(v.checks.find((c) => c.id === "impersonation").found, false);
  });
  it("scam OTP with a number to call is NOT excused by the pure-OTP guard", () => {
    const v = analyzeWithHeuristic(
      "BCA: Kode OTP Anda 482916. Jangan berikan kode ini ke siapapun termasuk petugas bank. Jika Anda tidak merasa melakukan transaksi, segera hubungi 0812-9876-5432.",
      "id",
    );
    assert.equal(v.status, "scam");
    assert.equal(v.riskScore, 60);
  });
  it("voucher + claim link is suspicious 32, not Safe 10", () => {
    const v = analyzeWithHeuristic(
      "Selamat! Anda mendapat voucher Rp 100.000 dari Tokopedia. Klaim sekarang: https://tokopedia.com/voucher",
      "id",
    );
    assert.equal(v.status, "suspicious");
    assert.equal(v.riskScore, 32);
  });
  it("shortlink no longer fires inside ordinary .com/.id domains", () => {
    assert.equal(
      analyzeWithHeuristic("Hubungi kami di https://contact.com untuk bantuan.", "id").riskScore,
      0,
    );
    assert.equal(
      analyzeWithHeuristic("Kunjungi https://bisnis.id untuk info lengkap.", "id").riskScore,
      0,
    );
    // A real shortener still fires.
    assert.equal(
      analyzeWithHeuristic("Info lengkap: https://t.co/abc123", "id").riskScore,
      20,
    );
  });
  it("a genuine new-number note to a parent is suspicious 30 (verify first)", () => {
    const v = analyzeWithHeuristic("Ma, ini nomor baruku ya, yang lama hilang.", "id");
    assert.equal(v.status, "suspicious");
    assert.equal(v.riskScore, 30);
  });
  it("scan-QR-to-receive-payment is suspicious 30 (CoArena audit)", () => {
    const v = analyzeWithHeuristic(
      "Untuk menerima pembayaran pesanan, pindai kode QR yang saya kirim.",
      "id",
    );
    assert.equal(v.status, "suspicious");
    assert.equal(v.riskScore, 30);
    assert.equal(v.checks.find((c) => c.id === "qrReceive").found, true);
  });
  it("legit QRIS pay instruction does NOT fire qrReceive", () => {
    assert.equal(
      analyzeWithHeuristic("Terima kasih. Silakan pindai kode QR di bawah untuk membayar.", "id").riskScore,
      0,
    );
    assert.equal(
      analyzeWithHeuristic("Silakan pindai kode QR untuk melakukan pembayaran.", "id").riskScore,
      0,
    );
  });
  it("OTP-harvesting 'reply with the code' does NOT pass the pure-OTP guard (CoArena audit)", () => {
    const v = analyzeWithHeuristic(
      "Your verification code is 482731. Never share this code. Reply with it to reverse a mistaken debit.",
      "en",
    );
    assert.equal(v.status, "suspicious");
    assert.equal(v.riskScore, 42);
  });
  it("a denial of guaranteed profit is SAFE 16, not suspicious (CoArena audit)", () => {
    // investGuarantee (30) correctly does NOT fire on the denial —
    // its gap is bounded to 10 chars, and "dijamin menghasilkan
    // profit" is 14 chars apart. The older tooGood rule still fires
    // (16) because keyword rules do not understand negation, but the
    // verdict is safe, which is the correct outcome for an
    // educational warning. Bounding tooGood the same way would risk
    // missing real "Investasi ... dijamin profit" phrasings with a
    // longer gap, so it stays as is.
    const v = analyzeWithHeuristic("Tidak ada investasi yang dijamin menghasilkan profit.", "id");
    assert.equal(v.status, "safe");
    assert.equal(v.riskScore, 16);
    assert.equal(v.checks.find((c) => c.id === "investGuarantee").found, false);
  });
  it("guaranteed-profit slang 'dijamin cuan' still fires investGuarantee", () => {
    const v = analyzeWithHeuristic("Investasi crypto dijamin cuan 20% per minggu!", "id");
    assert.equal(v.checks.find((c) => c.id === "investGuarantee").found, true);
  });
});

describe("analyzeLink / analyzeLinks", () => {
  it("bit.ly shortener is high risk", () => {
    const r = analyzeLink("http://bit.ly/hadiah-telkomsel-2026");
    assert.equal(r.level, "high");
  });
  it("real bank domain is safe", () => {
    assert.equal(analyzeLink("https://www.bca.co.id/id/informasi").level, "safe");
  });
  it("brand look-alike domain is high risk", () => {
    const r = analyzeLink("https://bca-klik-aman.xyz/login");
    assert.equal(r.level, "high");
  });
  it("a host merely containing the brand letters is NOT a look-alike (audit B7)", () => {
    assert.equal(analyzeLink("https://abcabc.com/").level, "safe");
  });
  it("a host starting with the brand IS a look-alike (audit B7)", () => {
    assert.equal(analyzeLink("https://bcabank.com/login").level, "high");
  });
  it("IP-literal host is high risk", () => {
    assert.equal(analyzeLink("http://192.168.1.1/login").level, "high");
  });
  it("punycode host is high risk", () => {
    // Valid punycode host (xn--n3h.com = ☃.com). The previous URL
    // (xn--bca-9ya.co.id) was INVALID punycode — Node's URL parser
    // rejects it, so hostOf returned "" and the link was judged
    // "low"/unparseable instead of reaching the punycode rule.
    assert.equal(analyzeLink("https://xn--n3h.com/").level, "high");
  });
  it("analyzeLinks finds the one link in the prize message", () => {
    const links = analyzeLinks(SCAM_PRIZE);
    assert.equal(links.length, 1);
    assert.equal(links[0].level, "high");
  });
});

describe("extractNumbers", () => {
  it("finds the phone in the OTP sample", () => {
    const { phones } = extractNumbers(OTP_SAMPLE);
    assert.deepEqual(phones, ["0812-9876-5432"]);
  });
  it("finds a 16-digit card-like run as an account", () => {
    const { accounts } = extractNumbers("kirim ke rekening 1234567890123456 ya");
    assert.ok(accounts.length >= 1);
  });
  it("a 22-digit transaction number yields NO phantom phone (21 Nov live: Pak Reza)", () => {
    const { phones, accounts } = extractNumbers(
      "Pak Reza\nJumlah Total Rp 480.000\nNo. Transaksi 2026011743008130078713\nudah di tf pak\nFaqih udah selesai... No 1724",
    );
    assert.deepEqual(phones, []);
    assert.deepEqual(accounts, []);
  });
  it("a real phone next to a transaction number is still found", () => {
    const { phones, accounts } = extractNumbers(
      "No. Transaksi 2026011743008130078713, hubungi 0812-3456-7890",
    );
    assert.deepEqual(phones, ["0812-3456-7890"]);
    assert.deepEqual(accounts, []);
  });
  it("a +62 phone is not also listed as an account", () => {
    const { phones, accounts } = extractNumbers("WA +6281234567890");
    assert.deepEqual(phones, ["+6281234567890"]);
    assert.deepEqual(accounts, []);
  });
  it("a phone at the very start of the message is found", () => {
    const { phones } = extractNumbers("081234567890 adalah nomor saya");
    assert.deepEqual(phones, ["081234567890"]);
  });
});

describe("outbound guard (check before sending)", () => {
  it("warns OTP + password + account, never shows raw secrets", () => {
    const found = analyzeOutgoing("Kode OTP saya 482916, password: rahasia123. Kirim ke rekening 1234567890 ya.");
    const kinds = found.map((f) => f.kind);
    assert.ok(kinds.includes("otp"));
    assert.ok(kinds.includes("password"));
    assert.ok(kinds.includes("account"));
    const blob = JSON.stringify(found);
    assert.ok(!blob.includes("482916"), "OTP must be masked");
    assert.ok(!blob.includes("rahasia123"), "password must be masked");
    assert.ok(!blob.includes("1234567890"), "account must be masked");
  });
  it("price is not an OTP (audit B1)", () => {
    assert.deepEqual(analyzeOutgoing("Harganya Rp 100000 ya"), []);
  });
  it("a phone number is not a bank account (audit B1)", () => {
    assert.deepEqual(analyzeOutgoing("Hubungi saya di 081298765432"), []);
  });
  it("a year next to the OTP word is not an OTP (audit B1)", () => {
    assert.deepEqual(analyzeOutgoing("Kode OTP saya tahun 2026"), []);
  });
  it("solid 16 digits = KTP, grouped 16 = card (audit B2)", () => {
    assert.equal(analyzeOutgoing("KTP saya 1234567890123456")[0].kind, "ktp");
    assert.equal(analyzeOutgoing("Kartu saya 1234 5678 9012 3456")[0].kind, "card");
  });
  it("a bare 6-digit code alone is an OTP", () => {
    assert.equal(analyzeOutgoing("482916")[0].kind, "otp");
  });
  it("maskDigits of empty input is empty (audit B11)", () => {
    assert.equal(maskDigits(""), "");
    assert.equal(maskDigits("password"), "");
  });
  it("clean message has no findings", () => {
    assert.deepEqual(analyzeOutgoing("Sampai jumpa besok jam 10 di kantor."), []);
  });
  it("maskDigits keeps first/last digits only", () => {
    const m = maskDigits("081298765432");
    assert.ok(m.startsWith("08"), m);
    assert.ok(m.endsWith("32"), m);
    assert.ok(!m.includes("12987654"), m);
  });
});

describe("chat export scanner", () => {
  const EXPORT = [
    "12/11/2026, 10:23 - Sari: Hai, rapat pindah ke Kamis ya",
    "12/11/2026, 10:24 - Budi: Oke, siap",
    "12/11/2026, 10:25 - Promo: SELAMAT! Anda menang Rp 50.000.000, klik http://bit.ly/hadiah-2026 dan bayar biaya admin!",
  ].join("\n");
  it("parses 3 messages with senders (Android dash format)", () => {
    const msgs = parseChatExport(EXPORT);
    assert.equal(msgs.length, 3);
    assert.equal(msgs[0].sender, "Sari");
    assert.equal(msgs[2].sender, "Promo");
  });
  it("parses the iOS bracket format too (no dash after ])", () => {
    const msgs = parseChatExport(
      "[12/11/2026, 10:23:45] Sari: Hai, rapat pindah ke Kamis ya\n[12/11/2026, 10:24:01] Budi: Oke, siap",
    );
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].sender, "Sari");
    assert.equal(msgs[1].sender, "Budi");
  });
  it("flags only the prize message as risky", () => {
    const res = scanChatLog(EXPORT, "en");
    assert.equal(res.total, 3);
    assert.equal(res.risky.length, 1);
    assert.equal(res.risky[0].sender, "Promo");
  });
  it("empty export scans to zero", () => {
    const res = scanChatLog("", "en");
    assert.equal(res.total, 0);
    assert.equal(res.risky.length, 0);
  });
  it("skips WhatsApp system lines (audit B8)", () => {
    const msgs = parseChatExport(
      [
        "12/11/2026, 10:23 - Sari changed the group name to 'Rapat'",
        "12/11/2026, 10:24 - Sari: Hai, rapat pindah ke Kamis ya",
        "12/11/2026, 10:25 - Messages are end-to-end encrypted.",
      ].join("\n"),
    );
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].sender, "Sari");
  });
  it("byte limit is byte-accurate, not UTF-16 length (audit B8)", () => {
    // 1.1M CJK chars = ~3.3 MB in UTF-8 (over the 2 MB limit) but only
    // 1.1M UTF-16 units — the old String.length check let it through.
    const bigCjk = "你".repeat(1_100_000);
    assert.equal(scanChatLog(bigCjk, "en").error, "tooBig");
    // 1.1M ASCII chars = 1.1 MB, under the limit.
    const bigAscii = "a".repeat(1_100_000);
    assert.notEqual(scanChatLog(bigAscii, "en").error, "tooBig");
    assert.ok(CHATLOG_MAX_BYTES === 2 * 1024 * 1024);
  });
});

describe("file structure check (magic bytes)", () => {
  function zipWithEntries(names) {
    // Minimal ZIP local headers: PK\x03\x04 + name, no data.
    const parts = [];
    for (const name of names) {
      const nb = new TextEncoder().encode(name);
      const h = new Uint8Array(30);
      h[0] = 0x50; h[1] = 0x4b; h[2] = 0x03; h[3] = 0x04;
      h[26] = nb.length & 0xff; h[27] = (nb.length >> 8) & 0xff;
      parts.push(h, nb);
    }
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return new Blob([out], { type: "application/octet-stream" });
  }
  it("ZIP with AndroidManifest.xml + classes.dex = apk, high", async () => {
    const info = await inspectFile(new File([zipWithEntries(["AndroidManifest.xml", "classes.dex"])], "invite.apk"));
    assert.equal(info.kind, "apk");
    assert.equal(info.level, "high");
  });
  it("MZ header = exe, high", async () => {
    const info = await inspectFile(new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], "program.exe"));
    assert.equal(info.kind, "exe");
    assert.equal(info.level, "high");
  });
  it("plain text is read and scored, not 'unknown' (gap fix 19 Nov)", async () => {
    const info = await inspectFile(new File([new TextEncoder().encode("hello world\n")], "note.txt"));
    assert.equal(info.kind, "text");
    assert.equal(info.level, "low");
    assert.equal(info.textContent, "hello world\n");
    assert.equal(info.textPreview, "hello world\n");
  });
  it("SHA-256 of 'abc' matches the known vector", async () => {
    const hex = await sha256HexOfBlob(new Blob(["abc"]));
    assert.equal(hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("ZIP with the data-descriptor flag still walks all entries (audit B3)", async () => {
    // Bit 3 set: compSize in the header is 0, data + PK\x07\x08
    // descriptor follow. The walker must scan for the next header.
    function zipBit3(names) {
      const parts = [];
      for (const name of names) {
        const nb = new TextEncoder().encode(name);
        const h = new Uint8Array(30);
        h[0] = 0x50; h[1] = 0x4b; h[2] = 0x03; h[3] = 0x04;
        h[6] = 0x08; // flag bit 3: data descriptor follows
        h[26] = nb.length & 0xff; h[27] = (nb.length >> 8) & 0xff;
        const data = new TextEncoder().encode("ABCD");
        const desc = new Uint8Array(16);
        desc[0] = 0x50; desc[1] = 0x4b; desc[2] = 0x07; desc[3] = 0x08;
        parts.push(h, nb, data, desc);
      }
      const total = parts.reduce((a, p) => a + p.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) { out.set(p, off); off += p.length; }
      return new Blob([out], { type: "application/octet-stream" });
    }
    const apk = await inspectFile(new File([zipBit3(["META-INF/MANIFEST.MF", "AndroidManifest.xml"])], "app.zip"));
    assert.equal(apk.kind, "apk");
    assert.equal(apk.level, "high");
    const prog = await inspectFile(new File([zipBit3(["readme.txt", "setup.exe"])], "bundle.zip"));
    assert.equal(prog.kind, "archive-prog");
    assert.equal(prog.level, "high");
  });
});

describe("quiz bank", () => {
  it("question ids are strings (q1..q8), not the Indonesian text object (audit B5)", () => {
    const qs = getQuizQuestions("en");
    assert.equal(qs[0].id, "q1");
    const ids = qs.map((q) => q.id);
    assert.ok(ids.every((id) => typeof id === "string"), JSON.stringify(ids));
    assert.equal(new Set(ids).size, ids.length, "ids must be unique");
  });
  it("English bank has questions, each with a scam/safe answer", () => {
    const qs = getQuizQuestions("en");
    assert.ok(qs.length >= 4, `only ${qs.length} questions`);
    for (const q of qs) {
      assert.ok(typeof q.text === "string" && q.text.length > 10);
      assert.equal(typeof q.scam, "boolean", JSON.stringify(q));
      assert.ok(typeof q.why === "string" && q.why.length > 10);
    }
  });
  it("Indonesian bank falls back gracefully", () => {
    const qs = getQuizQuestions("id");
    assert.ok(qs.length >= 4);
  });
});

describe("registrable domain (audit B4)", () => {
  it("keeps the brand under a two-level suffix", () => {
    assert.equal(registrableDomain("mail.bca.co.id"), "bca.co.id");
    assert.equal(registrableDomain("a.b.example.co.uk"), "example.co.uk");
    assert.equal(registrableDomain("www.bca.co.id"), "bca.co.id");
  });
  it("plain two-label hosts are unchanged", () => {
    assert.equal(registrableDomain("bca.co.id"), "bca.co.id");
    assert.equal(registrableDomain("example.com"), "example.com");
  });
});

describe("email brand check (audit B7)", () => {
  it("a sender name merely containing brand letters is not a mismatch", () => {
    const v = analyzeEmail({ fromName: "Abcabc", fromEmail: "x@random.com", body: "Halo, ini info biasa." }, "en");
    assert.equal(v.status, "safe");
    assert.equal(v.riskScore, 0);
  });
  it("a sender claiming the brand from a foreign domain is a mismatch", () => {
    // 30 (brand mismatch) + 20 (free-mail sender gmail.com) = 50.
    const v = analyzeEmail({ fromName: "BCA", fromEmail: "bca-promo@gmail.com", body: "Halo, ini info biasa." }, "en");
    assert.equal(v.status, "suspicious");
    assert.equal(v.riskScore, 50);
  });
});

describe("email brand verification (22 Nov audit 8)", () => {
  const GENUINE_BODY =
    "Terima kasih telah berbelanja di Tokopedia. Pesanan Anda sudah kami proses. Silakan cek status pesanan Anda di aplikasi Tokopedia.";
  it("a genuine Tokopedia email scores 0 — naming its own brand is not impersonation", () => {
    const v = analyzeEmail({ fromName: "Tokopedia", fromEmail: "noreply@tokopedia.com", body: GENUINE_BODY }, "en");
    assert.equal(v.status, "safe");
    assert.equal(v.riskScore, 0);
    assert.equal(v.redFlags.length, 0);
    const imp = v.checks.find((c) => c.id === "impersonation");
    assert.ok(imp && imp.found === false, "impersonation row must be present and clean");
    const verified = v.checks.find((c) => c.id === "emailBrandVerified");
    assert.ok(verified && verified.kind === "info", "a verified-sender info row must be present");
  });
  it("a genuine brand email from a brand subdomain also scores 0", () => {
    const v = analyzeEmail({ fromName: "Tokopedia", fromEmail: "noreply@mail.tokopedia.com", body: GENUINE_BODY }, "en");
    assert.equal(v.status, "safe");
    assert.equal(v.riskScore, 0);
  });
  it("a genuine brand email WITH links still scores 0 (verified brand's own links are not suspicious)", () => {
    // A real order email always carries links — multiLinks (+8) must
    // be excused together with impersonation for a verified sender.
    const body = GENUINE_BODY + " Lacak pesanan di https://tokopedia.com/order/123 dan https://tokopedia.com/help.";
    const v = analyzeEmail({ fromName: "Tokopedia", fromEmail: "noreply@tokopedia.com", body }, "en");
    assert.equal(v.status, "safe");
    assert.equal(v.riskScore, 0);
    assert.equal(v.redFlags.length, 0);
    assert.equal(v.checks.find((c) => c.id === "multiLinks").found, false);
  });
  it("a look-alike domain with links still fires everything (63 scam)", () => {
    const body = GENUINE_BODY + " Lacak pesanan di https://tokopedia-promo.net/order/123 dan https://tokopedia-promo.net/help.";
    const v = analyzeEmail({ fromName: "Tokopedia", fromEmail: "promo@tokopedia-promo.net", body }, "en");
    assert.equal(v.status, "scam");
    assert.equal(v.riskScore, 63); // 30 mismatch + 10 impersonation + 8 multiLinks + 15 suspicious link
  });
  it("a genuine email naming another brand FIRST still scores 0 (brand checked in the whole body, not the evidence snippet)", () => {
    // The impersonation rule fires on "Bank BCA" first; its evidence
    // snippet never reaches "Tokopedia" — the old evidence-only gate
    // left this genuine email at 10/100.
    const body = "Pembayaran melalui Bank BCA telah kami terima. Terima kasih telah berbelanja di Tokopedia. Pesanan Anda sudah kami proses.";
    const v = analyzeEmail({ fromName: "Tokopedia", fromEmail: "noreply@tokopedia.com", body }, "en");
    assert.equal(v.status, "safe");
    assert.equal(v.riskScore, 0);
    assert.equal(v.redFlags.length, 0);
  });
  it("a look-alike domain (tokopedia-promo.net) still fires mismatch + impersonation", () => {
    const v = analyzeEmail({ fromName: "Tokopedia", fromEmail: "promo@tokopedia-promo.net", body: GENUINE_BODY }, "en");
    assert.equal(v.status, "suspicious");
    assert.equal(v.riskScore, 40); // 30 mismatch + 10 impersonation
    assert.ok(v.redFlags.length >= 2);
    assert.equal(v.checks.find((c) => c.id === "emailBrandVerified"), undefined);
  });
  it("a brand name claimed from a free mailbox still scores scam", () => {
    const v = analyzeEmail({ fromName: "Tokopedia", fromEmail: "tokopedia@gmail.com", body: GENUINE_BODY }, "en");
    assert.equal(v.status, "scam");
    assert.equal(v.riskScore, 60); // 30 mismatch + 20 free mail + 10 impersonation
  });
});

describe("call check community lookup (21 Nov: always runs, no gate)", () => {
  const SAID = "Saya dari bank BCA, akun Anda akan diblokir, kirim kode OTP sekarang.";
  it("default (no options): lookup attempted, pattern score unchanged (demo: no Firebase, count null)", async () => {
    const { verdict, reportCount } = await analyzeCall({ number: "081234567890", said: SAID }, "en");
    assert.equal(reportCount, null);
    assert.equal(verdict.riskScore, 85);
    assert.equal(verdict.status, "scam");
    assert.equal(verdict.source, "LOCAL");
  });
  it("allowReports:false no longer disables the lookup (same result as default)", async () => {
    const { verdict, reportCount } = await analyzeCall({ number: "081234567890", said: SAID }, "en", { allowReports: false });
    assert.equal(reportCount, null);
    assert.equal(verdict.riskScore, 85);
  });
  it("returns lookupMs: measured lookup time for a number, null with no number (audit 6)", async () => {
    const withNum = await analyzeCall({ number: "081234567890", said: SAID }, "en");
    assert.equal(typeof withNum.lookupMs, "number");
    assert.ok(withNum.lookupMs >= 0);
    const noNum = await analyzeCall({ number: "", said: SAID }, "en");
    assert.equal(noNum.lookupMs, null);
  });
});

describe("call check plain transfer ask (perfection audit)", () => {
  it("a bare transfer ask with no other trigger is suspicious 30, not Safe 0", async () => {
    const { verdict } = await analyzeCall({ number: "081234567890", said: "Tolong transfer Rp 500.000 ke rekening ini ya" }, "id");
    assert.equal(verdict.riskScore, 30);
    assert.equal(verdict.status, "suspicious");
  });
  it("kirim kode OTP still does not match the transfer pattern (pinned 85)", async () => {
    const { verdict } = await analyzeCall({ number: "081234567890", said: "Saya dari bank BCA, akun Anda akan diblokir, kirim kode OTP sekarang." }, "en");
    assert.equal(verdict.riskScore, 85);
  });
});

describe("call check number-only summary honesty (21 Nov: lookup always attempted)", () => {
  it("demo mode (lookup failed) says the database could not be reached, not 'no reports' (ID)", async () => {
    const { verdict } = await analyzeCall({ number: "081234567890", said: "" }, "id");
    assert.equal(verdict.status, "suspicious");
    assert.match(verdict.summary, /tidak bisa dijangkau/);
  });
  it("same in EN", async () => {
    const { verdict } = await analyzeCall({ number: "081234567890", said: "" }, "en");
    assert.match(verdict.summary, /could not be reached/);
  });
});

describe("21 Nov audit 4: LOCAL verdicts show their own checks (counts match)", () => {
  const EMAIL_INPUT = {
    fromName: "BCA",
    fromEmail: "support@bca-secure-login.com",
    body: "Yth. Nasabah, akun Anda akan diblokir dalam 24 jam. Segera verifikasi data Anda di sini: https://bca-secure-login.com/verifikasi-akun",
  };
  it("email: 27 checks (23 message rules + 4 email checks), found == top flags", () => {
    const v = analyzeEmail(EMAIL_INPUT, "id");
    assert.equal(v.checks.length, 27); // 23 message rules + 4 email checks
    assert.equal(v.checks.filter((c) => c.found).length, 5);
    assert.equal(v.redFlags.length, 5);
    const vEn = analyzeEmail(EMAIL_INPUT, "en");
    assert.deepEqual(
      vEn.checks.filter((c) => c.found).map((c) => c.flag).sort(),
      [...vEn.redFlags].sort(),
    );
  });
  it("call OTP script with a greeting: 3 flags, 3 found, no prize flag", async () => {
    const { verdict } = await analyzeCall(
      {
        number: "081234567890",
        said: "Selamat pagi, saya dari Bank BCA. Akun Bapak telah diblokir. Untuk membuka blokirnya, mohon sebutkan kode OTP yang baru saja Bapak terima.",
      },
      "id",
    );
    assert.equal(verdict.riskScore, 85);
    assert.equal(verdict.redFlags.length, 3);
    assert.equal(verdict.checks.filter((c) => c.found).length, 3);
    assert.ok(!verdict.redFlags.some((f) => /hadiah/i.test(f)), `prize flag leaked: ${verdict.redFlags.join(" | ")}`);
    assert.ok(!verdict.checks.some((c) => c.id === "prize"));
  });
  it("call number-only: one flag, one found check (5 scripts + number-only row)", async () => {
    const { verdict } = await analyzeCall({ number: "081234567890", said: "" }, "id");
    assert.equal(verdict.redFlags.length, 1);
    assert.equal(verdict.checks.length, 6);
    assert.equal(verdict.checks.filter((c) => c.found).length, 1);
    assert.equal(verdict.checks.find((c) => c.found).id, "callNumberOnly");
  });
  it("checkerHintLocal + reportCountsTitle exist ID+EN", () => {
    assert.match(t("checkerHintLocal", "id"), /tanpa AI/);
    assert.match(t("checkerHintLocal", "en"), /no AI/);
    assert.equal(t("reportCountsTitle", "id"), "Laporan komunitas");
    assert.equal(t("reportCountsTitle", "en"), "Community reports");
  });
  it("hero source links to the OJK press release (the statistic's real source)", () => {
    const root = path.dirname(fileURLToPath(import.meta.url));
    const html = readFileSync(path.join(root, "..", "index.html"), "utf8");
    assert.match(
      html,
      /ojk\.go\.id\/id\/berita-dan-kegiatan\/siaran-pers\/Pages\/OJK-dan-Bareskrim-Polri-Sepakat-Perkuat-Kolaborasi/,
    );
  });
});

describe("21 Nov audit 5: counts, official numbers, local duration, OJK wording", () => {
  it("email gmail variant (the auditor's 8=8): 8 found == 8 top flags", () => {
    // The auditor's richer email: a "BCA" sender on gmail.com whose
    // body names Bank BCA and asks for an OTP — 8 rules fire, and
    // the top list matches the checklist exactly.
    const v = analyzeEmail(
      {
        fromName: "BCA",
        fromEmail: "bca-promo@gmail.com",
        body: "Yth. Nasabah Bank BCA, akun Anda akan diblokir dalam 24 jam. Segera verifikasi data Anda di sini: https://bca-secure-login.com/verifikasi-akun dan sebutkan kode OTP Anda kepada petugas kami.",
      },
      "id",
    );
    assert.equal(v.checks.length, 27); // 23 message rules + 4 email checks
    assert.equal(v.checks.filter((c) => c.found).length, 8);
    assert.equal(v.redFlags.length, 8);
    // The checklist flags are English (translated at render); compare
    // them against the EN verdict's own red flags.
    const vEn = analyzeEmail(
      {
        fromName: "BCA",
        fromEmail: "bca-promo@gmail.com",
        body: "Yth. Nasabah Bank BCA, akun Anda akan diblokir dalam 24 jam. Segera verifikasi data Anda di sini: https://bca-secure-login.com/verifikasi-akun dan sebutkan kode OTP Anda kepada petugas kami.",
      },
      "en",
    );
    assert.deepEqual(
      vEn.checks.filter((c) => c.found).map((c) => c.flag).sort(),
      [...vEn.redFlags].sort(),
    );
  });
  it("call short OTP text with an unreported number (the auditor's 2=2): threat + OTP only", async () => {
    const { verdict } = await analyzeCall(
      {
        number: "081234567890",
        said: "Akun Anda diblokir. Segera kirim kode OTP.",
      },
      "id",
    );
    // Demo mode: the community lookup fails (reportCount null), so
    // no report flag — exactly the auditor's 2 rules. (The longer
    // greeting script adds the bank word and is 3=3 / 85.)
    assert.equal(verdict.riskScore, 60);
    assert.equal(verdict.redFlags.length, 2);
    assert.equal(verdict.checks.filter((c) => c.found && c.kind !== "info").length, 2);
  });
  it("1500888 + 'Halo, ini BCA': Safe 0, no red flag, identity is info", async () => {
    const { verdict } = await analyzeCall({ number: "1500888", said: "Halo, ini BCA" }, "id");
    assert.equal(verdict.status, "safe");
    assert.equal(verdict.riskScore, 0);
    assert.equal(verdict.redFlags.length, 0);
    assert.equal((verdict.infoFlags || []).length, 1);
    assert.match((verdict.infoFlags || [])[0], /BCA/);
    // The summary names the official contact AND warns about
    // spoofing (Groq review: a verified identity must not read as
    // "this call is safe, full stop").
    assert.match(verdict.summary, /memalsukan nomor asli/);
    const bankRow = verdict.checks.find((c) => c.id === "callScriptBank");
    assert.equal(bankRow.kind, "info");
    assert.equal(bankRow.found, true);
    // Rules only: 5 script rows minus the demoted one + reports row
    // absent in demo (lookup failed) = 4 rules, 0 triggered, 4 clean.
    assert.equal(verdict.checks.filter((c) => c.kind !== "info").length, 4);
    assert.equal(verdict.checks.filter((c) => c.found && c.kind !== "info").length, 0);
  });
  it("1500888 + OTP ask: the OTP flag still fires (a real bank never asks for OTP)", async () => {
    const { verdict } = await analyzeCall(
      { number: "1500888", said: "Halo, ini BCA. Sebutkan kode OTP Anda." },
      "id",
    );
    assert.equal(verdict.riskScore, 35);
    assert.equal(verdict.status, "suspicious");
    assert.equal(verdict.redFlags.length, 1);
    assert.match(verdict.redFlags[0], /OTP/);
    assert.equal((verdict.infoFlags || []).length, 1);
  });
  it("1500888 + 'saya dari polisi': a DIFFERENT institution is still a danger sign", async () => {
    const { verdict } = await analyzeCall(
      { number: "1500888", said: "Saya dari polisi, segera transfer uang ke rekening ini." },
      "id",
    );
    // Bank pattern (polisi) 25 + transfer 30 + identity mismatch 35
    // (audit 7: the number belongs to BCA, the caller claims Polisi)
    // = 90; no demotion: the caller did not name BCA.
    assert.equal(verdict.riskScore, 90);
    assert.equal(verdict.status, "scam");
    assert.equal(verdict.redFlags.length, 3);
    assert.equal((verdict.infoFlags || []).length, 0);
    assert.ok(verdict.redFlags.some((f) => /BCA/.test(f) && /Polisi/.test(f)));
    const row = verdict.checks.find((c) => c.id === "callIdentityMismatch");
    assert.ok(row && row.found);
  });
  it("1500888 + 'Halo, saya dari OJK' (the auditor's case): mismatch, 60 scam, names BCA + OJK", async () => {
    const { verdict } = await analyzeCall(
      { number: "1500888", said: "Halo, saya dari OJK." },
      "id",
    );
    // Was 25/100 Safe (audit 7): bank pattern only. Now bank 25 +
    // identity mismatch 35 = 60 (scam), with a flag that names both
    // institutions so the user sees the number is BCA's, not OJK's.
    assert.equal(verdict.riskScore, 60);
    assert.equal(verdict.status, "scam");
    assert.equal(verdict.redFlags.length, 2);
    assert.ok(verdict.redFlags.some((f) => /BCA/.test(f) && /OJK/.test(f)));
    assert.equal((verdict.infoFlags || []).length, 0);
    const row = verdict.checks.find((c) => c.id === "callIdentityMismatch");
    assert.ok(row && row.found);
    assert.match(row.evidence, /BCA → OJK/);
    // Counts still match: 2 found rules == 2 top flags.
    assert.equal(verdict.checks.filter((c) => c.found && c.kind !== "info").length, 2);
  });
  it("1500888 + OJK claim in EN: the mismatch flag carries both names", async () => {
    const { verdict } = await analyzeCall(
      { number: "1500888", said: "Hello, this is OJK." },
      "en",
    );
    assert.equal(verdict.riskScore, 60);
    assert.ok(verdict.redFlags.some((f) => /BCA/.test(f) && /OJK/.test(f)));
  });
  it("1500888 + 'Saya dari OJK, bukan dari BCA.': first mention wins — mismatch, 60 (CoArena)", async () => {
    const { verdict } = await analyzeCall(
      { number: "1500888", said: "Saya dari OJK, bukan dari BCA." },
      "id",
    );
    // OJK is named first, so the claim is OJK — the later BCA mention
    // does not verify the identity. Bank 25 + mismatch 35 = 60.
    assert.equal(verdict.riskScore, 60);
    assert.equal(verdict.status, "scam");
    assert.equal(verdict.redFlags.length, 2);
    const row = verdict.checks.find((c) => c.id === "callIdentityMismatch");
    assert.ok(row && row.found);
  });
  it("1500888 + 'Saya dari bank.': generic 'bank' is not a distinct institution — no mismatch (CoArena)", async () => {
    const { verdict } = await analyzeCall(
      { number: "1500888", said: "Saya dari bank." },
      "id",
    );
    // Bank pattern only (25); no mismatch row: "bank" could be BCA itself.
    assert.equal(verdict.riskScore, 25);
    assert.equal(verdict.redFlags.length, 1);
    assert.equal(verdict.checks.find((c) => c.id === "callIdentityMismatch"), undefined);
  });
  it("1500888 + 'Saya dari BCA, OJK mengatur kami': BCA named first — verified, no mismatch (CoArena)", async () => {
    const { verdict } = await analyzeCall(
      { number: "1500888", said: "Saya dari BCA, OJK mengatur kami." },
      "id",
    );
    assert.equal(verdict.riskScore, 0);
    assert.equal(verdict.redFlags.length, 0);
    assert.equal((verdict.infoFlags || []).length, 1);
  });
  it("1500888 + a script that never names the institution: no info, generic summary", async () => {
    const { verdict } = await analyzeCall({ number: "1500888", said: "Rapat besok jam 10." }, "id");
    assert.equal(verdict.riskScore, 0);
    assert.equal(verdict.status, "safe");
    assert.equal((verdict.infoFlags || []).length, 0);
    assert.doesNotMatch(verdict.summary, /kontak resmi/);
  });
  it("mergeCallVerdict carries infoFlags from the local verdict", async () => {
    const { verdict: local } = await analyzeCall({ number: "1500888", said: "Halo, ini BCA" }, "en");
    const merged = mergeCallVerdict({ status: "safe", riskScore: 0, redFlags: [], summary: "ok", source: "IN_CLOUD" }, local);
    assert.equal(merged.redFlags.length, 0);
    assert.ok((merged.infoFlags || []).some((f) => /BCA/.test(f)));
  });
  it("local duration keys exist ID+EN and carry the number", () => {
    assert.match(t("checkedInLocal", "id", { s: "0.4" }), /0\.4/);
    assert.match(t("checkedInLocal", "id", { s: "0.4" }), /tanpa menunggu AI/);
    assert.match(t("checkedInLocal", "en", { s: "0.4" }), /no AI wait/);
    assert.match(t("receiptTimeLocal", "id", { s: "0.4" }), /0\.4/);
    assert.match(t("receiptTimeLocal", "en", { s: "0.4" }), /no AI wait/);
    assert.equal(t("receiptTimeLocalUnknown", "id"), "Diperiksa di perangkat ini — tanpa menunggu AI.");
    assert.equal(t("receiptTimeLocalUnknown", "en"), "Checked on this device — no AI wait.");
    assert.equal(t("infoFlags", "id"), "Informasi berguna");
    assert.equal(t("infoFlags", "en"), "Useful information");
  });
  it("OJK statLossNum is Rp9 exactly as the press release (ID+EN)", () => {
    assert.equal(t("statLossNum", "id"), "Rp9 triliun");
    assert.equal(t("statLossNum", "en"), "Rp9 trillion");
  });
});

describe("file name check (perfection audit)", () => {
  it("the word 'apk' in a .txt name is not an APK file", () => {
    const r = analyzeFileName("catatan apk rapat.txt");
    assert.notEqual(r.kind, "apk");
    assert.notEqual(r.level, "high");
  });
  it("a real .apk name is still high", () => {
    const r = analyzeFileName("undangan-nikah.apk");
    assert.equal(r.kind, "apk");
    assert.equal(r.level, "high");
  });
  it("reportCount key exists in both languages (no raw key shown)", () => {
    assert.notEqual(t("reportCount", "id", { n: 3 }), "reportCount");
    assert.notEqual(t("reportCount", "en", { n: 3 }), "reportCount");
    assert.match(t("reportCount", "id", { n: 3 }), /3/);
  });
});

describe("file name check: domains and URLs are not files (22 Nov audit 7)", () => {
  it("example.com is a domain, not a Windows program", () => {
    const r = analyzeFileName("example.com");
    assert.equal(r.kind, "url");
    assert.notEqual(r.level, "high");
    assert.equal(r.reasonKey, "fileNameIsUrl");
    assert.equal(fileTypeDisplay(r), "URL");
  });
  it("a bit.ly URL (with or without scheme) is a link, not a file", () => {
    for (const input of ["https://bit.ly/3abc", "http://bit.ly/3abc", "bit.ly/3abc", "bit.ly"]) {
      const r = analyzeFileName(input);
      assert.equal(r.kind, "url", input);
      assert.equal(fileTypeDisplay(r), "URL", input);
    }
  });
  it("an email address typed as a file name is not a file", () => {
    assert.equal(analyzeFileName("support@bca.com").kind, "url");
  });
  it("'@' alone is not an email: invoice@2025.pdf is a document (CoArena)", () => {
    assert.equal(analyzeFileName("invoice@2025.pdf").kind, "doc");
    assert.equal(analyzeFileName("foto@liburan.jpg").kind, "unknown");
    assert.equal(analyzeFileName("support@bca.com").kind, "url");
  });
  it("real file names still classify: apk, double ext, doc, archive", () => {
    assert.equal(analyzeFileName("undangan-nikah.apk").kind, "apk");
    assert.equal(analyzeFileName("laporan.pdf.exe").kind, "exe");
    assert.equal(analyzeFileName("laporan.pdf").kind, "doc");
    assert.equal(analyzeFileName("data.zip").kind, "archive");
    assert.equal(analyzeFileName("foto.jpg").kind, "unknown");
  });
  it("a path to a real file is still a file, not a URL", () => {
    assert.equal(analyzeFileName("folder/undangan-nikah.apk").kind, "apk");
  });
  it("the URL verdict and reason keys exist ID+EN", () => {
    assert.match(t("fileNameIsUrl", "id"), /Cek Tautan/);
    assert.match(t("fileNameIsUrl", "en"), /Check Link/);
    assert.match(t("fileVerdictUrl", "id"), /alamat web/);
    assert.match(t("fileVerdictUrl", "en"), /web address/);
  });
  it("the unresolved-link note is honest per case (audit 7 follow-up)", () => {
    assert.match(t("linkUnresolvedNote", "id"), /pemendek tautan memblokir/);
    assert.match(t("linkUnresolvedNoteFetch", "id"), /gagal dimuat/);
    assert.match(t("linkUnresolvedNoteFetch", "en"), /failed to load/);
    assert.doesNotMatch(t("linkUnresolvedNoteFetch", "id"), /pemendek/);
  });
});

describe("formatElapsed: ONE fixed unit — always milliseconds (22 Nov audit 9)", () => {
  it("every value prints in milliseconds, never seconds — the unit cannot flip between checks", () => {
    assert.equal(formatElapsed(2.5, "id"), "2.500,0 md");
    assert.equal(formatElapsed(2.5, "en"), "2,500.0 ms");
    assert.equal(formatElapsed(1, "id"), "1.000,0 md");
    assert.equal(formatElapsed(6.5, "id"), "6.500,0 md");
    assert.equal(formatElapsed(0.3207, "id"), "320,7 md");
    assert.equal(formatElapsed(0.2926, "id"), "292,6 md");
  });
  it("below one millisecond shows two decimals, never 0.0", () => {
    assert.equal(formatElapsed(0.0123, "id"), "12,3 md");
    assert.equal(formatElapsed(0.0123, "en"), "12.3 ms");
    assert.equal(formatElapsed(0.0004, "id"), "0,40 md");
    assert.equal(formatElapsed(0, "id"), "0,00 md");
  });
  it("forceUnit is ignored — the unit is always milliseconds (audit 8 pin removed)", () => {
    assert.equal(formatElapsed(1.2, "id", "ms"), "1.200,0 md");
    assert.equal(formatElapsed(0.998, "id", "s"), "998,0 md");
    assert.equal(formatElapsed(1.2, "en", "s"), "1,200.0 ms");
    assert.equal(formatElapsed(0.998, "en", "s"), "998.0 ms");
  });
  it("the local duration keys carry the formatted value (no unit in the string)", () => {
    assert.match(t("checkedInLocal", "id", { s: "12,3 md" }), /12,3 md/);
    assert.doesNotMatch(t("checkedInLocal", "id", { s: "12,3 md" }), /dtk/);
    assert.match(t("receiptTimeLocal", "en", { s: "12.3 ms" }), /12\.3 ms/);
  });
});

describe("message-text file scan: domains are not Windows programs (21 Nov, item 4)", () => {
  it("bca.com in a message is NOT a Windows program file (was exe/high)", () => {
    const r = analyzeFiles("Halo, ini dari Bank BCA. Hubungi kami di support@bca.com atau kunjungi bca.com untuk info lebih lanjut.");
    assert.deepEqual(r, []);
  });
  it("a bare domain alone is not flagged either", () => {
    assert.deepEqual(analyzeFiles("Kunjungi bca.com untuk info."), []);
  });
  it("a real .exe in a message is still exe/high", () => {
    const r = analyzeFiles("Jalankan setup.exe untuk instalasi.");
    assert.equal(r.length, 1);
    assert.equal(r[0].kind, "exe");
    assert.equal(r[0].level, "high");
  });
  it("a real .apk link in a message is still apk/high", () => {
    const r = analyzeFiles("Unduh aplikasinya di undangan-nikah.apk sekarang.");
    assert.equal(r.length, 1);
    assert.equal(r[0].kind, "apk");
    assert.equal(r[0].level, "high");
  });
  it("a double extension .pdf.exe is still exe/high", () => {
    const r = analyzeFiles("Buka laporan.pdf.exe ini.");
    assert.equal(r.length, 1);
    assert.equal(r[0].kind, "exe");
    assert.equal(r[0].level, "high");
  });
});

describe("21 Nov items 2/3/5/6: single score, OJK deep link, honest labels", () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const readSrc = (rel) => readFileSync(path.join(root, "..", rel), "utf8");
  it("modeLocal key exists ID+EN (header label for non-AI tabs)", () => {
    assert.equal(t("modeLocal", "id"), "Cek di perangkat");
    assert.equal(t("modeLocal", "en"), "On-device check");
  });
  it("localSignalTextLocal quotes the verdict score, never a second 'initial score'", () => {
    const id = t("localSignalTextLocal", "id", { score: 60, status: "Penipuan", n: 2 });
    assert.match(id, /60\/100/);
    assert.match(id, /Tanpa AI/);
    assert.doesNotMatch(id, /skor awal/);
    const en = t("localSignalTextLocal", "en", { score: 60, status: "Scam", n: 2 });
    assert.match(en, /60\/100/);
    assert.match(en, /No AI/);
  });
  it("receiptTimeLocal exists ID+EN (no fake 0,0 detik)", () => {
    assert.match(t("receiptTimeLocal", "id"), /tanpa menunggu AI/);
    assert.match(t("receiptTimeLocal", "en"), /no AI wait/);
  });
  it("linkUnresolvedNote exists ID+EN (honest bit.ly note)", () => {
    assert.match(t("linkUnresolvedNote", "id"), /tidak bisa dilacak/);
    assert.match(t("linkUnresolvedNote", "en"), /could not be traced/);
  });
  it("removed keys are gone EN+ID (no dangling t() lookups)", () => {
    for (const k of ["reportCountSkipped", "receiptSkipped"]) {
      assert.equal(t(k, "id"), k);
      assert.equal(t(k, "en"), k);
    }
  });
  it("OJK report links go to the IASC report form, not the homepage (hero source is the press release, see audit 4)", () => {
    const contacts = readSrc("src/contacts.js");
    const html = readSrc("index.html");
    assert.match(contacts, /https:\/\/iasc\.ojk\.go\.id\/Guest\/LaporanV2/);
    assert.match(html, /ojk\.go\.id\/id\/berita-dan-kegiatan\/siaran-pers\/Pages\/OJK-dan-Bareskrim-Polri-Sepakat-Perkuat-Kolaborasi/);
    assert.doesNotMatch(contacts, /https:\/\/iasc\.ojk\.go\.id\/"/);
    assert.doesNotMatch(html, /https:\/\/iasc\.ojk\.go\.id\/"/);
  });
  it("main.js no longer gates lookups on local-only, and re-scores resolved short links", () => {
    const mainJs = readSrc("src/main.js");
    assert.doesNotMatch(mainJs, /reportCountSkipped|receiptSkipped/);
    assert.doesNotMatch(mainJs, /allowReports: !isLocalOnly\(\)/);
    assert.match(mainJs, /analyzeLink\(r\.finalUrl\)/);
    assert.match(mainJs, /analyzeLink\(finalUrl\)/);
    assert.match(mainJs, /localSignalTextLocal/);
    assert.match(mainJs, /receiptTimeLocal/);
    assert.match(mainJs, /updateModeLabel\(\)/);
  });
});

describe("file type display label (21 Nov fix)", () => {
  it("a .pdf shows PDF, not the doc category", () => {
    assert.equal(fileTypeDisplay({ kind: "doc", fileName: "laporan.pdf" }), "PDF");
    assert.equal(fileTypeDisplay({ kind: "doc", fileName: "laporan.docx" }), "DOCX");
  });
  it("magic-confirmed apk/exe win over a disguise extension", () => {
    assert.equal(fileTypeDisplay({ kind: "exe", fileName: "laporan.pdf.exe" }), "EXE");
    assert.equal(fileTypeDisplay({ kind: "exe", fileName: "laporan.pdf" }), "EXE");
    assert.equal(fileTypeDisplay({ kind: "apk", fileName: "undangan-nikah.apk" }), "APK");
  });
  it("archive/text kinds show the real extension", () => {
    assert.equal(fileTypeDisplay({ kind: "archive", fileName: "data.zip" }), "ZIP");
    assert.equal(fileTypeDisplay({ kind: "text", fileName: "pesan.txt" }), "TXT");
  });
  it("a name without an extension keeps the kind", () => {
    assert.equal(fileTypeDisplay({ kind: "unknown", fileName: "laporan" }), "unknown");
  });
});

const LANG_CODES = LANGUAGES.map((l) => l.code);
const INDEX_HTML = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "index.html"),
  "utf8",
);
const MAIN_JS = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "main.js"),
  "utf8",
);

describe("hero OJK stat (polish 19 Nov)", () => {
  it("heroStat exists in both languages with the Devpost numbers", () => {
    for (const code of LANG_CODES) {
      const s = t("heroStat", code);
      assert.notEqual(s, "heroStat", `${code}: key missing`);
      assert.ok(/Rp/.test(s), `${code}: no Rp — ${s}`);
      // Audit 5: exactly as the OJK press release writes it — "Rp9
      // triliun", never the rounded "9,1/9.1".
      assert.ok(/Rp9/.test(s), `${code}: no Rp9 — ${s}`);
      assert.ok(!/9[,.]1/.test(s), `${code}: still 9.1/9,1 — ${s}`);
      assert.ok(/411[.,]000\+/.test(s), `${code}: no 411.000+/411,000+ — ${s}`);
      assert.ok(/OJK \(IASC\)/.test(s), `${code}: no OJK (IASC) — ${s}`);
      assert.ok(/2024/.test(s) && /2025/.test(s), `${code}: no Nov 2024–Dec 2025 — ${s}`);
    }
  });
  it("Indonesian stat matches DEVPOST-DESCRIPTION.md exactly", () => {
    assert.equal(
      t("heroStat", "id"),
      "Rp9 triliun kerugian penipuan dari 411.000+ laporan · Nov 2024–Des 2025 · OJK (IASC)",
    );
  });
  it("English stat matches the Devpost wording", () => {
    assert.equal(
      t("heroStat", "en"),
      "Rp9 trillion (~US$500 million) lost to scams in 411,000+ reports · Nov 2024–Dec 2025 · OJK (IASC)",
    );
  });
});

describe("module tabs (polish 19 Nov)", () => {
  const TAB_KEYS = [
    "moduleTabsLabel",
    "moduleTabFile",
    "moduleTabLink",
    "moduleTabContacts",
    "moduleTabAid",
    "moduleTabChatlog",
    "moduleTabQuiz",
    "moduleTabAssistant",
    "moduleTabReport",
    "moduleTabHow",
  ];
  it("every module-tab label exists in both languages", () => {
    for (const key of TAB_KEYS) {
      for (const code of LANG_CODES) {
        const s = t(key, code);
        assert.ok(typeof s === "string" && s.length > 0 && s !== key, `${key} missing in ${code}`);
      }
    }
  });
  it("index.html has 9 module-tab buttons + 9 tabpanels + Aman dialog panel, link first", () => {
    const btns = [...INDEX_HTML.matchAll(/id="module-tab-([a-z]+)"/g)].map((m) => m[1]);
    // No "assistant" tab (Myuden 20 Nov 20:50): the round floating
    // launcher is the only door to Aman.
    // Tab order (Myuden 20 Nov 21:23): link, file, chatlog, report,
    // contacts, aid, quiz, how — most-used checks first.
    // (21 Nov 11:22, Myuden: the Riwayat card was removed from the
    // grid — Riwayat opens only from the bottom nav, so the grid
    // shows 8 tools.)
    // (23 Nov 2026: the QR check joins as the 9th tool, right after
    // Cek File — it is a check tool like file and link.)
    assert.deepEqual(btns, ["link", "file", "qr", "chatlog", "report", "contacts", "aid", "quiz", "how"]);
    assert.ok(!INDEX_HTML.includes('id="module-tab-assistant"'), "the Tanya Aman module tab must be gone");
    // Panels stay in their original section order in the document;
    // the buttons above are what the user sees and navigates.
    const panels = [...INDEX_HTML.matchAll(/role="tabpanel" aria-labelledby="module-tab-([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(panels, ["file", "qr", "link", "contacts", "aid", "report", "chatlog", "quiz", "how"]);
    // Aman is a dialog panel (20 Nov), not a tabpanel.
    assert.ok(INDEX_HTML.includes('id="assistant" class="card assistant aman-panel module-panel" role="dialog"'), "Aman panel must be a dialog");
    // Only the link panel is visible by default; the rest start hidden.
    const hiddenPanels = [...INDEX_HTML.matchAll(/aria-labelledby="module-tab-([a-z]+)" hidden/g)].map((m) => m[1]);
    assert.deepEqual(hiddenPanels, ["file", "qr", "contacts", "aid", "report", "chatlog", "quiz", "how"]);
  });
  it("message tab is a plain form (Myuden 21 Nov 18:01): sample chips, then the composer — no chat thread", () => {
    assert.ok(!INDEX_HTML.includes('id="chat-thread"'), "the chat thread must be gone");
    const samplesAt = INDEX_HTML.indexOf('id="samples"');
    const checkAt = INDEX_HTML.indexOf('id="check-btn"');
    assert.ok(samplesAt > 0 && checkAt > 0, "samples and send button must exist");
    assert.ok(samplesAt < checkAt, "sample chips must precede the send button");
  });
});

describe("plain language: tabs, badges, no jargon (Myuden 19 Nov 17:44)", () => {
  it("tab labels are plain words a layperson understands (EN + ID exact)", () => {
    const labels = {
      messageTab: ["Check message", "Cek Pesan"],
      emailTab: ["Check email", "Cek Email"],
      callTab: ["Check number", "Cek Nomor"],
      moduleTabFile: ["Check file", "Cek File"],
      moduleTabLink: ["Check link", "Cek Tautan"],
      moduleTabReport: ["Report", "Laporkan"],
      moduleTabChatlog: ["Check chat", "Cek Chat"],
      moduleTabContacts: ["Official contacts", "Kontak Resmi"],
      moduleTabAid: ["Emergency guide", "Panduan Darurat"],
    };
    for (const [key, [en, id]] of Object.entries(labels)) {
      assert.equal(t(key, "en"), en, key);
      assert.equal(t(key, "id"), id, key);
    }
  });
  it("answer badges say in plain words where the answer came from (EN + ID exact)", () => {
    assert.equal(t("badgeDevice", "en"), "Answered on this device, private");
    assert.equal(t("badgeDevice", "id"), "Dijawab di perangkat ini, privat");
    assert.equal(t("badgeCloud", "en"), "Answered in the cloud");
    assert.equal(t("badgeCloud", "id"), "Dijawab di cloud");
    assert.equal(t("badgeLocal", "en"), "Checked on your device");
    assert.equal(t("badgeLocal", "id"), "Diperiksa di perangkat Anda");
    assert.equal(t("badgeDemo", "en"), "Demo check — local only");
    assert.equal(t("badgeDemo", "id"), "Cek demo — lokal saja");
    // The internal source codes (ON_DEVICE / IN_CLOUD / LOCAL) are never
    // shown to the user — they live in src/ai.js only.
    for (const key of ["badgeDevice", "badgeCloud", "badgeLocal", "badgeDemo", "badgeUnknown"]) {
      for (const code of LANG_CODES) {
        const s = t(key, code);
        assert.ok(!/ON_DEVICE|IN_CLOUD/.test(s), `${key}/${code} leaks a source code: ${s}`);
      }
    }
  });
  it("main.js renders plain badges, never the source codes or SHA-256", () => {
    assert.ok(MAIN_JS.includes('t("badgeDemo"'), "DEMO badge must use badgeDemo");
    assert.ok(!MAIN_JS.includes("ON_DEVICE — "), "badge must not print the ON_DEVICE code");
    assert.ok(!MAIN_JS.includes("IN_CLOUD — "), "badge must not print the IN_CLOUD code");
    assert.ok(!MAIN_JS.includes("LOCAL — "), "badge must not print the LOCAL code");
    // Jargon check runs over rendered strings only: code comments and
    // the internal `rdap` variable name are not user-visible, so strip
    // comments first (a comment may still document the data sent).
    const codeOnly = MAIN_JS
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1");
    assert.ok(!codeOnly.includes("SHA-256"), "file check must not print SHA-256");
    assert.ok(!codeOnly.includes("rdap.org"), "link check must not print rdap.org");
    assert.ok(MAIN_JS.includes('t("fileFingerprintLabel"'), "file fingerprint uses the plain label");
  });
  it("no user-visible string contains jargon (EN + ID sweep over all keys)", () => {
    // Banned on the UI surface (Myuden 19 Nov 17:44): model names,
    // registry URLs, hash names, platform names, source codes.
    const banned = [
      "SHA-256", "rdap.org", "Gemini", "gemini-3.5", "Firebase AI Logic",
      "Gemini Nano", "App Check", "ON_DEVICE", "IN_CLOUD", "for inference",
      "Firebase",
    ];
    // Deliberate exception (Myuden 23 Nov 2026): the footer tech credit
    // names the stack ("Built with Firebase AI Logic + Gemini") so judges
    // see it at a glance. It is a footer attribution, not a verdict or
    // instruction — plain-language rules still apply everywhere else.
    const allowedJargonKeys = new Set(["footerTech"]);
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n.js"),
      "utf8",
    );
    const s0 = src.indexOf("const STRINGS = {");
    const s1 = src.indexOf("\n};", s0);
    const enBlock = src.slice(s0, s1).split("  id: {")[0];
    const keys = [...new Set([...enBlock.matchAll(/^\s*"?([A-Za-z0-9_]+)"?\s*:/gm)].map((m) => m[1]))];
    assert.ok(keys.length > 300, `only ${keys.length} keys found`);
    for (const key of keys) {
      if (allowedJargonKeys.has(key)) continue;
      for (const code of ["en", "id"]) {
        const v = t(key, code);
        for (const b of banned) {
          assert.ok(!v.includes(b), `${key}/${code} contains jargon ${JSON.stringify(b)}: ${v.slice(0, 80)}`);
        }
      }
    }
  });
  it("file fingerprint label is plain in both languages", () => {
    assert.equal(t("fileFingerprintLabel", "en"), "File fingerprint");
    assert.equal(t("fileFingerprintLabel", "id"), "Sidik file");
    for (const code of LANG_CODES) {
      const s = t("fileFingerprintLabel", code);
      assert.ok(typeof s === "string" && s.length > 0 && s !== "fileFingerprintLabel", code);
    }
  });
});

describe("static fallback is Bahasa Indonesia (polish 19 Nov)", () => {
  it("every data-i18n key in index.html resolves in both languages", () => {
    const keys = new Set([...INDEX_HTML.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
    assert.ok(keys.size > 50, `only ${keys.size} data-i18n keys found`);
    for (const key of keys) {
      for (const code of LANG_CODES) {
        assert.notEqual(t(key, code), key, `${key} missing in ${code}`);
      }
    }
  });
  it("every data-i18n-placeholder key resolves in both languages", () => {
    const keys = new Set([...INDEX_HTML.matchAll(/data-i18n-placeholder="([^"]+)"/g)].map((m) => m[1]));
    assert.ok(keys.size >= 5, `only ${keys.size} placeholder keys found`);
    for (const key of keys) {
      for (const code of LANG_CODES) {
        assert.notEqual(t(key, code), key, `${key} missing in ${code}`);
      }
    }
  });
  it("html lang is id and the hero fallback is Indonesian", () => {
    assert.ok(INDEX_HTML.includes('<html lang="id">'), "html lang must be id");
    // Check the rendered fallback text (element content), not the
    // bilingual og/twitter meta descriptions, which keep both languages.
    assert.ok(INDEX_HTML.includes('data-i18n="heroTitle">Apakah pesan ini penipuan?<'), "hero title fallback must be Indonesian");
    assert.ok(INDEX_HTML.includes('data-i18n="checkerHeading">Periksa pesan mencurigakan<'), "checker heading fallback must be Indonesian");
    assert.ok(INDEX_HTML.includes('placeholder="Tulis pesan mencurigakan…"'), "placeholder fallback must be Indonesian");
    assert.ok(!INDEX_HTML.includes('>Is this message a scam?<'), "no English hero title fallback");
  });
  it("checksNote still says a voice call CAN be checked (fixed 17:04, do not change)", () => {
    assert.ok(
      t("checksNote", "en").includes("A voice call can be checked"),
      t("checksNote", "en"),
    );
    assert.ok(
      t("checksNote", "id").includes("Panggilan suara bisa diperiksa"),
      t("checksNote", "id"),
    );
  });
});

describe("crowd report validation (lapor-balik, 19 Nov)", () => {
  const DETAILS = "Penipu mengaku dari bank, minta kode OTP lalu minta transfer ke rekening aman.";
  it("valid Indonesian phone formats pass (08, +62, 62, spaces/dashes)", () => {
    for (const v of ["081234567890", "+6281234567890", "6281234567890", "0812 3456 7890", "0812-3456-7890"]) {
      assert.deepEqual(validateCrowdReport({ type: "phone", value: v, details: DETAILS }), {}, v);
    }
  });
  it("invalid phones fail: landline, too short, too long, letters, wrong prefix", () => {
    for (const v of ["0211234567", "08123456", "08123456789012345", "0812abc7890", "071234567890", "621234567890"]) {
      const e = validateCrowdReport({ type: "phone", value: v, details: DETAILS });
      assert.equal(e.value, "crowdErrPhone", `${v} -> ${JSON.stringify(e)}`);
    }
  });
  it("account: digits only, 8–20 digits", () => {
    assert.deepEqual(validateCrowdReport({ type: "account", value: "12345678", details: DETAILS }), {});
    assert.deepEqual(validateCrowdReport({ type: "account", value: "1234 5678 9012 3456 7890", details: DETAILS }), {});
    assert.equal(validateCrowdReport({ type: "account", value: "1234567", details: DETAILS }).value, "crowdErrAccount");
    assert.equal(validateCrowdReport({ type: "account", value: "123456789012345678901", details: DETAILS }).value, "crowdErrAccount");
    assert.equal(validateCrowdReport({ type: "account", value: "1234abcd", details: DETAILS }).value, "crowdErrAccount");
  });
  it("details: 10–500 chars (9 fails, 10 passes, 500 passes, 501 fails)", () => {
    const ok10 = "a".repeat(10);
    const ok500 = "a".repeat(500);
    assert.deepEqual(validateCrowdReport({ type: "phone", value: "081234567890", details: ok10 }), {});
    assert.deepEqual(validateCrowdReport({ type: "phone", value: "081234567890", details: ok500 }), {});
    assert.equal(validateCrowdReport({ type: "phone", value: "081234567890", details: "a".repeat(9) }).details, "crowdErrDetails");
    assert.equal(validateCrowdReport({ type: "phone", value: "081234567890", details: "a".repeat(501) }).details, "crowdErrDetails");
  });
  it("mode value: 3–100 chars (2 fails, 3 passes, 101 fails)", () => {
    assert.deepEqual(validateCrowdReport({ type: "mode", value: "APK", details: DETAILS }), {});
    assert.equal(validateCrowdReport({ type: "mode", value: "AB", details: DETAILS }).value, "crowdErrMode");
    assert.equal(validateCrowdReport({ type: "mode", value: "a".repeat(101), details: DETAILS }).value, "crowdErrMode");
  });
  it("message value: 10–2000 chars (9 fails, 10 passes, 2000 passes, 2001 fails)", () => {
    assert.deepEqual(validateCrowdReport({ type: "message", value: "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel.", details: DETAILS }), {});
    assert.deepEqual(validateCrowdReport({ type: "message", value: "a".repeat(10), details: DETAILS }), {});
    assert.deepEqual(validateCrowdReport({ type: "message", value: "a".repeat(2000), details: DETAILS }), {});
    assert.equal(validateCrowdReport({ type: "message", value: "a".repeat(9), details: DETAILS }).value, "crowdErrMessage");
    assert.equal(validateCrowdReport({ type: "message", value: "a".repeat(2001), details: DETAILS }).value, "crowdErrMessage");
  });
  it("file value: 1–100 chars (100 passes, 101 fails); unknown type rejected", () => {
    assert.deepEqual(validateCrowdReport({ type: "file", value: "undangan-nikah.apk", details: DETAILS }), {});
    assert.deepEqual(validateCrowdReport({ type: "file", value: "a".repeat(100), details: DETAILS }), {});
    assert.equal(validateCrowdReport({ type: "file", value: "a".repeat(101), details: DETAILS }).value, "crowdErrFile");
    assert.equal(validateCrowdReport({ type: "link", value: "https://x.xyz", details: DETAILS }).value, "crowdErrValueRequired");
  });
  it("empty value reports the required error per field", () => {
    const e = validateCrowdReport({ type: "phone", value: "   ", details: "" });
    assert.equal(e.value, "crowdErrValueRequired");
    assert.equal(e.details, "crowdErrDetails");
  });
  it("normalizers strip separators before validation/storage", () => {
    assert.equal(normalizeCrowdPhone("+62 812-3456.7890"), "+6281234567890");
    assert.equal(normalizeCrowdAccount("1234 5678-90"), "1234567890");
  });
  it("local record helpers never throw without localStorage (Node)", () => {
    assert.deepEqual(loadLocalReports(), []);
    recordLocalReport({ type: "phone", value: "081234567890", details: DETAILS, createdAt: new Date().toISOString() });
    assert.deepEqual(loadLocalReports(), []);
  });
  it("crowd form strings exist in both languages (incl. JS-set labels)", () => {
    for (const key of ["crowdValuePhone", "crowdValueAccount", "crowdValueMode", "crowdValuePhPhone", "crowdValuePhAccount", "crowdValuePhMode", "crowdSubmitting", "crowdThanks", "crowdReceipt", "crowdPrivacy"]) {
      for (const code of LANG_CODES) {
        assert.notEqual(t(key, code), key, `${key} missing in ${code}`);
      }
    }
  });
});

describe("resolveShortLink reports whether the redirect was followed (honest label, 19 Nov)", () => {
  let server;
  let base;
  before(async () => {
    server = createServer((req, res) => {
      if (req.url === "/short") {
        res.writeHead(302, { Location: "/target" });
        res.end();
      } else if (req.url === "/target" || req.url === "/plain") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
  });

  it("redirect followed: finalUrl is the target, resolved true", async () => {
    const r = await resolveShortLink(`${base}/short`);
    assert.equal(r.resolved, true);
    assert.equal(r.finalUrl, `${base}/target`);
    assert.equal(r.error, undefined);
  });
  it("no redirect: finalUrl equals the input, still resolved true (the fetch confirmed it)", async () => {
    const r = await resolveShortLink(`${base}/plain`);
    assert.equal(r.resolved, true);
    assert.equal(r.finalUrl, `${base}/plain`);
  });
  it("blocked follow (connection refused): no finalUrl, resolved false, error unresolvable", async () => {
    const r = await resolveShortLink("http://127.0.0.1:1/x");
    assert.equal(r.resolved, false);
    assert.equal(r.error, "unresolvable");
    assert.equal(r.finalUrl, undefined);
  });
  it("honest-label keys exist with real text in both languages", () => {
    for (const key of ["linkFinal", "linkFinalUnresolved", "linktrackFinal", "linktrackFinalUnresolved"]) {
      for (const code of LANG_CODES) {
        const v = t(key, code);
        assert.notEqual(v, key, `${key} missing in ${code}`);
        assert.ok(v.trim().length > 0, `${key} empty in ${code}`);
        assert.notEqual(v, "undefined", `${key} undefined in ${code}`);
      }
    }
    // The two labels must differ: "final destination" is only for a
    // follow that really happened, "link you entered" for one that did not.
    for (const code of LANG_CODES) {
      assert.notEqual(t("linkFinal", code), t("linkFinalUnresolved", code), `labels identical in ${code}`);
      assert.notEqual(t("linktrackFinal", code), t("linktrackFinalUnresolved", code), `linktrack labels identical in ${code}`);
    }
  });
});

describe("i18n completeness: every key in both languages, non-empty, placeholders match (19 Nov)", () => {
  // The STRINGS/DEMO tables are not exported, so the test parses the
  // source of truth (src/i18n.js) directly. Values are double-quoted
  // (no escaped double quotes inside — verified), so one regex covers
  // single- and multi-line entries.
  const SRC = readFileSync(new URL("../src/i18n.js", import.meta.url), "utf8");
  const ENTRY = /(?:\"([^\"]+)\"|([A-Za-z0-9_]+))\s*:\s*\"((?:[^\"\\]|\\.)*)\"/g;
  function langBlocks(section) {
    const starts = [...section.matchAll(/^  (en|id|es|fr|de|pt|ja|zh): \{$/gm)];
    const out = {};
    for (let i = 0; i < starts.length; i++) {
      const body = section.slice(starts[i].index, starts[i + 1]?.index ?? section.length);
      out[starts[i][1]] = new Map(
        [...body.matchAll(ENTRY)].map((m) => [m[1] ?? m[2], m[3]]),
      );
    }
    return out;
  }
  const stringsSection = SRC.slice(SRC.indexOf("const STRINGS = {"), SRC.indexOf("const DEMO = {"));
  const demoSection = SRC.slice(SRC.indexOf("const DEMO = {"), SRC.indexOf("export function t("));
  const STR = langBlocks(stringsSection);
  const DEMO = langBlocks(demoSection);
  const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

  it("STRINGS: same key set in both languages, every value a non-empty string", () => {
    const ref = [...STR.en.keys()];
    assert.ok(ref.length > 300, `en has only ${ref.length} keys`);
    for (const code of LANG_CODES) {
      assert.deepEqual([...STR[code].keys()].sort(), [...ref].sort(), `key set differs in ${code}`);
      for (const [k, v] of STR[code]) {
        assert.ok(typeof v === "string" && v.trim().length > 0, `${k} empty in ${code}`);
        assert.notEqual(v.trim(), "undefined", `${k} is "undefined" in ${code}`);
      }
    }
  });
  it("STRINGS: placeholders identical to English in every language", () => {
    for (const code of LANG_CODES) {
      if (code === "en") continue;
      for (const k of STR.en.keys()) {
        assert.equal(
          placeholders(STR[code].get(k)),
          placeholders(STR.en.get(k)),
          `${k} placeholders differ in ${code}`,
        );
      }
    }
  });
  it("DEMO: summaries complete in both languages; flags complete in id (empty in en by design)", () => {
    for (const code of LANG_CODES) {
      for (const status of ["scam", "suspicious", "safe"]) {
        const v = DEMO[code].get(status);
        assert.ok(typeof v === "string" && v.trim().length > 0, `demo summary ${status} missing/empty in ${code}`);
      }
    }
    // en.flags is empty by design (demoFlag returns the English flag as-is).
    assert.equal(DEMO.en.size, 3, "en DEMO should hold only the 3 summaries");
    const refFlags = [...DEMO.id.keys()].filter((k) => !["scam", "suspicious", "safe"].includes(k));
    assert.ok(refFlags.length > 0, "id DEMO flags missing");
    for (const k of refFlags) {
      assert.ok(DEMO.id.get(k).trim().length > 0, `demo flag empty in id: ${k}`);
    }
  });
});

describe("language switch: per-language samples + re-check (bugs 1+2, 19 Nov)", () => {
  const SAMPLE_KEYS = [
    "sampleTextScam",
    "sampleTextSuspicious",
    "sampleTextSafe",
    "sampleTextApk",
    "sampleTextJob",
    "sampleTextOtp",
  ];
  it("rechecking key exists in both languages, non-empty, never the key itself", () => {
    for (const code of LANG_CODES) {
      const s = t("rechecking", code);
      assert.notEqual(s, "rechecking", code);
      assert.ok(s.trim().length > 0, code);
    }
  });
  it("every sample text exists in both languages, non-empty, and differs per language", () => {
    for (const key of SAMPLE_KEYS) {
      const seen = new Set();
      for (const code of LANG_CODES) {
        const s = t(key, code);
        assert.notEqual(s, key, `${key} missing in ${code}`);
        assert.ok(s.trim().length > 20, `${key} too short in ${code}: ${s}`);
        seen.add(s);
      }
      // One natural text per language: no two languages share a body.
      assert.equal(seen.size, LANG_CODES.length, `${key} repeats across languages`);
    }
  });
  it("English samples contain no Indonesian text; Indonesian samples contain no English body", () => {
    const idMarkers = /SELAMAT|hadiah|Telkomsel|undian|Rp |BCA|Kode OTP|kurir|kantor|pernikahan|LOWONGAN/;
    // Exception (Myuden 20 Nov): the OTP sample keeps the BCA case
    // identity in every language — bank name BCA + the Indonesian
    // number 0812-9876-5432 + the code 482916 — only the prose is
    // translated. "Bank of America / +1 (555)" invented a different
    // case, so it was replaced by the BCA translation.
    for (const key of SAMPLE_KEYS) {
      if (key === "sampleTextOtp") continue;
      assert.ok(!idMarkers.test(t(key, "en")), `${key}/en leaks Indonesian: ${t(key, "en").slice(0, 80)}`);
    }
    assert.ok(/BCA: Your OTP code is 482916/.test(t("sampleTextOtp", "en")), `en OTP must keep the BCA case: ${t("sampleTextOtp", "en").slice(0, 80)}`);
    assert.ok(/0812-9876-5432/.test(t("sampleTextOtp", "en")), "en OTP must keep the Indonesian number");
    assert.ok(!/Bank of America|\+1 \(555\)/.test(t("sampleTextOtp", "en")), "en OTP must not invent a US bank/number");
    assert.ok(/SELAMAT/.test(t("sampleTextScam", "id")), "id scam must keep SELAMAT");
    assert.ok(/Rp 50\.000\.000/.test(t("sampleTextScam", "id")), "id scam must keep the Rp amount");
    assert.ok(!/Your package is held|team meeting is moved/.test(t("sampleTextSuspicious", "id")), "id suspicious must not be the English DHL text");
    assert.ok(!/team meeting is moved/.test(t("sampleTextSafe", "id")), "id safe must not be the English office text");
    assert.ok(/Sari dari kantor/.test(t("sampleTextSafe", "id")), "id safe must be the Indonesian office text");
  });
  it("ID/EN scam samples open in their own language, never the other's opener", () => {
    assert.ok(/SELAMAT/.test(t("sampleTextScam", "id")), `id scam opener missing: ${t("sampleTextScam", "id").slice(0, 60)}`);
    assert.ok(!/CONGRATULATIONS/.test(t("sampleTextScam", "id")), "id scam leaks the English opener");
    assert.ok(/CONGRATULATIONS/.test(t("sampleTextScam", "en")), `en scam opener missing: ${t("sampleTextScam", "en").slice(0, 60)}`);
    assert.ok(!/SELAMAT/.test(t("sampleTextScam", "en")), "en scam leaks the Indonesian opener");
 
  });
  it("heuristic verdicts pinned for EN + ID (the two languages the demo rules cover)", () => {
    // Measured 19 Nov; the demo heuristic is ID/EN-only by design
    // (src/ai.js), so only these two languages are pinned here.
    // Updated 23 Nov 2026 regression: the job + OTP samples are now
    // correctly scam (deposit-demanding job; OTP telling you to call
    // a random mobile), the EN scam sample is 88 (fee 16 -> 18), and
    // the suspicious samples are the J&T courier texts (30) — the old
    // DHL text is scam 60 under the rules now.
    const pinned = [
      ["en", "sampleTextScam", "scam", 88],
      ["id", "sampleTextScam", "scam", 100],
      ["en", "sampleTextSuspicious", "suspicious", 30],
      ["id", "sampleTextSuspicious", "suspicious", 30],
      ["en", "sampleTextSafe", "safe", 0],
      ["id", "sampleTextSafe", "safe", 0],
      ["en", "sampleTextApk", "scam", 75],
      ["id", "sampleTextApk", "scam", 75],
      ["en", "sampleTextJob", "scam", 74],
      ["id", "sampleTextJob", "scam", 74],
      ["en", "sampleTextOtp", "scam", 60],
      ["id", "sampleTextOtp", "scam", 60],
    ];
    for (const [code, key, status, score] of pinned) {
      const v = analyzeWithHeuristic(t(key, code), code);
      assert.equal(v.status, status, `${code}/${key}`);
      assert.equal(v.riskScore, score, `${code}/${key} score`);
    }
  });
  it("demo verdict re-run in a new language keeps status+score, translates summary+flags (bug 2, demo path)", () => {
    // The J&T courier message (the suspicious sample), checked in EN
    // then re-run in ID.
    const dhlEn = t("sampleTextSuspicious", "en");
    const en = analyzeWithHeuristic(dhlEn, "en");
    const id = analyzeWithHeuristic(dhlEn, "id");
    assert.equal(id.status, en.status);
    assert.equal(id.riskScore, en.riskScore);
    assert.equal(id.summary, demoSummary(en.status, "id"));
    assert.ok(/This message/.test(en.summary), en.summary);
    assert.ok(/Pesan ini/.test(id.summary), id.summary);
    assert.equal(id.redFlags.length, en.redFlags.length);
    // No English flag text may survive into the Indonesian verdict.
    for (const f of id.redFlags) {
      assert.ok(
        !/Urgency|Prize|Suspicious or shortened|Asks for money|Impersonates|Family \/ known|Too-good|download an app|Fee or tax|Phishing-style|Multiple links/.test(f),
        `id flag leaks English: ${f}`,
      );
    }
  });
  it("main.js wires samples per language and re-checks on language change (static pins)", () => {
    assert.ok(MAIN_JS.includes("textKey"), "SAMPLES must carry a per-language textKey");
    assert.ok(!MAIN_JS.includes('text: "SELAMAT'), "no hard-coded Indonesian sample body may remain");
    assert.ok(!MAIN_JS.includes("DHL courier. Your package is held"), "no hard-coded English sample body may remain");
    assert.ok(MAIN_JS.includes("recheckLastCheck"), "language change must trigger a re-check");
    assert.ok(MAIN_JS.includes('t("rechecking"'), "re-check must show a progress status");
    assert.ok(MAIN_JS.includes("recheckAfterCheck"), "language change during a running check must queue a re-check");
    // History: the re-check must not re-record (no saveCheck inside it).
    const recheckBody = MAIN_JS.slice(
      MAIN_JS.indexOf("async function recheckLastCheck()"),
      MAIN_JS.indexOf("// Screenshot check:"),
    );
    assert.ok(!recheckBody.includes("saveCheck"), "re-check must not call saveCheck (no duplicate history entry)");
    // Audit 19 Nov: history items must show the plain-language source
    // label (e.g. "Answered in the cloud"), never the raw source code
    // (IN_CLOUD / ON_DEVICE).
    assert.ok(
      MAIN_JS.includes("function sourceLabel(source)"),
      "sourceLabel helper must exist",
    );
    assert.ok(
      MAIN_JS.includes("sourceLabel(e.source)"),
      "history items must render sourceLabel(e.source)",
    );
    assert.ok(
      !MAIN_JS.includes('<span class="history-source">${escapeHtml(e.source'),
      "history items must never render the raw source code",
    );
    // Audit 19 Nov: the verdict cache must never store a demo result —
    // every cache write is production-only (isFirebaseConfigured()).
    for (const call of [
      'verdictCacheSet("message"',
      'verdictCacheSet("image"',
      "verdictCacheSet(kind, message, lang",
    ]) {
      const at = MAIN_JS.indexOf(call);
      assert.ok(at > 0, `cache write must exist: ${call}`);
      assert.ok(
        MAIN_JS.slice(Math.max(0, at - 200), at).includes("isFirebaseConfigured()"),
        `cache write must be guarded by isFirebaseConfigured(): ${call}`,
      );
    }
  });
});

describe("polish 19 Nov 20:25: honest history, Mode AI label, Anda, Aman FAB", () => {
  const I18N_SRC = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n.js"),
    "utf8",
  );
  const STYLES = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles.css"),
    "utf8",
  );
  const idBlock = I18N_SRC.slice(I18N_SRC.indexOf("  id: {"), I18N_SRC.indexOf("const DEMO"));

  it("(1) history strings are honest in both languages: no 'not configured yet'", () => {
    const stale = /sampai AI tersambung|until the AI is connected|hasta conectar la IA|jusqu'à la connexion de l'IA|bis die KI verbunden ist|até conectar a IA|AIに接続するまで|在连接 AI 之前|not configured|belum dikonfigurasi|no configurado|non configuré|nicht konfiguriert|não configurado|未設定|未配置|Firebase/;
    for (const code of LANG_CODES) {
      assert.ok(!stale.test(t("historyLocalNote", code)), `historyLocalNote/${code} still claims unconfigured: ${t("historyLocalNote", code)}`);
      assert.ok(!stale.test(t("storageLocal", code)), `storageLocal/${code} still claims unconfigured: ${t("storageLocal", code)}`);
      assert.ok(t("historyLocalNote", code).trim().length > 10, code);
      assert.ok(t("storageLocal", code).trim().length > 5, code);
    }
    assert.equal(
      t("historyLocalNote", "id"),
      "Riwayat hanya tersimpan di browser ini. Selama pengaturan ini aktif, tidak ada yang dikirim ke cloud.",
    );
    assert.equal(
      t("historyLocalNote", "en"),
      "History is stored only in this browser. While this setting is on, nothing is sent to the cloud.",
    );
    assert.equal(t("storageLocal", "id"), "Disimpan lokal di browser ini.");
    assert.equal(t("storageLocal", "en"), "Saved locally in this browser.");
    // The static fallback in index.html must say the same honest thing.
    assert.ok(INDEX_HTML.includes("Riwayat hanya tersimpan di browser ini. Selama pengaturan ini aktif, tidak ada yang dikirim ke cloud."), "index.html storage-note fallback is stale");
    assert.ok(!INDEX_HTML.includes("sampai Firebase dikonfigurasi"), "index.html still says 'sampai Firebase dikonfigurasi'");
  });
  it("(2) static mode label is the production value 'Mode AI', never a demo claim", () => {
    const m = INDEX_HTML.match(/<span id="mode-label"[^>]*>([\s\S]*?)<\/span>/);
    assert.ok(m, "#mode-label span not found in index.html");
    assert.equal(m[1].trim(), "Mode AI");
    const banner = INDEX_HTML.match(/<div id="demo-banner"[^>]*hidden[^>]*>[\s\S]*?<\/div>/);
    assert.ok(banner, "hidden demo-banner block not found");
    const visible = INDEX_HTML.replace(banner[0], "");
    assert.doesNotMatch(visible, /demo mode|mode demo/i, "visible static text still claims a demo mode");
  });
  it("(3) Indonesian is uniformly 'Anda': zero 'kamu' anywhere", () => {
    assert.doesNotMatch(idBlock, /\bkamu\b|Kamu|Laporanmu|pribadimu|pesanmu|laporanmu/, "Indonesian i18n still has kamu/-mu");
    assert.doesNotMatch(INDEX_HTML, /kamu/i, "index.html still has kamu");
    assert.equal(t("tagline", "id"), "Cek pesannya sebelum Anda percaya");
    for (const key of ["crowdHint", "crowdPrivacy", "crowdThanks", "assistantGreeting"]) {
      assert.ok(/Anda/.test(t(key, "id")), `${key}/id must use Anda: ${t(key, "id").slice(0, 60)}`);
    }
  });
  it("(3) ID + EN: no formal/informal mix (Anda in ID, consistent EN)", () => {
    // Only 2 languages now (Myuden 21:32): Indonesian must stay Anda
    // throughout, English just needs to exist and stay English.
    assert.doesNotMatch(idBlock, /\bkamu\b|Kamu|Laporanmu|pribadimu|pesanmu|laporanmu/, "Indonesian i18n still has kamu/-mu");
    for (const key of ["crowdHint", "crowdPrivacy", "crowdThanks", "assistantGreeting"]) {
      assert.ok(/Anda/.test(t(key, "id")), `${key}/id must use Anda: ${t(key, "id").slice(0, 60)}`);
    }
    assert.ok(t("assistantGreeting", "en").trim().length > 0, "en greeting must exist");
    assert.ok(!/Anda|kamu/.test(t("assistantGreeting", "en")), "en greeting must not leak Indonesian");
  });
  it("(4) Aman launcher: round avatar button + panel wiring + 56px style (panel, 20 Nov)", () => {
    assert.ok(INDEX_HTML.includes('id="aman-fab"'), "index.html must have #aman-fab");
    assert.ok(INDEX_HTML.includes('<span class="visually-hidden" data-i18n="moduleTabAssistant">'), "launcher accessible name must follow the UI language");
    assert.ok(INDEX_HTML.includes('<img src="/aman.png" alt=""'), "launcher shows Aman's face, not a '?' icon");
    assert.ok(MAIN_JS.includes('$("aman-fab").addEventListener("click"'), "main.js must wire the launcher click");
    assert.ok(MAIN_JS.includes("openAmanPanel()"), "launcher must open the chat panel");
    assert.ok(MAIN_JS.includes("isAmanPanelOpen()"), "launcher toggles the panel");
    const ASSISTANT_JS = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "assistant.js"),
      "utf8",
    );
    assert.ok(ASSISTANT_JS.includes('input.focus({ preventScroll: true })'), "opening the panel must focus the question box");
    assert.ok(/\.aman-fab\s*\{[^}]*position:\s*fixed/s.test(STYLES), ".aman-fab must be position:fixed");
    assert.ok(/\.aman-fab\s*\{[^}]*width:\s*56px/s.test(STYLES), ".aman-fab must be a 56px round button");
    assert.ok(/\.aman-fab\s*\{[^}]*bottom:\s*84px/s.test(STYLES), ".aman-fab must sit above the bottom nav (bottom 84px)");
    assert.ok(/body\s*\{[^}]*padding-bottom:\s*96px/s.test(STYLES), "body must reserve bottom space so the launcher never covers the footer");
  });
});

describe("code-only fallback verdict (AI timeout fallback, 19 Nov)", () => {
  // The fallback must be EXACTLY the deterministic heuristic, only
  // re-labeled source "CODE" — nothing added, nothing inflated. The
  // UI renders it as a code result without an AI verdict.
  it("scam prize: same score/status/flags/summary as the heuristic, source CODE", () => {
    const h = analyzeWithHeuristic(SCAM_PRIZE, "en");
    const c = codeOnlyVerdict(SCAM_PRIZE, "en");
    assert.equal(c.source, "CODE");
    assert.equal(c.status, h.status);
    assert.equal(c.riskScore, h.riskScore);
    assert.deepEqual(c.redFlags, h.redFlags);
    assert.equal(c.summary, h.summary);
    assert.equal(c.status, "scam");
    assert.ok(c.riskScore >= 60);
  });
  it("OTP sample (Myuden's timed-out check): scam 60, source CODE", () => {
    // Was pinned suspicious 40 ("the code check cannot know BCA's
    // real number"). Superseded 23 Nov 2026 regression: the fix is
    // structural, not a number lookup — a genuine bank OTP never tells
    // you to call a mobile number. The fallback is scam 60, and the
    // card says it is code-only with a retry for the AI verdict.
    const c = codeOnlyVerdict(OTP_SAMPLE, "id");
    assert.equal(c.source, "CODE");
    assert.equal(c.status, "scam");
    assert.equal(c.riskScore, 60);
    assert.ok(c.redFlags.length >= 1);
  });
  it("ordinary office message: safe 0, source CODE, identical to heuristic", () => {
    const h = analyzeWithHeuristic(SAFE_OFFICE, "en");
    const c = codeOnlyVerdict(SAFE_OFFICE, "en");
    assert.deepEqual(
      { status: c.status, riskScore: c.riskScore, redFlags: c.redFlags, summary: c.summary },
      { status: h.status, riskScore: h.riskScore, redFlags: h.redFlags, summary: h.summary },
    );
    assert.equal(c.source, "CODE");
  });
  it("code-only strings exist in both languages, honest, retry named", () => {
    for (const code of LANG_CODES) {
      const badge = t("badgeCode", code);
      const note = t("codeOnlyNote", code, { retry: t("retryBtn", code) });
      const receipt = t("receiptCode", code);
      const noteU = t("codeOnlyNoteUnavailable", code, { retry: t("retryBtn", code) });
      const receiptU = t("receiptCodeUnavailable", code);
      for (const [key, v] of [["badgeCode", badge], ["codeOnlyNote", note], ["receiptCode", receipt], ["codeOnlyNoteUnavailable", noteU], ["receiptCodeUnavailable", receiptU]]) {
        assert.ok(typeof v === "string" && v.trim().length > 0, `${key} empty in ${code}`);
        assert.notEqual(v, key, `${key} untranslated in ${code}`);
        assert.doesNotMatch(v, /undefined/, `${key} has undefined in ${code}`);
        assert.doesNotMatch(v, /\{retry\}/, `${key} left {retry} unfilled in ${code}`);
      }
      // The note must name the retry button, so the user knows the
      // next step is one tap away.
      assert.ok(note.includes(t("retryBtn", code)), `codeOnlyNote must name the retry button in ${code}`);
      assert.ok(noteU.includes(t("retryBtn", code)), `codeOnlyNoteUnavailable must name the retry button in ${code}`);
      // The badge must say it is NOT an AI verdict (the honest label).
      // "AI" is abbreviated IA in ES/FR/PT and KI in DE.
      assert.ok(/AI|IA|KI/i.test(badge), `badgeCode must mention AI in ${code}: ${badge}`);
      assert.ok(/AI|IA|KI/i.test(receipt), `receiptCode must mention AI in ${code}`);
      assert.ok(/AI|IA|KI/i.test(receiptU), `receiptCodeUnavailable must mention AI in ${code}`);
      // Timeout wording carries the 30-second claim; the unavailable
      // wording must NEVER carry it (a 1-second App Check 403 is not
      // "did not answer within 30 seconds"). The two wordings must differ.
      assert.ok(note.includes("30"), `codeOnlyNote must carry the 30-second claim in ${code}`);
      assert.ok(!noteU.includes("30"), `codeOnlyNoteUnavailable must not claim 30 seconds in ${code}`);
      assert.notEqual(noteU, note, `unavailable note must differ from the timeout note in ${code}`);
      assert.notEqual(receiptU, receipt, `unavailable receipt must differ from the timeout receipt in ${code}`);
      if (code !== "en") assert.notEqual(badge, t("badgeCode", "en"), `badgeCode untranslated in ${code}`);
    }
  });
  it("mergeCallVerdict keeps source CODE when the AI slot is the fallback", async () => {
    const code = codeOnlyVerdict(SCAM_PRIZE, "en");
    const { verdict: localSafe } = await analyzeCall({ number: "", said: "rapat besok jam 10" }, "en");
    const merged = mergeCallVerdict(code, localSafe);
    assert.equal(merged.source, "CODE");
    assert.equal(merged.status, "scam");
    assert.ok(merged.riskScore >= 60);
    assert.ok(merged.redFlags.length >= 2);
  });
  it("main.js wires the fallback: CODE badge/note/retry, no cache of CODE, retry replaces", () => {
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    assert.ok(SRC.includes('source === "CODE"'), "main.js must branch on source CODE");
    assert.ok(SRC.includes('t("badgeCode"'), "main.js must use badgeCode");
    assert.ok(SRC.includes('"codeOnlyNote",'), "main.js must use codeOnlyNote");
    assert.ok(SRC.includes('"codeOnlyNoteUnavailable"'), "main.js must use codeOnlyNoteUnavailable for fast failures");
    assert.ok(SRC.includes('"receiptCode",'), "main.js must use receiptCode");
    assert.ok(SRC.includes('"receiptCodeUnavailable"'), "main.js must use receiptCodeUnavailable for fast failures");
    assert.ok(SRC.includes('id="retry-ai-btn"'), "fallback card must have a retry button");
    assert.ok(SRC.includes("codeOnlyVerdict("), "onCheck must build the fallback from the message");
    assert.ok(SRC.includes('? "timeout" : "unavailable"'), "onCheck must record timeout vs fast failure for the fallback wording");
    assert.ok(SRC.includes("Never cache the fallback"), "fallback must not be cached (retry must ask the AI again)");
    assert.ok(SRC.includes('$("result").hidden = true;'), "a failed fresh check must hide #result so no 'still loading' panel survives");
  });
});

describe("code-only reason: timeout vs fast failure (audit round 7, 20 Nov)", () => {
  // A fast failure (App Check 403, network) must never be described
  // as "did not answer within 30 seconds" — the card says the AI
  // could not be reached instead. Only a real timeout gets the
  // 30-second wording.
  it("codeOnlyVerdict defaults to timeout (backward compatible)", () => {
    const c = codeOnlyVerdict(SCAM_PRIZE, "en");
    assert.equal(c.codeOnlyReason, "timeout");
  });
  it("codeOnlyVerdict records unavailable when told so", () => {
    const c = codeOnlyVerdict(SCAM_PRIZE, "en", "unavailable");
    assert.equal(c.codeOnlyReason, "unavailable");
    assert.equal(c.source, "CODE");
  });
  it("codeOnlyVerdict normalizes an unknown reason to timeout", () => {
    const c = codeOnlyVerdict(SCAM_PRIZE, "en", "weird");
    assert.equal(c.codeOnlyReason, "timeout");
  });
  it("main.js wires the reason: timeout test in both fallbacks, unavailable keys in card + receipt", () => {
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    assert.ok(SRC.includes('? "timeout" : "unavailable"'), "both fallback sites must pass timeout vs unavailable");
    assert.ok(SRC.includes("codeOnlyNoteUnavailable"), "card must use codeOnlyNoteUnavailable for fast failures");
    assert.ok(SRC.includes("receiptCodeUnavailable"), "receipt must use receiptCodeUnavailable for fast failures");
    assert.ok(SRC.includes("codeOnlyReason"), "verdict must carry codeOnlyReason");
  });
  it("main.js hides a stale card on failed checks (image/email/call/transcription)", () => {
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    assert.ok(SRC.includes("function hideStaleResult()"), "hideStaleResult helper must exist");
    assert.ok(SRC.includes("hideStaleResult();"), "failed checks must hide the stale card");
  });
  it("main.js routes raw-error paths through the friendly error table", () => {
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    assert.ok(!SRC.includes('t("errorFailed"'), "no raw err.message headline may remain in main.js");
    assert.ok(SRC.includes("friendlyErrorMessage(err)"), "call audio fallback must use the friendly table");
  });
  it("toast adds bottom padding while shown so it never covers content", () => {
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    const CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    assert.ok(SRC.includes('classList.add("toast-visible")'), "showing the toast must mark the body");
    assert.ok(SRC.includes('classList.remove("toast-visible")'), "hiding the toast must unmark the body");
    assert.ok(CSS.includes("body.toast-visible .page"), "CSS must give the page bottom room while the toast shows");
  });
});

describe("audit MINOR M1/M2/M4 (21 Nov)", () => {
  it("M2: completion toast auto-hides after ~3 s, not 5 s, and the × close is wired", () => {
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    assert.ok(/const TOAST_MS = 3000;/.test(SRC), "TOAST_MS must be 3000");
    assert.ok(!/const TOAST_MS = 5000;/.test(SRC), "the old 5 s duration must be gone");
    assert.ok(SRC.includes('el.querySelector(".toast-close").addEventListener("click", hideCheckCompleteToast)'), "the × button must hide the toast at once");
  });
  it("M4: copy-link shows a toast on success and an honest error toast when the clipboard fails", () => {
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    assert.ok(SRC.includes('showInfoToast(t(ok ? "shareCopied" : "shareCopyFailed", lang))'), "copy must toast either way");
    assert.equal(t("shareCopyFailed", "id"), "Gagal menyalin tautan — salin tipucek.web.app secara manual.");
    assert.equal(t("shareCopyFailed", "en"), "Couldn't copy the link — copy tipucek.web.app by hand.");
  });
  it("M1: chart empty state invites trying an example, with a button that lands on the checker", () => {
    const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    const CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    assert.ok(HTML.includes('id="week-chart-empty" class="week-chart-empty"'), "the empty state must be a block, not a bare note");
    assert.ok(HTML.includes('id="week-chart-try-btn"'), "the empty state must have a try button");
    assert.ok(SRC.includes('$("week-chart-try-btn").addEventListener("click"'), "the try button must be wired");
    assert.ok(SRC.includes('if ($("tab-message").hidden) switchCheckerTab("message");'), "the try button must land on the message tab");
    assert.ok(CSS.includes(".week-chart-empty {") && CSS.includes(".week-chart-try {"), "the empty state must be styled");
    assert.equal(t("chartEmpty", "id"), "Belum ada data — coba salah satu contoh di bawah.");
    assert.equal(t("chartEmpty", "en"), "No data yet — try one of the examples below.");
    assert.equal(t("chartEmptyTryBtn", "id"), "Coba contoh");
    assert.equal(t("chartEmptyTryBtn", "en"), "Try an example");
  });
});

describe("folded clean checks (21 Nov, Myuden: lipat baris bersihnya)", () => {
  it("disclosure title carries the count, ID+EN", () => {
    assert.equal(t("checksCleanToggle", "id", { n: 14 }), "14 aturan bersih");
    assert.equal(t("checksCleanToggle", "en", { n: 14 }), "14 rules clear");
  });
  it("renderLocalChecks folds clean rows into a closed-by-default disclosure; found rows stay outside", () => {
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    const fn = SRC.slice(SRC.indexOf("function renderLocalChecks"), SRC.indexOf("function renderResult"));
    assert.ok(fn.includes('<details class="clean-checks"'), "clean rows must live in a <details> disclosure");
    assert.ok(fn.includes('t("checksCleanToggle", lang, { n: cleanCount })'), "the disclosure title must carry the clean count");
    assert.ok(fn.includes("${cleanChecksOpen ? \" open\" : \"\"}"), "open state must come from the preserved module variable");
    assert.ok(fn.includes("const foundRows = rules.filter((c) => c.found)"), "found rows must be selected separately (rules only — info rows are partitioned out)");
    assert.ok(fn.includes("const cleanRows = rules.filter((c) => !c.found)"), "clean rows must be selected separately (rules only)");
    assert.ok(fn.includes("return `${pills}${foundList}${cleanDisclosure}${infoList}`;"), "found list must render before (outside) the disclosure, info list last");
    assert.ok(SRC.includes("let cleanChecksOpen = false;"), "the disclosure must be closed by default");
    assert.ok(SRC.includes('cleanDetails.addEventListener("toggle"'), "the toggle must update the preserved open state");
  });
  it("APK sample has 23 checks: 3 found, 20 clean (the disclosure count)", () => {
    const apk = analyzeWithHeuristic(t("sampleTextApk", "id"), "id");
    assert.equal(apk.checks.length, 23);
    assert.equal(apk.checks.filter((c) => c.found).length, 3);
    assert.equal(apk.checks.filter((c) => !c.found).length, 20);
  });
  it("the disclosure is styled (toggle row + rotating chevron)", () => {
    const CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    assert.ok(CSS.includes(".clean-checks {"), "the disclosure must be styled");
    assert.ok(CSS.includes(".clean-checks summary {"), "the toggle row must be styled");
    assert.ok(CSS.includes(".clean-checks[open ] summary::after"), "the chevron must rotate when open");
    assert.ok(CSS.includes(".clean-checks .local-checks {"), "the rows inside must reuse the checklist style");
  });
});

describe("3-vs-6 inconsistency (21 Nov, Myuden: daftar 3 butir vs ceklis 6)", () => {
  it("the local rule set is self-consistent: redFlags.length always equals the found-check count", () => {
    for (const key of ["sampleTextApk", "sampleTextScam", "sampleTextSafe"]) {
      const r = analyzeWithHeuristic(t(key, "id"), "id");
      assert.equal(r.redFlags.length, r.checks.filter((c) => c.found).length, `${key}: flags must equal found checks`);
    }
    const apk = analyzeWithHeuristic(t("sampleTextApk", "id"), "id");
    assert.equal(apk.redFlags.length, 3);
    const prize = analyzeWithHeuristic(t("sampleTextScam", "id"), "id");
    assert.equal(prize.redFlags.length, 6);
  });
  it("the AI flags heading is labelled as the AI verdict only for model verdicts", () => {
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    assert.ok(SRC.includes('verdict.source === "IN_CLOUD" || verdict.source === "ON_DEVICE" ? "redFlagsAi" : "redFlags"'), "model verdicts must use the AI-labelled heading");
    assert.equal(t("redFlagsAi", "id"), "Tanda bahaya (vonis AI)");
    assert.equal(t("redFlagsAi", "en"), "Red flags (AI verdict)");
  });
  it("the device checklist counts rules, not signs, so its number cannot read as a second flag count", () => {
    assert.equal(t("checksExamined", "id", { n: 17 }), "17 aturan diperiksa");
    assert.equal(t("checksExamined", "en", { n: 17 }), "17 rules checked");
    assert.equal(t("checksFound", "id", { n: 6 }), "6 terpicu");
    assert.equal(t("checksFound", "en", { n: 6 }), "6 triggered");
    assert.equal(t("checksClean", "id", { n: 11 }), "11 bersih");
    assert.equal(t("checksClean", "en", { n: 11 }), "11 clean");
    assert.equal(t("localSignalText", "id", { n: 6, score: 100, status: "Penipuan" }), "Cek cepat di HP Anda: 6 aturan terpicu, skor awal 100/100 (Penipuan). Ini bukan vonis akhir — vonis AI di atas yang berlaku.");
    assert.equal(t("localSignalText", "en", { n: 6, score: 100, status: "Scam" }), "A quick check on your device: 6 rules triggered, initial score 100/100 (Scam). This is not the final verdict — the AI verdict above is what counts.");
  });
});

describe("model failover (primary 3.5-flash-lite, backup 3.1-flash-lite, 20 Nov)", () => {
  // The failover loop is pure w.r.t. the model call: tests inject a
  // stub makeCall(modelName). The live browser test proves the same
  // loop against the real endpoint (primary blocked -> backup answers).
  it("primary error -> backup answers once, model recorded as backup", async () => {
    let backupCalls = 0;
    let onBackupCalls = 0;
    const { result, model } = await generateWithFailover(
      async (name) => {
        if (name === CLOUD_MODEL) throw new Error("429 quota exhausted");
        backupCalls++;
        return { ok: true };
      },
      { timeoutMs: 1000, onBackup: () => { onBackupCalls++; } },
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(model, BACKUP_CLOUD_MODEL);
    assert.equal(backupCalls, 1);
    assert.equal(onBackupCalls, 1);
  });

  it("both fail -> throws the last (backup) error, each tried exactly once", async () => {
    const calls = [];
    let onBackupCalls = 0;
    await assert.rejects(
      generateWithFailover(
        async (name) => {
          calls.push(name);
          throw new Error(`fail ${name}`);
        },
        { timeoutMs: 1000, onBackup: () => { onBackupCalls++; } },
      ),
      /gemini-3\.1-flash-lite/,
    );
    assert.deepEqual(calls, [CLOUD_MODEL, BACKUP_CLOUD_MODEL]);
    assert.equal(onBackupCalls, 1);
  });

  it("primary success -> backup never called, model recorded as primary", async () => {
    const calls = [];
    let onBackupCalls = 0;
    const { result, model } = await generateWithFailover(
      async (name) => {
        calls.push(name);
        return { ok: true };
      },
      { timeoutMs: 1000, onBackup: () => { onBackupCalls++; } },
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(model, CLOUD_MODEL);
    assert.deepEqual(calls, [CLOUD_MODEL]);
    assert.equal(onBackupCalls, 0);
  });

  it("primary timeout -> backup tried (short timeout proves the timeout path)", async () => {
    const calls = [];
    const { result, model } = await generateWithFailover(
      async (name) => {
        calls.push(name);
        if (name === CLOUD_MODEL) return new Promise(() => {}); // never resolves
        return { ok: true };
      },
      { timeoutMs: 50 },
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(model, BACKUP_CLOUD_MODEL);
    assert.deepEqual(calls, [CLOUD_MODEL, BACKUP_CLOUD_MODEL]);
  });

  it("failover strings exist in both languages, honest, model filled", () => {
    for (const code of LANG_CODES) {
      const trying = t("tryingBackupModel", code);
      assert.ok(typeof trying === "string" && trying.trim().length > 0, `tryingBackupModel empty in ${code}`);
      assert.notEqual(trying, "tryingBackupModel", `tryingBackupModel untranslated in ${code}`);
      assert.doesNotMatch(trying, /undefined/, `tryingBackupModel has undefined in ${code}`);
      // The user-facing receipt no longer names the model (21 Nov,
      // Myuden — users do not understand model names), so there is no
      // receiptModel* string to check here anymore.
      if (code !== "en") {
        assert.notEqual(trying, t("tryingBackupModel", "en"), `tryingBackupModel untranslated in ${code}`);
      }
    }
  });

  it("codeOnlyVerdict records model 'code'; mergeCallVerdict keeps the AI slot's model", async () => {
    const c = codeOnlyVerdict(SCAM_PRIZE, "en");
    assert.equal(c.model, "code");
    const { verdict: localSafe } = await analyzeCall({ number: "", said: "rapat besok jam 10" }, "en");
    const merged = mergeCallVerdict(c, localSafe);
    assert.equal(merged.model, "code");
    const aiPrimary = { status: "scam", riskScore: 95, redFlags: ["x"], summary: "s", source: "IN_CLOUD", model: CLOUD_MODEL };
    assert.equal(mergeCallVerdict(aiPrimary, localSafe).model, CLOUD_MODEL);
    assert.equal(mergeCallVerdict({ ...aiPrimary, model: BACKUP_CLOUD_MODEL }, localSafe).model, BACKUP_CLOUD_MODEL);
  });

  it("main.js wires the failover: backup stage, receipt without model line, history model, image onProgress", () => {
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    assert.ok(SRC.includes('stage === "backup"'), "main.js must handle the backup progress stage");
    assert.ok(SRC.includes('t("tryingBackupModel"'), "main.js must show the backup status text");
    assert.ok(!SRC.includes('"receiptModelBackup"'), "receipt must not name the backup model (21 Nov, Myuden)");
    assert.ok(!SRC.includes('"receiptModelPrimary"'), "receipt must not name the primary model (21 Nov, Myuden)");
    assert.ok(SRC.includes("e.model"), "history must record the answering model");
    assert.ok(SRC.includes("analyzeImageWithAI(selectedImage, lang,"), "image check must pass onProgress for the backup stage");
    assert.ok(SRC.includes("BACKUP_CLOUD_MODEL"), "main.js must import the backup model constant");
  });

  it("history round-trip (local-only) preserves the answering model", async () => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
    try {
      const where = await saveCheck({
        message: "x",
        status: "scam",
        riskScore: 95,
        redFlags: ["x"],
        summary: "s",
        source: "IN_CLOUD",
        model: BACKUP_CLOUD_MODEL,
      });
      assert.equal(where, "local");
      const entries = await loadHistory();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].model, BACKUP_CLOUD_MODEL);
      assert.equal(entries[0].source, "IN_CLOUD");
    } finally {
      delete globalThis.localStorage;
    }
  });
});

describe("aggregate stats totals (22 Nov audit 8)", () => {
  function freshStore() {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
    return store;
  }
  it("counts never drop when a new check trims the oldest entry (auditor: 32 -> 31)", async () => {
    freshStore();
    try {
      // Seed the auditor's exact scene, scaled to the 200 cap: 32
      // scams first (oldest), then 168 safe = 200 entries.
      for (let i = 0; i < 32; i++) {
        await saveCheck({ message: `scam ${i}`, status: "scam", riskScore: 90, redFlags: ["x"], summary: "s", source: "LOCAL" });
      }
      for (let i = 0; i < 168; i++) {
        await saveCheck({ message: `safe ${i}`, status: "safe", riskScore: 0, redFlags: [], summary: "s", source: "LOCAL" });
      }
      assert.equal((await loadHistory()).length, 200);
      assert.deepEqual(
        { checked: getStatsTotals().checked, scams: getStatsTotals().scams },
        { checked: 200, scams: 32 },
      );
      // One more safe check: the list stays 200, the oldest scam is
      // trimmed — but the totals must NOT fall.
      await saveCheck({ message: "one more safe", status: "safe", riskScore: 0, redFlags: [], summary: "s", source: "LOCAL" });
      const list = await loadHistory();
      assert.equal(list.length, 200);
      assert.equal(list.filter((e) => e.status === "scam").length, 31, "the list itself lost its oldest scam (cap)");
      assert.equal(getStatsTotals().checked, 201);
      assert.equal(getStatsTotals().scams, 32, "the aggregate scam count must never drop on a new check");
      const today = getStatsTotals().days[localDayKey(new Date())];
      assert.ok(today && today.c === 201 && today.s === 32, "per-day bucket tracks all checks, not just the list");
    } finally {
      delete globalThis.localStorage;
    }
  });
  it("totals seed from an existing list and clear with the history", async () => {
    freshStore();
    try {
      await saveCheck({ message: "a", status: "scam", riskScore: 90, redFlags: ["x"], summary: "s", source: "LOCAL" });
      await saveCheck({ message: "b", status: "safe", riskScore: 0, redFlags: [], summary: "s", source: "LOCAL" });
      assert.equal(getStatsTotals().checked, 2);
      assert.equal(getStatsTotals().scams, 1);
      clearLocalHistory();
      assert.equal((await loadHistory()).length, 0);
      assert.deepEqual(getStatsTotals(), { checked: 0, scams: 0, days: {} });
    } finally {
      delete globalThis.localStorage;
    }
  });
  it("seedTotalsFromList merges a loaded (e.g. cloud) list without ever lowering a count", async () => {
    freshStore();
    try {
      // A list the local store never saw (cloud entries on a fresh
      // device): totals must rise to include them, hero included.
      const now = new Date().toISOString();
      seedTotalsFromList([
        { status: "scam", createdAt: now },
        { status: "safe", createdAt: now },
        { status: "scam", createdAt: now },
      ]);
      assert.equal(getStatsTotals().checked, 3);
      assert.equal(getStatsTotals().scams, 2);
      // Seeding a SMALLER list afterwards must not lower anything.
      seedTotalsFromList([{ status: "safe", createdAt: now }]);
      assert.equal(getStatsTotals().checked, 3);
      assert.equal(getStatsTotals().scams, 2);
    } finally {
      delete globalThis.localStorage;
    }
  });
  it("a failed local write does not bump the totals (ordering, 100milionseek)", async () => {
    // Quota-full storage: writeLocal swallows the error (history is
    // best-effort, saveCheck still resolves "local"), but the totals
    // must not claim a check that was never saved.
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        if (k === "pesanaman_history_v1") throw new Error("QuotaExceededError");
        store.set(k, String(v));
      },
      removeItem: (k) => { store.delete(k); },
    };
    try {
      const where = await saveCheck({ message: "x", status: "scam", riskScore: 90, redFlags: ["x"], summary: "s", source: "LOCAL" });
      assert.equal(where, "local");
      assert.deepEqual(getStatsTotals(), { checked: 0, scams: 0, days: {} });
      assert.equal((await loadHistory()).length, 0);
      // And a later successful save still bumps exactly once.
      globalThis.localStorage.setItem = (k, v) => { store.set(k, String(v)); };
      await saveCheck({ message: "y", status: "safe", riskScore: 0, redFlags: [], summary: "s", source: "LOCAL" });
      assert.equal(getStatsTotals().checked, 1);
      assert.equal(getStatsTotals().scams, 0);
    } finally {
      delete globalThis.localStorage;
    }
  });
});

describe("Aman answers in the question's language (panel, 20 Nov)", () => {
  it("detects Indonesian questions", () => {
    assert.equal(detectQuestionLanguage("Apa itu penipuan OTP?"), "id");
    assert.equal(detectQuestionLanguage("Bagaimana cara melaporkan penipuan?"), "id");
    assert.equal(
      detectQuestionLanguage(
        "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini dan bayar biaya admin untuk klaim hadiah Anda sebelum 24 jam.",
      ),
      "id",
    );
  });
  it("detects English questions", () => {
    assert.equal(detectQuestionLanguage("What is OTP fraud?"), "en");
    assert.equal(detectQuestionLanguage("How do I report a scam?"), "en");
    assert.equal(
      detectQuestionLanguage("Hi Budi, this is Sari from the office. The team meeting is moved to Thursday 10:00 in room 3B."),
      "en",
    );
  });
  it("detects the other six locales", () => {
    assert.equal(detectQuestionLanguage("¿Cómo denuncio una estafa?"), "es");
    assert.equal(detectQuestionLanguage("Comment signaler une arnaque ?"), "fr");
    assert.equal(detectQuestionLanguage("Wie melde ich einen Betrug?"), "de");
    assert.equal(detectQuestionLanguage("Como denuncio um golpe?"), "pt");
    assert.equal(detectQuestionLanguage("詐欺を報告するには？"), "ja");
    assert.equal(detectQuestionLanguage("如何举报诈骗？"), "zh");
  });
  it("mixed-language question follows the dominant language", () => {
    assert.equal(detectQuestionLanguage("Hi Aman, apa itu OTP?"), "id");
  });
  it("returns null when nothing is confident (fallback = site language)", () => {
    assert.equal(detectQuestionLanguage("OTP 482916"), null);
    assert.equal(detectQuestionLanguage("   "), null);
    assert.equal(detectQuestionLanguage(""), null);
    // "para" scores in both Spanish and Portuguese — a tie is not confident.
    assert.equal(detectQuestionLanguage("para"), null);
  });
  it("assistant.js passes the detected language + pasted-message hint to askAssistant", () => {
    const SRC = readFileSync(new URL("../src/assistant.js", import.meta.url), "utf8");
    assert.ok(SRC.includes("detectQuestionLanguage(text) || lang"), "send() must detect the question language with the site language as fallback");
    assert.ok(SRC.includes("askAssistant(text, answerLang, history, undefined, {"), "askAssistant must receive the detected language");
    assert.ok(SRC.includes("pastedMessage: maybePastedMessage"), "askAssistant must be told whether the text looks like a pasted message to judge");
    assert.ok(SRC.includes("assistant-retry-btn"), "a failed answer must offer a retry button");
    assert.ok(SRC.includes("chipReport"), "the panel must have the report-a-scam quick chip");
    assert.ok(SRC.includes("openAmanPanel"), "assistant.js must export the panel opener");
    assert.ok(SRC.includes("closeAmanPanel"), "assistant.js must export the panel closer");
  });
  it("ai.js askAssistant has the same primary → backup failover as the checker", () => {
    const SRC = readFileSync(new URL("../src/ai.js", import.meta.url), "utf8");
    const start = SRC.indexOf("export async function askAssistant");
    assert.ok(start >= 0, "askAssistant must exist");
    const body = SRC.slice(start, SRC.indexOf("function fileToBase64", start));
    assert.ok(body.includes("generateWithFailover"), "askAssistant must use generateWithFailover");
    assert.ok(body.includes("ASSISTANT_TIMEOUT_MS"), "each assistant attempt keeps its own 30 s budget");
  });
  it("ai.js assistantSystemPrompt is professional, concise, clear (Myuden 20 Nov 20:30)", () => {
    const SRC = readFileSync(new URL("../src/ai.js", import.meta.url), "utf8");
    const start = SRC.indexOf("function assistantSystemPrompt");
    assert.ok(start >= 0, "assistantSystemPrompt must exist");
    const body = SRC.slice(start, SRC.indexOf("export async function askAssistant", start));
    assert.ok(body.includes("professional"), "the prompt must demand a professional tone");
    assert.ok(body.includes("at most 3 short sentences"), "answers are capped at 3 short sentences");
    assert.ok(body.includes("no small talk"), "no small talk");
    assert.ok(body.includes("no jargon"), "no jargon");
    assert.ok(body.includes("verdict directly"), "a pasted message must get its verdict in sentence 1");
    assert.ok(body.includes("strongest warning sign"), "sentence 2 must name the strongest warning sign");
    assert.ok(body.includes("one clear action"), "sentence 3 must give one clear action");
    assert.doesNotMatch(body, /friendly|buddy/, "the prompt must not ask for a casual tone");
    // 20 Nov 20:46 fix: the verdict is ONLY for a pasted message. A
    // general question must be answered directly — the old prompt
    // forced a verdict onto every answer, so "How do I spot a fake
    // link?" was answered "This message is suspicious." about a
    // message that was never pasted.
    assert.ok(body.includes("PASTED MESSAGE"), "the prompt must separate a pasted message from a general question");
    assert.ok(body.includes("GENERAL QUESTION"), "the prompt must name the general-question case");
    assert.ok(body.includes("NEVER invent a verdict"), "a general question must never get an invented verdict");
  });
  it("panel markup + wiring: one Aman UI (dialog), round avatar launcher, close + Escape", () => {
    const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    assert.ok(HTML.includes('id="assistant"'), "the panel keeps the assistant id");
    assert.ok(HTML.includes('role="dialog"'), "the panel is a dialog, not a tab section");
    assert.ok(HTML.includes('id="assistant-close"'), "the panel has a close button");
    assert.ok(HTML.includes('id="assistant-privacy"'), "the panel shows the privacy line");
    assert.ok(HTML.includes('class="aman-fab"'), "the launcher keeps its id");
    assert.ok(HTML.includes('<img src="/aman.png" alt=""'), "the launcher shows Aman's face, not a '?' icon");
    assert.ok(HTML.includes('class="visually-hidden"'), "the icon-only launcher keeps an accessible name");
    assert.ok(!HTML.includes('id="assistant" class="card assistant module-panel" role="tabpanel"'), "the old in-page assistant section is gone");
    const MAIN = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    assert.ok(MAIN.includes("openAmanPanel"), "main.js must wire the panel opener");
    assert.ok(MAIN.includes("closeAmanPanel"), "main.js must wire the panel closer");
    assert.ok(MAIN.includes('"Escape"'), "Escape must close the panel");
    assert.ok(MAIN.includes("moduleTabBeforeAman"), "closing the panel must restore the previous module tab");
    const CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    assert.ok(CSS.includes(".aman-panel"), "the panel must be styled as a fixed overlay");
    assert.ok(CSS.includes(".aman-panel[hidden]"), "hidden must win over the panel's flex display");
    assert.ok(CSS.includes("body.aman-panel-open .toast"), "the toast must move out of the panel's way while it is open");
    assert.ok(CSS.includes(".visually-hidden"), "the visually-hidden utility must exist");
    // Launcher float (Myuden 20 Nov 20:26): same slow aman-float as the
    // avatar — up/down 10px, 4.5 s, infinite. Hover must not fight it
    // with its own translateY, and reduced motion must stop it too.
    // The base rule is anchored to the line start: the dark-theme
    // overrides (":root[data-theme=dark] .aman-fab { ... }") also
    // contain ".aman-fab {" but carry no animation of their own.
    const fabRule = CSS.match(/^\.aman-fab \{[^}]*\}/m);
    assert.ok(fabRule && fabRule[0].includes("animation: aman-float 4.5s ease-in-out infinite;"), "the launcher must float like the avatar (same aman-float keyframe)");
    const fabHover = CSS.match(/\.aman-fab:hover \{[^}]*\}/);
    assert.ok(fabHover && !fabHover[0].includes("translateY"), "hover must not fight the float animation with its own translateY");
    assert.ok(CSS.includes(".avatar, .avatar.thinking, .avatar.waving, .aman-fab, .aman-panel { animation: none; }"), "reduced motion must stop the launcher float and the panel entrance too");
    // Panel entrance (slide-up + fade, 0.25 s) and the launcher pause:
    // the float must stop the moment the user reaches for the button,
    // or an infinitely moving target never settles for a tap/click.
    const panelRule = CSS.match(/\.aman-panel \{\n  position: fixed;[^}]*\}/);
    assert.ok(panelRule && panelRule[0].includes("animation: aman-panel-in 0.25s ease-out;"), "the panel must slide up + fade in briefly on open");
    assert.ok(CSS.includes("@keyframes aman-panel-in"), "the panel enter keyframes must exist");
    const fabPause = CSS.match(/\.aman-fab:hover, \.aman-fab:focus-visible \{[^}]*\}/);
    assert.ok(fabPause && fabPause[0].includes("animation-play-state: paused;"), "the launcher must pause its float on hover/focus so it can be tapped");
  });
  it("panel containment (Myuden 20 Nov 20:57): the log is the only scroller, nothing spills out of the card", () => {
    const CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    // The rigid 320px log cap is gone — the log sizes by flex.
    assert.doesNotMatch(CSS, /assistant-log[^}]*max-height: 320px/, "the rigid 320px log cap must be gone");
    const logRule = CSS.match(/\.aman-panel \.assistant-log \{[^}]*\}/);
    assert.ok(logRule, "the panel log rule must exist");
    assert.ok(logRule[0].includes("min-height: 0"), "the log must be able to shrink to nothing (min-height 0) so the panel never overflows");
    assert.ok(logRule[0].includes("overflow-y: auto") || CSS.match(/\.assistant-log \{[^}]*overflow-y: auto/), "the log must scroll internally");
    // Every other direct child of the panel is fixed size — only the
    // log absorbs a squeeze.
    for (const sel of [".aman-panel .assistant-head", ".aman-panel .assistant-greeting", ".aman-panel .assistant-chips", ".aman-panel .assistant-input-row", ".aman-panel .assistant-note"]) {
      const rule = CSS.match(new RegExp(sel.replace(/\./g, "\\.") + " \\{[^}]*\\}"));
      assert.ok(rule && rule[0].includes("flex: none"), `${sel} must be flex: none`);
    }
    // The panel itself contains everything: nothing may spill below
    // the white card, in any state.
    const panelRule = CSS.match(/\.aman-panel \{\n  position: fixed;[^}]*\}/);
    assert.ok(panelRule && panelRule[0].includes("overflow: hidden;"), "the panel must hide overflow so no text spills out of the card");
    // The panel keeps its width rule (380px, shrinking to 100vw-24px
    // on phones) — the width is not part of this fix.
    assert.ok(panelRule && panelRule[0].includes("width: min(380px, calc(100vw - 24px));"), "the panel width rule must stay");
  });
});

describe("history privacy masking (21 Nov 01:19; proportional 22 Nov audit 7)", () => {
  it("masks an OTP code in a message snippet", () => {
    assert.equal(
      maskSensitive("BCA: Kode OTP Anda 482916. Jangan berikan kode ini kepada siapa pun."),
      "BCA: Kode OTP Anda ••••••. Jangan berikan kode ini kepada siapa pun.",
    );
  });
  it("masks phone numbers with and without separators — dots follow the digit count", () => {
    // 12-digit phone -> 12 dots (was always 6, audit 7).
    assert.equal(maskSensitive("Hubungi 081234567890 segera"), "Hubungi •••••••••••• segera");
    assert.equal(maskSensitive("Hubungi 0812-3456-7890 segera"), "Hubungi •••••••••••• segera");
    // +62 812-3456-7890 is 13 digits -> 13 dots.
    assert.equal(maskSensitive("Hubungi +62 812-3456-7890 segera"), "Hubungi ••••••••••••• segera");
  });
  it("masks a bank account number — 10 digits, 10 dots", () => {
    assert.equal(
      maskSensitive("Transfer ke rekening 1234567890 a.n. Budi"),
      "Transfer ke rekening •••••••••• a.n. Budi",
    );
  });
  it("different lengths give different dot counts (proportional, audit 7)", () => {
    assert.equal(maskSensitive("Kode 1234"), "Kode ••••");
    assert.equal(maskSensitive("Kode 123456"), "Kode ••••••");
    assert.equal(maskSensitive("Kode 123456789012"), "Kode ••••••••••••");
    const dots = (s) => (s.match(/•/g) || []).length;
    assert.ok(dots(maskSensitive("Kode 1234")) < dots(maskSensitive("Kode 123456789012")));
  });
  it("leaves short numbers and plain words alone", () => {
    assert.equal(maskSensitive("Diskon 50% hari ini, 3 hadiah"), "Diskon 50% hari ini, 3 hadiah");
    assert.equal(maskSensitive(""), "");
    assert.equal(maskSensitive(null), "");
  });
  it("never leaves a digit run of 4+ visible", () => {
    const out = maskSensitive("Kode 482916 atau 1234 atau 9876543210987654");
    assert.doesNotMatch(out, /\d{4,}/);
  });
  it("audit 6: an evidence quote carries the raw code in analysis, masked at render", () => {
    // The heuristic still returns the raw matched window (the card
    // re-derives it on language change); the DISPLAY masks it — this
    // pins the contract both sides must keep.
    const v = analyzeWithHeuristic(OTP_SAMPLE, "id");
    const otpCheck = v.checks.find((c) => c.id === "moneyOtp");
    assert.ok(otpCheck && otpCheck.found, "OTP rule fires on the sample");
    assert.ok(otpCheck.evidence.includes("482916"), "raw evidence contains the code");
    assert.doesNotMatch(maskSensitive(otpCheck.evidence), /\d{4,}/);
    assert.ok(!maskSensitive(OTP_SAMPLE).includes("0812-9876-5432"));
  });
});

describe("history privacy masking — alphanumeric code tokens (audit 14)", () => {
  it("masks a mixed letter+digit token whole (abc123 -> 6 dots)", () => {
    assert.equal(
      maskSensitive("Kode OTP Anda adalah abc123. Jangan berikan kepada siapa pun."),
      "Kode OTP Anda adalah ••••••. Jangan berikan kepada siapa pun.",
    );
    assert.equal(maskSensitive("Kode XK7Q2P"), "Kode ••••••");
    assert.equal(maskSensitive("Kode a1b2c3"), "Kode ••••••");
  });
  it("masks the token whole even when the digit part alone is long (no abc + dots leak)", () => {
    // The token pass runs BEFORE the digit passes — otherwise the
    // digit pass would leave the letters visible ("abc••••••").
    assert.equal(maskSensitive("Kode abc123456"), "Kode •••••••••");
    assert.ok(!maskSensitive("Kode abc123456").includes("abc"));
  });
  it("leaves ordinary words, prices and short numbers alone", () => {
    assert.equal(maskSensitive("Kode OTP Anda sudah aktif. Terima kasih."), "Kode OTP Anda sudah aktif. Terima kasih.");
    assert.equal(maskSensitive("Diskon 50% hari ini, 3 hadiah"), "Diskon 50% hari ini, 3 hadiah");
    assert.equal(maskSensitive("BCA dan Telkomsel bekerja sama"), "BCA dan Telkomsel bekerja sama");
    // Currency amounts are prices, not codes: the token pass leaves
    // the "Rp"/"USD" letters alone (no whole-token dots) — but the
    // pre-existing digit rule still masks a 4+ digit amount, so
    // "Rp100000" reads "Rp••••••" (letters kept, amount hidden).
    // A short amount ("USD50") has no 4+ digit run and stays whole.
    assert.equal(maskSensitive("Bayar Rp100000 sekarang"), "Bayar Rp•••••• sekarang");
    assert.equal(maskSensitive("Harga USD50 saja"), "Harga USD50 saja");
  });
  it("never leaves a mixed token visible", () => {
    const out = maskSensitive("Kode abc123 atau XK7Q2P atau a1b2c3");
    assert.ok(!out.includes("abc123") && !out.includes("XK7Q2P") && !out.includes("a1b2c3"));
    assert.doesNotMatch(out, /[A-Za-z]+\d+|\d+[A-Za-z]+/);
  });
  it("still masks digit-only codes and phones exactly as before", () => {
    assert.equal(maskSensitive("Kode OTP Anda 482916."), "Kode OTP Anda ••••••.");
    assert.equal(maskSensitive("Hubungi 081234567890 segera"), "Hubungi •••••••••••• segera");
  });
});

describe("auto-redact PII before AI (23 Nov 2026)", () => {
  it("replaces each PII kind with its typed placeholder + counts", () => {
    const r = redactForAI("BCA: Kode OTP Anda 482916, hubungi 0812-9876-5432");
    assert.equal(r.text, "BCA: Kode OTP Anda [KODE_OTP], hubungi [NOMOR_HP]");
    assert.deepEqual(r.found, [
      { kind: "otp", count: 1 },
      { kind: "phone", count: 1 },
    ]);
    assert.equal(redactForAI("transfer ke rekening 1234567890").text, "transfer ke rekening [REKENING]");
    assert.equal(redactForAI("PIN Anda 1234").text, "PIN Anda [PIN]");
    assert.equal(redactForAI("Kartu 1234 5678 9012 3456").text, "Kartu [KARTU]");
    assert.equal(redactForAI("NIK 3201234567890001").text, "NIK [NIK]");
    assert.equal(redactForAI("hubungi budi@gmail.com").text, "hubungi [EMAIL]");
    assert.equal(redactForAI("kode referral abc123").text, "kode referral [KODE]");
  });
  it("counts repeated values per kind", () => {
    const r = redactForAI("081234567890 dan 081298765432");
    assert.equal(r.text, "[NOMOR_HP] dan [NOMOR_HP]");
    assert.deepEqual(r.found, [{ kind: "phone", count: 2 }]);
  });
  it("does NOT redact a tracking number, money, a year, or short numbers", () => {
    // The safe-delivery trap: a resi is not a bank account.
    assert.equal(
      redactForAI("Paket Anda dengan resi JNE 1234567890 sudah tiba").text,
      "Paket Anda dengan resi JNE 1234567890 sudah tiba",
    );
    assert.deepEqual(redactForAI("Paket Anda dengan resi JNE 1234567890 sudah tiba").found, []);
    assert.equal(redactForAI("resi JNE1234567890").text, "resi JNE1234567890");
    // Money amounts are signals, not PII.
    assert.equal(redactForAI("transfer Rp 2.000.000 ke rekening 9876543210").text, "transfer Rp 2.000.000 ke rekening [REKENING]");
    assert.equal(redactForAI("Rp100000").text, "Rp100000");
    assert.equal(redactForAI("Harga 100000").text, "Harga 100000");
    assert.equal(redactForAI("Rp 100000").text, "Rp 100000");
    // Years and short numbers stay.
    assert.equal(redactForAI("tahun 2026").text, "tahun 2026");
    assert.equal(redactForAI("Diskon 50% hari ini, 3 hadiah").text, "Diskon 50% hari ini, 3 hadiah");
  });
  it("does not mistake a phone for an account, or a transaction number for a phone", () => {
    // A phone number is [NOMOR_HP], never [REKENING] as well.
    const r = redactForAI("hubungi 081234567890");
    assert.equal(r.text, "hubungi [NOMOR_HP]");
    assert.deepEqual(r.found, [{ kind: "phone", count: 1 }]);
    // A 22-digit transaction number must not spawn a phantom phone
    // (same guard as extractNumbers).
    const t = redactForAI("No. Transaksi 2026011743008130078713");
    assert.equal(t.text, "No. Transaksi 2026011743008130078713");
    assert.deepEqual(t.found, []);
  });
  it("a bare 6-digit run is an OTP only with OTP context or as the whole message", () => {
    // With OTP words it is redacted...
    assert.equal(redactForAI("Kode verifikasi Tokopedia Anda: 482916").text, "Kode verifikasi Tokopedia Anda: [KODE_OTP]");
    // ...as a bare code on its own...
    assert.equal(redactForAI("482916").text, "[KODE_OTP]");
    assert.equal(redactForAI("Kode: 482916").text, "Kode: [KODE_OTP]");
    // ...but never as a price in a longer message.
    assert.equal(redactForAI("Harga 100000").text, "Harga 100000");
  });
  it("CoArena audit (23 Nov): +62 with a separator is still a phone", () => {
    assert.equal(redactForAI("hubungi +62 812-3456-7890").text, "hubungi [NOMOR_HP]");
    assert.equal(redactForAI("hubungi +62 812345678").text, "hubungi [NOMOR_HP]");
    assert.equal(redactForAI("hubungi 0812 3456 7890").text, "hubungi [NOMOR_HP]");
    assert.equal(redactForAI("hubungi 62 8123456789").text, "hubungi [NOMOR_HP]");
    assert.equal(redactForAI("hubungi 081234567890").text, "hubungi [NOMOR_HP]");
  });
  it("CoArena audit (23 Nov): OTP/PIN context does not swallow money or years", () => {
    assert.equal(redactForAI("OTP 123456, harga Rp 100000").text, "OTP [KODE_OTP], harga Rp 100000");
    assert.equal(redactForAI("PIN 1234, berlaku sampai tahun 2026").text, "PIN [PIN], berlaku sampai tahun 2026");
    assert.equal(redactForAI("PIN 1234, harga Rp 5000").text, "PIN [PIN], harga Rp 5000");
    // The OTP and the PIN themselves are still redacted.
    assert.equal(redactForAI("Kode OTP Anda 482916").text, "Kode OTP Anda [KODE_OTP]");
    assert.equal(redactForAI("PIN Anda 1234").text, "PIN Anda [PIN]");
  });
  it("CoArena audit (23 Nov): a transaction reference is not a bank account", () => {
    assert.equal(redactForAI("No. transaksi 123456789012").text, "No. transaksi 123456789012");
    assert.equal(redactForAI("Ref 123456789012").text, "Ref 123456789012");
    // ...but a real account after "rekening" still redacts, even
    // when "transaksi" appears earlier in the message.
    assert.equal(redactForAI("transaksi ke rekening 1234567890").text, "transaksi ke rekening [REKENING]");
    assert.equal(redactForAI("transfer ke rekening 1234567890").text, "transfer ke rekening [REKENING]");
  });
  it("is idempotent and safe on empty input", () => {
    const r = redactForAI("BCA: Kode OTP Anda 482916, hubungi 0812-9876-5432");
    assert.equal(redactForAI(r.text).text, r.text);
    assert.deepEqual(redactForAI(""), { text: "", found: [] });
    assert.deepEqual(redactForAI(null), { text: "", found: [] });
    assert.deepEqual(redactForAI("pesan biasa tanpa data sensitif").found, []);
  });
  it("integration: the AI prompt built from redacted text contains no raw sensitive value", () => {
    const raw = "BCA: Kode OTP Anda 482916, transfer ke rekening 1234567890, hubungi 0812-9876-5432 atau budi@gmail.com";
    const redacted = redactForAI(raw);
    const prompt = buildPrompt(redacted.text, "id");
    for (const secret of ["482916", "1234567890", "0812-9876-5432", "081298765432", "budi@gmail.com"]) {
      assert.ok(!prompt.includes(secret), `prompt must not contain ${secret}`);
    }
    // The placeholders survive into the prompt so the model still
    // sees that a phone / account / OTP was there.
    for (const marker of ["[KODE_OTP]", "[REKENING]", "[NOMOR_HP]", "[EMAIL]"]) {
      assert.ok(prompt.includes(marker), `prompt must keep ${marker}`);
    }
  });
});

describe("settings rows stack in Large text + Senior Mode (23 Nov 2026, Myuden)", () => {
  const STYLES = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "styles.css"),
    "utf8",
  );
  it("Large + Senior stack every settings row: label above, control below, left-aligned", () => {
    // The stacking block must cover BOTH selectors in one rule.
    const block = /\.settings-row\s*\{[^}]*flex-direction:\s*column[^}]*\}/s.exec(STYLES);
    assert.ok(block, "a .settings-row stacking rule must exist");
    const ruleHead = STYLES.slice(Math.max(0, STYLES.indexOf(block[0]) - 120), STYLES.indexOf(block[0]));
    assert.ok(ruleHead.includes('html[data-text-size="large"]'), "the stacking rule must cover Large text mode");
    assert.ok(ruleHead.includes("body.senior-mode"), "the stacking rule must cover Senior Mode");
    assert.ok(/align-items:\s*flex-start/.test(block[0]), "stacked rows must be left-aligned");
    // The label takes the full row width so long text wraps cleanly.
    assert.ok(
      /html\[data-text-size="large"\] \.settings-label,\s*body\.senior-mode \.settings-label\s*\{[^}]*width:\s*100%/.test(STYLES),
      "the label must take the full row width in Large + Senior",
    );
  });
  it("Small/Medium keep the one-line layout: the base rule stays a row flex", () => {
    const base = /\.settings-row \{ display: flex; align-items: center; justify-content: space-between;/.exec(STYLES);
    assert.ok(base, "the base .settings-row must stay a one-line flex row (Small/Medium unchanged)");
  });
  it("the Senior Mode button stays full-width", () => {
    assert.ok(/\.senior-btn \{ width: 100%; min-height: 48px;/.test(STYLES), ".senior-btn must stay full-width");
  });
});

describe("anonymous visitor counter — date gate (Myuden 22 Nov 21:02)", () => {
  it("todayKey returns the local date as YYYY-MM-DD, zero-padded", () => {
    assert.equal(todayKey(new Date(2026, 10, 22)), "2026-11-22");
    assert.equal(todayKey(new Date(2026, 0, 5)), "2026-01-05");
    assert.equal(todayKey(new Date(2026, 11, 31)), "2026-12-31");
  });
  it("shouldCountToday is true until the device is counted today", () => {
    assert.equal(shouldCountToday(null, "2026-11-22"), true);
    assert.equal(shouldCountToday(undefined, "2026-11-22"), true);
    assert.equal(shouldCountToday("2026-11-21", "2026-11-22"), true);
    assert.equal(shouldCountToday("2026-11-22", "2026-11-22"), false);
  });
  it("a device counted today is counted again tomorrow, not today", () => {
    // Same device, counted on the 22nd: no second count on the 22nd,
    // a fresh count on the 23rd — the 1x/day rule.
    assert.equal(shouldCountToday("2026-11-22", "2026-11-22"), false);
    assert.equal(shouldCountToday("2026-11-22", "2026-11-23"), true);
  });
  it("read/writeCountedDate round-trips through localStorage", () => {
    const store = new Map();
    const fakeStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    };
    const prev = globalThis.localStorage;
    globalThis.localStorage = fakeStorage;
    try {
      assert.equal(readCountedDate(), null);
      assert.equal(writeCountedDate("2026-11-22"), true);
      assert.equal(readCountedDate(), "2026-11-22");
      assert.equal(shouldCountToday(readCountedDate(), "2026-11-22"), false);
      assert.equal(shouldCountToday(readCountedDate(), "2026-11-23"), true);
    } finally {
      if (prev === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = prev;
    }
  });
  it("the counter only ever writes increment(1) — no personal data", () => {
    // Source pin: the only Firestore write in visitors.js is a
    // setDoc with { count: increment(1) }; no IP, user agent or
    // device ID is ever sent.
    const src = readFileSync(new URL("../src/visitors.js", import.meta.url), "utf8");
    assert.ok(src.includes("increment(1)"), "the write must be increment(1)");
    assert.ok(!src.includes("userAgent"), "no user agent is sent");
    assert.ok(!src.includes("navigator."), "no device info is sent");
    assert.ok(src.includes('"site_stats", "visitors"'), "the doc is site_stats/visitors");
  });
});

describe("warning-card layout planner (Variant A, 21 Nov)", () => {
  // Width stub: ~0.55em per character, like a proportional sans.
  const measure = (text, fontStr) => {
    const size = Number(fontStr.match(/(\d+)px/)[1]);
    return text.length * size * 0.55;
  };
  const base = {
    quote: "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel.",
    summary: "Pesan ini adalah penipuan klasik yang menjanjikan hadiah besar.",
    flags: ["Hadiah undian palsu", "Impersonasi Telkomsel", "Batas waktu mendesak"],
    next: "Jangan klik tautan apa pun, jangan bayar apa pun — blokir dan laporkan pengirim.",
    verdictWord: "PENIPUAN",
    scoreLabel: "SKOR RISIKO",
    scoreText: "95",
    measure,
  };

  it("typical scam card fits the 1080x1350 body budget", () => {
    const plan = planCardContent(base);
    assert.equal(plan.fits, true);
    assert.equal(plan.verdictSize, 84);
    assert.ok(plan.scoreBoxW >= 240);
    assert.equal(plan.quoteLines.length, 2); // 70 chars at the stub width wraps once
    assert.equal(plan.flagRows.length, 3);
  });

  it("long quote caps at 3 lines and ends with an ellipsis", () => {
    const plan = planCardContent({ ...base, quote: "Kata ".repeat(120) });
    assert.equal(plan.quoteLines.length, 3);
    assert.ok(plan.quoteLines[2].endsWith("…"));
    assert.equal(plan.truncated.quote, true);
    assert.equal(plan.fits, true);
  });

  it("long summary caps at 3 lines with an ellipsis", () => {
    const plan = planCardContent({ ...base, summary: "Kalimat panjang. ".repeat(60) });
    assert.equal(plan.summaryLines.length, 3);
    assert.ok(plan.summaryLines[2].endsWith("…"));
    assert.equal(plan.fits, true);
  });

  it("more than 4 flags are capped at 4 and reported truncated", () => {
    const plan = planCardContent({
      ...base,
      flags: ["Satu", "Dua", "Tiga", "Empat", "Lima", "Enam"],
    });
    assert.equal(plan.flagRows.length, 4);
    assert.equal(plan.truncated.flags, true);
    assert.equal(plan.fits, true);
  });

  it("an over-wide verdict word shrinks but never below 56px", () => {
    const plan = planCardContent({ ...base, verdictWord: "MENCURIGAKANSEKALI" });
    assert.ok(plan.verdictSize < 84);
    assert.ok(plan.verdictSize >= 56);
    assert.equal(plan.fits, true);
  });

  it("worst case (everything long) still fits after the caps shrink", () => {
    const plan = planCardContent({
      ...base,
      quote: "Kata ".repeat(200),
      summary: "Kalimat panjang. ".repeat(100),
      flags: ["Tanda bahaya yang sangat panjang sekali".repeat(3), "Dua".repeat(40), "Tiga".repeat(40), "Empat".repeat(40), "Lima".repeat(40)],
      next: "Jangan lakukan apa pun. ".repeat(40),
    });
    assert.equal(plan.fits, true);
    assert.ok(plan.totalHeight <= 1056);
  });

  it("empty quote / flags / next are skipped, card still fits", () => {
    const plan = planCardContent({ ...base, quote: "", flags: [], next: "" });
    assert.equal(plan.quoteLines.length, 0);
    assert.equal(plan.flagRows.length, 0);
    assert.equal(plan.nextLines.length, 0);
    assert.equal(plan.fits, true);
  });

  // Score-box number (21 Nov 19:06): the 84px digit ink used to cross
  // the box's bottom edge because the "top" baseline follows the
  // font's tall ascent. scoreNumberLayout places the ink by its
  // measured box instead, so 0 / 95 / 100 all fit identically.
  it("score number ink fits inside the 139px box at 84px (typical metrics)", () => {
    const l = scoreNumberLayout({ ascent: 60, descent: 0, smallAscent: 29 });
    assert.equal(l.size, 84);
    assert.ok(l.numberTop >= 44, `numberTop ${l.numberTop}`);
    assert.ok(l.inkBottom <= 129, `inkBottom ${l.inkBottom}`);
    assert.ok(l.smallBaseline < l.numberBaseline, "the /100 stays raised above the number baseline");
  });

  it("score number shrinks instead of overflowing on a tall font", () => {
    const l = scoreNumberLayout({ ascent: 90, descent: 5, smallAscent: 30 });
    assert.ok(l.size < 84 && l.size >= 48, `size ${l.size}`);
    assert.ok(l.inkBottom <= 129, `inkBottom ${l.inkBottom}`);
    assert.ok(l.numberTop >= 44, `numberTop ${l.numberTop}`);
  });

  it("score number layout is identical for 0, 95 and 100 (fixed font size)", () => {
    // The layout depends on ink metrics, not the digit string — all
    // three scores share the 84px font, so all three fit identically.
    const a = scoreNumberLayout({ ascent: 60, descent: 0, smallAscent: 29 });
    const b = scoreNumberLayout({ ascent: 60, descent: 0, smallAscent: 29 });
    assert.deepEqual(a, b);
    assert.equal(a.size, 84);
    assert.ok(a.inkBottom <= 129);
  });

  it("score number layout with the REAL measured metrics (Plus Jakarta Sans, alphabetic baseline)", () => {
    // Measured in Chromium 21 Nov 19:06: "95" @84px ascent 61 /
    // descent 1, "/100" @40px ascent 28. The digits must sit in the
    // free space below the label (top >= 44) with the ink bottom
    // well inside the box (<= 129), and the /100 stays raised.
    const l = scoreNumberLayout({ ascent: 61, descent: 1, smallAscent: 28 });
    assert.equal(l.size, 84);
    assert.ok(l.numberTop >= 44, `numberTop ${l.numberTop}`);
    assert.ok(l.inkBottom <= 129, `inkBottom ${l.inkBottom}`);
    assert.ok(l.smallBaseline < l.numberBaseline);
    // The baseline trap: metrics measured under textBaseline "top"
    // come back as ascent -4.9 / descent 66.9 — the same helper
    // then returns a baseline ~62px too high (50.6 vs ~116.5),
    // which is what overlapped the label. The renderer must never
    // feed those in; this locks the correct baseline in place.
    assert.ok(Math.abs(l.numberBaseline - 116.5) < 1, `numberBaseline ${l.numberBaseline}`);
  });
});

describe("audit 10 (22 Nov): bare-domain links, OJK area-code mismatch, tool badge, legacy note, counting rule", () => {
  // (c) A bare domain is a link too — it is normalized to https://
  // instead of being rejected (the auditor found example.com refused).
  it("normalizeLinkInput: bare domains gain https://, bad input stays empty", () => {
    assert.equal(normalizeLinkInput("https://example.com"), "https://example.com");
    // Audit 13 (D): the scheme is case-insensitive (RFC 3986) — an
    // uppercase scheme is normalized to lowercase so "HTTPS://..." and
    // "https://..." are the same link downstream. The host is kept
    // as typed (only the scheme is normalized).
    assert.equal(normalizeLinkInput("HTTP://EXAMPLE.COM"), "http://EXAMPLE.COM");
    assert.equal(normalizeLinkInput("HTTPS://Example.COM/x?token=abc123"), "https://Example.COM/x?token=abc123");
    assert.equal(normalizeLinkInput("example.com"), "https://example.com");
    assert.equal(normalizeLinkInput("www.example.com/path?q=1"), "https://www.example.com/path?q=1");
    assert.equal(normalizeLinkInput("example.com:8080/x"), "https://example.com:8080/x");
    // Groq review, audit 10: a port above 65535 is not a usable URL.
    assert.equal(normalizeLinkInput("example.com:65535"), "https://example.com:65535");
    assert.equal(normalizeLinkInput("example.com:65536"), "");
    assert.equal(normalizeLinkInput("example.com:99999"), "");
    // CoArena review, audit 10: the http(s) fast path must reject
    // hostless or malformed URLs instead of passing them on.
    assert.equal(normalizeLinkInput("https://"), "");
    assert.equal(normalizeLinkInput("http:// not-a-url"), "");
    assert.equal(normalizeLinkInput("https://example.com:99999"), "");
    assert.equal(normalizeLinkInput("https://example.com:65535"), "https://example.com:65535");
    assert.equal(normalizeLinkInput("https://user:pass@example.com"), "https://user:pass@example.com");
    assert.equal(normalizeLinkInput("https://192.168.1.1/x"), "https://192.168.1.1/x");
    assert.equal(normalizeLinkInput("  example.com  "), "https://example.com");
    assert.equal(normalizeLinkInput(""), "");
    assert.equal(normalizeLinkInput("   "), "");
    assert.equal(normalizeLinkInput("ftp://example.com"), "");
    assert.equal(normalizeLinkInput("javascript:alert(1)"), "");
    assert.equal(normalizeLinkInput("example"), "");
    assert.equal(normalizeLinkInput("foo bar.com"), "");
  });
  it("main.js wires the normalizer into Cek Tautan and stores the normalized URL", () => {
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    assert.ok(SRC.includes('import { lookupDomain, resolveShortLink, registrableDomain, normalizeLinkInput } from "./domain.js";'), "main.js must import normalizeLinkInput");
    assert.ok(SRC.includes("const input = normalizeLinkInput(rawInput);"), "link handler must normalize before validating");
    assert.ok(SRC.includes('t(rawInput ? "linktrackInvalid" : "linktrackEmpty", lang)'), "non-empty bad input must get the invalid-link wording, empty input the empty wording");
    for (const code of ["id", "en"]) {
      const msg = t("linktrackInvalid", code);
      assert.ok(msg && msg !== "linktrackInvalid" && msg.length > 10, `linktrackInvalid must be translated in ${code}`);
    }
  });

  // OJK: the same official number + the same light claim must land
  // in the same band whatever the number format (audit 10: "+62 21
  // 1500888" scored 25 Safe while "1500888" scored 60 Scam).
  it("analyzeCall: an official number with an area code still mismatches a foreign claim", async () => {
    const light = "Saya dari OJK, ada informasi untuk Anda";
    for (const number of ["1500888", "+62 21 1500888", "1500 888", "0211500888", "03311500888", "021188", "02114017"]) {
      const { verdict } = await analyzeCall({ number, said: light }, "id");
      assert.equal(verdict.riskScore, 60, `${number} must score 60 (bank 25 + mismatch 35), got ${verdict.riskScore}`);
      assert.equal(verdict.status, "scam", `${number} must be scam`);
      assert.ok(verdict.redFlags.some((f) => /identitas tidak cocok/.test(f)), `${number} must carry the mismatch flag`);
    }
    // The area-code strip must never turn a mobile number into an
    // official one: 08121500888 is NOT BCA's 1500888.
    const { verdict: mobile } = await analyzeCall({ number: "08121500888", said: light }, "id");
    assert.equal(mobile.riskScore, 25, "mobile 08121500888 must stay 25 (bank pattern only)");
    assert.equal(mobile.status, "safe");
    // A claim that matches the number's own institution stays clean.
    const { verdict: clean } = await analyzeCall({ number: "1500888", said: "Saya dari BCA, ada informasi untuk Anda" }, "id");
    assert.equal(clean.riskScore, 0);
    // An OJK claim on an UNKNOWN number stays 25 Safe — the claim
    // cannot be verified there, so the score honestly depends on
    // the rest of the script (documented boundary, not a bug).
    const { verdict: unknown } = await analyzeCall({ number: "081234567890", said: light }, "id");
    assert.equal(unknown.riskScore, 25);
    assert.equal(unknown.status, "safe");
  });
  it("currentMismatch answers the identity fact the history annotation reuses", () => {
    assert.deepEqual(currentMismatch("1500888", "Saya dari OJK, halo"), { official: "BCA", claimed: "OJK" });
    assert.deepEqual(currentMismatch("+62 21 1500888", "Saya dari OJK, halo"), { official: "BCA", claimed: "OJK" });
    assert.equal(currentMismatch("1500888", "Saya dari BCA, halo"), null);
    assert.equal(currentMismatch("081234567890", "Saya dari OJK, halo"), null);
    assert.equal(currentMismatch("", "Saya dari OJK, halo"), null);
    assert.equal(currentMismatch("1500888", "rapat besok jam 10"), null);
  });

  // (e) Every history row shows which tool produced it, so a
  // File-URL entry and a Link entry with the same input differ.
  it("main.js renders a tool badge on every history row and searches it", () => {
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    assert.ok(SRC.includes("historyToolLabel(e.kind)"), "historyRowHtml must use historyToolLabel");
    assert.ok(SRC.includes('class="history-tool"'), "the row must carry a .history-tool badge");
    assert.ok(SRC.includes("historyToolLabel(e.kind).toLowerCase().includes(q)"), "history search must match the tool label");
    const STYLES = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    assert.ok(/\.history-tool\s*\{/.test(STYLES), "styles.css must style .history-tool");
    assert.ok(/\.history-legacy\s*\{/.test(STYLES), "styles.css must style .history-legacy");
  });
  it("loadHistory copies kind from the local twin (cloud records carry no kind)", () => {
    const SRC = readFileSync(new URL("../src/history.js", import.meta.url), "utf8");
    assert.ok(SRC.includes("if (!entry.kind)"), "loadHistory must copy kind from the local twin");
  });

  // Legacy entries: the stored verdict is never rewritten — a visible
  // note says what the current rules would give instead.
  it("historyOldRules is translated in both languages and main.js uses it", () => {
    for (const code of ["id", "en"]) {
      const msg = t("historyOldRules", code, { n: 60, label: t("statusScam", code) });
      assert.ok(msg.includes("60/100"), `historyOldRules/${code} must carry the recomputed score: ${msg}`);
      assert.ok(!/historyOldRules/.test(msg), `historyOldRules/${code} must be translated`);
    }
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    assert.ok(SRC.includes('t("historyOldRules", lang,'), "legacyOjkNote must use historyOldRules");
    assert.ok(SRC.includes("callIdentityMismatch"), "the annotation must skip entries that already counted the mismatch");
    assert.ok(SRC.includes('c.id === "callReports" && c.found'), "the annotation must skip reported numbers (no mismatch bonus there)");
  });
  it("saveCheck stamps the scoring version so old entries stay identifiable", async () => {
    assert.equal(SCORING_VERSION, 2, "SCORING_VERSION must be 2 after audit 10");
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
    try {
      await saveCheck({ message: "x", status: "safe", riskScore: 0, redFlags: [], summary: "s", source: "LOCAL" });
      const [entry] = await loadHistory();
      assert.equal(entry.scoreVersion, 2, "a newly saved entry must carry scoreVersion 2");
    } finally {
      delete globalThis.localStorage;
    }
  });

  // (f) Counting rule: exactly once, at the moment the final verdict
  // renders. Every handler renders first and saves right after —
  // the totals bump is the render's shadow, never a separate event.
  it("saveCheck documents the unified counting rule and main.js keeps one save per handler", () => {
    const HIST = readFileSync(new URL("../src/history.js", import.meta.url), "utf8");
    assert.ok(HIST.includes("COUNTING RULE"), "saveCheck must document the counting rule");
    assert.ok(HIST.includes("exactly ONCE"), "the rule must say exactly once, at final-verdict render");
    const SRC = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
    const saves = (SRC.match(/await saveCheck\(/g) || []).length;
    assert.equal(saves, 8, `main.js must have exactly 8 saveCheck call sites (message, image, email, call, call transcript, file upload, file name, link), got ${saves}`);
  });
});

describe("audit 13 (22 Nov): stats hardening, email weight, uppercase scheme, rekening context, file + chat formats, simplified card", () => {
  // (A) Audit 16 regression: the totals are DERIVED from the list,
  // not incremented on a stored aggregate. Seed the auditor's exact
  // scene — legacy aggregate 103/51 + a 47-entry local list (20
  // scams) — then run the auditor's 12-check sequence. The totals
  // must reach 115/54 (3 scams in this sequence) and STAY there
  // (getStatsTotals re-reads storage, like a reload). The old
  // bumpTotalsFrom increment lost these updates (hero 104/51,
  // stored 103/51 after reload); deriving from the list makes the
  // loss impossible, and the migration recovers the baseline.
  it("audit 16: auditor's 12-check sequence accumulates 103/51 -> 115/54 and stays (derive-from-list)", async () => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
    try {
      // Auditor baseline: legacy aggregate 103/51, local list 47
      // entries (20 scams), recent dates.
      const entries = [];
      for (let i = 0; i < 47; i++) {
        entries.push({ id: `seed-${i}`, status: i < 20 ? "scam" : "safe", riskScore: i < 20 ? 95 : 0, createdAt: new Date(Date.now() - i * 3600e3).toISOString() });
      }
      store.set("pesanaman_history_v1", JSON.stringify(entries));
      store.set("tipucek_stats_totals_v1", JSON.stringify({ checked: 103, scams: 51, days: {} }));
      store.set("tipucek_local_only", "1");
      // Baseline preserved through the migration.
      assert.deepEqual(
        { checked: getStatsTotals().checked, scams: getStatsTotals().scams },
        { checked: 103, scams: 51 },
      );
      // The auditor's exact 12-check sequence (3 scams: #1, #3, #11).
      const seq = ["scam", "safe", "scam", "safe", "suspicious", "suspicious", "safe", "suspicious", "safe", "suspicious", "scam", "safe"];
      for (let i = 0; i < seq.length; i++) {
        await saveCheck({ message: `check ${i}`, status: seq[i], riskScore: 50, redFlags: [], summary: "s", source: "CODE" });
      }
      assert.equal((await loadHistory()).length, 59, "the list grew 47 -> 59");
      assert.deepEqual(
        { checked: getStatsTotals().checked, scams: getStatsTotals().scams },
        { checked: 115, scams: 54 },
      );
      // Still 115/54 on a fresh read (reload): the totals are stored
      // as list + trimmed bucket, not a lost increment.
      assert.deepEqual(
        { checked: getStatsTotals().checked, scams: getStatsTotals().scams },
        { checked: 115, scams: 54 },
      );
    } finally {
      delete globalThis.localStorage;
    }
  });

  // (B) The sender-name mismatch is 30, not 40 — it has been 30 since
  // the rule was written (commit 3c16d6f); the audit-12 "40" came from
  // a body that also triggered the +10 impersonation rule. Pin the
  // weights on the auditor's neutral body, and the 40 that body
  // reaches when it names the brand.
  it("email Tokopedia: 0 / 30 / 50 on the neutral body, 40 when the body names the brand", () => {
    const body = "Halo, terima kasih. Pesanan Anda sudah kami proses. Terima kasih.";
    assert.equal(analyzeEmail({ fromName: "Tokopedia", fromEmail: "no-reply@tokopedia.com", body }, "id").riskScore, 0);
    assert.equal(analyzeEmail({ fromName: "Tokopedia", fromEmail: "no-reply@tokopedia-promo.net", body }, "id").riskScore, 30);
    assert.equal(analyzeEmail({ fromName: "Tokopedia", fromEmail: "tokopedia@gmail.com", body }, "id").riskScore, 50);
    const branded = "Terima kasih telah berbelanja di Tokopedia. Pesanan Anda sudah kami proses.";
    assert.equal(analyzeEmail({ fromName: "Tokopedia", fromEmail: "no-reply@tokopedia-promo.net", body: branded }, "id").riskScore, 40);
  });

  // (D) An uppercase scheme is the same scheme (RFC 3986) — the
  // "links in this message" section must not vanish for HTTPS://.
  it("uppercase scheme links are extracted and normalized to lowercase", () => {
    const links = analyzeLinks("Cek tautan ini: HTTPS://example.com/?token=abc123");
    assert.equal(links.length, 1);
    assert.equal(links[0].url, "https://example.com/?token=abc123");
    assert.equal(links[0].host, "example.com");
    assert.equal(analyzeLink("HTTPS://EXAMPLE.COM/x").host, "example.com");
    assert.equal(normalizeLinkInput("HTTPS://Example.COM/x?token=abc123"), "https://Example.COM/x?token=abc123");
  });

  // (F) A bare "rekening" must not fire the money/OTP rule — it needs
  // a risky context (account number, account in trouble, destination
  // account, money sent to an account). The real scam phrasings must
  // still fire.
  it("bare 'rekening' does not fire moneyOtp; risky contexts still do", () => {
    const benign = analyzeWithHeuristic("Halo, rekening Anda sudah aktif. Terima kasih.", "id");
    assert.equal(benign.riskScore, 0, `benign "rekening" scored ${benign.riskScore}`);
    assert.equal(benign.checks.find((c) => c.id === "moneyOtp").found, false);
    const police = analyzeWithHeuristic("Dari POLRES: Akun rekening Anda terindikasi tindak pidana. Segera transfer seluruh saldo ke rekening aman 1234567890.", "id");
    assert.equal(police.checks.find((c) => c.id === "moneyOtp").found, true, "POLRES transfer-to-account must still fire moneyOtp");
    const num = analyzeWithHeuristic("Ini nomor rekening saya 1234567890, tolong dicek ya.", "id");
    assert.equal(num.checks.find((c) => c.id === "moneyOtp").found, true, "'nomor rekening' must still fire moneyOtp");
    const trouble = analyzeWithHeuristic("Rekening Anda bermasalah, segera hubungi kami untuk verifikasi.", "id");
    assert.equal(trouble.checks.find((c) => c.id === "moneyOtp").found, true, "'rekening bermasalah' must still fire moneyOtp");
  });

  // Link tracking: more shorteners are recognized as hidden destinations.
  it("new shorteners are judged by their hidden destination", () => {
    for (const host of ["rebrand.ly", "cut.ly", "short.io", "tiny.one", "lnk.to", "gg.gg"]) {
      const r = analyzeLink(`https://${host}/abc`);
      assert.equal(r.level, "high", `${host} should be high`);
      assert.ok(r.reasons.includes("linkRiskShortener"), `${host} should carry linkRiskShortener`);
    }
    // A regular site is never a shortener.
    assert.ok(!analyzeLink("https://example.com/abc").reasons.includes("linkRiskShortener"));
  });

  // File check: images, audio/video, scripts, packages and Office ZIPs
  // are recognized by magic bytes — and an unknown file stays unknown.
  it("file magic bytes: images, audio, video, archives, packages", async () => {
    const jpg = await inspectFile(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], "foto.jpg"));
    assert.equal(jpg.kind, "image");
    const png = await inspectFile(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "foto.png"));
    assert.equal(png.kind, "image");
    const gif = await inspectFile(new File([new TextEncoder().encode("GIF89a....")], "anim.gif"));
    assert.equal(gif.kind, "image");
    const webp = await inspectFile(new File([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])], "foto.webp"));
    assert.equal(webp.kind, "image");
    const mp3 = await inspectFile(new File([new Uint8Array([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0])], "lagu.mp3"));
    assert.equal(mp3.kind, "audio");
    const wav = await inspectFile(new File([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])], "rekaman.wav"));
    assert.equal(wav.kind, "audio");
    const mp4 = await inspectFile(new File([new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])], "video.mp4"));
    assert.equal(mp4.kind, "video");
    const mkv = await inspectFile(new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0, 0, 0])], "film.mkv"));
    assert.equal(mkv.kind, "video");
    const gz = await inspectFile(new File([new Uint8Array([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0])], "arsip.tar.gz"));
    assert.equal(gz.kind, "archive");
    const deb = await inspectFile(new File([new TextEncoder().encode("!<arch>\ndebian-binary")], "paket.deb"));
    assert.equal(deb.kind, "archive");
    const rpm = await inspectFile(new File([new Uint8Array([0xed, 0xab, 0xee, 0xdb, 0x03, 0, 0, 0])], "paket.rpm"));
    assert.equal(rpm.kind, "archive");
    // ISO 9660: "CD001" at byte 32769.
    const isoBytes = new Uint8Array(33000);
    isoBytes.set([0x43, 0x44, 0x30, 0x30, 0x31], 32769);
    const iso = await inspectFile(new File([isoBytes], "cakram.iso"));
    assert.equal(iso.kind, "archive");
    // DMG: "koly" trailer in the last 512 bytes.
    const dmgBytes = new Uint8Array(1024);
    dmgBytes.set([0x6b, 0x6f, 0x6c, 0x79], 600);
    const dmg = await inspectFile(new File([dmgBytes], "cakram.dmg"));
    assert.equal(dmg.kind, "archive");
    const dmgNoTrailer = await inspectFile(new File([new Uint8Array(1024)], "cakram2.dmg"));
    assert.equal(dmgNoTrailer.kind, "unknown", "a .dmg without the koly trailer stays unknown, not 'safe'");
    // MSI uses the OLE container but is an installer, not a document.
    const msi = await inspectFile(new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])], "setup.msi"));
    assert.equal(msi.kind, "exe");
    assert.equal(msi.level, "high");
    // Random bytes, unknown extension: unknown, never "safe".
    const unk = await inspectFile(new File([new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc])], "berkas.xyz"));
    assert.equal(unk.kind, "unknown");
    assert.equal(unk.reasonKey, "fileCheckUnknown");
  });
  it("Office ZIP documents read as documents, not generic archives", async () => {
    function zipWithEntries(names) {
      const parts = [];
      for (const name of names) {
        const nb = new TextEncoder().encode(name);
        const h = new Uint8Array(30);
        h[0] = 0x50; h[1] = 0x4b; h[2] = 0x03; h[3] = 0x04;
        h[26] = nb.length & 0xff; h[27] = (nb.length >> 8) & 0xff;
        parts.push(h, nb);
      }
      const total = parts.reduce((a, p) => a + p.length, 0);
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) { out.set(p, off); off += p.length; }
      return new Blob([out], { type: "application/octet-stream" });
    }
    const docx = await inspectFile(new File([zipWithEntries(["[Content_Types].xml", "word/document.xml"])], "laporan.docx"));
    assert.equal(docx.kind, "doc");
    const xlsx = await inspectFile(new File([zipWithEntries(["[Content_Types].xml", "xl/workbook.xml"])], "data.xlsx"));
    assert.equal(xlsx.kind, "doc");
    const plainZip = await inspectFile(new File([zipWithEntries(["readme.txt"])], "arsip.zip"));
    assert.equal(plainZip.kind, "archive");
  });
  it("scripts are read as text and scored; their names are programs", async () => {
    const scamJs = await inspectFile(new File([new TextEncoder().encode("SELAMAT! Anda menang Rp 50.000.000, klik http://bit.ly/hadiah dan bayar biaya admin!")], "update.js"));
    assert.equal(scamJs.kind, "script");
    assert.ok(scamJs.textContent && scamJs.textContent.includes("bit.ly"), "script content must be read for scoring");
    // Audit 13 (label fix): the content verdict drives the panel
    // headline — a scam script's content scores 82/scam, so the
    // panel must show Dangerous, never the green safe label.
    const scamScore = analyzeWithHeuristic(scamJs.textContent, "id");
    assert.equal(scamScore.riskScore, 82);
    assert.equal(scamScore.status, "scam");
    const benignSh = await inspectFile(new File([new TextEncoder().encode("#!/bin/sh\necho halo\n")], "hello.sh"));
    assert.equal(benignSh.kind, "script");
    assert.equal(benignSh.textContent, "#!/bin/sh\necho halo\n");
    assert.equal(analyzeWithHeuristic(benignSh.textContent, "id").status, "safe");
    assert.equal(analyzeFileName("update.js").kind, "script");
    assert.equal(analyzeFileName("update.js").level, "high");
    assert.equal(analyzeFileName("update.ps1").kind, "script");
    assert.equal(analyzeFileName("update.sh").kind, "script");
    assert.equal(analyzeFileName("update.py").kind, "script");
  });

  // Chat exports: Telegram JSON/HTML, Messenger JSON, plain lines —
  // and WhatsApp still parses as WhatsApp.
  it("Telegram JSON export parses (incl. entity-array text)", () => {
    const tg = JSON.stringify({
      name: "Chat", type: "personal_chat",
      messages: [
        { date: "2026-11-22T10:00:00", from: "Budi", text: "Halo, rapat pindah ke Kamis ya" },
        { date: "2026-11-22T10:01:00", from: "Promo", text: [{ type: "plain", text: "SELAMAT! Anda menang Rp 50.000.000, klik " }, { type: "link", text: "http://bit.ly/hadiah-2026" }, { type: "plain", text: " dan bayar biaya admin!" }] },
      ],
    });
    const res = scanChatLog(tg, "en");
    assert.equal(res.format, "telegram-json");
    assert.equal(res.total, 2);
    assert.equal(res.risky.length, 1);
    assert.equal(res.risky[0].sender, "Promo");
    assert.ok(res.risky[0].text.includes("bit.ly/hadiah-2026"), "entity-array text must be flattened");
  });
  it("Messenger JSON export parses, oldest first, unsent skipped", () => {
    const ms = JSON.stringify({
      participants: [{ name: "Budi" }, { name: "Promo" }],
      messages: [
        { sender_name: "Promo", content: "SELAMAT! Anda menang Rp 50.000.000, klik http://bit.ly/hadiah dan bayar biaya admin!", timestamp_ms: 2000 },
        { sender_name: "Budi", content: "Halo", timestamp_ms: 1000 },
        { sender_name: "Promo", content: "pesan ditarik", timestamp_ms: 3000, is_unsent: true },
        { sender_name: "Promo", timestamp_ms: 4000 },
      ],
    });
    const res = scanChatLog(ms, "en");
    assert.equal(res.format, "messenger-json");
    assert.equal(res.total, 2);
    assert.equal(res.risky.length, 1);
    assert.equal(res.risky[0].sender, "Promo");
    const parsed = parseChatExportWithFormat(ms, "en");
    assert.equal(parsed.messages[0].sender, "Budi", "Messenger exports list newest first — result must be oldest first");
  });
  it("Telegram HTML export parses from_name + text", () => {
    const html = [
      '<div class="message default clearfix" id="message1"><div class="body"><div class="pull_right date details" title="22.11.2026 10:00:00 UTC+07:00">10:00</div><div class="from_name">Budi</div><div class="text">Halo, rapat pindah ke Kamis ya</div></div></div>',
      '<div class="message default clearfix" id="message2"><div class="body"><div class="pull_right date details" title="22.11.2026 10:01:00 UTC+07:00">10:01</div><div class="from_name">Promo</div><div class="text">SELAMAT! Anda menang Rp 50.000.000, klik http://bit.ly/hadiah dan bayar biaya admin!</div></div></div>',
    ].join("\n");
    const res = scanChatLog(html, "en");
    assert.equal(res.format, "telegram-html");
    assert.equal(res.total, 2);
    assert.equal(res.risky.length, 1);
    assert.equal(res.risky[0].sender, "Promo");
  });
  it("plain lines without timestamps are scanned line by line", () => {
    const plain = "Halo, apa kabar?\nSELAMAT! Anda menang Rp 50.000.000, klik http://bit.ly/hadiah dan bayar biaya admin!\nOke, siap";
    const res = scanChatLog(plain, "en");
    assert.equal(res.format, "plain");
    assert.equal(res.total, 3);
    assert.equal(res.risky.length, 1);
    assert.equal(res.risky[0].sender, "Message");
    const wa = parseChatExportWithFormat("12/11/2026, 10:23 - Sari: Hai\n12/11/2026, 10:24 - Budi: Oke", "en");
    assert.equal(wa.format, "whatsapp");
    assert.equal(wa.messages.length, 2);
  });

  // Simplified card (Myuden 22 Nov 18:58): the new strings exist in
  // both languages, and main.js renders the summary + folded details
  // + who-answered line (source pins, not behaviour — the live probe
  // checks the rendered card).
  it("simplified-card strings exist in EN and ID", () => {
    for (const k of ["resultDetailsSummary", "resultAnsweredBy", "sourceWhoCloud", "sourceWhoDevice", "sourceWhoLocal", "sourceWhoCode", "sourceWhoDemo", "sourceWhoUnknown", "panelLangStale", "fileCheckImage", "fileCheckMedia", "fileCheckScript", "fileReasonScript", "fileVerdictUnknown", "chatlogFormat", "chatlogFormatPlain", "chatlogPlainSender"]) {
      const en = t(k, "en");
      const id = t(k, "id");
      assert.notEqual(en, k, `${k} missing in EN`);
      assert.notEqual(id, k, `${k} missing in ID`);
      assert.notEqual(en, id, `${k} is not translated (EN == ID)`);
    }
    // Who-answered nouns (23 Nov 18:06): short nouns, never full
    // sentences — a sentence value would double the phrase
    // ("Dijawab oleh Dijawab di cloud").
    for (const k of ["sourceWhoCloud", "sourceWhoDevice", "sourceWhoLocal", "sourceWhoCode", "sourceWhoDemo", "sourceWhoUnknown"]) {
      for (const l of ["en", "id"]) {
        const v = t(k, l);
        assert.ok(!/^(Dijawab|Diperiksa|Hasil|Sumber tidak|Answered|Checked|Code-check|Source unknown|Demo check|Cek demo)/.test(v), `${k} (${l}) must be a short noun, got: ${v}`);
      }
    }
    // The stale-language note is now neutral: it is accurate both
    // while a re-check is running and after one failed.
    assert.ok(!t("langStaleNote", "en").includes("failed"), "EN stale note must not claim a failure");
    assert.ok(!t("langStaleNote", "id").includes("gagal"), "ID stale note must not claim a failure");
  });
  it("main.js renders the simplified card and the E stale handling", () => {
    assert.ok(MAIN_JS.includes('<details class="result-details"'), "card must fold the details into <details class=\"result-details\">");
    assert.ok(MAIN_JS.includes('t("resultDetailsSummary"'), "details summary must be translated");
    assert.ok(MAIN_JS.includes('class="result-source-line"'), "card must show the who-answered line");
    assert.ok(MAIN_JS.includes('t("resultAnsweredBy"'), "who-answered line must be translated");
    // Who-answered value (23 Nov 18:06): sourceWho (short noun),
    // NEVER sourceLabel (full sentence — doubles the phrase).
    assert.ok(MAIN_JS.includes("who: sourceWho(verdict.source)"), "who-answered line must use sourceWho");
    assert.ok(!MAIN_JS.includes("who: sourceLabel(verdict.source)"), "who-answered line must not use sourceLabel");
    assert.ok(MAIN_JS.includes("resultDetailsOpen"), "details open/closed must survive a re-render");
    assert.ok(MAIN_JS.includes('class="main-sign"'), "the one-sentence main reason (Tanda utama) stays in the visible summary");
    // E: an AI verdict is marked stale at once on language switch
    // (the note shows during the re-check), code/demo verdicts are
    // re-derived and their stale flag is cleared.
    assert.ok(MAIN_JS.includes("langStale: true"), "AI verdict must be marked stale during the language re-check");
    assert.ok(MAIN_JS.includes("langStale: false"), "code/demo verdict must clear the stale flag on re-render");
    assert.ok(MAIN_JS.includes('t("panelLangStale"'), "file/link panels must show the stale note on language switch");
    // The unknown-file verdict must never be "safe" 0 (audit 13).
    assert.ok(MAIN_JS.includes('info.kind === "unknown"'), "fileVerdictFor must treat an unknown file specially");
    assert.ok(MAIN_JS.includes('"fileVerdictUnknown"'), "an unknown file must show the not-recognized label");
    // Audit 13 (label fix): the file panel headline follows the
    // VERDICT (fv.status), not the file TYPE's level — a script whose
    // content scores scam has level "low", so the old info.level
    // label showed the green safe headline for a scam.
    assert.ok(MAIN_JS.includes('fv.status === "scam" ? "fileVerdictHigh"'), "file panel headline must follow the verdict (fv.status)");
    assert.ok(!MAIN_JS.includes('info.level === "high" ? "fileVerdictHigh" : "fileVerdictLow"'), "the old info.level label must be gone");
  });
});

// ============================================================
// 23 Nov 2026: safety floor (lantai pengaman) vonis AI
// Pure unit tests — no Firebase, no network. AI verdicts are
// stubs (plain objects). The floor itself is deterministic.
// ============================================================
describe("23 Nov 2026: safety floor (lantai pengaman) vonis AI", () => {
  // Teks benchmark yang dipakai (harus cocok persis dengan benchmark).
  const OTP_BCA = "BCA: Kode OTP Anda 482916. Jangan berikan kode ini ke siapapun termasuk petugas bank. Jika Anda tidak merasa melakukan transaksi, segera hubungi 0812-9876-5432.";
  const OTP_LEGIT = "Kode verifikasi Tokopedia Anda: 482916. Jangan berikan kode ini kepada siapa pun, termasuk karyawan Tokopedia.";
  const SAFE_OFFICE_ID = "Hi Budi, ini Sari dari kantor. Rapat tim dipindah ke Kamis jam 10:00 di ruang 3B. Tolong bawa laporan Q3. Sampai jumpa!";
  const COURIER_LINK = "J&T: Paket Anda tertunda karena alamat tidak lengkap. Perbarui alamat Anda di sini: http://jnt-update-alamat.com";
  const PROMO_LINK = "Selamat! Anda mendapat voucher Rp 100.000 dari Tokopedia. Klaim sekarang: https://tokopedia.com/voucher";
  const JOB_REAL = "Lowongan: Admin toko, gaji Rp 4,5 juta/bulan, jam kerja 09:00-17:00. Kirim CV ke tokoabadi@gmail.com.";

  // Verifikasi asumsi: skor lokal untuk tiap teks (agar tes tidak berbohong).
  it("asumsi skor lokal: OTP_BCA = scam 60, OTP_LEGIT = safe 0, SAFE_OFFICE_ID = safe 0", () => {
    const otpBca = analyzeWithHeuristic(OTP_BCA, "id");
    assert.equal(otpBca.status, "scam");
    assert.equal(otpBca.riskScore, 60);
    const otpLegit = analyzeWithHeuristic(OTP_LEGIT, "id");
    assert.equal(otpLegit.status, "safe");
    assert.equal(otpLegit.riskScore, 0);
    const safeOffice = analyzeWithHeuristic(SAFE_OFFICE_ID, "id");
    assert.equal(safeOffice.status, "safe");
    assert.equal(safeOffice.riskScore, 0);
  });

  it("asumsi skor lokal: COURIER=suspicious 30, PROMO=suspicious 32, JOB_REAL=safe 16", () => {
    const courier = analyzeWithHeuristic(COURIER_LINK, "id");
    assert.equal(courier.status, "suspicious");
    assert.equal(courier.riskScore, 30);
    const promo = analyzeWithHeuristic(PROMO_LINK, "id");
    assert.equal(promo.status, "suspicious");
    assert.equal(promo.riskScore, 32);
    const job = analyzeWithHeuristic(JOB_REAL, "id");
    assert.equal(job.status, "safe");
    assert.equal(job.riskScore, 16);
  });

  it("OTP BCA + AI safe 5 → lantai AKTIF: scam 60, floorApplied true, source/model/redacted dari AI", () => {
    const aiVerdict = { status: "safe", riskScore: 5, redFlags: [], summary: "Looks safe.", source: "IN_CLOUD", model: "gemini-3.5-flash-lite", redacted: [] };
    const result = applySafetyFloor(aiVerdict, OTP_BCA, "id");
    assert.equal(result.floorApplied, true);
    assert.equal(result.status, "scam");
    assert.equal(result.riskScore, 60);
    // source/model/redacted HARUS dari AI, bukan dari lokal
    assert.equal(result.source, "IN_CLOUD");
    assert.equal(result.model, "gemini-3.5-flash-lite");
    assert.deepEqual(result.redacted, []);
    // redFlags dan summary dari lokal (bukan AI)
    assert.ok(result.redFlags.length > 0, "redFlags lokal harus ada");
    assert.ok(Array.isArray(result.checks) && result.checks.length > 0, "checks lokal harus ada");
  });

  it("OTP BCA + AI suspicious 40 → lantai AKTIF (AI bukan scam)", () => {
    const aiVerdict = { status: "suspicious", riskScore: 40, redFlags: ["OTP code"], summary: "Suspicious.", source: "ON_DEVICE", model: "on-device", redacted: [{ kind: "otp", count: 1 }] };
    const result = applySafetyFloor(aiVerdict, OTP_BCA, "id");
    assert.equal(result.floorApplied, true);
    assert.equal(result.status, "scam");
    assert.equal(result.riskScore, 60);
    // redacted dari AI (bukan dikosongkan)
    assert.deepEqual(result.redacted, [{ kind: "otp", count: 1 }]);
  });

  it("OTP BCA + AI sudah scam 85 → lantai TIDAK aktif, skor AI 85 dipertahankan", () => {
    const aiVerdict = { status: "scam", riskScore: 85, redFlags: ["OTP theft"], summary: "Scam.", source: "IN_CLOUD", model: "gemini-3.5-flash-lite", redacted: [] };
    const result = applySafetyFloor(aiVerdict, OTP_BCA, "id");
    assert.equal(result.floorApplied, false);
    assert.equal(result.status, "scam");
    assert.equal(result.riskScore, 85, "skor AI dipertahankan, bukan 60");
  });

  it("OTP BCA + AI scam tapi skor 40 (<60) → lantai AKTIF: status scam saja tidak cukup, skor harus >= 60 (temuan CoArena, LOW)", () => {
    const aiVerdict = { status: "scam", riskScore: 40, redFlags: ["OTP theft"], summary: "Scam.", source: "IN_CLOUD", model: "gemini-3.5-flash-lite", redacted: [] };
    const result = applySafetyFloor(aiVerdict, OTP_BCA, "id");
    assert.equal(result.floorApplied, true, "AI bilang scam tapi skornya < 60 = miss");
    assert.equal(result.status, "scam");
    assert.equal(result.riskScore, 60, "skor lokal 60 yang dipakai, bukan 40 AI");
  });

  it("OTP asli Tokopedia + AI safe 0 → lantai TIDAK aktif (lokal 0 < 60)", () => {
    const aiVerdict = { status: "safe", riskScore: 0, redFlags: [], summary: "Legitimate OTP.", source: "IN_CLOUD", model: "gemini-3.5-flash-lite", redacted: [] };
    const result = applySafetyFloor(aiVerdict, OTP_LEGIT, "id");
    assert.equal(result.floorApplied, false);
    assert.equal(result.status, "safe");
    assert.equal(result.riskScore, 0);
  });

  it("pesan kantor aman + AI safe 0 → lantai TIDAK aktif", () => {
    const aiVerdict = { status: "safe", riskScore: 0, redFlags: [], summary: "Office message.", source: "ON_DEVICE", model: "on-device", redacted: [] };
    const result = applySafetyFloor(aiVerdict, SAFE_OFFICE_ID, "id");
    assert.equal(result.floorApplied, false);
    assert.equal(result.status, "safe");
  });

  it("kurir ambigu (lokal 30) + AI scam 95 → lantai TIDAK aktif, AI 95 dipertahankan (lantai tidak memperbaiki kasus ini)", () => {
    // Ini menegaskan: lantai hanya melindungi dari false negative AI,
    // TIDAK menekan false positive AI. Kasus ambigu bergantung pada prompt.
    const aiVerdict = { status: "scam", riskScore: 95, redFlags: ["suspicious link"], summary: "Scam link.", source: "IN_CLOUD", model: "gemini-3.5-flash-lite", redacted: [] };
    const result = applySafetyFloor(aiVerdict, COURIER_LINK, "id");
    assert.equal(result.floorApplied, false);
    assert.equal(result.riskScore, 95);
  });

  it("promo ambigu (lokal 32) + AI scam 90 → lantai TIDAK aktif (lokal 32 < 60)", () => {
    const aiVerdict = { status: "scam", riskScore: 90, redFlags: ["voucher scam"], summary: "Fake promo.", source: "IN_CLOUD", model: "gemini-3.5-flash-lite", redacted: [] };
    const result = applySafetyFloor(aiVerdict, PROMO_LINK, "id");
    assert.equal(result.floorApplied, false);
    assert.equal(result.riskScore, 90);
  });

  it("lowongan real (lokal 16) + AI safe 0 → lantai TIDAK aktif (lokal 16 < 60)", () => {
    const aiVerdict = { status: "safe", riskScore: 0, redFlags: [], summary: "Genuine job.", source: "IN_CLOUD", model: "gemini-3.5-flash-lite", redacted: [] };
    const result = applySafetyFloor(aiVerdict, JOB_REAL, "id");
    assert.equal(result.floorApplied, false);
    assert.equal(result.status, "safe");
  });

  it("batas ambang: lokal tepat 60 (OTP BCA) + AI scam 60 → TIDAK aktif; + AI safe 5 → aktif", () => {
    // Tidak ada kasus nyata di skor lokal tepat 59 di kedua benchmark.
    // OTP_BCA adalah kasus nyata paling dekat (60). Untuk membuktikan
    // batas bawah, kita gunakan aiVerdict scam 60 (tidak memenuhi
    // syarat "aiMissed") vs aiVerdict safe 5 (memenuhi syarat).
    // Kasus 60 lokal + AI scam 60 → NOT missed (AI sudah scam >= 60).
    const ai60 = { status: "scam", riskScore: 60, redFlags: [], summary: "s", source: "IN_CLOUD", model: "m", redacted: [] };
    assert.equal(applySafetyFloor(ai60, OTP_BCA, "id").floorApplied, false,
      "AI scam 60 bukan 'miss' — lantai tidak aktif");
    // Kasus 60 lokal + AI safe 5 → lantai aktif.
    const ai5 = { status: "safe", riskScore: 5, redFlags: [], summary: "s", source: "IN_CLOUD", model: "m", redacted: [] };
    assert.equal(applySafetyFloor(ai5, OTP_BCA, "id").floorApplied, true,
      "lokal 60 + AI miss → lantai aktif");
  });

  it("input defensif: aiVerdict null → tidak crash, output memiliki floorApplied", () => {
    const result = applySafetyFloor(null, OTP_BCA, "id");
    assert.ok(typeof result.floorApplied === "boolean");
    assert.equal(result.floorApplied, true, "null AI verdict dihitung sebagai miss → lantai aktif");
  });

  it("input defensif: message kosong → tidak crash, lantai tidak aktif (lokal 0)", () => {
    const aiVerdict = { status: "safe", riskScore: 0, redFlags: [], summary: "", source: "IN_CLOUD", model: "m", redacted: [] };
    const result = applySafetyFloor(aiVerdict, "", "id");
    assert.equal(result.floorApplied, false);
  });

  it("buildPrompt mengandung instruksi OTP SCAM (23 Nov 2026)", () => {
    const p = buildPrompt("test", "id");
    assert.ok(p.includes("OTP SCAM"), "harus ada label OTP SCAM");
    assert.ok(p.includes("hubungi") || p.includes("contact"), "harus menyebut larangan menyuruh hubungi nomor");
    assert.ok(p.includes("85"), "harus menyebut riskScore 85+");
  });

  it("buildPrompt mengandung instruksi AMBIGUOUS CASES (23 Nov 2026)", () => {
    const p = buildPrompt("test", "en");
    assert.ok(p.includes("AMBIGUOUS CASES"), "harus ada label AMBIGUOUS CASES");
    assert.ok(p.includes("suspicious") && p.includes("30"), "harus menyebut suspicious + rentang skor");
  });
});
