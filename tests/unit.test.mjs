// TipuCek unit tests — pure local logic only (no network, no Firebase).
// Run: node --test tests/unit.test.mjs
// These pin the behaviour the Devpost description cites: the local
// rule engine, the link/number analysis, the outbound guard, the chat
// export scanner, the file-structure check and the quiz bank.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeWithHeuristic } from "../src/ai.js";
import { analyzeLink, analyzeLinks, extractNumbers } from "../src/risks.js";
import { maskDigits, analyzeOutgoing } from "../src/outbound.js";
import { parseChatExport, scanChatLog, CHATLOG_MAX_BYTES } from "../src/chatlog.js";
import { inspectFile, sha256HexOfBlob } from "../src/filecheck.js";
import { getQuizQuestions } from "../src/quiz.js";
import { registrableDomain } from "../src/domain.js";
import { analyzeEmail } from "../src/emailcheck.js";
import { analyzeCall } from "../src/callcheck.js";

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
  it("OTP phishing sample = suspicious 40 (urgency + OTP ask, no link)", () => {
    // Pinned true value (verified 19 Nov): the rules cannot know BCA's
    // real number, so this is suspicious, not scam. Do not inflate it.
    const v = analyzeWithHeuristic(OTP_SAMPLE, "en");
    assert.equal(v.status, "suspicious");
    assert.equal(v.riskScore, 40);
  });
  it("empty message = safe 0", () => {
    const v = analyzeWithHeuristic("   ", "en");
    assert.equal(v.status, "safe");
    assert.equal(v.riskScore, 0);
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
    assert.equal(analyzeLink("https://xn--bca-9ya.co.id/").level, "high");
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

describe("call check privacy gate (audit §2c)", () => {
  const SAID = "Saya dari bank BCA, akun Anda akan diblokir, kirim kode OTP sekarang.";
  it("default (no allowReports): no lookup, pattern score only", async () => {
    const { verdict, reportCount } = await analyzeCall({ number: "081234567890", said: SAID }, "en");
    assert.equal(reportCount, null);
    assert.equal(verdict.riskScore, 85);
    assert.equal(verdict.status, "scam");
    assert.equal(verdict.source, "LOCAL");
  });
  it("allowReports:true in demo mode (no Firebase): still no count, same score", async () => {
    const { verdict, reportCount } = await analyzeCall({ number: "081234567890", said: SAID }, "en", { allowReports: true });
    assert.equal(reportCount, null);
    assert.equal(verdict.riskScore, 85);
  });
});
