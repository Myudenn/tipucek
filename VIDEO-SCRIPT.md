# TipuCek — Demo Video Script v5 (English, draft)

Target length: about 2 minutes 45 seconds (max 3:00). Simple, clear
English — one idea per shot. Narration is read aloud over a screen
recording of the live demo at https://tipucek.web.app.

This is a DRAFT for the v5 recording (not yet recorded). It replaces
v4, which is obsolete: v4 showed the roaming companion (removed 19 Nov
2026 — it covered page content), the anime avatar (replaced by the
Robot Shield + Star), and the old name framing. Every score below
says "update from v5 recording" — the cloud model is
non-deterministic, so the narration must use the scores from the
RECORDED video, never a different run's number over that footage.
Do not change the sample texts or the red-flag wording — they are
what the app actually returns.

Structure: 9 shots. Narration: about 460 words (update the exact
count after the v5 recording).

## Shot 1 — Opening (0:00–0:12) — homepage

Visual: the TipuCek homepage, header "AI mode — Firebase AI Logic
(hybrid inference)", the tagline "Check the message before you trust
it", the four checker tabs visible.

> "This is TipuCek — a free scam-message scanner. Paste a suspicious
> message, and it tells you if it is a scam — and shows you exactly
> where the answer came from."

## Shot 2 — Meet Aman (0:12–0:23) — Ask Aman panel

Visual: scroll to the "Ask Aman" panel. Aman, the robot-shield
avatar, sits in the panel (he stays there — he does not wander the
page). Click "What is OTP fraud?" — the answer appears.

> "Meet Aman, your AI safety buddy. He lives in this panel — ask him
> anything about suspicious messages, and he answers with the same AI
> that checks them. He never asks for personal data."

## Shot 3 — The problem (0:23–0:40) — scam sample on screen

Visual: click the "Scam example" sample button. The exact text fills
the input box:
"SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel.
Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya
admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam. Hubungi
customer service kami segera!"

> "Scam messages look like this. Fifty million rupiah, supposedly won
> in a Telkomsel lottery. A shortened link. A one-hundred-fifty-thousand
> rupiah admin fee to claim it. And twenty-four hours before it expires.
> Most people have to decide in seconds — with no tool to help."

## Shot 4 — The scam check (0:40–1:06) — click Check, verdict card

Visual: click **Check message**. The result card appears: VERDICT Scam,
risk score [update from v5 recording] out of 100, badge [IN_CLOUD or
ON_DEVICE — use what the recording shows], red flags, summary.
Reference (latest verified live run, 19 Nov 14:05, same sample):
95/100, IN_CLOUD, 4.1 s — use the recorded run's numbers if they
differ.

> "Let's check it. TipuCek tries the on-device model first — a Gemini
> Nano-class model running in the browser. If it cannot answer, it falls
> back to the cloud. Here [the cloud / the device] answered: Scam,
> [score] out of one hundred. Red flags: fake prize notification, an
> administrative fee, a suspicious shortened link, and urgent time
> pressure. The badge tells you where the answer came from — every
> time."

## Shot 5 — The fake APK (1:06–1:31) — file check, report links

Visual: the fake wedding-invitation message with its attached file.
The verdict card appears: Scam, [update from v5 recording] out of 100,
with the suspicious-file box (invite.apk) and the report lines — phone
numbers to aduannomor.id, bank accounts to cekrekening.id.

> "Some scams don't ask you to click a link — they ask you to install
> an app. This fake wedding invitation hides an Android install file.
> TipuCek flags the file itself — invite dot apk — and tells you
> exactly where to report the scammer: phone numbers to aduannomor dot
> id, bank accounts to cekrekening dot id. Same message, same check."

## Shot 6 — Screenshot check (1:31–1:48) — upload image, verdict

Visual: upload a screenshot of the same prize message, click "Check
screenshot". The verdict card appears: Scam, [update from v5
recording] out of 100, with the text read from the image shown next
to the verdict.

> "Scams don't always arrive as text you can copy. Upload a screenshot
> of the chat, and the AI reads the words in the image and checks them
> the same way — with the text it read shown right next to the
> verdict."

## Shot 7 — A safe message (1:48–2:00) — second sample, low score

Visual: click the "Safe example" sample button, click Check. Verdict
Safe, low risk score [update from v5 recording], no red flags.

> "Now a normal message. A meeting moved to Thursday, ten o'clock, room
> 3B. Same app, same button — Safe, with a low score. No drama,
> no false alarm."

## Shot 8 — More ways to check (2:00–2:24) — tabs + quiz + file

Visual: quick montage (2–3 seconds each, no narration overlap):
the Email tab (phishing check), the Call tab (phone-call script
check), the "Before you send" tab (outbound guard warning on an OTP),
the file checker (APK flagged by magic bytes), one quiz question
("Scam or safe?" — answer + explanation).

> "And it does not stop at messages. Check a phishing email. Check
> what a caller just told you. Check a message before you send it —
> it warns you if it contains an OTP or a password. Check a file
> before you open it. Or learn to spot scams yourself, with the quiz."

## Shot 9 — History, privacy, closing (2:24–2:45) — history + links

Visual: the Check history section (toggle "Save history only on this
device" checked), the privacy receipt at the bottom of the result
card (what was sent, where it was answered, how long it took, where
it is stored), then the closing card with the live URL and repo
address.

> "Your history stays on your device by default — the message text is
> never stored in the cloud. Only the verdict is synced, and only if
> you choose to. Share any verdict as a warning card, or install the
> app and share messages to it straight from WhatsApp. TipuCek.
> Private by design, hybrid by default. Try it live, and read the
> code — the links are in the description."

---

## Production notes

- Record the screen at 1280x720 or higher, browser window only.
- Keep the mouse still while the verdict card is on screen (2–3 seconds
  per card so viewers can read it).
- Narration: calm, steady pace, about 140 words per minute.
- On-screen text: live URL https://tipucek.web.app and repo
  https://github.com/kyleweb3/tipucek in the closing shot and in the
  video description.
- If the on-device model answers during recording, the badge will read
  ON_DEVICE instead of IN_CLOUD — that is fine, and even better for the
  privacy story; do not re-record just for the badge. Update the Shot 4
  narration bracket to match the recorded badge.
- The privacy line in Shot 9 is precise: history is local by default;
  the message text is never STORED in the cloud. When the cloud model
  answers, the message is sent to Gemini as the inference input — do
  not narrate "the message never leaves your device" (that would be
  false for the cloud path). The Devpost description explains the
  storage-vs-inference distinction in full.
- If the first Check click fails (a 401 was seen once on a stale cached
  page load), reload the page once and run the check again — the
  recording script retries after a reload before giving up.
- The v5 recording must use the post-rombak build (TipuCek name,
  Robot Shield + Star avatar, no roaming companion, 4 checker tabs,
  quiz, file checker). Do NOT reuse v4 footage: v4 shows roaming,
  the anime avatar, and the old "Safe Message" framing.
- v4 (9 shots, 2:41, scam 98 / APK 98 / screenshot 95 / safe 0 — all
  IN_CLOUD) is kept as `pesanaman-demo-final-v4.mp4` for reference
  only; it must NOT be uploaded (Myuden's rule: no upload before the
  web truly works, and v4 shows removed features).
