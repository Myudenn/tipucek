// TipuCek — scam-message analysis.
//
// Two paths, one result shape:
//  1. PRODUCTION: Firebase AI Logic, hybrid inference
//     (InferenceMode.PREFER_ON_DEVICE, cloud model gemini-3.5-flash-lite).
//     Used whenever a real Firebase config is present.
//  2. DEMO: a local keyword heuristic, used only while the Firebase config
//     is still a placeholder, so the whole UI can be tested end-to-end
//     without any account. The demo path NEVER pretends to be AI: the UI
//     shows a "Demo mode" banner and the verdict source is "DEMO".
//
// Result shape (both paths):
//   { status: "safe" | "suspicious" | "scam",
//     riskScore: 0-100,
//     redFlags: string[],
//     summary: string,
//     source: "ON_DEVICE" | "IN_CLOUD" | "DEMO" | "Unknown" }

import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";
import { languageName, demoSummary, demoFlag } from "./i18n.js";
import { redactForAI } from "./redact.js";

export const CLOUD_MODEL = "gemini-3.5-flash-lite";

// Backup cloud model (failover, Myuden 20 Nov 02:46): tried once when
// the primary model fails or times out. Live test 20 Nov ~02:32:
// 44/54 (81%) success, 3 false positives — slightly less accurate
// than the primary, but far better than no AI verdict at all.
export const BACKUP_CLOUD_MODEL = "gemini-3.1-flash-lite";

// Longest message accepted for a check. A pasted chat export can be
// huge — sending it whole to the cloud wastes tokens and risks a
// misleading "input is too large" error, so reject it up front with a
// clear message instead (the UI maps it to a friendly string).
export const MAX_MESSAGE_CHARS = 4000;

// Cloud calls must never hang the UI forever: only the on-device init
// used to be raced against a timeout. Every generateContent now has
// one too — 30 s for a verdict (cloud answers in ~2-4 s in practice;
// 30 s is still 7x the normal time). Worst case for a verdict is
// 5 s init + 30 s hybrid + 30 s primary cloud + 30 s backup model
// = ~95 s before the code-only card appears — but only when every
// leg hangs the full 30 s; in practice the hybrid leg fails fast
// (on-device not ready) and the measured failover worst case is
// ~36 s (live, 20 Nov). Each attempt keeps its own 30 s budget
// (Myuden 19 Nov 23:43). 30 s also for a chat answer, 30 s for a
// screenshot (vision + OCR).
export const CLOUD_CHECK_TIMEOUT_MS = 30000;
export const ASSISTANT_TIMEOUT_MS = 30000;
export const IMAGE_CHECK_TIMEOUT_MS = 30000;
// Transcription of a phone recording can take longer than a text
// check (a 2-minute clip); 60 s is the cap, with an honest error
// after it instead of a silent hang.
export const AUDIO_CHECK_TIMEOUT_MS = 60000;
// Longest recording accepted for transcription (10 MB). A 2-minute
// voice clip is ~1-2 MB, so this is generous without letting a huge
// file waste the user's time and tokens.
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** Race a promise against a timeout; the loser is ignored. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
      ms,
    );
  });
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    timeout,
  ]);
}

/**
 * Try the cloud models in order (primary, then the backup once) for a
 * single generateContent call. `makeCall(modelName)` builds the model
 * and returns its generateContent promise — same prompt, same schema,
 * only the model name differs. Each attempt gets its own timeout
 * (30 s in production). `onBackup` fires before the backup attempt so
 * the UI can say so honestly. Returns { result, model } — the model
 * that answered. Throws the last error when every attempt fails. The
 * backup is only ever reached when the primary fails or times out; a
 * successful primary never triggers a backup call.
 */
export async function generateWithFailover(
  makeCall,
  { timeoutMs = CLOUD_CHECK_TIMEOUT_MS, label = "Check", onBackup } = {},
) {
  const attempts = [CLOUD_MODEL, BACKUP_CLOUD_MODEL];
  let lastError;
  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    if (i > 0) onBackup?.();
    try {
      const result = await withTimeout(makeCall(model), timeoutMs, label);
      return { result, model };
    } catch (e) {
      lastError = e;
      console.warn(`[TipuCek] Cloud model ${model} failed:`, e?.message || e);
    }
  }
  throw lastError;
}

// On-device model prep is the slow step (first download can take 10-20s).
// Give it a short window: when the model is already on the device it is
// ready in ~1s, and when it is not, the cloud model answers in ~2s —
// waiting longer only delays the verdict.
export const ON_DEVICE_INIT_TIMEOUT_MS = 5000;

// Structured-output schema for the verdict (shared by the check path and
// the background warm-up). Takes the Schema namespace as an argument
// because firebase/ai is imported dynamically.
function makeVerdictSchema(Schema) {
  return Schema.object({
    description: "Scam verdict for a suspicious message",
    properties: {
      status: Schema.enumString({
        description: "Overall verdict",
        enum: ["safe", "suspicious", "scam"],
      }),
      riskScore: Schema.integer({
        description: "Risk score from 0 (harmless) to 100 (certain scam)",
      }),
      redFlags: Schema.array({
        description: "Warning signs found in the message",
        items: Schema.string({ description: "One red flag, short phrase" }),
      }),
      summary: Schema.string({
        description: "One or two sentences explaining the verdict",
      }),
    },
  });
}

function makeHybridModel(ai, getGenerativeModel, InferenceMode, verdictSchema) {
  return getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    inCloudParams: {
      model: CLOUD_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: verdictSchema,
      },
    },
    onDeviceParams: {
      promptOptions: { responseConstraint: verdictSchema },
    },
  });
}

// Verdict schema for screenshot analysis: the four verdict fields plus
// the text the model read from the image (OCR), so the UI can show what
// was actually analyzed.
function makeImageVerdictSchema(Schema) {
  return Schema.object({
    description: "Scam verdict for a screenshot of a message",
    properties: {
      status: Schema.enumString({
        description: "Overall verdict",
        enum: ["safe", "suspicious", "scam"],
      }),
      riskScore: Schema.integer({
        description: "Risk score from 0 (harmless) to 100 (certain scam)",
      }),
      redFlags: Schema.array({
        description: "Warning signs found in the message",
        items: Schema.string({ description: "One red flag, short phrase" }),
      }),
      summary: Schema.string({
        description: "One or two sentences explaining the verdict",
      }),
      extractedText: Schema.string({
        description: "The exact text read from the image (OCR); empty if none visible",
      }),
    },
  });
}

// Shared start-up for every production AI call: Firebase app + App Check
// pre-flight (fail fast with the real reason instead of a bare 401) +
// the AI client. Used by the check path, the assistant chat and the
// screenshot path alike.
async function ensureAIReady() {
  const app = await getFirebaseApp();
  let tokenInfo = "";

  // Pre-flight: make sure App Check can actually mint a token before the
  // AI call. Without a token the server rejects the request with a bare
  // 401, so fail here with the real reason instead.
  if (appCheckInitError) {
    throw new Error(`App Check failed to initialize: ${appCheckInitError}`);
  }
  if (appCheckInstance) {
    const { getToken } = await import("firebase/app-check");
    try {
      const { token } = await getToken(appCheckInstance, false);
      // Decode the JWT payload (best effort) so a later failure can say
      // exactly which token was presented: app, audience, issue/expiry.
      try {
        const payload = JSON.parse(
          atob(
            token
              .split(".")[1]
              .replace(/-/g, "+")
              .replace(/_/g, "/"),
          ),
        );
        tokenInfo = `app_id=${payload.app_id || payload.sub || "?"} aud=${payload.aud || "?"} iat=${payload.iat ? new Date(payload.iat * 1000).toISOString() : "?"} exp=${payload.exp ? new Date(payload.exp * 1000).toISOString() : "?"}`;
      } catch {
        tokenInfo = `unparseable token (length ${token.length})`;
      }
    } catch (e) {
      throw new Error(
        `App Check could not obtain a token: ${e?.message || e}`,
      );
    }
  }

  const { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } =
    await import("firebase/ai");
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  return { ai, getGenerativeModel, InferenceMode, Schema, tokenInfo };
}

// ---------------------------------------------------------------------------
// Demo-mode heuristic analyzer (local, no network, no AI).
// Keyword-based scoring for Indonesian + English scam messages.
// ---------------------------------------------------------------------------

