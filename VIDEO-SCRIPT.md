# PesanAman — Demo Video Script v3 (English, final)

Target length: about 2 minutes (max 3:00). Simple, clear English — one
idea per shot. Narration is read aloud over a screen recording of the
live demo at https://pesanaman-80d63.web.app.

Every fact below was verified live on 19 Nov 2026 using the app's own
sample buttons. The cloud model is non-deterministic: the scam score
came back 98, 99 and 100 in verified runs. The narration uses the
scores from the RECORDED video (v3 recording, 19 Nov 10:19 WIB: scam
98/100, screenshot 95/100, safe 0/100) — never quote a different run's
number over that footage. Do not change the sample texts or the red-flag
wording — they are what the app actually returns.

Total video: 124.2 seconds (2:04). Narration: 7 shots, 352 words.

## Shot 1 — Opening (0:00–0:12) — homepage

Visual: the PesanAman homepage, header "AI mode — Firebase AI Logic
(hybrid inference)", the three sample buttons visible.

> "This is PesanAman — Safe Message. A private scam-message scanner.
> Paste a suspicious message, and it tells you if it is a scam —
> without the message having to leave your device."

## Shot 2 — The problem (0:12–0:30) — scam sample on screen

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

## Shot 3 — The scam check (0:30–0:56) — click Check, verdict card

Visual: click **Check message**. The result card appears: VERDICT Scam,
risk score 98 out of 100 in the recorded video, badge IN_CLOUD, red
flags, summary. (Earlier verified runs scored 99 and 100 — same verdict,
same flags; the model varies slightly per run.)

> "Let's check it. PesanAman tries the on-device model first — a Gemini
> Nano-class model running in the browser. If it cannot answer, it falls
> back to the cloud. Here the cloud answered: Scam, ninety-eight out of
> one hundred. Red flags: fake prize notification, an administrative
> fee, a suspicious shortened link, and urgent time pressure. The badge
> tells you where the answer came from — every time."

## Shot 4 — Meet Aman (0:56–1:15) — assistant chat

Visual: scroll to "Ask Aman", type "What is OTP fraud?", send. Aman's
answer appears: "OTP fraud happens when scammers trick you into sharing
your one-time password. They use this code to break into your accounts
or steal your money. Never share your OTP with anyone, even if they
claim to be from your bank."

> "Meet Aman, your AI scam-safety buddy. Ask him anything — what is OTP
> fraud, how do I spot a fake link — and he answers in your language,
> using the same AI that checks messages. He never asks for personal
> data, and with one tap he can send a pasted message to the real
> checker."

## Shot 5 — Screenshot check (1:15–1:32) — upload image, verdict

Visual: upload a screenshot of the same prize message, click "Check
screenshot". The verdict card appears: Scam, 95 out of 100, badge
IN_CLOUD, with the text read from the image shown next to the verdict.

> "Scams don't always arrive as text you can copy. Upload a screenshot
> of the chat, and the AI reads the words in the image and checks them
> the same way. Here it read the same prize message and scored it Scam,
> ninety-five out of one hundred — with the text it read shown right
> next to the verdict."

## Shot 6 — A safe message (1:32–1:45) — second sample, low score

Visual: click the "Safe example" sample button, click Check. Verdict
Safe, risk score 0 out of 100, no red flags.

> "Now a normal message. A meeting moved to Thursday, ten o'clock, room
> 3B. Same app, same button — Safe, zero out of one hundred. No drama,
> no false alarm."

## Shot 7 — History and closing (1:45–2:04) — history + links

Visual: the Check history section, then the closing card with the live
URL and repo address.

> "Every check is saved to your history — under an anonymous account.
> No email, no name, no phone number. Share any verdict as a warning
> card, or install the app and share messages to it straight from
> WhatsApp. PesanAman. Private by design, hybrid by default. Try it
> live, and read the code — the links are in the description."

---

## Production notes

- Record the screen at 1280x720 or higher, browser window only.
- Keep the mouse still while the verdict card is on screen (2–3 seconds
  per card so viewers can read it).
- Narration: calm, steady pace, about 140 words per minute. Total
  narration is 352 words (about 2:00 at ~155 wpm, the TTS pace used);
  the rest of the 2:04 is deliberate pauses so viewers can read the
  verdict cards.
- On-screen text: live URL https://pesanaman-80d63.web.app and repo
  https://github.com/kyleweb3/pesanaman in the closing shot and in the
  video description.
- If the on-device model answers during recording, the badge will read
  ON_DEVICE instead of IN_CLOUD — that is fine, and even better for the
  privacy story; do not re-record just for the badge.
- If the first Check click fails (a 401 was seen once on a stale cached
  page load), reload the page once and run the check again — the
  recording script retries after a reload before giving up.
- The v3 recording was made with the record.js scenario
  `pesanaman-demo-v3.json` (30 steps: scam check, Aman chat, screenshot
  upload, safe check) and assembled by `video/build-v3.sh`. The video
  shows the v2.2 build (the v2.3 motion polish and file-detection box
  came after the recording — the live site has them, the video does not).
