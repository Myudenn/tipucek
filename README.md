# PesanAman — Private Scam-Message Scanner

A single-page web app that checks whether a suspicious message (SMS,
WhatsApp, DM or email — Indonesian or English) is a scam. Built for the
**#BuildHybridAI 2026** hackathon (Devpost + Firebase).

## What it does

1. The user pastes a suspicious message and clicks **Check message**.
2. The app returns a result card:
   - **Status:** Safe / Suspicious / Scam
   - **Risk score:** 0–100
   - **Red flags:** the warning signs found
   - **Summary:** one or two sentences explaining the verdict
   - **A large badge** showing where the answer came from:
     `ON_DEVICE` (answered on the device, private) or `IN_CLOUD`
     (answered in the cloud)
3. Every check is saved to **check history** (Firestore, anonymous login).
4. An **offline / airplane-mode indicator** shows the connection state.
   While offline, only on-device inference can run.
5. Three **one-click samples** (clear scam, suspicious, safe) make the demo
   fast.

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
  `generateContent()`.
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
3. Copy the web app config into `src/firebase-config.js` (replace the
   `YOUR_...` placeholders). Never commit real credentials to a public
   repo — see `SETUP-MYUDEN.md` (Bahasa Indonesia, step-by-step) for the
   full walkthrough, including App Check.
4. Enable **Authentication → Anonymous** sign-in and create a Firestore
   database with a `checks` collection for history. Without Firestore the
   app still works: history falls back to `localStorage` and never crashes.

## Project structure

```
index.html            Single-page UI (English)
src/main.js           UI wiring, samples, online/offline indicator
src/ai.js             Firebase AI Logic integration + demo heuristic
src/history.js        Firestore (anonymous auth) with localStorage fallback
src/firebase-config.js  Firebase config placeholders (TODO)
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