const SCAM_PATTERNS = [
  // Urgency / threats (ID + EN). "Hari ini juga" (today, right now)
  // and scarcity ("slot terbatas", "kuota terbatas") added 23 Nov 2026
  // regression: a POLRES arrest threat ("...atau Anda akan ditangkap
  // hari ini juga") scored Safe 22 — the arrest threat alone was not
  // in any pattern — and a guaranteed-profit investment ("slot
  // terbatas 20 orang") had no pressure signal at all.
  { re: /\b(segera|sekarang juga|hari ini juga|dalam 24 jam|batas waktu|slot terbatas|kuota terbatas|sebelum.*ditutup|akun.*(diblokir|ditutup|dinonaktifkan)|account.*(blocked|closed|suspended|locked)|act (now|immediately)|within 24 hours|urgent|immediately)\b/i, weight: 18, id: "urgency", flag: "Urgency / threat: pressure to act immediately" },
  // Prize / free money. A bare "selamat" must NEVER match on its own:
  // it is also the everyday greeting ("Selamat pagi" = good morning),
  // and matching it flagged an OTP call script with no prize promise
  // as "Janji hadiah" (21 Nov, audit 4). A prize promise needs prize
  // words nearby (menang/mendapatkan/hadiah/undian/won/prize/...).
  // "Klaim" / "voucher" added 23 Nov 2026 regression: "Selamat! Anda
  // mendapat voucher Rp 100.000 dari Tokopedia. Klaim sekarang: ..."
  // scored Safe 10 — "mendapat" did not match "mendapatkan" and
  // "klaim" was not a prize word at all. Spanish prize words added
  // the same day (scam-prize-es): the app is ID+EN, but scam messages
  // arrive in any language — the AI judges all of them, and the rules
  // should at least catch an obvious foreign prize scam.
  { re: /\b(selamat.*(menang|mendapat(kan)?)|hadiah|undian|giveaway|klaim|voucher|you (have )?won|congratulations.*won|claim.*prize|free.*(money|cash|iphone|gift)|felicidades|has ganado|ganaste|sorteo|premio)\b/i, weight: 22, id: "prize", flag: "Prize / free-money promise" },
  // Suspicious link / short link. The shortener names carry a word
  // boundary (23 Nov 2026 regression): without it, "t.co" matched
  // inside "alamat.com" and "contact.com" and "s.id" inside
  // "bisnis.id" — any .com/.id URL ending in those letters scored
  // +20. The J&T courier text ("Perbarui alamat Anda di sini:
  // http://jnt-update-alamat.com") only scored suspicious because of
  // that accident, so "perbarui" joins "klik" as the verb that makes
  // "...di sini: <link>" a suspicious-link signal.
  { re: /(\bbit\.ly|\btinyurl|\bt\.co|\bs\.id|\bshorturl|\bgoo\.gl|(klik|perbarui).*(link|tautan|di sini)|click.*(link|here)|http[^\s]*\.(xyz|top|click|link|tk|ml|ga)\b)/i, weight: 20, id: "shortlink", flag: "Suspicious or shortened link" },
  // Asking for money / transfer / OTP / PIN. Audit 13 (F): a bare
  // "rekening" (bank account) fired this on its own — a benign
  // "Halo, rekening Anda sudah aktif" scored +22. "Rekening" alone
  // is everyday language; it only counts with a risky context:
  // an account NUMBER given, the account in trouble / blocked, a
  // destination (mule) account, or money being sent TO an account.
  // ("Transfer" and "bayar biaya/admin" still fire on their own.)
  { re: /\b(transfer|kirim.*(uang|dana|saldo)|top ?up|bayar.*(biaya|admin|pajak)|otp|kode verifikasi|pin|password|kata sandi|nomor\s+rekening|rekening\s+(anda\s+)?(bermasalah|diblokir|dibekukan|ditangguhkan|terblokir|akan\s+(diblokir|ditutup|dibekukan))|rekening\s+(tujuan|penerima|penampung|aman)|kirim\s+[^.\n]{0,60}?\s+ke\s+rekening|send money|wire transfer|account\s+number|verification code|one-time password)\b/i, weight: 22, id: "moneyOtp", flag: "Asks for money, transfer, OTP, PIN or password" },
  // "Call / contact this number" (23 Nov 2026 regression — the OTP
  // sample stayed "suspicious" 40): a genuine bank OTP never tells
  // you to call a mobile number — a real bank gives its official
  // hotline (Halo BCA 1500888) or a branch. The signal is structural
  // (a contact verb next to a digit run), not a lookup of the number
  // against a database — the rules still cannot know any bank's real
  // number. The digit run needs 4+ digits so a street address
  // ("No. 12") or a short code never fires it, and the verb needs a
  // word boundary so "waspada" does not match "wa". "Reply" / "balas"
  // added after the CoArena audit: "Reply with it [the code]" is how
  // an OTP-harvesting scam asks for the code — the code's own digits
  // are the digit run next to the verb.
  { re: /\b(hubungi|call|contact|whatsapp|wa|telpon|telepon|reply|balas)\b[\s\S]{0,50}?\d{4,}|\d{4,}[\s\S]{0,50}?\b(hubungi|call|contact|whatsapp|wa|telpon|telepon|reply|balas)\b/i, weight: 20, id: "contactNumber", flag: "Tells you to call / contact a number (fake bank / courier number)" },
  // Impersonation (bank, government, courier, marketplace). "Polres"
  // / "Polri" / "Polda" added 23 Nov 2026 regression: a POLRES money-
  // laundering threat ("Dari POLRES: ... transfer seluruh saldo ke
  // rekening aman ...") scored only 40 — "polisi" was in the list but
  // the way scam messages actually sign off ("POLRES") was not.
  { re: /\b(bank (bri|bca|mandiri|bni|bsi)|ojk|polisi|polres|polri|polda|kejaksaan|pengadilan|bea cukai|courier|kurir|jne|j&t|sicepat|gojek|grab|shopee|tokopedia|dinkes|kemenkes|dhl|fedex|ups|official|customer service|support team)\b/i, weight: 10, id: "impersonation", flag: "Impersonates a bank, authority, courier or marketplace" },
  // Police / legal threat (23 Nov 2026 regression — the POLRES case
  // above): an accusation of money laundering, an arrest threat, or
  // an "investigation" used to force a transfer to a "safe account".
  // A real police / prosecutor never collects money this way. The
  // "terlibat" gap is bounded (CoArena audit: unbounded ".*" rescans
  // long inputs quadratically).
  { re: /\b(pencucian uang|ditangkap|penangkapan|penyidikan|terlibat[\s\S]{0,40}?(pidana|kejahatan))\b/i, weight: 14, id: "legalThreat", flag: "Police / legal threat: arrest, investigation, money laundering" },
  // Impersonation of a known contact / family emergency
  { re: /\b(mama|papa|ibu|ayah|anak.*(kecelakaan|sakit|ditahan)|ganti nomor|nomor baruku|nomor barumu|nomor baru|ini nomor.*baru|this is my new number|mom|dad|emergency)\b/i, weight: 14, id: "family", flag: "Family / known-contact impersonation or emergency story" },
  // Family address + new number TOGETHER (23 Nov 2026 regression —
  // "Ma, ini nomor baru aku. HP lama hilang. Tolong transfer ..."
  // scored suspicious 54): the "relative with a new number" opener is
  // the classic family-impersonation setup. A bare "ibu" in a birthday
  // message still scores only the 14 above; the pair is what makes
  // this fire — and a genuine new-number note to a parent lands at
  // exactly 30 (suspicious), which is the honest caution: verify that
  // it really is your child before you trust it.
  { re: /\b(ma|mama|papa|ibu|ayah|nak|kak|dek)\b[\s\S]{0,40}?\b(nomor baruku|nomor barumu|nomor baru|ganti nomor|no\.?\s*baru)\b|\b(nomor baruku|nomor barumu|nomor baru|ganti nomor|no\.?\s*baru)\b[\s\S]{0,40}?\b(ma|mama|papa|ibu|ayah|nak|kak|dek)\b/i, weight: 16, id: "familyNewNumber", flag: "Family member with a new number (verify before you trust it)" },
  // Too-good-to-be-true offer / investment
  { re: /\b(investasi.*(untung|profit|jaminan)|profit.*\d+%|penghasilan.*(harian|pasif)|double.*money|guaranteed.*(profit|return)|lowongan.*(gaji|kerja dari rumah).*juta|part time.*\d+.*(juta|ribu))\b/i, weight: 16, id: "tooGood", flag: "Too-good-to-be-true offer (investment / job / income)" },
  // Guaranteed investment return (23 Nov 2026 regression — "INVESTASI
  // CRYPTO dijamin profit 30% per minggu! Modal minimal Rp 500.000"
  // scored Safe 16): no real investment can guarantee a profit, and
  // 30% a week is mathematically absurd — so a guaranteed return is
  // its own strong signal, not just "too good". Kept tight on purpose:
  // "modal minimal" alone is a feature of legitimate products too, so
  // it is NOT in this pattern — only the guarantee and the absurd rate.
  // The gaps are BOUNDED ([\s\S]{0,10}? / {0,20}?) — an unbounded
  // "dijamin.*profit" also matches a DENIAL ("Tidak ada investasi yang
  // dijamin menghasilkan profit" — 14 chars between the words — and
  // would flag an educational warning as suspicious; CoArena audit).
  { re: /\b(dijamin[\s\S]{0,10}?(profit|untung|return|cuan)|jaminan[\s\S]{0,10}?(profit|untung|cuan)|profit[\s\S]{0,20}?\d+\s*%[\s\S]{0,20}?per\s*(minggu|hari|bulan))\b/i, weight: 30, id: "investGuarantee", flag: "Guaranteed investment return (no real investment can promise this)" },
  // Asking to download an app / APK — weight 30 (was 18): a chat
  // message pushing an installer is a strong scam signal on its own.
  // The wedding-invite APK sample scored only 38 ("suspicious") with
  // 18 while the AI verdict was 95/100 "scam" — the local score
  // contradicted the verdict. At 30, a bare download ask is at least
  // "suspicious" and the sample (30 + suspicious link 20 + direct
  // .apk link 25) reaches 75 "scam", agreeing with the AI.
  { re: /\b(download.*(apk|aplikasi)|install.*(apk|aplikasi)|unduh.*apk|\.apk\b)/i, weight: 30, id: "apkDownload", flag: "Asks to download an app / APK file" },
  // Direct .apk file link (not from the Play Store): the file itself
  // is the payload — a chat link ending in .apk is never a store
  // install, so it scores on its own, even without "download" words.
  { re: /https?:\/\/(?!play\.google\.com)[^\s]*\.apk\b/i, weight: 25, id: "apkLink", flag: "Direct link to an .apk file (outside the Play Store)" },
  // Shortened link + explicit APK mention: the short link hides its
  // destination, so the device cannot prove it is (or is not) an .apk
  // — but the message itself says "APK". Honest weight 15: the bit.ly
  // APK case (30 download + 20 short link + 15) reaches 65 "scam",
  // agreeing with the AI. A legit short-link app invite WITHOUT the
  // word APK is untouched (still 50 "suspicious" at most) — the word
  // APK is what makes this fire.
  { re: /https?:\/\/(bit\.ly|tinyurl\.com|t\.co|s\.id|goo\.gl|shorturl\.at|cutt\.ly|is\.gd|rb\.gy|t\.ly|adf\.ly|ow\.ly|buff\.ly)\b[^\s]*[\s\S]{0,400}?\bapk\b|\bapk\b[\s\S]{0,400}?https?:\/\/(bit\.ly|tinyurl\.com|t\.co|s\.id|goo\.gl|shorturl\.at|cutt\.ly|is\.gd|rb\.gy|t\.ly|adf\.ly|ow\.ly|buff\.ly)\b/i, weight: 15, id: "shortApk", flag: "Shortened link hides its destination and the message mentions an APK file" },
  // Lottery / tax / fee to claim. Weight 18 (was 16) + Spanish
  // "tarifa de envío" (23 Nov 2026 regression): the DHL courier text
  // (clearance fee + .xyz verify link) scored 58 "suspicious" while
  // the AI verdict is 95 "scam" — a fee demanded to release a package
  // or a prize is a strong scam signal, and at 18 the text reaches 60.
  // The Spanish fee is what the ES prize scam needs to reach 60 too.
  { re: /\b(biaya (admin|klaim|pajak)|pajak hadiah|ongkir.*(hadiah|klaim)|(clearance|customs|processing|delivery) fee|pay.*(fee|tax).*claim|processing fee|tarifa de env[ií]o)\b/i, weight: 18, id: "fee", flag: "Fee or tax demanded before claiming something" },
  // Online loan with instant disbursement + an upfront fee (23 Nov
  // 2026 regression — "PINJAMAN ONLINE tanpa jaminan, cair 5 menit!
  // ... Bayar biaya admin di muka Rp 250.000" scored suspicious 38):
  // "pinjaman online tanpa jaminan + cair menit + biaya di muka" is
  // the illegal-lending (pinjol) script. A legitimate loan ad that
  // merely says "tanpa jaminan" scores only this 22 (safe on its own).
  { re: /\b(pinjaman\s+online|pinjol|tanpa\s+jaminan|cair\s*(dalam\s+)?\d+\s*menit)\b/i, weight: 22, id: "loanScam", flag: "Online loan with instant disbursement and an upfront fee" },
  // Scan a QR code to RECEIVE money (23 Nov 2026, CoArena audit:
  // "Untuk menerima pembayaran pesanan, pindai kode QR yang saya
  // kirim." scored Safe 0 — a fake marketplace buyer harvesting a
  // payment). You never need to scan a code to GET money; the QR the
  // scammer sends is a payment request in disguise. Kept tight: the
  // receive phrase must name the money ("menerima pembayaran",
  // "terima uang") — a bare "terima kasih" (thank you) never fires,
  // and a legitimate "scan this QR to pay" has no receive phrase.
  { re: /\b(menerima|terima|dapatkan)\s+(pembayaran|uang|dana)\b[\s\S]{0,60}?\b(pindai|scan)\b[\s\S]{0,30}?\b(kode\s*qr|qr)\b|\b(pindai|scan)\b[\s\S]{0,30}?\b(kode\s*qr|qr)\b[\s\S]{0,60}?\b(menerima|terima|dapatkan)\s+(pembayaran|uang|dana)\b/i, weight: 30, id: "qrReceive", flag: "Asks you to scan a QR code to receive money (payment QR scam)" },
  // Generic phishing phrasing
  { re: /\b(verifikasi.*(akun|data)|update.*(data|akun)|konfirmasi.*(akun|data)|verify.*(account|identity|details)|update your (account|details)|confirm your (account|identity))\b/i, weight: 12, id: "phishing", flag: "Phishing-style account verification request" },
  // --- Job scams (21 Nov 2026 false-negative fix: "Pak Reza" job scam
  // judged Safe 0/100 by the cloud model AND 0/100 by these rules).
  // A real employer pays the worker — money flowing FROM the job
  // seeker TO the employer as a condition of work is a scam. Every
  // pattern below requires a recruitment word nearby, so a genuine
  // job message with no payment stays safe (hard-job-real pinned 16).
  // Job + payment demanded before/during recruitment (admin fee,
  // deposit, guarantee, registration, training, activation — "pay
  // first, then work"). Either order: the demand may come before or
  // after the job word in the chat.
  { re: /\b(lowongan|pekerjaan|rekrut|lamaran|interview|wawancara|standby|part-time|work from home|hiring|vacancy)\b[\s\S]{0,300}?\b(bayar|transfer|tf|deposit|setoran|pendaftaran|registrasi|pelatihan|jaminan|aktivasi|activate|uang muka|transaksi|registration fee|activation fee)\b|\b(bayar|transfer|tf|deposit|setoran|pendaftaran|registrasi|pelatihan|jaminan|aktivasi|activate|uang muka|transaksi|registration fee|activation fee)\b[\s\S]{0,300}?\b(lowongan|pekerjaan|rekrut|lamaran|interview|wawancara|standby|part-time|work from home|hiring|vacancy)\b/i, weight: 36, id: "jobPay", flag: "Job scam: payment demanded before or during recruitment" },
  // Fake task / member-number system in a job chat ("No 1724",
  // "nomor tugas", "member No ...") — handlers number victims like a queue.
  // The bare "No <digits>" needs 3+ digits: a 1-2 digit number is
  // usually a street address ("Jl. Sudirman No. 12") in a genuine HR
  // invite, and flagging that was a false positive (21 Nov, found by
  // the flows test). "No 1724" (4 digits) still matches.
  { re: /\b(lowongan|pekerjaan|rekrut|lamaran|interview|wawancara|standby|part-time|work from home|hiring|vacancy)\b[\s\S]{0,300}?\b(no\.?\s*\d{3,}|nomor\s*(tugas|anggota|member|id)|tugas\s*(no\.?|#)?\s*\d+|member\s*(no\.?|#)?\s*\d+)|\b(no\.?\s*\d{3,}|nomor\s*(tugas|anggota|member|id)|tugas\s*(no\.?|#)?\s*\d+|member\s*(no\.?|#)?\s*\d+)[\s\S]{0,300}?\b(lowongan|pekerjaan|rekrut|lamaran|interview|wawancara|standby|part-time|work from home|hiring|vacancy)\b/i, weight: 16, id: "jobTaskNo", flag: "Fake task / member-number system (job-task scam)" },
  // Transfer receipt / proof of payment inside a job chat ("Jumlah
  // Total Rp ...", "No. Transaksi ...", "bukti transfer") next to
  // recruitment instructions — the victim's own receipt.
  { re: /\b(lowongan|pekerjaan|rekrut|lamaran|interview|wawancara|standby|part-time|work from home|hiring|vacancy)\b[\s\S]{0,300}?\b(jumlah total|no\.?\s*transaksi|bukti\s*(transfer|tf|bayar|pembayaran)|struk|resi pembayaran)|\b(jumlah total|no\.?\s*transaksi|bukti\s*(transfer|tf|bayar|pembayaran)|struk|resi pembayaran)[\s\S]{0,300}?\b(lowongan|pekerjaan|rekrut|lamaran|interview|wawancara|standby|part-time|work from home|hiring|vacancy)\b/i, weight: 14, id: "jobReceipt", flag: "Transfer receipt / proof of payment in a job chat" },
  // Fake task work: pay promised for trivial tasks — liking,
  // subscribing, following, typing, captcha, watching videos.
  { re: /\b(lowongan|pekerjaan|rekrut|lamaran|interview|wawancara|standby|part-time|work from home|hiring|vacancy)\b[\s\S]{0,300}?\b(like|subscribe|follow|ketik|captcha|tonton video|isi survei|klik iklan|nonton iklan|nonton video)\b|\b(like|subscribe|follow|ketik|captcha|tonton video|isi survei|klik iklan|nonton iklan|nonton video)\b[\s\S]{0,300}?\b(lowongan|pekerjaan|rekrut|lamaran|interview|wawancara|standby|part-time|work from home|hiring|vacancy)\b/i, weight: 18, id: "jobTaskWork", flag: "Fake task work (like/subscribe/type/captcha for pay)" },
];

// Short quote of the text that fired one pattern — a window around
// the match, whitespace-collapsed and capped, so a checklist row can
// show WHY the check fired without pasting the whole message. Pure
// presentation: the verdict score never depends on this.
function matchSnippet(text, m) {
  if (!m || m.index == null) return "";
  let start = Math.max(0, m.index - 28);
  let end = Math.min(text.length, m.index + m[0].length + 28);
  // Cut at word boundaries (demo reference): a quote starting or
  // ending mid-word ("…wnload", "te…") reads as sloppy.
  if (start > 0) {
    const sp = text.indexOf(" ", start);
    if (sp !== -1 && sp < m.index) start = sp + 1;
  }
  if (end < text.length) {
    const ep = text.lastIndexOf(" ", end);
    if (ep > m.index + m[0].length) end = ep;
  }
  let s = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (s.length > 120) {
    const cut = s.lastIndexOf(" ", 117);
    s = (cut > 60 ? s.slice(0, cut) : s.slice(0, 117).trimEnd()) + "…";
  }
  return (start > 0 ? "…" : "") + s + (end < text.length && !s.endsWith("…") ? "…" : "");
}

/**
 * Is this message a pure OTP-delivery notification — an OTP code with
 * a don't-share warning and NOTHING actionable? Used by
 * analyzeWithHeuristic to excuse the moneyOtp / impersonation rules
 * for a genuine OTP (see the guard above). Every condition must hold:
 *   1. an OTP-code mention ("kode verifikasi", "OTP", "verification code");
 *   2. a don't-share warning ("jangan berikan ...", "do not share ...");
 *   3. NO link (a link makes it a phishing attempt, not a notification);
 *   4. NO phone-number-length digit run (9+ digits ignoring separators
 *      — the 6-digit OTP code itself does not count; "0812-9876-5432"
 *      does, because a number to call is the scam's action);
 *   5. NO action verb (hubungi/call, klik/click, transfer, bayar, link).
 */
function isPureOtpNotification(text) {
  if (!/\b(kode\s+(verifikasi|otp)|otp|verification code|one-time password)\b/i.test(text)) return false;
  // The don't-share warning — and the rest of its sentence — is
  // removed before the action check below: "Jangan berikan kode ini"
  // contains the word "berikan" (give), which is an action verb in
  // the scam's mouth ("berikan kode Anda") but a warning in the
  // notification's. Testing the REMAINDER keeps the two apart.
  const warnRe = /\b(jangan\s+(berikan|bagikan|beri|kasih|sebar)|do not share|never share|don't share)\b[^.!?\n]*/i;
  const warnMatch = text.match(warnRe);
  if (!warnMatch) return false;
  const rest = text.replace(warnMatch[0], "");
  if (/https?:\/\//i.test(text)) return false;
  // A phone-number-length digit run (9+ digits, allowing spaces,
  // dashes, dots and parentheses between them). The 6-digit OTP code
  // itself never counts; "0812-9876-5432" does — a number to call is
  // the scam's action. (Concatenating ALL digits in the message would
  // be wrong: two unrelated short numbers would look like one long
  // one, so the run must be consecutive in the text.)
  if (/(\d[\s\-.()]?){9,}\d/.test(text)) return false;
  // Action verbs in the REMAINDER (not the warning): the message asks
  // the reader to DO something with the code — call, click, transfer,
  // pay, reply with it, state it, enter it, send it. (23 Nov 2026,
  // CoArena audit: "Reply with it to reverse a mistaken debit"
  // passed the old guard because "reply" was not a blocked verb.)
  if (/\b(hubungi|call|contact|klik|click|transfer|bayar|tautan|link|reply|balas|sebutkan|masukkan)\b/i.test(rest)) return false;
  if (/\b(kirim|send|share|berikan|beri)\b[\s\S]{0,20}?\b(kode|code|otp)\b/i.test(rest)) return false;
  return true;
}

export function analyzeWithHeuristic(message, lang = "en", opts = {}) {
  const text = (message || "").trim();
  const redFlags = [];
  // Pure OTP-delivery notification (23 Nov 2026 regression — a real
  // Tokopedia OTP, "Kode verifikasi Tokopedia Anda: 482916. Jangan
  // berikan kode ini kepada siapa pun, termasuk karyawan Tokopedia.",
  // scored suspicious 32): an OTP code mention + a don't-share warning
  // + NO link, NO phone-number-length digit run, NO action verb
  // (call/click/transfer/pay) is exactly what a real OTP looks like —
  // a notification, not a request. The moneyOtp and impersonation
  // rules are excused for it through the skipIds mechanism below, so
  // the checklist shows them as clean (excused), never as found.
  // A scam OTP is never shaped like this: it always adds an action —
  // "segera hubungi 0812-..." (a number to call) or a link — and the
  // guard refuses to apply the moment one is present. A bare OTP with
  // a brand name but NO don't-share warning is NOT excused either:
  // it keeps its suspicious score, because the warning is part of
  // what makes a delivery notification recognizable as genuine.
  const localSkips = opts.skipIds instanceof Set ? new Set(opts.skipIds) : new Set();
  if (isPureOtpNotification(text)) {
    localSkips.add("moneyOtp");
    localSkips.add("impersonation");
  }
  // Per-pattern checklist (21 Nov 2026, demo reference): the SAME
  // fixed rule set, each entry found or clean, so the result card can
  // show every check that ran — not just the ones that fired. The
  // score loop below is untouched: one match() per pattern, same
  // weights, same flags, same total.
  const checks = [];
  let score = 0;
  // opts.skipIds (22 Nov audit 8): a caller that KNOWS a rule is a
  // false positive for its input may excuse it — the email checker
  // skips "impersonation" (and "multiLinks", a verified brand's own
  // links) when the sender domain IS the brand's real domain. A
  // skipped rule still appears in the checklist as clean (it ran and
  // was excused), never as found, and never scores. localSkips is the
  // caller's set PLUS the pure-OTP guard above.
  const skipIds = localSkips;
  for (const p of SCAM_PATTERNS) {
    if (skipIds && skipIds.has(p.id)) {
      checks.push({ id: p.id, flag: p.flag, found: false, evidence: "" });
      continue;
    }
    const m = text.match(p.re);
    checks.push({ id: p.id, flag: p.flag, found: !!m, evidence: m ? matchSnippet(text, m) : "" });
    if (m) {
      score += p.weight;
      if (!redFlags.includes(p.flag)) redFlags.push(p.flag);
    }
  }
  // Long messages full of links / numbers are slightly more suspicious.
  // opts.skipIds covers this row too (22 Nov audit 8): a VERIFIED
  // brand sender links to its own pages as a matter of course — a
  // genuine Tokopedia order email always carries 2+ links — so the
  // email checker excuses it together with "impersonation".
  const links = (text.match(/https?:\/\/[^\s]+/g) || []).length;
  const multiSkipped = skipIds && skipIds.has("multiLinks");
  checks.push({ id: "multiLinks", flag: "Multiple links in one message", found: links >= 2 && !multiSkipped, evidence: "" });
  if (links >= 2 && !multiSkipped) {
    score += 8;
    if (!redFlags.includes("Multiple links in one message")) {
      redFlags.push("Multiple links in one message");
    }
  }
  score = Math.max(0, Math.min(100, score));
  const status = score >= 60 ? "scam" : score >= 30 ? "suspicious" : "safe";
  // Demo verdicts speak the UI language too (fixed strings, translated
  // through the i18n table — the AI path gets it from the model instead).
  return {
    status,
    riskScore: score,
    redFlags: redFlags.map((f) => demoFlag(f, lang)),
    checks,
    summary: demoSummary(status, lang),
    source: "DEMO",
  };
}

/**
 * Code-only fallback verdict: the same deterministic rule set as
 * analyzeWithHeuristic, marked source "CODE" so every surface (badge,
 * receipt, history) can say honestly that this is a code result
 * WITHOUT an AI verdict — never an AI verdict. Pure and deterministic:
 * the score/status/flags are exactly the heuristic's, nothing added.
 * Used when the AI verdict fails or times out (30 s), so the check
 * still returns a real verdict instead of a dead error. `reason`
 * records WHY the AI did not answer: "timeout" (the 30 s budget ran
 * out) or "unavailable" (the AI could not be reached at all — fast
 * failure such as App Check 403 or a network error). The UI picks
 * its wording from this — a fast failure must never be described as
 * "did not answer within 30 seconds" (audit round 7).
 */
export function codeOnlyVerdict(message, lang = "en", reason = "timeout") {
  const local = analyzeWithHeuristic(message, lang);
  return {
    ...local,
    source: "CODE",
    model: "code",
    codeOnlyReason: reason === "unavailable" ? "unavailable" : "timeout",
  };
}

// ---------------------------------------------------------------------------
// Production path: Firebase AI Logic (hybrid inference).
// Lazy dynamic imports keep the Firebase SDK out of the demo path entirely.
// ---------------------------------------------------------------------------

let appPromise = null;
// App Check instance (when init succeeded) and init failure reason (when it
// did not). Surfaced to the user before any AI call so a broken App Check
// fails fast with a clear message instead of a cryptic 401 from the server.
let appCheckInstance = null;
let appCheckInitError = null;

async function getFirebaseApp() {
  if (appPromise) return appPromise;
  appPromise = (async () => {
    const { initializeApp, getApps, getApp } = await import("firebase/app");

    // App Check debug token: localhost development ONLY.
    // Never hardcode a real debug token; this flag just enables the
    // debug provider so the browser can register a token itself.
    const isLocalhost =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (isLocalhost) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import(
      "firebase/app-check"
    );
    // NOTE: another module (history.js / Firestore) may already have
    // created the Firebase app at page load. App Check must still be
    // initialized on that existing app — an early return here used to
    // skip App Check entirely, so no token was ever minted and every
    // AI Logic call failed with 401 "App Check token is invalid".
    const app =
      getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
    // App Check: only activated when it can actually work.
    // - With a real reCAPTCHA Enterprise site key configured: use it on
    //   localhost AND in production (the Enterprise key covers the
    //   localhost domain, and AI Logic enforces App Check).
    // - On localhost without a key: debug mode
    //   (self.FIREBASE_APPCHECK_DEBUG_TOKEN = true) so the browser
    //   registers its own debug token; no real site key is needed and NO
    //   token is hardcoded anywhere. The debug token must be registered
    //   in the Firebase console to pass enforcement.
    // - In production without a key: App Check is skipped entirely —
    //   the app keeps working instead of failing on a placeholder key.
    const siteKey = firebaseConfig.appCheckSiteKey;
    try {
      if (siteKey && !siteKey.startsWith("YOUR_")) {
        appCheckInstance = initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(siteKey),
          isTokenAutoRefreshEnabled: true,
        });
      } else if (isLocalhost) {
        appCheckInstance = initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider("debug-placeholder-not-used"),
          isTokenAutoRefreshEnabled: true,
        });
      } else {
        console.info(
          "[TipuCek] App Check skipped: no reCAPTCHA Enterprise site key configured.",
        );
      }
    } catch (e) {
      appCheckInitError = e?.message || String(e);
      console.warn("[TipuCek] App Check init skipped:", appCheckInitError);
    }
    return app;
  })();
  return appPromise;
}

// Exported for the redaction integration test (tests/unit.test.mjs):
// the prompt the model receives must never contain a raw sensitive
// value, so the test builds it from redacted text and asserts the
// original values are gone.
export function buildPrompt(message, lang = "en") {
  // The verdict itself (summary + red flags) comes back in the UI
  // language, so the result card speaks the user's language. The
  // machine fields (status enum, riskScore) stay language-independent.
  const answerLang = languageName(lang);
  return [
    "You are a scam-message detector. Analyze the user message below,",
    "which may be in Indonesian or English (SMS, WhatsApp, DM or email).",
    "Return ONLY a JSON object matching the provided schema, nothing else.",
    "",
    "Rules:",
    '- status: "scam" if it is clearly a scam (phishing link, fake prize,',
    "  impersonation, demand for money/OTP/PIN, malware APK);",
    '- "suspicious" if it has warning signs but is not conclusive;',
    '- "safe" if it looks like a normal legitimate message.',
    "- riskScore: integer 0-100, how likely the message is a scam.",
    "- JOB SCAM (21 Nov 2026 false-negative fix — a job scam was judged Safe 0/100): if a job/recruitment message asks the job seeker to pay or transfer ANYTHING before or during recruitment (admin fee, deposit, guarantee money, registration fee, training fee, activation fee, 'pay first, then work'), it is a SCAM with riskScore 80 or higher. Ask yourself: why would a job seeker transfer money to the employer? A real employer pays the worker — money flowing FROM the job seeker TO the employer as a condition of work is a scam. Also a scam: fake task jobs (typing, captcha, liking, subscribing for pay), huge pay promised for trivial tasks, 'standby and check your email' recruitment flows, task/member numbers. A genuine job message (interview invitation with no payment, official HR information) is SAFE — the trigger is the PAYMENT CONDITION, not the word 'job' alone.",
    "- OTP SCAM (23 Nov 2026 false-negative fix — a fake-bank OTP was judged Safe 5/100 by the AI in Run 1): if an OTP notification tells the recipient to call or contact a mobile phone number, it is a SCAM with riskScore 85 or higher. A real bank OTP message contains ONLY the code and a do-not-share warning — it never includes a number to call, a link to click, or any other action. The mobile number to call is the scammer's number, not the bank's official hotline. The structural signal (OTP code + contact a mobile number) is enough — you do not need to know whose number it is.",
    "- AMBIGUOUS CASES (23 Nov 2026 false-positive fix — ambiguous messages were scored Scam 90-95 instead of Suspicious in Run 1): when a message has warning signs but is NOT conclusive — a suspicious courier link with a plausible brand name but an unrecognised domain, a voucher or promo link that could be real or fake, a job listing with a personal email address but no payment demanded — rate it 'suspicious' with riskScore in the range 30-59. Reserve riskScore 60+ for messages where the scam is clear (OTP + call a number, explicit fee before a prize, fake APK, money demanded). Do not jump to Scam 90+ when doubt remains — 'suspicious' is the honest verdict for 'probably bad but not certain'. Sub-rules: apply the SCAM rules (fee, OTP/PIN, sensitive identity/banking data) FIRST — a delivery address ALONE is NOT sensitive data and does NOT trigger SCAM; only then apply these sub-rules. (COURIER) a courier/delivery message whose link goes to a domain that is NOT the courier's official domain (example: jnt-update-alamat.com is not J&T's official jnt.co.id / jet.co.id) BUT which asks for NO money, NO OTP/PIN, and NO sensitive personal data beyond a delivery address (an address-update form asking only where to deliver, not KTP/banking/full-identity details) — is 'suspicious' 30-59, NOT Scam 90+. Contrast: courier phishing that DOES ask for a fee (customs/clearance fee), OTP/PIN, or sensitive identity/banking data stays SCAM; an unfamiliar or .xyz domain ALONE is not enough for SCAM — it needs additional clear phishing evidence. (JOB) a job listing whose ONLY contact is a personal email address (gmail/yahoo) with no company address and no official company website, BUT which asks for NO payment/deposit/fee of any kind, is 'suspicious' 30-59, NOT Safe 0-10. Contrast: a job that demands any deposit/fee stays SCAM under the JOB SCAM rule, and a job listing with an official company contact (company domain email, office address, official site) that demands NO payment and shows NO other scam indicators stays SAFE — the SCAM rules take precedence over any SAFE carve-out. (PROMO) a voucher/promo message received by SMS, WhatsApp/other DM, or email offering money, a discount, or a free item (example: 'Selamat! Anda mendapat voucher Rp 100.000 dari Tokopedia. Klaim sekarang: https://tokopedia.com/voucher') — even when its link goes to the brand's OFFICIAL domain — is 'suspicious' 30-59, NOT Safe 0-10. An official-looking link or domain alone does NOT prove the message itself is genuine; scammers can copy official links. Do not treat the link or domain alone as verification. For a message-only assessment, do not infer that the user already uses the channel or has independently verified the offer: treat a promo received by SMS, WhatsApp/other DM, or email as unverified unless the user provides context outside the message that they expected it. An official-looking link or domain, or the fact that the user could check the offer independently, is not verification. Contrast: a promo that demands a fee, deposit, or payment specifically to claim or release the advertised voucher, prize, or free item, or that asks for an OTP/PIN or sensitive identity/banking data, stays SCAM under the SCAM rules. An ordinary purchase price for a product offered at a discount is not, by itself, a SCAM indicator — the SCAM rules take precedence over any SAFE carve-out.",
    `- redFlags: short phrases in ${answerLang} naming each warning sign found`,
    "  (empty array when the message is safe).",
    `- summary: one or two sentences in ${answerLang} explaining the verdict.`,
    "",
    "Message to analyze:",
    '"""',
    message,
    '"""',
  ].join("\n");
}

/**
 * Parse the model's verdict JSON. Models sometimes wrap the JSON in a
 * markdown fence (```json ... ```) even when a JSON response schema was
 * requested — strip the fence before parsing so the check still works
 * instead of failing on a valid verdict.
 */
function parseVerdictJson(text) {
  const trimmed = (text || "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

// ---------------------------------------------------------------------------
// Safety floor (lantai pengaman) — 23 Nov 2026 (Run 1: a fake BCA OTP
// was judged Safe 5/100 by the AI while the local rules score it 60).
//
// WHY threshold 60 (scam), not max(local, AI):
//   The "max" approach is too coarse: a legitimate message about a real
//   bank transfer ("transfer" +22, "segera" urgency +18) can reach local
//   40 and would wrongly be promoted to "suspicious". 60 is the local
//   threshold for "scam" — a score that high requires multiple strong
//   independent signals (OTP + contact number + urgency = 60) and has
//   ZERO false positives across both benchmarks (highest safe score:
//   22 across the 9 safe cases of the 18-case local benchmark,
//   14 across the 11 safe cases of the AI benchmark). Raising a verdict
//   TO scam from below 60 is therefore safe.
//
// WHY only the floor (never a ceiling for safe verdicts):
//   We only override when the LOCAL rules are CERTAIN (>=60 = scam) and
//   the AI is WRONG (not scam). The AI may legitimately give a higher
//   score than the local rules — that is fine, the AI stays. We never
//   suppress an AI scam verdict, only rescue a missed one.
//
// source / model / redacted: left from the AI — these describe WHERE the
//   check ran and WHAT was redacted before it left the device. Even when
//   the floor overrides the status/score, the source is still the AI
//   (the message WAS sent to it; the floor is a post-processing guard,
//   not a different analysis). This is the honest thing to report, and
//   the receipt says so (receiptFloorApplied).
//
// Pure function: takes the AI verdict object and the RAW message text
//   (local rules always run on-device, never on redacted text). Safe to
//   call with a null/undefined aiVerdict or an empty message.
// ---------------------------------------------------------------------------
export function applySafetyFloor(aiVerdict, message, lang = "en") {
  // Defensive: treat a missing AI verdict as a safe/0 verdict so the
  // floor logic still runs and can protect the user.
  const ai = aiVerdict && typeof aiVerdict === "object" ? aiVerdict : { status: "safe", riskScore: 0 };
  const text = typeof message === "string" ? message : "";

  // Local rules run on the RAW text — they are deterministic and never
  // leave the device, so there is no privacy reason to redact first.
  const local = analyzeWithHeuristic(text, lang);

  // Floor condition: local is CERTAIN (scam, >=60) AND the AI missed it
  // (AI status is not "scam", OR AI riskScore < 60).
  const localCertain = local.riskScore >= 60;
  const aiMissed = ai.status !== "scam" || (typeof ai.riskScore === "number" && ai.riskScore < 60);

  if (localCertain && aiMissed) {
    return {
      // Verdict fields come from the local rules (the authoritative signal).
      status: local.status,           // always "scam" when score >= 60
      riskScore: local.riskScore,
      redFlags: local.redFlags,
      summary: local.summary,
      checks: local.checks,
      // Provenance fields stay from the AI: the message WAS sent there,
      // and the redaction receipt is still accurate.
      source: ai.source,
      model: ai.model,
      redacted: ai.redacted,
      // Transparency flag: the receipt renders an honest note.
      floorApplied: true,
    };
  }

  // Floor not triggered — return the AI verdict unchanged, only add the flag.
  return { ...ai, floorApplied: false };
}

/**
 * Analyze a message with Firebase AI Logic (hybrid inference).
 * `onProgress` receives { stage, progress }: "downloading-model"
 * while the on-device model downloads (progress 0-1), "cloud" when
 * the hybrid path falls back to the cloud-only model, "backup" when
 * the primary cloud model failed and the backup model is tried.
 */
export async function analyzeWithAI(message, onProgress, lang = "en") {
  const { ai, getGenerativeModel, InferenceMode, Schema, tokenInfo } =
    await ensureAIReady();

  // Auto-redact (23 Nov 2026): sensitive values are replaced with
  // typed placeholders BEFORE anything reaches the model — this is
  // the one choke point for both legs below (the hybrid leg can
  // answer in-cloud by itself when the on-device model is not ready,
  // so redacting only the cloud-only failover would not be enough).
  // The LOCAL rules still run on the raw text (they never leave the
  // device); only the AI prompt is redacted. The counts ride along
  // on the verdict so the UI receipt can say what was redacted.
  const redacted = redactForAI(message);
  const promptMessage = redacted.text;

  // Structured-output schema for the verdict (shared by both paths).
  const verdictSchema = makeVerdictSchema(Schema);

  const model = makeHybridModel(
    ai,
    getGenerativeModel,
    InferenceMode,
    verdictSchema,
  );

  // On-device model prep is the slow step: the first download can take
  // 10-20s. Give it a short window — when the model is already on the
  // device it is ready in about a second; when it is not, the cloud
  // model answers in ~2s, so waiting longer only delays the verdict.
  // (The download keeps running in the background, so a later check can
  // still answer on-device.)
  let result;
  // Cloud model that answered via the cloud-only retry (primary or
  // backup); null when the hybrid path answered directly.
  let answeredModel = null;
  try {
    await Promise.race([
      model.initializeDeviceModel((progress) => {
        onProgress?.({ stage: "downloading-model", progress });
      }),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                "On-device model not ready in time — using the cloud model.",
              ),
            ),
          ON_DEVICE_INIT_TIMEOUT_MS,
        ),
      ),
    ]);
    result = await withTimeout(
      model.generateContent(buildPrompt(promptMessage, lang)),
      CLOUD_CHECK_TIMEOUT_MS,
      "Check",
    );
  } catch (e) {
    onProgress?.({ stage: "cloud" });
    // On-device generation can fail even after initializeDeviceModel
    // resolves — e.g. headless browsers, or a model that cannot run the
    // request (the SDK reports this as a misleading "input is too
    // large" error, even for a four-word message). PREFER_ON_DEVICE
    // does not fall back to the cloud on its own for this error class,
    // so retry once with a cloud-only model instead of failing the
    // check. The verdict still comes from the real model, and its
    // source badge (IN_CLOUD) says so.
    console.warn(
      "[TipuCek] On-device generation failed, falling back to cloud:",
      e?.message || e,
    );
    try {
      // Failover: the primary cloud model first, the backup once when
      // it fails or times out. The on-device leg already had its
      // chance above, so this is the last AI attempt before the
      // caller's code-only fallback.
      const { result: cloudResult, model: cloudModelName } =
        await generateWithFailover(
          (modelName) => {
            const m = getGenerativeModel(ai, {
              model: modelName,
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: verdictSchema,
              },
            });
            return m.generateContent(buildPrompt(promptMessage, lang));
          },
          { onBackup: () => onProgress?.({ stage: "backup" }) },
        );
      result = cloudResult;
      answeredModel = cloudModelName;
    } catch (e2) {
      // The App Check token's claims are debug info only: log them for
      // diagnosis, never attach them to the user-facing error (the old
      // code pasted app_id/aud/iat/exp into the message the UI showed).
      if (tokenInfo) console.warn("[TipuCek] App Check token:", tokenInfo);
      throw new Error(e2?.message || e2);
    }
  }
  const response = result.response;
  const text = response.text();

  // inferenceSource is "on_device" | "in_cloud" (lowercase, per @firebase/ai
  // 3.x .d.ts). Map to the display labels; anything else => "Unknown".
  const rawSource = response.inferenceSource;
  const source =
    rawSource === "on_device" || rawSource === "ON_DEVICE"
      ? "ON_DEVICE"
      : rawSource === "in_cloud" || rawSource === "IN_CLOUD"
        ? "IN_CLOUD"
        : "Unknown";

  let verdict;
  try {
    verdict = parseVerdictJson(text);
  } catch {
    throw new Error("AI returned a response that is not valid JSON.");
  }
  const riskScore = Math.max(
    0,
    Math.min(100, Math.round(Number(verdict.riskScore) || 0)),
  );
  const status =
    verdict.status === "scam" ||
    verdict.status === "suspicious" ||
    verdict.status === "safe"
      ? verdict.status
      : riskScore >= 60
        ? "scam"
        : riskScore >= 30
          ? "suspicious"
          : "safe";
  // Assemble the raw AI verdict before the safety floor.
  const rawAiVerdict = {
    status,
    riskScore,
    redFlags: Array.isArray(verdict.redFlags)
      ? verdict.redFlags.map(String)
      : [],
    summary: String(verdict.summary || ""),
    source,
    // What was redacted before the text reached the model (counts
    // only, no values): the UI receipt shows this, and the local
    // history record keeps it. Empty when nothing was redacted.
    redacted: redacted.found,
    // Which model answered: the backup when the failover ran, the
    // primary cloud model when the hybrid cloud leg or the cloud-only
    // retry answered, "on-device" when the device model did. The UI
    // receipt + history show this; the badge stays "Answered in the cloud".
    model:
      answeredModel ||
      (source === "ON_DEVICE"
        ? "on-device"
        : source === "IN_CLOUD"
          ? CLOUD_MODEL
          : undefined),
  };
  // Safety floor (23 Nov 2026): if the local rules are certain (score
  // >=60 = scam) and the AI missed it, promote the verdict to the local
  // result. The AI source/model/redacted fields are preserved — the
  // message WAS sent to the AI, and the redaction receipt is still
  // accurate. Only AI paths reach this line; heuristic-only and
  // code-only paths are unaffected. `message` here is the RAW original
  // text (local rules never leave the device).
  return applySafetyFloor(rawAiVerdict, message, lang);
}

