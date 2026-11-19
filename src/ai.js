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

export const CLOUD_MODEL = "gemini-3.5-flash-lite";

// Longest message accepted for a check. A pasted chat export can be
// huge — sending it whole to the cloud wastes tokens and risks a
// misleading "input is too large" error, so reject it up front with a
// clear message instead (the UI maps it to a friendly string).
export const MAX_MESSAGE_CHARS = 4000;

// Cloud calls must never hang the UI forever: only the on-device init
// used to be raced against a timeout. Every generateContent now has
// one too — 30 s for a verdict (cloud answers in ~2-4 s in practice;
// 30 s is still 7x the normal time, and it keeps the worst case
// — 5 s init + 30 s hybrid + 30 s cloud fallback = 65 s — under the
// 90 s a user will tolerate before giving up), 30 s for a chat
// answer, 30 s for a screenshot (vision + OCR).
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
  // Urgency / threats (ID + EN)
  { re: /\b(segera|sekarang juga|dalam 24 jam|batas waktu|sebelum.*ditutup|akun.*(diblokir|ditutup|dinonaktifkan)|account.*(blocked|closed|suspended|locked)|act (now|immediately)|within 24 hours|urgent|immediately)\b/i, weight: 18, flag: "Urgency / threat: pressure to act immediately" },
  // Prize / free money
  { re: /\b(sELAMAT|selamat.*(menang|mendapatkan)|hadiah|undian|giveaway|you (have )?won|congratulations.*won|claim.*prize|free.*(money|cash|iphone|gift))\b/i, weight: 22, flag: "Prize / free-money promise" },
  // Suspicious link / short link
  { re: /(bit\.ly|tinyurl|t\.co|s\.id|shorturl|goo\.gl|klik.*(link|tautan|di sini)|click.*(link|here)|http[^\s]*\.(xyz|top|click|link|tk|ml|ga)\b)/i, weight: 20, flag: "Suspicious or shortened link" },
  // Asking for money / transfer / OTP / PIN
  { re: /\b(transfer|kirim.*(uang|dana|saldo)|top ?up|bayar.*(biaya|admin|pajak)|otp|kode verifikasi|pin|password|kata sandi|rekening|send money|wire transfer|verification code|one-time password)\b/i, weight: 22, flag: "Asks for money, transfer, OTP, PIN or password" },
  // Impersonation (bank, government, courier, marketplace)
  { re: /\b(bank (bri|bca|mandiri|bni|bsi)|ojk|polisi|bea cukai|courier|kurir|jne|j&t|sicepat|gojek|grab|shopee|tokopedia|dinkes|kemenkes|dhl|fedex|ups|official|customer service|support team)\b/i, weight: 10, flag: "Impersonates a bank, authority, courier or marketplace" },
  // Impersonation of a known contact / family emergency
  { re: /\b(mama|papa|ibu|ayah|anak.*(kecelakaan|sakit|ditahan)|ganti nomor|nomor baru|ini nomor.*baru|this is my new number|mom|dad|emergency)\b/i, weight: 14, flag: "Family / known-contact impersonation or emergency story" },
  // Too-good-to-be-true offer / investment
  { re: /\b(investasi.*(untung|profit|jaminan)|profit.*\d+%|penghasilan.*(harian|pasif)|double.*money|guaranteed.*(profit|return)|lowongan.*(gaji|kerja dari rumah).*juta|part time.*\d+.*(juta|ribu))\b/i, weight: 16, flag: "Too-good-to-be-true offer (investment / job / income)" },
  // Asking to download an app / APK
  { re: /\b(download.*(apk|aplikasi)|install.*(apk|aplikasi)|unduh.*apk|\.apk\b)/i, weight: 18, flag: "Asks to download an app / APK file" },
  // Lottery / tax / fee to claim
  { re: /\b(biaya (admin|klaim|pajak)|pajak hadiah|ongkir.*(hadiah|klaim)|(clearance|customs|processing|delivery) fee|pay.*(fee|tax).*claim|processing fee)\b/i, weight: 16, flag: "Fee or tax demanded before claiming something" },
  // Generic phishing phrasing
  { re: /\b(verifikasi.*(akun|data)|update.*(data|akun)|konfirmasi.*(akun|data)|verify.*(account|identity|details)|update your (account|details)|confirm your (account|identity))\b/i, weight: 12, flag: "Phishing-style account verification request" },
];

