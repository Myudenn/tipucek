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
5. Six **one-click samples** (clear scam, suspicious, safe, plus three
   real Indonesian cases: a fake wedding-invitation APK, a fake
   part-time job, a fake bank OTP warning), shown as chat bubbles,
   make the demo fast.
6. **Automatic translation — 8 languages.** The whole interface
   (English, Bahasa Indonesia, Español, Français, Deutsch, Português,
   日本語, 中文) is translated, and the verdict itself (summary + red
   flags) is returned in the UI language — by the AI model in AI mode,
   by a translation table in demo mode. The language is picked
   automatically from the browser (`?lang=` overrides, the choice is
   saved), and a dropdown in the top bar switches it any time.
7. **Aman, the virtual AI assistant.** A small, handsome, dignified
   anime character (blue hair, blue eyes, blue hoodie) who greets the
   user, answers scam-safety questions in a chat (same cloud model as
   the checker, in the UI language), and can send a pasted message to
   the real checker with one tap. Voice readout via the browser's
   speech synthesis is available with a toggle (off by default).
8. **Screenshot check (OCR + vision).** Upload a screenshot of a chat
   and the cloud model reads the text in it and judges it like a pasted
   message — the text it read is shown with the verdict. Cloud-only:
   the on-device model cannot read images.
9. **Link risk + numbers.** Every URL in a message is analyzed on the
   device (shortener, suspicious TLD, brand look-alike, IP host,
   punycode, http-only, @-trick) with a per-link risk label and reasons
   — no link is followed and no database is consulted. Phone numbers
   and bank-account-like numbers are extracted and shown, with a link
   to the official checker (cekrekening.id) for accounts. PesanAman has
   no scam-number database of its own and does not pretend otherwise.
10. **Shareable warning card.** One tap renders the verdict as a PNG
    card (verdict, score ring, summary, what to do, red flags) and
    shares it through the device's native share sheet, or downloads it
    — so a user can warn a family WhatsApp group in seconds.
11. **PWA + Share Target.** The app is installable (manifest + service
    worker, offline app shell) and registers as a share target: share
    any message to PesanAman straight from WhatsApp and it opens with
    the checker already filled in and running.
12. **Aman moves like a living character.** He floats smoothly when idle
    (with a shadow that softens as he rises), blinks every few seconds,
    waves once on greeting, and nods while he talks. Honest note: the
    art is one flat image, so the hand and the mouth cannot move on
    their own — the whole character moves instead.
13. **Fake-file detection (local).** File names in the message are
    checked on the device: `.apk` installers, Windows programs
    (`.exe`/`.msi`/`.bat`), archives (`.zip`/`.rar`), and documents that
    push an install or a macro — each with a warning and advice. It
    reads names only; it never downloads or opens a file.
14. **Report channels (official).** Every phone number links to
    Komdigi's aduannomor.id to report it; every account links to
    cekrekening.id; and scam/suspicious verdicts carry a report line
    with both, even when the message contains no number at all.
15. **Roaming companion.** A small Aman floats around the page: he
    glides from edge to edge (slow, eased, with pauses), bobs and
    blinks while he waits, waves on arrival, and comes to look at the
    verdict with the user after a check. He parks while the user types
    and stays still for reduced-motion users. Click him to jump to the
    Ask Aman chat.
16. **Voice (on-device).** Aman speaks with the browser's own voice:
    the Voice toggle reads every answer out loud (and greets out loud
    the moment it is turned on), and each answer has its own "Listen"
    button. The app picks the best voice for the UI language (Bahasa
    Indonesia first when the device has one) and says honestly when
    the device has no usable voice.

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

Note: demo mode is only for unconfigured local builds. The live site
(https://pesanaman-80d63.web.app) is fully configured and runs the real
Firebase AI Logic path — every check there returns a real Gemini verdict
with the `ON_DEVICE` / `IN_CLOUD` badge.

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
src/main.js           UI wiring, samples, online/offline indicator, copy/CSV,
                      screenshot check, share card, PWA registration
src/ai.js             Firebase AI Logic integration + demo heuristic +
                      Aman chat (askAssistant) + screenshot analysis
src/assistant.js      Aman — the virtual AI assistant (avatar + chat + voice)
src/risks.js          Local link-risk analysis + phone/account extraction
src/files.js          Local fake-file detection (APK, programs, archives, docs)
src/sharecard.js      Shareable warning card (canvas PNG + Web Share)
src/i18n.js           Interface translations (8 languages) + auto-detect
src/history.js        Firestore (anonymous auth) with localStorage fallback
src/firebase-config.js  Firebase config (reads `.env.local`; placeholders mean Demo mode)
src/styles.css        Responsive, professional styling (light + dark)
public/aman.png       Aman avatar art (Myuden's chosen character)
public/manifest.webmanifest  PWA manifest (installable + share target)
public/sw.js          Service worker (offline app shell)
SETUP-MYUDEN.md       Firebase setup guide in Bahasa Indonesia
```

## Privacy

- On-device answers never leave the device.
- History is stored under an anonymous Firebase account — no email, no
  name, no phone number.
- In demo mode nothing leaves the browser at all.

## License

Apache License 2.0 — see `LICENSE`.