// ---------------------------------------------------------------------------
// Aman — the virtual assistant (chat) + screenshot analysis.
// Both are cloud-only: the on-device model does single-turn text only, so
// it cannot hold a conversation or read images. The UI says so honestly.
// ---------------------------------------------------------------------------

// Professional, concise, clear (Myuden 20 Nov 20:30): at most 3 short
// sentences — no small talk, no jargon. (20 Nov 20:46 fix: the verdict
// is ONLY for a pasted message. The old prompt forced sentence 1 to be
// a verdict for every answer, so a general question like "How do I
// spot a fake link?" was answered "This message is suspicious." —
// inventing a verdict about a message that was never pasted. The rule
// now depends on the input: pasted message → verdict first; general
// question → answer the question directly, never invent a verdict.)
function assistantSystemPrompt(lang) {
  const answerLang = languageName(lang);
  return [
    "You are Aman, the professional AI assistant of TipuCek, a scam-message scanner.",
    `Answer in ${answerLang}. Professional tone, at most 3 short sentences, no small talk, no jargon.`,
    "Answer the user's text as it is. If it is a PASTED MESSAGE to judge — a forwarded or copied message (fake prize, fake courier, fake bank warning, OTP request, fake APK invitation, fake job) — sentence 1 states the verdict directly (Scam, Suspicious, or Safe); sentence 2 names the single strongest warning sign — or, when safe, the single reason it looks legitimate; sentence 3 gives one clear action: check it with the TipuCek checker for a full verdict, or verify the sender through an official channel.",
    "If it is a GENERAL QUESTION — the user asks how something works or what to do, with no message to judge — answer the question directly and helpfully. NEVER invent a verdict about a message: if no message was pasted, there is nothing to call suspicious, scam, or safe. Sentence 2 may name the strongest warning sign when the question is about one; sentence 3 gives one clear action when relevant.",
    "You help people recognize scam messages (fake prizes, fake couriers, fake bank warnings, OTP theft, fake APK invitations, fake jobs).",
    "For job messages: a job that asks the seeker to pay anything before or during recruitment is a scam — a real employer pays the worker, never the other way round. A genuine job message with no payment asked is safe.",
    "Never ask for personal data (no phone numbers, OTPs, PINs, passwords, bank accounts).",
    "If you are unsure, say so and tell them to verify the sender through an official channel.",
    "Never claim to be human. Never give legal or financial advice beyond general safety tips.",
  ].join("\n");
}

