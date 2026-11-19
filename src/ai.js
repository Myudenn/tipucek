// PesanAman — scam-message analysis.
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

export const CLOUD_MODEL = "gemini-3.5-flash-lite";

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

export function analyzeWithHeuristic(message) {
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
  const summary =
    status === "scam"
      ? "This message shows several strong scam indicators. Do not click any link, do not send money or codes, and block/report the sender."
      : status === "suspicious"
        ? "This message has some warning signs but is not conclusive. Be cautious: verify the sender through an official channel before acting."
        : "No clear scam indicators were found in this message. Stay alert anyway — never share OTPs, PINs or passwords with anyone.";
  return { status, riskScore: score, redFlags, summary, source: "DEMO" };
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
          "[PesanAman] App Check skipped: no reCAPTCHA Enterprise site key configured.",
        );
      }
    } catch (e) {
      appCheckInitError = e?.message || String(e);
      console.warn("[PesanAman] App Check init skipped:", appCheckInitError);
    }
    return app;
  })();
  return appPromise;
}

function buildPrompt(message) {
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
    "- redFlags: short English phrases naming each warning sign found",
    "  (empty array when the message is safe).",
    "- summary: one or two sentences in English explaining the verdict.",
    "",
    "Message to analyze:",
    '"""',
    message,
    '"""',
  ].join("\n");
}

/**
 * Analyze a message with Firebase AI Logic (hybrid inference).
 * `onProgress` receives { stage, progress } while the on-device model
 * downloads (stage "downloading-model", progress 0-1).
 */
export async function analyzeWithAI(message, onProgress) {
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

  // Structured-output schema for the verdict (shared by both paths).
  const verdictSchema = Schema.object({
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

  const model = getGenerativeModel(ai, {
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

  // REQUIRED: download/prepare the on-device model after a user gesture
  // (the Check button click) and BEFORE generateContent().
  await model.initializeDeviceModel((progress) => {
    onProgress?.({ stage: "downloading-model", progress });
  });

  let result;
  try {
    result = await model.generateContent(buildPrompt(message));
  } catch (e) {
    // Attach the App Check token's claims so the failure says which token
    // was presented when the server rejected the request.
    const detail = tokenInfo
      ? ` [App Check token presented: ${tokenInfo}]`
      : " [no App Check token was obtained]";
    throw new Error(`${e?.message || e}${detail}`);
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
    verdict = JSON.parse(text);
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

/** Public entry point: production AI when configured, demo heuristic otherwise. */
export async function analyzeMessage(message, onProgress) {
  if (!isFirebaseConfigured()) {
    // Small async tick so the UI can show its "checking" state first.
    await new Promise((r) => setTimeout(r, 350));
    return analyzeWithHeuristic(message);
  }
  return analyzeWithAI(message, onProgress);
}

export { isFirebaseConfigured };
