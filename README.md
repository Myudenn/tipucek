# PesanAman — Private Scam-Message Scanner

A single-page web app that checks whether a suspicious message (SMS,
WhatsApp, DM or email — Indonesian or English) is a scam. Built for the
**#BuildHybridAI 2026** hackathon (Devpost + Firebase).

## What it does

1. The user pastes a suspicious message and clicks **Check message**
   (or presses Ctrl+Enter).
2. The app returns a result card:
   - **Status:** Safe / Suspicious / Scam
   - **Risk score:** 0–100, shown as a ring gauge
   - **Red flags:** the warning signs found, as chips
   - **Summary:** one or two sentences explaining the verdict
   - **What to do next:** one concrete action line per verdict
   - **Links found:** every URL in the message, with a don't-click warning
   - **A large badge** showing where the answer came from:
     `ON_DEVICE` (answered on the device, private) or `IN_CLOUD`
     (answered in the cloud), plus the time the check took
   - **Copy result:** one click copies the whole verdict as plain text
3. Every check is saved to **check history** (Firestore, anonymous login),
   with live stats ("N checks · M scams caught") and a **Download CSV**
   export.
4. An **offline / airplane-mode indicator** shows the connection state.
   While offline, only on-device inference can run.
5. Three **one-click samples** (clear scam, suspicious, safe), shown as
   chat bubbles, make the demo fast.
6. **Automatic translation — 8 languages.** The whole interface
   (English, Bahasa Indonesia, Español, Français, Deutsch, Português,
   日本語, 中文) is translated, and the verdict itself (summary + red
   flags) is returned in the UI language — by the AI model in AI mode,
   by a translation table in demo mode. The language is picked
   automatically from the browser (`?lang=` overrides, the choice is
   saved), and a dropdown in the top bar switches it any time.

## How hybrid inference works

PesanAman uses **Firebase AI Logic** with hybrid inference
(`InferenceMode.PREFER_ON_DEVICE`):

- The message is analyzed **on the device first**, by a Gemini Nano-class
  model downloaded to the browser. The message never leaves the device.
- If the on-device model cannot answer, the request **falls back to the
  cloud** model `gemini-3.5-flash-lite` (explicitly set — see the note in
  `src/ai.js` about the model name).
- The SDK reports where the answer came from via
  `response.inferenceSource` (`"on_device"` / `"in_cloud"` in the SDK;
  displayed as `ON_DEVICE` / `IN_CLOUD`). If it is missing, the badge
  shows `Unknown`.
- The on-device model is prepared with `model.initializeDeviceModel()`,
  called from the Check button click (a user gesture) and **before**
  `generateContent()`. To keep checks fast, the init is raced against a
  5-second timeout: if the model is not ready in time, the check goes
  straight to the cloud instead of waiting 10–20s on a first download
  (the download keeps running in the background, so a later check can
  still answer on-device). The app also warms up the model in the
  background after the user's first gesture (textarea focus or sample
  click), so a repeat check is fast.
- Structured output: the model must return JSON matching a schema
  (`status`, `riskScore`, `redFlags`, `summary`) — enforced in the cloud
  with `responseSchema` and on-device with `responseConstraint`.
- The app uses single-turn text generation only, which is all the
  on-device model supports.

## Demo mode

Without a Firebase config the app runs in **demo mode**: a local keyword
heuristic analyzes the message so the whole flow (check → result card →
history) can be tested end-to-end with no account. The UI always shows
the banner **"Demo mode — connect Firebase to enable AI"** and demo
verdicts carry the `DEMO` badge. The production path always uses the
Firebase AI Logic SDK — never a mock.

## Run it

```bash
npm install
npm run dev      # development server (http://localhost:5173)
npm run build    # production build
npm run preview  # serve the production build locally
```

Requirements: Node.js 20+ (developed with Node 24), npm 10+.

## Connect Firebase (production AI)

1. Create a Firebase project in the
   [Firebase Console](https://console.firebase.google.com/) and register a
   Web app.
2. In the console, open **AI Logic** → **Get started** and choose the
   **Gemini Developer API**.
3. Copy the web app config into `.env.local` in the repo (copy
   `.env.local.example` first) with the `VITE_FIREBASE_*` variable
   names. Never commit real credentials to a public repo — `.env.local`
   is git-ignored; see `SETUP-MYUDEN.md` (Bahasa Indonesia,
   step-by-step) for the full walkthrough, including App Check.
4. Enable **Authentication → Anonymous** sign-in and create a Firestore
   database with a `checks` collection for history. Without Firestore the
   app still works: history falls back to `localStorage` and never crashes.

## Project structure

```
index.html            Single-page UI (8 languages, auto-detected)
src/main.js           UI wiring, samples, online/offline indicator, copy/CSV
src/ai.js             Firebase AI Logic integration + demo heuristic
src/i18n.js           Interface translations (8 languages) + auto-detect
src/history.js        Firestore (anonymous auth) with localStorage fallback
src/firebase-config.js  Firebase config (reads `.env.local`; placeholders mean Demo mode)
src/styles.css        Responsive, professional styling (light + dark)
SETUP-MYUDEN.md       Firebase setup guide in Bahasa Indonesia
```

## Privacy

- On-device answers never leave the device.
- History is stored under an anonymous Firebase account — no email, no
  name, no phone number.
- In demo mode nothing leaves the browser at all.

## License

Apache License 2.0 — see `LICENSE`.