/**
 * Ask Aman a question. `history` is the recent chat ({ role: "user" |
 * "aman", text }[]), kept short (last 6 turns) so the prompt stays small.
 * Cloud-only; throws when Firebase is not configured or the call fails.
 * Failover like the message/image check: primary model first, backup
 * once when it fails or times out (Aman chat panel, 20 Nov 2026 — the
 * assistant previously had no failover, so one primary failure killed
 * the whole chat). `onBackup` fires before the backup attempt.
 */
export async function askAssistant(question, lang = "en", history = [], onBackup, { pastedMessage = false } = {}) {
  const { ai, getGenerativeModel } = await ensureAIReady();
  // Auto-redact (23 Nov 2026): the user may paste a message with an
  // OTP or account number into the Aman chat, so redact the question
  // AND the recent turns before anything reaches the model — same
  // typed placeholders as the check path.
  const redactedQuestion = redactForAI(question).text;
  const turns = (history || [])
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Aman"}: ${redactForAI(m.text).text}`)
    .join("\n");
  const prompt = [
    assistantSystemPrompt(lang),
    "",
    // A hint from the UI (long text usually means a pasted message);
    // the system prompt still tells the model to decide from the text
    // itself, so a long question is answered as a question.
    pastedMessage
      ? "Note: the user's text looks like a pasted message to judge."
      : "Note: the user's text looks like a general question.",
    "",
    turns ? `Conversation so far:\n${turns}\n` : "",
    `User: ${redactedQuestion}`,
    "Aman:",
  ].join("\n");
  const { result } = await generateWithFailover(
    (modelName) => {
      const model = getGenerativeModel(ai, { model: modelName });
      return model.generateContent(prompt);
    },
    {
      timeoutMs: ASSISTANT_TIMEOUT_MS,
      label: "Assistant",
      onBackup: () => onBackup?.(),
    },
  );
  const answer = (result.response.text() || "").trim();
  if (!answer) throw new Error("The assistant returned an empty answer.");
  return { answer, source: "IN_CLOUD" };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const base64 = dataUrl.split(",")[1] || "";
      resolve({ base64, mimeType: file.type || "image/png" });
    };
    reader.onerror = () =>
      reject(new Error("Could not read the image file."));
    reader.readAsDataURL(file);
  });
}

