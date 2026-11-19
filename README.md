# TipuCek — Private Scam-Message Scanner

**Check the message before you trust it.**

A single-page web app that checks whether a suspicious message (SMS,
WhatsApp, DM or email — Indonesian or English) is a scam. Built for the
**#BuildHybridAI 2026** hackathon (Devpost + Firebase AI Logic).

Why it matters: Indonesia's Anti-Scam Centre (IASC, OJK) recorded
about **Rp 9.1 trillion in losses from 411,000+ scam reports
(Nov 2024–Dec 2025)**, and GASA's 2025 report found **66% of
Indonesians have experienced a scam attempt**. TipuCek is built for
the people scammers target most — parents and grandparents, in their
own language, in one tap.

- **Live demo:** https://tipucek.web.app
- **Devpost description:** [DEVPOST-DESCRIPTION.md](./DEVPOST-DESCRIPTION.md)
- **License:** MIT License — see `LICENSE`

## What it does

### The checker

1. The user pastes a suspicious message and clicks **Check message**
   (or presses Ctrl+Enter), or taps **Paste** to read the clipboard and
   check immediately.
2. The app returns a result card:
   - **Status:** Safe / Suspicious / Scam
   - **Risk score:** 0–100, shown as a ring gauge
   - **Red flags:** the warning signs found, as chips
   - **Summary:** one or two sentences explaining the verdict
   - **What to do next:** one concrete action line per verdict
   - **Links found:** every URL in the message, each with its own risk
     label and reasons
   - **Numbers found:** Indonesian phone numbers and bank-account-like
     numbers, with links to the official checkers
   - **A badge showing where the answer came from:** `ON_DEVICE`
     (answered on the device), `IN_CLOUD` (answered in the cloud),
     `LOCAL` (answered by on-device rules, no AI) or `DEMO` (demo mode),
     plus the time the check took
   - **Copy result:** one tap copies the whole verdict as plain text
3. **Aman, the AI assistant** — a shield-and-star robot — answers
   scam-safety questions in a chat (same AI as the checker, in the
   interface language), and can send a
   pasted message to the real checker with one tap.
4. Six **one-click samples** (clear scam, suspicious, safe, plus three
   real Indonesian cases: a fake wedding-invitation APK, a fake
   part-time job, a fake bank OTP warning), shown as chat bubbles, make
   the demo fast.
5. An **online/offline indicator** shows the connection state. While
   offline, only on-device inference can run.

### Everything it can detect

| Input | What TipuCek checks |
|---|---|
| Pasted text (SMS, WhatsApp, email, DM) | AI verdict (on-device first, cloud fallback) + local rules: OTP/password demands, prize + fee, impersonation, threats, urgency |
| Screenshot / chat image | Cloud vision reads the text (OCR) and judges it like a pasted message; the text read is shown with the verdict. Cloud-only. |
| Links & sites | Shortener, suspicious TLD, brand look-alike, raw IP host, punycode, layered subdomains, http-only, `@`-trick. Short-link destinations are traced on a best-effort basis — the app says honestly when a link cannot be traced. |
| Phone numbers (Indonesia) | Extracted and shown, with a link to report the number at Komdigi's aduannomor.id |
| Bank account numbers | Extracted and shown, with a link to check the account at cekrekening.id |
| Files (uploaded) | Magic-byte inspection: true file type vs. extension, ZIP entry listing (APK vs. plain archive), local SHA-256 fingerprint. Text files (.txt/.md/.csv/…) are read and scored like a pasted message, with a button to send the same text to the full AI checker. **Structure check, not a malware scan** — a clean result never proves a file safe; the file is never uploaded. |
| File names in a message | `.apk` installers, Windows programs (`.exe`/`.msi`/`.bat`), archives (`.zip`/`.rar`), macro documents — names only, never downloaded or opened |
| Invitations | Fake job offers, fake prize announcements, fake event invitations — caught by the text checker |
| Phishing email | Display-name vs. sender-domain mismatch, free-mailbox sender, suspicious links in the body, pressure language |
| Phone calls | Known scam call scripts (bank/police impersonation, OTP/PIN demands, threats, "safe account" transfers) + community-report lookup. A number alone can be checked too — matched against the official contacts, format-checked, looked up in the reports. **By voice:** record the call (loudspeaker) or upload a recording — the cloud transcribes the speech and scores it like a message; the audio is never stored. TipuCek cannot tap a phone call directly and says so. |
| WhatsApp chat export | `.txt` export scan (max 2 MB / 5,000 messages), per-message local scores, risky messages listed |
| Messages you are about to send | Outbound guard: warns locally, with values masked, if the message contains an OTP, password, card number, ID number, account number or PIN |

