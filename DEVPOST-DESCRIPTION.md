# PesanAman — Devpost Description (English, draft)

> Draft for the #BuildHybridAI 2026 Devpost submission. Live demo:
> https://pesanaman-80d63.web.app — Public repo:
> https://github.com/kyleweb3/pesanaman

## Inspiration

Scam messages are everywhere: fake lottery wins, fake package deliveries,
fake bank warnings asking for an OTP. They arrive by SMS, WhatsApp, DM
and email, and they work because people have to decide in seconds whether
a message is real. Most people have no tool for that decision — and the
messages themselves are private, so sending them to a random website to
check is its own privacy problem.

PesanAman ("Safe Message" in Indonesian) answers one question: is this
message a scam — without the message ever having to leave the device.

## What it does

Paste a suspicious message, click **Check message**, and get a verdict
card in seconds:

- **Status:** Safe, Suspicious, or Scam
- **Risk score:** 0–100, shown as a ring gauge
- **Red flags:** the warning signs found (for example, "Request for OTP
  code" or "Unsolicited prize winnings")
- **Summary:** one or two sentences explaining the verdict
- **What to do next:** one concrete action line per verdict
- **Links found:** every URL in the message, with a don't-click warning
- **A badge showing where the answer came from:** `ON_DEVICE` (answered
  on the device, fully private) or `IN_CLOUD` (answered in the cloud),
  plus the time the check took
- **Copy result:** one click copies the whole verdict as plain text

Every check is saved to check history (Firestore, anonymous login — no
email, no name, no phone number), with live stats and a CSV export. An
online/offline indicator shows the connection state, and three one-click
samples (clear scam, suspicious, safe) make the demo fast. It checks
messages in Indonesian or English.

**Automatic translation — 8 languages.** The whole interface is
translated (English, Bahasa Indonesia, Español, Français, Deutsch,
Português, 日本語, 中文), picked automatically from the browser with a
dropdown to switch any time — and the verdict itself (summary + red
flags) is returned in the UI language. Verified live on 19 Nov 2026:
the built-in scam sample scores Scam 99/100 and the safe sample scores
Safe 0/100 (the scam score varies slightly run to run, 98–100).

## How we built it

PesanAman is a single-page web app (Vite + vanilla JavaScript) using
**Firebase AI Logic with hybrid inference**
(`InferenceMode.PREFER_ON_DEVICE`):

- The message is analyzed **on the device first**, by a Gemini Nano-class
  model downloaded to the browser. In this path the message never leaves
  the device.
- If the on-device model cannot answer, the request **falls back to the
  cloud** model `gemini-3.5-flash-lite`.
- The SDK reports where the answer came from via
  `response.inferenceSource`, shown as the `ON_DEVICE` / `IN_CLOUD`
  badge — so the privacy claim is visible on every single result, not
  just in the documentation.
- Structured output: the model must return JSON matching a schema
  (`status`, `riskScore`, `redFlags`, `summary`), enforced in the cloud
  with `responseSchema` and on-device with `responseConstraint`.
- The on-device model is prepared with `model.initializeDeviceModel()`,
  called from the Check button click (a user gesture) and before
  `generateContent()`. To keep checks fast, the init is raced against a
  5-second timeout — if the model is not ready in time, the check goes
  straight to the cloud instead of waiting 10–20s on a first download —
  and the app warms up the model in the background after the user's
  first gesture, so repeat checks are fast.
- **Firebase App Check** (reCAPTCHA Enterprise) protects the API key,
  **Anonymous Authentication** + **Firestore** store the history, and
  **Firebase Hosting** serves the live demo.

## Challenges we ran into

The hardest bug was a silent one: every live AI check failed with
`401 Firebase App Check token is invalid`, even though the site key, the
domains and the app ID were all correct. The cause was an initialization
order bug — the history module created the Firebase app at page load, and
the AI module's early return skipped `initializeAppCheck` entirely, so no
token was ever minted. The fix initializes App Check on the existing app
too, and adds a pre-flight token check with a clear error message. The
live demo now returns Scam 100/100 with the `IN_CLOUD` badge.

## What's next

- More sample packs for the scam patterns seen most in Southeast Asia.
- Optional on-device-only mode for users who never want a cloud call.
- More interface languages, and a shareable result card.

## Links

- Live demo: https://pesanaman-80d63.web.app
- Source code (Apache-2.0): https://github.com/kyleweb3/pesanaman