/**
 * Analyze a screenshot of a chat/message with the cloud model's vision:
 * read the visible text (OCR) and judge it as a scam message. Returns the
 * usual verdict shape plus `extractedText` (what the model read).
 * Cloud-only — the on-device model cannot read images. Failover like
 * the message check: primary model first, backup once on failure;
 * `onProgress` reports stage "backup" while the backup is tried.
 */
export async function analyzeImageWithAI(file, lang = "en", onProgress) {
  const { ai, getGenerativeModel, Schema, tokenInfo } =
    await ensureAIReady();
  const { base64, mimeType } = await fileToBase64(file);
  const answerLang = languageName(lang);
  const prompt = [
    "You are a scam-message detector. The user uploaded a screenshot of a chat or message.",
    "First read all visible text in the image (OCR, Indonesian or English). Then analyze that text as a scam message.",
    "Return ONLY a JSON object matching the provided schema, nothing else.",
    '- status: "scam" if it is clearly a scam (phishing link, fake prize, impersonation, demand for money/OTP/PIN, malware APK);',
    '- "suspicious" if it has warning signs but is not conclusive;',
    '- "safe" if it looks like a normal legitimate message.',
    "- JOB SCAM (21 Nov 2026 false-negative fix — a job-scam screenshot was judged Safe 0/100): apply the same rule to the text you read from the image — if it is a job/recruitment chat that asks the job seeker to pay or transfer anything before or during recruitment (admin fee, deposit, guarantee money, registration fee, training fee, activation fee, 'pay first, then work'), it is a SCAM with riskScore 80 or higher. A real employer pays the worker — money flowing FROM the job seeker TO the employer as a condition of work is a scam. Also a scam: fake task jobs (typing, captcha, liking, subscribing for pay), 'standby and check your email' flows, task/member numbers. A genuine job message with no payment asked is SAFE.",
    "- riskScore: integer 0-100, how likely the message is a scam.",
    `- redFlags: short phrases in ${answerLang} naming each warning sign found (empty array when the message is safe).`,
    `- summary: one or two sentences in ${answerLang} explaining the verdict.`,
    `- extractedText: the exact text you read from the image, in its original language (empty string if no text is visible).`,
  ].join("\n");
  let result;
  let answeredModel;
  try {
    // Failover, same as the message check: primary first, backup once.
    const { result: r, model } = await generateWithFailover(
      (modelName) => {
        const m = getGenerativeModel(ai, {
          model: modelName,
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: makeImageVerdictSchema(Schema),
          },
        });
        return m.generateContent([
          { text: prompt },
          { inlineData: { mimeType, data: base64 } },
        ]);
      },
      {
        label: "Image check",
        onBackup: () => onProgress?.({ stage: "backup" }),
      },
    );
    result = r;
    answeredModel = model;
  } catch (e) {
    // Token claims are debug info only — log, never show to the user.
    if (tokenInfo) console.warn("[TipuCek] App Check token:", tokenInfo);
    throw new Error(e?.message || e);
  }
  let verdict;
  try {
    verdict = parseVerdictJson(result.response.text());
  } catch {
    throw new Error("AI returned a response that is not valid JSON.");
  }
  const riskScore = Math.max(
    0,
    Math.min(100, Math.round(Number(verdict.riskScore) || 0)),
  );
  const status =
    verdict.status === "scam" ||
    verdict.status === "suspicious" ||
    verdict.status === "safe"
      ? verdict.status
      : riskScore >= 60
        ? "scam"
        : riskScore >= 30
          ? "suspicious"
          : "safe";
  return {
    status,
    riskScore,
    redFlags: Array.isArray(verdict.redFlags)
      ? verdict.redFlags.map(String)
      : [],
    summary: String(verdict.summary || ""),
    extractedText: String(verdict.extractedText || ""),
    source: "IN_CLOUD",
    model: answeredModel,
  };
}