### Twelve modules around the checker

| Module (`src/`) | What it does |
|---|---|
| `filecheck.js` | Real-file inspection by magic bytes + local SHA-256; ZIP entry listing; community-report lookup by file hash; text files (.txt/.md/.csv/…) are read and scored like a message, with a button to send the text to the AI checker |
| `contacts.js` | 16 entries for Indonesian banks, e-wallets, marketplaces, operators and authorities — 13 with an official number, 3 reachable only via their app (GoPay, LinkAja, Tokopedia), said so honestly |
| `firstaid.js` | Interactive first-aid guide, 4 scenarios × 3 steps: money sent, link clicked, APK installed, OTP shared. General guidance, not legal or financial advice. |
| `chatlog.js` | WhatsApp `.txt` export scanner (2 MB / 5,000 messages), local-only, per-message scores |
| `outbound.js` | Check-before-you-send guard: local patterns only, no AI, no network, findings masked (first 2 + last 2 digits), never saved to history |
| `reports.js` | Community report database (Firestore `reports`): **hash-only** — a document holds only a SHA-256 hash + `kind` + `count` + `firstSeen` + `lastSeen`. Never a raw value, never a reporter. A count is not a verdict and not a blocklist. |
| `crowdreport.js` | Crowd report-back form (Firestore `crowd_reports`): a user reports a scam phone number, bank account or new scam mode. Exactly 6 fields — `type`, `value`, `details`, `status="pending"`, `createdAt`, `reporterUid` (null, the app has no login) — enforced by `firestore.rules`; clients cannot read, update or delete reports (the owner reads them in the Firebase Console). Reports are **never trusted automatically and never shown publicly** — each stays `pending` until a human reviews it. The form and the privacy receipt say plainly that the report is sent to the TipuCek database for review, and only the reported number/account/mode is sent — no chat history, no personal data. A copy of the user's own report is kept in local history (local-only). |
| `domain.js` | Public RDAP domain age/registrar + best-effort short-link tracing; says honestly when a lookup fails; standalone link-tracker section (explicit per-link consent, works in local-only mode) |
| `quiz.js` | "Scam or safe?" quiz — 8 questions in Indonesian and English (other languages fall back to English) |
| `emailcheck.js` | Phishing-email check (local, no AI, no network): name-vs-domain, free mailbox, links, urgency, body heuristic |
| `callcheck.js` | Phone-call check: local scam-script patterns + community-report lookup, which only runs when cloud history is on; number-only path (official-contact match, format check, reports); transcribed-call merge (AI verdict + local analysis, worse wins) |

### Built for the people scammers target

- **Check before sending** (above): stop secrets from leaving the phone
  in the first place.
- **One-tap paste:** one tap reads the clipboard and checks immediately.
- **Senior mode:** bigger text and buttons (the main check button
  is relabelled "Check this message").
  Saved on the device (`localStorage`).
- **One-tap family alert:** warn the family in seconds — a pre-filled
  WhatsApp message (wa.me link) in all 8 interface languages — plus a
  shareable warning card rendered as a PNG through the native share
  sheet, and a one-tap PDF report (browser print, no dependencies).

### Phone and PC, 8 languages

Responsive on a 390 px phone and a 1280 px desktop, with no horizontal
overflow, touch targets of at least 44 px and 16 px inputs (no iOS zoom
jump). Installable PWA (standalone display, service-worker cache
`tipucek-v5`, 192/512/maskable icons, Apple touch icon) that registers
as a share target — share a message to TipuCek straight from WhatsApp
and it opens with the checker already filled in. The whole interface is
translated into 8 languages (English, Bahasa Indonesia, Español,
Français, Deutsch, Português, 日本語, 中文), auto-detected from the
browser, and the verdict itself is returned in the interface language.
(The quiz bank is Indonesian + English only so far; other languages
fall back to English.)

## How hybrid inference works

TipuCek uses **Firebase AI Logic** with hybrid inference
(`InferenceMode.PREFER_ON_DEVICE`):

- The message is analyzed **on the device first**, by a Gemini Nano-class
  model downloaded to the browser.
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
  straight to the cloud instead of waiting 10–20 s on a first download
  (the download keeps running in the background, so a later check can
  still answer on-device). The app also warms up the model in the
  background after the user's first gesture (textarea focus or sample
  click), so a repeat check is fast.
- Structured output: the model must return JSON matching a schema
  (`status`, `riskScore`, `redFlags`, `summary`) — enforced in the cloud
  with `responseSchema` and on-device with `responseConstraint`.
- The app uses single-turn text generation only, which is all the
  on-device model supports.
