# TipuCek — Check the message before you trust it

> Built for the **#BuildHybridAI 2026** hackathon (Devpost + Firebase AI Logic).
> Live demo: https://tipucek.web.app — Public repo:
> https://github.com/kyleweb3/tipucek

**TipuCek** (from Indonesian *tipu*, "scam / deception", and *cek*, "check")
answers one question in seconds: **is this message a scam?** Paste any
suspicious message — SMS, WhatsApp, email, DM — and get a clear verdict,
the warning signs behind it, and exactly what to do next. It checks on the
device first, falls back to the cloud only when needed, and tells you
honestly, on every single result, where the answer came from.

## Inspiration

Scam messages are everywhere: fake lottery wins, fake package deliveries,
fake bank warnings demanding an OTP, fake job offers asking for a "fee".
They arrive by SMS, WhatsApp, DM and email, and they work because people
have to decide in seconds whether a message is real. Most people have no
tool for that decision — and the messages themselves are private, so
pasting them into a random website to check is its own privacy problem.

In Indonesia alone, the scale is staggering: the OJK's Indonesia
Anti-Scam Centre (IASC) recorded about **Rp 9.1 trillion in losses
from 411,000+ scam reports between November 2024 and December 2025**,
and the Global Anti-Scam Alliance's 2025 report found **66% of
Indonesians have experienced a scam attempt**. The people scammers
target most are parents and grandparents who get these messages on
their phones, in their own language, with no time to research. The
check has to be one tap, the answer has to be readable at a glance,
and the message itself must stay private — not stored in someone
else's database.

## What it does

### One check, one clear verdict

Paste a suspicious message, tap **Check message**, and get a verdict card:

- **Status:** Safe, Suspicious, or Scam
- **Risk score:** 0–100, shown as a ring gauge
- **Red flags:** the warning signs found (for example, "Request for OTP
  code" or "Unsolicited prize winnings")
- **Summary:** one or two sentences explaining the verdict
- **What to do next:** one concrete action line per verdict
- **Links found:** every URL in the message, each with its own risk label
- **Numbers found:** Indonesian phone numbers and bank-account-like
  numbers, with links to the official checkers — report a number at
  Komdigi's aduannomor.id, check an account at cekrekening.id
- **A badge showing where the answer came from:** `ON_DEVICE`
  (answered on the device), `IN_CLOUD` (answered in the cloud), `LOCAL`
  (answered by on-device rules, no AI), or `DEMO` (demo mode) — plus the
  time the check took
- **Copy result:** one tap copies the whole verdict as plain text

### More than text: screenshots, links, files, invitations

- **Screenshot check (OCR).** Upload a screenshot of a chat and the
  cloud model's vision reads the text in it and judges it like a pasted
  message. The text it read is shown next to the verdict. Cloud-only:
  the on-device model cannot read images.
- **Link and domain check.** Every URL is analyzed from the address
  itself — shortener, suspicious domain ending, brand look-alike, raw IP
  host, punycode, layered subdomains. Short-link destinations are traced
  on a best-effort basis, and the app says honestly when a link cannot
  be traced instead of guessing. A standalone **Track a link** section
  traces any pasted link to its final destination, registrar and
  registration date — tapping it is the consent for that one link, so
  it works even in local-only mode.
- **Phone-call voice.** A web page cannot tap a phone call directly,
  and TipuCek says so on the page. Instead the user records the call
  (loudspeaker + microphone, up to 2 minutes) or uploads a recording
  file (MP3, WAV, M4A, OGG, FLAC, WebM, max 10 MB); the cloud model
  transcribes the speech and the transcript is scored like a message
  (AI verdict + local call-script patterns, worse wins). The audio is
  sent to the cloud only for transcription and is never stored; the
  privacy receipt says so. Demo mode honestly refuses transcription
  instead of faking it.
- **Real-file check.** Upload a file and TipuCek reads its magic bytes
  to identify its true type (a ".pdf" can really be an .exe), lists ZIP
  entries so an APK is told apart from a plain archive, and computes a
  local SHA-256 fingerprint. Text files (.txt/.md/.csv/…) are read and
  scored like a pasted message, with a button to send the same text to
  the full AI checker. This is a **structure** check, not a
  malware scan — it never sends the file anywhere, and a clean result
  never proves a file safe. File names mentioned inside a message are
  checked too (APK, exe/msi/bat, zip/rar, macro documents).
- **Invitations.** Fake job offers, fake prize announcements and fake
  event invitations are caught by the same text checker — no separate
  flow to learn.

### Twelve tools around the checker

The message checker is the core; twelve focused modules cover the rest of
the scam journey:

| Module | What it does |
|---|---|
| File check | Magic-byte file inspection + local SHA-256 (above); text files are read and scored like a message |
| Link tracking | Standalone section: follow any pasted link to its final destination, registrar and registration date (explicit per-link consent) |
| Official contacts | 16 entries for Indonesian banks, e-wallets, marketplaces, operators and authorities (BCA, BRI, Mandiri, BNI, BSI, OVO, DANA, GoPay, LinkAja, Shopee, Tokopedia, Telkomsel, Indosat, XL, OJK, Police) — 13 with an official number, 3 reachable only via their app (GoPay, LinkAja, Tokopedia), said so honestly |
| First aid | Interactive 4-scenario guide for when it already happened: money sent, link clicked, APK installed, OTP shared — 3 steps each |
| Chat-log scan | Scans a WhatsApp `.txt` chat export (max 2 MB / 5,000 messages), scores every message locally, lists the risky ones |
| Check before sending | Warns — locally, with values masked — if a message you are about to send contains an OTP, password, card number, ID number, account number or PIN |
| Community reports | Hash-only database: only a SHA-256 hash + category + count + timestamp is stored, never the raw number, account or file, never the reporter |
| Crowd reports | Report a scam phone number, bank account or new scam mode. The report is sent to the TipuCek database for review — only the reported number/account/mode is sent, no chat history, no personal data. Every report stays pending until a human reviews it; reports are never trusted automatically and never shown publicly |
| Domain lookup | Public RDAP domain age/registrar + best-effort short-link tracing |
| Scam quiz | "Scam or safe?" — 8 questions in Indonesian and English (other languages fall back to English) |
| Email check | Phishing-email check: display-name vs. sender-domain mismatch, free-mailbox sender, suspicious links, pressure language |
| Call check | Phone-call check: known scam call scripts (bank/police impersonation, OTP/PIN demands, threats, "safe account" transfers) plus a community-report lookup. A number alone can be checked too — matched against the official contacts, format-checked, and looked up in the reports |

### Built for the people scammers target

- **Check before sending** (above): stop secrets from leaving the phone
  in the first place.
- **One-tap paste:** one tap reads the clipboard and checks immediately —
  no selecting, copying and switching back and forth.
- **Senior mode:** bigger text and buttons, a single "Check this message"
  button. The choice is saved on the
  device.
- **One-tap family alert:** warn the family in seconds — a pre-filled
  WhatsApp message (wa.me link) in all 8 interface languages — plus a
  shareable warning card rendered as a PNG through the native share
  sheet, and a one-tap PDF report (browser print, no dependencies).

### Aman, the AI assistant

Aman — a shield-and-star robot — answers scam-safety questions in a chat,
in the interface language, and can send a
pasted message to the real checker with one tap. He greets the user, and
the chat card shows when he is thinking or answering.

### Private by design

- **"Save history only on this device" is ON by default.** The full
  history, including message text, lives in the browser's localStorage
  and nowhere else.
- **Cloud sync is opt-in, and it never carries message text.** If the
  user turns it on, only the verdict is synced — status, risk score,
  red flags, summary, source, timestamp and the owner's anonymous UID.
  This is enforced twice: by the code, and by `firestore.rules`
  (`hasOnly` on exactly those fields). History is per-user: only the
  same anonymous UID can read it back.
- **Community reports and link tracking only run when cloud history is
  on.** Community reports store hashes only (see above).
- **Crowd reports are the deliberate exception — and the form says so.**
  When a user reports a scam number, account or mode, that report is
  sent to the TipuCek database for human review: only the reported
  value and a short description are sent — no chat history, no personal
  data. Every report stays pending until reviewed; reports are never
  trusted automatically and never shown publicly, and clients cannot
  read, update or delete them.
- **Honest about the cloud fallback:** when the on-device model cannot
  answer, the message is sent to Gemini in the cloud *to produce the
  verdict* (inference input). Our privacy promise is about
  **storage** — the raw message is never stored in the cloud — and we
  say so plainly instead of claiming the message never leaves the
  device.
- **Local-only checks never touch the network at all:** check-before-
  sending, email check, call check and chat-log scan run entirely on
  the device.

### Phone and PC, 8 languages

Responsive on a 390 px phone and a 1280 px desktop, with no horizontal
overflow, touch targets of at least 44 px and 16 px inputs (no iOS zoom
jump). Installable PWA (standalone, service-worker cache `tipucek-v5`,
192/512/maskable icons, Apple touch icon) that registers as a share
target — share a message to TipuCek straight from WhatsApp and it opens
with the checker already filled in. The whole interface is translated
into 8 languages (English, Bahasa Indonesia, Español, Français,
Deutsch, Português, 日本語, 中文), auto-detected from the browser, and
the verdict itself is returned in the interface language.

## Try it in 60 seconds (for judges)

No account, no setup — open https://tipucek.web.app and:

1. Click the sample **"Scam example"** (fake Rp 50,000,000 prize +
   admin fee), then **Check message**. Expect: **Scam, ~95/100,
   `IN_CLOUD`**, about 4 seconds.
2. Click **"Safe example"** (an ordinary work message). Expect:
   **Safe, low score**.
3. Click the **"Wedding invite APK"** sample. Expect: **Scam**, with
   the APK file warning in the result card.
4. Open the **File check** tab, upload any file: the magic-byte
   inspection reports its true type + local SHA-256, never uploading it.
5. Open the **privacy receipt** at the bottom of any result card: it
   says what was sent, where it was answered, how long it took, and
   where the result is stored.
6. Switch the language (top right) — the whole interface, including
   the verdict, follows in 8 languages.

Every result shows a badge (`ON_DEVICE` / `IN_CLOUD` / `LOCAL` /
`DEMO`) and the time it took, so the hybrid claim is checkable on
every single check, not just in this text.

## How we built it

TipuCek is a single-page web app (Vite + vanilla JavaScript) using
**Firebase AI Logic with hybrid inference**
(`InferenceMode.PREFER_ON_DEVICE`):

- The message is analyzed **on the device first**, by a Gemini Nano-class
  model downloaded to the browser.
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
  straight to the cloud instead of waiting 10–20 s on a first download —
  and the app warms up the model in the background after the user's
  first gesture, so repeat checks are fast.
- **Firebase App Check** (reCAPTCHA Enterprise) protects the API key,
  **Anonymous Authentication** + **Firestore** store the opt-in history,
  and **Firebase Hosting** serves the live demo.
- **Two checks, not one:** before the verdict, deterministic local
  rules score the same message (prize + fee, OTP demands, fake links,
  APK names) and the score is shown in the result card as a
  supporting signal — code first, model second. The AI verdict is
  still the verdict, but a judge can see what the code already knew
  without any model.
- **Privacy receipt on every result:** each result card states what
  was sent, where it was answered, how long it took, and where the
  result is stored — plus an honest note when community counts and
  link tracing were skipped because local-only mode is on.
- **Fail-safe UX:** messages are capped at 4,000 characters, every
  cloud call has a timeout (60 s for a check, 30 s for the assistant,
  60 s for a screenshot), failures show a plain-language sentence
  with a retry button and the technical detail collapsed — never a
  raw token or stack trace.
- Everything that can run locally does: link-risk analysis, file-name
  detection, email/call/outbound/chat-log checks, the quiz and first
  aid are plain client-side modules with no network calls. Without a
  Firebase config the app runs in **demo mode** — a local keyword
  heuristic with a `DEMO` badge and a visible banner — so the whole
  flow can be tested with no account.

## Challenges we ran into

The hardest bug was a silent one: every live AI check failed with
`401 Firebase App Check token is invalid`, even though the site key, the
domains and the app ID were all correct. The cause was an initialization
order bug — the history module created the Firebase app at page load, and
the AI module's early return skipped `initializeAppCheck` entirely, so no
token was ever minted. The fix initializes App Check on the existing app
too, and adds a pre-flight token check with a clear error message. The
live demo now returns real Gemini verdicts with the `IN_CLOUD` badge.

Two honest limits shaped the design. First, on-device inference has not
yet been verified on a real desktop Chrome — our VM's Chromium only
provides a stub — so we never claim a verified on-device result; the
badge reports what the SDK actually did on each check, and verifying
on-device on real desktop Chrome is the first item in What's next.
Second, short-link tracing often fails outright (most shorteners block
cross-origin fetches), so the domain module was built to say "cannot be
traced" rather than guess — an honest failure is a feature in a safety
tool.

## Accomplishments that we're proud of

- A live, installable PWA that checks a message end to end — text,
  screenshot, link, number, account, file, email, call and chat export —
  in 8 languages, with a privacy model enforced by code *and* by
  Firestore rules.
- **59 tests passing** (`npm test` — 43 unit tests in
  `tests/unit.test.mjs`, covering the local detectors, link-risk
  rules, email brand checks and the privacy gates, plus 4 structural
  tests for `firestore.rules` in `tests/rules.test.mjs` proving the
  verdict-only field list, the owner-only read, and the hash-only
  report shape, plus 12 gap-fix tests in `tests/gaps.test.mjs` for the
  holes live testing found on 19 Nov — text files, number-only
  call checks, call-voice transcription helpers + verdict merge, the
  standalone link tracker). No
  Firestore emulator is available on this machine
  (no Java), so the rules tests assert on the rules text itself and
  say so.
- **AI benchmark defined** (`tests/ai-benchmark-cases.json`,
  `tests/AI-BENCHMARK.md`): 25 fixed cases (11 scam, 10 safe, 4
  hard/ambiguous) run one by one through the live site, scoring
  exact verdict match, false positives/negatives, latency and the
  ON_DEVICE/IN_CLOUD split. First live run: pending — the numbers
  will be quoted here only after that run, never before.
- **Local-rules demo benchmark: 14/14 flagged, 0 false positives,
  0 false negatives**, mean scam score 49.4 vs. safe 7.7. This is a
  benchmark of the local demo rules, not AI accuracy — and we label it
  that way.
- **89 Playwright checks (run 28)** (desktop + mobile), **28 design checks** and
  **16 avatar checks** run against the live build.
- **Four holes found by live testing on 19 Nov, all fixed and
  re-verified in the browser:** text files were "unknown type" with no
  score (now read and scored like a message); a phone number alone
  errored "paste a message first" (now a number-only check — official
  match, format, reports — Suspicious 30 for an unknown number);
  link tracking had no visible module (now a standalone section with
  explicit per-link consent). QRIS checking was removed the same day
  by the owner's order: a pasted QRIS payload had been judged 0/100
  Safe, and no official registry can verify a QRIS merchant — so the
  feature was deleted entirely rather than kept half-working.
- **Voice output removed 19 Nov:** cloud TTS + device voice never
  sounded on the user's phone, so the whole voice-output feature was
  removed; call-voice INPUT (record/upload → transcribe → score) is
  kept.
- Ten new checker modules, senior mode, one-tap family alert and a PDF
  report — all shipped and verified on the live site.

## What we learned

- **Privacy is about storage, not just inference.** Users hear "on
  device" and assume nothing ever leaves the phone. The honest
  statement is narrower and stronger: the raw message is never
  *stored* in the cloud, and the badge shows whether this particular
  answer came from the device or the cloud. Saying the narrower thing
  is what makes the claim trustworthy.
- **A safety tool must fail honestly.** A link tracer that guesses, a
  file check that calls itself a malware scan, or a community count
  presented as a verdict would all make users less safe, not more.
  Every module states its limits in the UI.
- **Local-first is a product decision, not just an architecture one.**
  The checks people need most urgently — "am I about to send my OTP?",
  "is this email fake?" — should never depend on a network call.

## What's next

- Run the AI benchmark (`tests/AI-BENCHMARK.md`) on the live site and
  publish the numbers here — accuracy, false positives/negatives,
  latency, badge split.
- Verify on-device inference on a real desktop Chrome and report the
  result honestly.
- Google Search Console + search indexing so people find TipuCek when
  they search for a scam check.
- Demo video (max 3 minutes) for the Devpost submission.
- Moderation for community reports: the crowd report-back form exists
  and every report stays pending until a human reviews it, so the
  hash-only counts stay trustworthy as they grow; the next step is the
  review workflow that turns reviewed reports into trusted data.
- Translate the quiz bank into the other 6 interface languages (it is
  Indonesian + English today, English fallback elsewhere).

## Links

- Live demo: https://tipucek.web.app
- Source code (Apache-2.0): https://github.com/kyleweb3/tipucek