// ---------------------------------------------------------------------------
// Phone-call voice transcription (cloud-only).
//
// A web page cannot tap a phone call directly — the user records the
// call themselves (loudspeaker + microphone) or uploads a recording
// file, and the cloud model transcribes the speech. The transcript is
// then scored like a pasted message by the normal checker. The audio
// itself is never stored anywhere: it is sent to the model once and
// discarded (the transcript is treated like any other checked message).
// Demo mode has no AI at all, so transcription honestly refuses there
// instead of pretending — the UI maps the DEMO_NO_TRANSCRIBE error to
// a clear message.
// ---------------------------------------------------------------------------

/** Audio MIME types the cloud model accepts (extension fallback included). */
export const SUPPORTED_AUDIO_TYPES = [
  "audio/mp3",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/flac",
  "audio/webm",
];

const AUDIO_EXT_MIME = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
};

/**
 * Resolve the MIME type for an audio file: the browser-reported type
 * when it is supported, otherwise the file extension (some browsers
 * report an empty type for .m4a/.webm). Returns null when neither
 * identifies a supported format. Pure — unit-tested.
 */
export function resolveAudioMimeType(file) {
  const reported = String(file?.type || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (SUPPORTED_AUDIO_TYPES.includes(reported)) return reported;
  const ext = String(file?.name || "")
    .split(".")
    .pop()
    .toLowerCase();
  return AUDIO_EXT_MIME[ext] || null;
}

/**
 * Validate an audio file before transcription. Returns null when the
 * file is fine, otherwise the i18n error key for the UI
 * ("callAudioTooBig" | "callAudioType"). Pure — unit-tested.
 */
export function validateAudioFile(file) {
  if (!file) return "callAudioType";
  if (typeof file.size === "number" && file.size > MAX_AUDIO_BYTES) {
    return "callAudioTooBig";
  }
  if (!resolveAudioMimeType(file)) return "callAudioType";
  return null;
}

function audioFileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const base64 = dataUrl.split(",")[1] || "";
      resolve({ base64, mimeType: resolveAudioMimeType(file) });
    };
    reader.onerror = () =>
      reject(new Error("Could not read the audio file."));
    reader.readAsDataURL(file);
  });
}