- **Honest limit:** on-device inference has not yet been verified on a
  real desktop Chrome (the VM's Chromium only provides a stub). The
  badge reports what the SDK actually did on each check; verifying
  on-device on real desktop Chrome is the first item on the roadmap.

### What runs where

| Path | Where it runs |
|---|---|
| Message check (AI) | On-device first (`ON_DEVICE`), cloud fallback (`IN_CLOUD`) |
| Screenshot check (OCR + vision) | Cloud only |
| Aman chat | Cloud only |
| Link-risk analysis, file-name detection | On-device rules (`LOCAL`) |
| Email check, call check, outbound guard, chat-log scan, quiz, first aid | Local only — no AI, no network |
| Community-report lookup, link tracking | Only when cloud history is on |

## Demo mode

Without a Firebase config the app runs in **demo mode**: a local keyword
heuristic analyzes the message so the whole flow (check → result card →
history) can be tested end-to-end with no account. The UI always shows
the banner **"Demo mode — connect Firebase to enable AI"** and demo
verdicts carry the `DEMO` badge. The production path always uses the
Firebase AI Logic SDK — never a mock.

Note: demo mode is only for unconfigured local builds. The live site
(https://tipucek.web.app) is fully configured and runs the real
Firebase AI Logic path — every check there returns a real Gemini verdict
with the `ON_DEVICE` / `IN_CLOUD` badge.

## How to test (for judges)

No account, no setup — open https://tipucek.web.app and:

1. Click the sample **"Scam example"** (fake Rp 50,000,000 prize +
   admin fee), then **Check message**. Expect: **Scam, ~95/100,
   `IN_CLOUD`**, about 4 seconds.
2. Click **"Safe example"**. Expect: **Safe, low score**.
3. Click the **"Wedding invite APK"** sample. Expect: **Scam** + the
   APK file warning.
4. Open the **privacy receipt** at the bottom of any result card: it
   says what was sent, where it was answered, how long it took, and
   where the result is stored.
5. Switch language (top right) — interface + verdict follow in
   8 languages.

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
   database with a `checks` collection for history (and a `reports`
   collection for community counts; see `firestore.rules`). Without
   Firestore the app still works: history falls back to `localStorage`
   and never crashes.

## Project structure

```
index.html               Single-page UI (8 languages, auto-detected)
src/main.js              UI wiring, samples, online/offline indicator, copy/CSV,
                         screenshot check, share card, PWA registration,
                         senior mode, family alert, PDF report
src/ai.js                Firebase AI Logic integration + demo heuristic +
                         Aman chat (askAssistant) + screenshot analysis
src/assistant.js         Aman — the virtual AI assistant (avatar + chat)
src/risks.js             Local link-risk analysis + phone/account extraction
src/files.js             Local fake-file-name detection (APK, programs, archives, docs)
src/filecheck.js         Real-file inspection (magic bytes + local SHA-256)
src/contacts.js          Official contact directory (16 Indonesian contacts)
src/firstaid.js          Interactive first-aid guide (4 scenarios × 3 steps)
src/chatlog.js           WhatsApp chat-export scanner (2 MB / 5,000 messages)
src/outbound.js          Check-before-you-send guard (local, masked, never saved)
src/reports.js           Community reports (hash-only Firestore counts)
src/domain.js            RDAP domain lookup + best-effort short-link tracing
src/quiz.js              "Scam or safe?" quiz (8 questions, ID + EN)
src/emailcheck.js        Phishing-email check (local)
src/callcheck.js         Phone-call check (local patterns + gated report lookup)
src/sharecard.js         Shareable warning card (canvas PNG + Web Share)
src/i18n.js              Interface translations (8 languages) + auto-detect
src/history.js           History: localStorage first, opt-in Firestore verdicts
src/firebase-config.js   Firebase config (reads `.env.local`; placeholders mean Demo mode)
src/styles.css           Responsive styling (light + dark, senior mode, print styles)
public/aman.png          Aman avatar art (shield-and-star robot)
public/manifest.webmanifest  PWA manifest (installable + share target)
public/sw.js             Service worker (offline app shell, cache tipucek-v5)
firestore.rules          Rules: verdict-only history (hasOnly) + hash-only reports
tests/unit.test.mjs      Unit tests (node --test)
tests/benchmark-local-rules.mjs  Local-rules demo benchmark
SETUP-MYUDEN.md          Firebase setup guide in Bahasa Indonesia
DEVPOST-DESCRIPTION.md   Devpost submission text
VIDEO-SCRIPT.md          Demo video script
```

## Privacy

Read this carefully — it is the product's core promise, and it is
deliberately narrow so that it stays true:

- **History is local by default.** "Save history only on this device"
  is ON by default. Every check is always kept in `localStorage`
  (with the full message text, so the on-device history is complete)
  and nowhere else unless the user opts into cloud sync.
- **Cloud sync, when opted in, never carries message text.** Only the
  verdict is synced — `status`, `riskScore`, `redFlags`, `summary`,
  `source`, `createdAt`, `ownerUid` — and `firestore.rules` enforces
  exactly that field list (`hasOnly`), so even a buggy or malicious
  client cannot store a raw message in the cloud. History is
  per-user: only the same anonymous UID can read it back; there are
  no updates or deletes through the client.
- **Community reports store hashes only.** A report document is keyed
  by the SHA-256 hash of a normalized value (phone, account, file name
  or file-content hash) and holds only `{ kind, count, firstSeen,
  lastSeen }` — never the raw value, never the reporter. Counts are
  public; a count is not personal data.
- **Crowd reports (lapor-balik) are sent to the database for human
  review — and the form says so.** A crowd report is the one place
  where the user deliberately sends a raw value: the reported phone
  number, bank account or scam mode (`type`, `value`, `details`) plus
  `status="pending"`, `createdAt` and `reporterUid` (null) — exactly
  those 6 fields, enforced by `firestore.rules`. Nothing else is
  sent: no chat history, no personal data. Reports are never trusted
  automatically and never shown publicly; each stays `pending` until
  a human reviews it in the Firebase Console (clients cannot read,
  update or delete them). The user keeps a local-only copy in their
  own history.
- **Community counts and link tracking only run when cloud history is
  on.** With the default local-only setting, no report lookup and no
  link tracking happen.
- **Local-only checks never touch the network:** check-before-sending,
  email check, call check and chat-log scan run entirely on the device.
- **The honest caveat — storage vs. inference input.** When the
  on-device model cannot answer and the cloud fallback runs, the
  message **is sent to Gemini in the cloud to produce the verdict**
  (inference input). Our privacy promise is about **storage**: the raw
  message is never stored in the cloud. We do not claim the message
  never leaves the device, because that would not be true on a cloud
  fallback.
- **On-device answers never leave the device**, and in demo mode
  nothing leaves the browser at all.
- History is stored under an anonymous Firebase account — no email, no
  name, no phone number.

## Verification

Numbers we can stand behind (all re-runnable from this repo):

- **59 tests passing, 0 failing** — `npm test` (43 unit tests in
  `tests/unit.test.mjs`: local detectors, link-risk rules, email brand
  checks, privacy gates; plus 4 structural tests for `firestore.rules`
  in `tests/rules.test.mjs`; plus 12 gap-fix tests in
  `tests/gaps.test.mjs` — text files, number-only call checks, call-voice
  transcription helpers + verdict merge, the standalone link tracker).
  The rules tests assert on
  the rules text (no Java → no Firestore emulator here) and say so.
- **AI benchmark protocol** — `tests/ai-benchmark-cases.json` +
  `tests/AI-BENCHMARK.md`: 25 fixed cases run through the live site
  (11 scam, 10 safe, 4 hard). First live run pending; numbers are
  quoted only after that run.
- **Local-rules demo benchmark: 14/14 flagged, 0 false positives,
  0 false negatives**, mean scam score 49.4 vs. safe 7.7
  (`tests/benchmark-local-rules.mjs`). Labelled honestly: this is a
  benchmark of the local demo rules, **not AI accuracy**.
- **89 Playwright checks (run 28)** (desktop + mobile), **28 design checks** and
  **16 avatar checks** run against the live build.
- **Four holes found by live testing on 19 Nov, all fixed and
  re-verified in the browser** — text files, number-only call checks,
  the standalone link tracker (see the checks table above). QRIS
  checking was removed the same day by the owner's order — no official
  registry can verify a QRIS merchant, so the feature was deleted
  rather than kept half-working.
- **Voice output removed 19 Nov** — cloud TTS + device voice never
  sounded on the user's phone, so the whole voice-output feature was
  removed; call-voice INPUT (record/upload → transcribe → score) is kept.
- Live site verified: real Gemini verdicts with the `IN_CLOUD` badge.

## What's next

- Verify on-device inference on a real desktop Chrome and report the
  result honestly.
- Google Search Console + search indexing.
- Demo video (max 3 minutes) for the Devpost submission.
- Moderation for community reports: the crowd report-back form
  exists and every report stays `pending` until a human reviews it;
  the next step is the review workflow that turns reviewed reports
  into trusted data.
- Translate the quiz bank into the other 6 interface languages.

## License

MIT License — see `LICENSE`.
