// TipuCek unit tests — pure local logic only (no network, no Firebase).
// Run: node --test tests/unit.test.mjs
// These pin the behaviour the Devpost description cites: the local
// rule engine, the link/number analysis, the outbound guard, the chat
// export scanner, the file-structure check and the quiz bank.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { t, LANGUAGES } from "../src/i18n.js";
import {
  validateCrowdReport,
  normalizeCrowdPhone,
  normalizeCrowdAccount,
  loadLocalReports,
  recordLocalReport,
} from "../src/crowdreport.js";
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
  it("heroStat exists in all 8 languages with the Devpost numbers", () => {
    for (const code of LANG_CODES) {
      const s = t("heroStat", code);
      assert.notEqual(s, "heroStat", `${code}: key missing`);
      assert.ok(/Rp/.test(s), `${code}: no Rp — ${s}`);
      assert.ok(/9[,.]1/.test(s), `${code}: no 9.1/9,1 — ${s}`);
      assert.ok(/411[.,]000\+/.test(s), `${code}: no 411.000+/411,000+ — ${s}`);
      assert.ok(/OJK \(IASC\)/.test(s), `${code}: no OJK (IASC) — ${s}`);
      assert.ok(/2024/.test(s) && /2025/.test(s), `${code}: no Nov 2024–Dec 2025 — ${s}`);
    }
  });
  it("Indonesian stat matches DEVPOST-DESCRIPTION.md exactly", () => {
    assert.equal(
      t("heroStat", "id"),
      "Rp 9,1 triliun kerugian penipuan dari 411.000+ laporan · Nov 2024–Des 2025 · OJK (IASC)",
    );
  });
  it("English stat matches the Devpost wording", () => {
    assert.equal(
      t("heroStat", "en"),
      "Rp 9.1 trillion lost to scams in 411,000+ reports · Nov 2024–Dec 2025 · OJK (IASC)",
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
    "moduleTabHistory",
    "moduleTabReport",
    "moduleTabHow",
  ];
  it("every module-tab label exists in all 8 languages", () => {
    for (const key of TAB_KEYS) {
      for (const code of LANG_CODES) {
        const s = t(key, code);
        assert.ok(typeof s === "string" && s.length > 0 && s !== key, `${key} missing in ${code}`);
      }
    }
  });
  it("index.html has 10 module-tab buttons + 10 panels, file first", () => {
    const btns = [...INDEX_HTML.matchAll(/id="module-tab-([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(btns, ["file", "link", "contacts", "aid", "report", "chatlog", "quiz", "assistant", "history", "how"]);
    const panels = [...INDEX_HTML.matchAll(/role="tabpanel" aria-labelledby="module-tab-([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(panels, ["file", "link", "contacts", "aid", "report", "chatlog", "quiz", "assistant", "history", "how"]);
    // Only the file panel is visible by default; the rest start hidden.
    const hiddenPanels = [...INDEX_HTML.matchAll(/aria-labelledby="module-tab-([a-z]+)" hidden/g)].map((m) => m[1]);
    assert.deepEqual(hiddenPanels, ["link", "contacts", "aid", "report", "chatlog", "quiz", "assistant", "history", "how"]);
  });
  it("quick check comes before the samples (check button above the fold)", () => {
    const checkAt = INDEX_HTML.indexOf('id="check-btn"');
    const samplesAt = INDEX_HTML.indexOf('id="samples"');
    assert.ok(checkAt > 0 && samplesAt > 0 && checkAt < samplesAt, "check button must precede the samples list");
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
      for (const code of ["en", "id"]) {
        const v = t(key, code);
        for (const b of banned) {
          assert.ok(!v.includes(b), `${key}/${code} contains jargon ${JSON.stringify(b)}: ${v.slice(0, 80)}`);
        }
      }
    }
  });
  it("file fingerprint label is plain in all 8 languages", () => {
    assert.equal(t("fileFingerprintLabel", "en"), "File fingerprint");
    assert.equal(t("fileFingerprintLabel", "id"), "Sidik file");
    for (const code of LANG_CODES) {
      const s = t("fileFingerprintLabel", code);
      assert.ok(typeof s === "string" && s.length > 0 && s !== "fileFingerprintLabel", code);
    }
  });
});

describe("static fallback is Bahasa Indonesia (polish 19 Nov)", () => {
  it("every data-i18n key in index.html resolves in all 8 languages", () => {
    const keys = new Set([...INDEX_HTML.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]));
    assert.ok(keys.size > 50, `only ${keys.size} data-i18n keys found`);
    for (const key of keys) {
      for (const code of LANG_CODES) {
        assert.notEqual(t(key, code), key, `${key} missing in ${code}`);
      }
    }
  });
  it("every data-i18n-placeholder key resolves in all 8 languages", () => {
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
    assert.ok(INDEX_HTML.includes('placeholder="Tempel pesan mencurigakan di sini…"'), "placeholder fallback must be Indonesian");
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
  it("crowd form strings exist in all 8 languages (incl. JS-set labels)", () => {
    for (const key of ["crowdValuePhone", "crowdValueAccount", "crowdValueMode", "crowdValuePhPhone", "crowdValuePhAccount", "crowdValuePhMode", "crowdSubmitting", "crowdHistoryPending", "crowdThanks", "crowdReceipt", "crowdPrivacy"]) {
      for (const code of LANG_CODES) {
        assert.notEqual(t(key, code), key, `${key} missing in ${code}`);
      }
    }
  });
});