/**
 * Transcribe speech in an audio recording with the cloud model.
 * `file` is a Blob/File (microphone recording or uploaded file).
 * Returns { transcript, source: "IN_CLOUD" }.
 * Throws Error("DEMO_NO_TRANSCRIBE") in demo mode, Error("NO_SPEECH")
 * when no speech is audible, Error("AUDIO_TOO_BIG") / Error("AUDIO_TYPE")
 * for rejected files, or the model's error otherwise. Never returns a
 * made-up transcript: an empty or failed transcription is an error.
 */
export async function transcribeAudioWithAI(file, lang = "en", onBackup) {
  const problem = validateAudioFile(file);
  if (problem === "callAudioTooBig") throw new Error("AUDIO_TOO_BIG");
  if (problem === "callAudioType") throw new Error("AUDIO_TYPE");
  if (!isFirebaseConfigured()) throw new Error("DEMO_NO_TRANSCRIBE");
  const { ai, getGenerativeModel, tokenInfo } = await ensureAIReady();
  const { base64, mimeType } = await audioFileToBase64(file);
  const answerLang = languageName(lang);
  const prompt = [
    "Transcribe the speech in this audio recording verbatim, in its",
    "original language (Indonesian or English). The speaker may be a",
    `phone scammer — transcribe what they actually said, in ${answerLang} only if the speech itself is in that language; otherwise keep the original language.`,
    "Return ONLY the transcript text, nothing else — no verdict, no summary, no labels.",
    "If no speech is audible, return an empty string.",
  ].join("\n");
  let result;
  try {
    // Failover, same as the message/image check: primary first, backup
    // once (round 6 — before this, a 429 on the primary killed the whole
    // call-audio check with no verdict at all).
    const { result: r } = await generateWithFailover(
      (modelName) => {
        const m = getGenerativeModel(ai, { model: modelName });
        return m.generateContent([
          { text: prompt },
          { inlineData: { mimeType, data: base64 } },
        ]);
      },
      {
        timeoutMs: AUDIO_CHECK_TIMEOUT_MS,
        label: "Audio transcription",
        onBackup: () => onBackup?.(),
      },
    );
    result = r;
  } catch (e) {
    if (tokenInfo) console.warn("[TipuCek] App Check token:", tokenInfo);
    throw new Error(e?.message || e);
  }
  const transcript = (result.response.text() || "").trim();
  if (!transcript) throw new Error("NO_SPEECH");
  return { transcript, source: "IN_CLOUD" };
}