export function analyzeWithHeuristic(message, lang = "en") {
  const text = (message || "").trim();
  const redFlags = [];
  let score = 0;
  for (const p of SCAM_PATTERNS) {
    if (p.re.test(text)) {
      score += p.weight;
      if (!redFlags.includes(p.flag)) redFlags.push(p.flag);
    }
  }
  // Long messages full of links / numbers are slightly more suspicious.
  const links = (text.match(/https?:\/\/[^\s]+/g) || []).length;
  if (links >= 2) {
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
    summary: demoSummary(status, lang),
    source: "DEMO",
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

function buildPrompt(message, lang = "en") {
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

/**
 * Analyze a message with Firebase AI Logic (hybrid inference).
 * `onProgress` receives { stage, progress } while the on-device model
 * downloads (stage "downloading-model", progress 0-1).
 */
export async function analyzeWithAI(message, onProgress, lang = "en") {
  const { ai, getGenerativeModel, InferenceMode, Schema, tokenInfo } =
    await ensureAIReady();

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
      model.generateContent(buildPrompt(message, lang)),
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
    const cloudModel = getGenerativeModel(ai, {
      model: CLOUD_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: verdictSchema,
      },
    });
    try {
      result = await withTimeout(
        cloudModel.generateContent(buildPrompt(message, lang)),
        CLOUD_CHECK_TIMEOUT_MS,
        "Check",
      );
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
  return {
    status,
    riskScore,
    redFlags: Array.isArray(verdict.redFlags)
      ? verdict.redFlags.map(String)
      : [],
    summary: String(verdict.summary || ""),
    source,
  };
}

// ---------------------------------------------------------------------------
// Aman — the virtual assistant (chat) + screenshot analysis.
// Both are cloud-only: the on-device model does single-turn text only, so
// it cannot hold a conversation or read images. The UI says so honestly.
// ---------------------------------------------------------------------------

function assistantSystemPrompt(lang) {
  const answerLang = languageName(lang);
  return [
    "You are Aman, the friendly AI assistant of TipuCek, a scam-message scanner.",
    `Answer in ${answerLang}. Keep answers short: 2-4 sentences, plain words, no jargon.`,
    "You help people recognize scam messages (fake prizes, fake couriers, fake bank warnings, OTP theft, fake APK invitations, fake jobs).",
    "Never ask for personal data (no phone numbers, OTPs, PINs, passwords, bank accounts).",
    "If the user pastes a suspicious message, give a quick judgment (scam / suspicious / safe) with the strongest warning sign, then tell them to check it with the TipuCek checker for a full verdict.",
    "If you are unsure, say so and tell them to verify the sender through an official channel.",
    "Never claim to be human. Never give legal or financial advice beyond general safety tips.",
  ].join("\n");
}

/**
 * Ask Aman a question. `history` is the recent chat ({ role: "user" |
 * "aman", text }[]), kept short (last 6 turns) so the prompt stays small.
 * Cloud-only; throws when Firebase is not configured or the call fails.
 */
export async function askAssistant(question, lang = "en", history = []) {
  const { ai, getGenerativeModel } = await ensureAIReady();
  const model = getGenerativeModel(ai, { model: CLOUD_MODEL });
  const turns = (history || [])
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Aman"}: ${m.text}`)
    .join("\n");
  const prompt = [
    assistantSystemPrompt(lang),
    "",
    turns ? `Conversation so far:\n${turns}\n` : "",
    `User: ${question}`,
    "Aman:",
  ].join("\n");
  const result = await withTimeout(
    model.generateContent(prompt),
    ASSISTANT_TIMEOUT_MS,
    "Assistant",
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
 * Cloud-only — the on-device model cannot read images.
 */
export async function analyzeImageWithAI(file, lang = "en") {
  const { ai, getGenerativeModel, Schema, tokenInfo } =
    await ensureAIReady();
  const { base64, mimeType } = await fileToBase64(file);
  const answerLang = languageName(lang);
  const model = getGenerativeModel(ai, {
    model: CLOUD_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: makeImageVerdictSchema(Schema),
    },
  });
  const prompt = [
    "You are a scam-message detector. The user uploaded a screenshot of a chat or message.",
    "First read all visible text in the image (OCR, Indonesian or English). Then analyze that text as a scam message.",
    "Return ONLY a JSON object matching the provided schema, nothing else.",
    '- status: "scam" if it is clearly a scam (phishing link, fake prize, impersonation, demand for money/OTP/PIN, malware APK);',
    '- "suspicious" if it has warning signs but is not conclusive;',
    '- "safe" if it looks like a normal legitimate message.',
    "- riskScore: integer 0-100, how likely the message is a scam.",
    `- redFlags: short phrases in ${answerLang} naming each warning sign found (empty array when the message is safe).`,
    `- summary: one or two sentences in ${answerLang} explaining the verdict.`,
    `- extractedText: the exact text you read from the image, in its original language (empty string if no text is visible).`,
  ].join("\n");
  let result;
  try {
    result = await withTimeout(
      model.generateContent([
        { text: prompt },
        { inlineData: { mimeType, data: base64 } },
      ]),
      IMAGE_CHECK_TIMEOUT_MS,
      "Image check",
    );
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
export async function transcribeAudioWithAI(file, lang = "en") {
  const problem = validateAudioFile(file);
  if (problem === "callAudioTooBig") throw new Error("AUDIO_TOO_BIG");
  if (problem === "callAudioType") throw new Error("AUDIO_TYPE");
  if (!isFirebaseConfigured()) throw new Error("DEMO_NO_TRANSCRIBE");
  const { ai, getGenerativeModel, tokenInfo } = await ensureAIReady();
  const { base64, mimeType } = await audioFileToBase64(file);
  const answerLang = languageName(lang);
  const model = getGenerativeModel(ai, { model: CLOUD_MODEL });
  const prompt = [
    "Transcribe the speech in this audio recording verbatim, in its",
    "original language (Indonesian or English). The speaker may be a",
    `phone scammer — transcribe what they actually said, in ${answerLang} only if the speech itself is in that language; otherwise keep the original language.`,
    "Return ONLY the transcript text, nothing else — no verdict, no summary, no labels.",
    "If no speech is audible, return an empty string.",
  ].join("\n");
  let result;
  try {
    result = await withTimeout(
      model.generateContent([
        { text: prompt },
        { inlineData: { mimeType, data: base64 } },
      ]),
      AUDIO_CHECK_TIMEOUT_MS,
      "Audio transcription",
    );
  } catch (e) {
    if (tokenInfo) console.warn("[TipuCek] App Check token:", tokenInfo);
    throw new Error(e?.message || e);
  }
  const transcript = (result.response.text() || "").trim();
  if (!transcript) throw new Error("NO_SPEECH");
  return { transcript, source: "IN_CLOUD" };
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
