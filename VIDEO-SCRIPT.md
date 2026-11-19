# PesanAman — Demo Video Script (English, final)

Target length: about 2 minutes 30 seconds (max 3:00). Simple, clear
English — one idea per shot. Narration is written to be read aloud
(or generated with text-to-speech) over a screen recording of the live
demo at https://pesanaman-80d63.web.app.

Every fact below was verified live on 19 Nov 2026 using the app's own
sample buttons. The cloud model is non-deterministic: the scam score
came back 98, 99 and 100 in verified runs. The narration uses the
score from the RECORDED video (99/100 in the v2 recording, 19 Nov
09:58 WIB) — never quote a different run's number over that footage.
Do not change the sample texts or the red-flag wording — they are what
the app actually returns.

## Shot 1 — Opening (0:00–0:15) — homepage

Visual: the PesanAman homepage, header "AI mode — Firebase AI Logic
(hybrid inference)", the three sample buttons visible.

> "This is PesanAman — Safe Message. A private scam-message scanner.
> Paste a suspicious message, and it tells you if it is a scam —
> without the message having to leave your device."

## Shot 2 — The problem (0:15–0:40) — scam sample on screen

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

## Shot 3 — The scam check (0:40–1:25) — click Check, verdict card

Visual: click **Check message**. The result card appears: VERDICT Scam,
risk score 99 out of 100 in the recorded video, badge IN_CLOUD, red
flags, summary. (Earlier verified runs scored 98 and 100 — same verdict,
same flags; the model varies slightly per run.)

> "Let's check it. PesanAman tries the on-device model first — a Gemini
> Nano-class model running in the browser. If it cannot answer, it falls
> back to the cloud. Here the cloud answered: Scam, ninety-nine out of
> one hundred. Red flags: unexpected prize winnings, an upfront
> administrative fee, a suspicious shortened link, and urgent
> time-limited pressure. The badge tells you where the answer came
> from — every time."

## Shot 4 — A safe message (1:25–1:55) — second sample, low score

Visual: click the "Safe example" sample button, click Check. Verdict
Safe, risk score 0 out of 100, no red flags.

> "Now a normal message. A meeting moved to Thursday, ten o'clock, room
> 3B. Same app, same button — Safe, zero out of one hundred. No drama,
> no false alarm."

## Shot 5 — History and privacy (1:55–2:20) — history entries

Visual: the Check history section, entries saved to Firestore with
their scores and badges.

> "Every check is saved to your history — under an anonymous account.
> No email, no name, no phone number. And when the on-device model
> answers, the message never leaves your device at all."

## Shot 6 — Closing (2:20–2:30) — homepage + links

Visual: homepage again, with the live URL and repo address on screen.

> "PesanAman. Private by design, hybrid by default. Try it live, and
> read the code — the links are in the description."

---

## Production notes

- Record the screen at 1280x720 or higher, browser window only.
- Keep the mouse still while the verdict card is on screen (2–3 seconds
  per card so viewers can read it).
- Narration: calm, steady pace, about 140 words per minute. Total
  narration is 227 words (about 1:35 at 140–150 wpm); the rest of the
  2:30 is deliberate pauses so viewers can read the verdict cards.
- On-screen text: live URL https://pesanaman-80d63.web.app and repo
  https://github.com/kyleweb3/pesanaman in the closing shot and in the
  video description.
- If the on-device model answers during recording, the badge will read
  ON_DEVICE instead of IN_CLOUD — that is fine, and even better for the
  privacy story; do not re-record just for the badge.
- If the first Check click fails (a 401 was seen once on a stale cached
  page load), reload the page once and run the check again — the
  recording script retries after a reload before giving up.