/**
 * Preload the Firebase SDK chunks (app, app-check, AI) in the
 * background — no account, no token, no model, no verdict; just the
 * JavaScript files, from the same hosting origin. The first check
 * otherwise pays for these downloads inside ensureAIReady (measured
 * ~17s of a ~30s first check in the VM): preloading them on page
 * load (idle) means the check path's identical imports resolve from
 * the module cache. Safe to call repeatedly; never throws.
 */
export async function preloadAiModules() {
  if (!isFirebaseConfigured()) return;
  await Promise.all(
    [
      import("firebase/app"),
      import("firebase/app-check"),
      import("firebase/ai"),
    ].map((p) => p.catch(() => {})),
  );
}

/**
 * Best-effort background warm-up: prepare the Firebase app, an App Check
 * token and the on-device model after the user's first gesture (textarea
 * focus or sample click). Never throws and never blocks the UI — the
 * check path re-does whatever is still missing. A warmed-up device
 * answers the next check on-device in ~2s instead of waiting on a
 * first-time model download.
 */
export async function warmUpAI() {
  if (!isFirebaseConfigured()) return;
  try {
    const app = await getFirebaseApp();
    if (appCheckInstance) {
      const { getToken } = await import("firebase/app-check");
      await getToken(appCheckInstance, false).catch(() => {});
    }
    const { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } =
      await import("firebase/ai");
    const ai = getAI(app, { backend: new GoogleAIBackend() });
    const model = makeHybridModel(
      ai,
      getGenerativeModel,
      InferenceMode,
      makeVerdictSchema(Schema),
    );
    await model.initializeDeviceModel(() => {}).catch(() => {});
  } catch {
    // Warm-up is optional; the check path handles everything itself.
  }
}

/** Public entry point: production AI when configured, demo heuristic otherwise. */
export async function analyzeMessage(message, onProgress, lang = "en") {
  const text = (message || "").trim();
  if (text.length > MAX_MESSAGE_CHARS) {
    throw new Error(
      `Message too long: ${text.length} chars (max ${MAX_MESSAGE_CHARS})`,
    );
  }
  if (!isFirebaseConfigured()) {
    // Small async tick so the UI can show its "checking" state first.
    await new Promise((r) => setTimeout(r, 350));
    return analyzeWithHeuristic(message, lang);
  }
  return analyzeWithAI(message, onProgress, lang);
}

export { isFirebaseConfigured };
