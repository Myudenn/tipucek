# TipuCek — Demo Video Script v6 (English)

Target length: about 2 minutes 40 seconds (max 3:00). Simple, clear
English — one idea per shot. Narration is read aloud over a screen
recording of the live demo at https://tipucek.web.app/?lang=en.

This script is for the v6 recording. It replaces v5, which is
obsolete: v5 showed the OLD check flow — no interim code-check panel,
no code-only fallback card, no model failover, no "Check complete"
toast — and its cursor was 25fps/invisible. Final recorded scores (20 Nov 2026, all "Answered in the cloud"):
OTP BCA Safe 5/100, APK Scam 100/100, DHL Scam 95/100, safe message
Safe 0/100, screenshot Scam 100/100. The cloud model is
non-deterministic, so the narration uses the scores from the RECORDED
video, never a different run's number over that footage. Do not change the sample
texts or the red-flag wording — they are what the app actually
returns.

v6-v3 (20 Nov 2026, narration/mix edit only, no footage re-recorded):
opening cover is 2.0s and the shot 1 narration starts at 0:00 over
the cover; shot 4 adds the failover line "The main model was busy,
so the backup answered — the check never stops."; shot 5 names
"Firebase AI Logic in the cloud".

CORRECTION (v7, 20 Nov 2026): the v6-v3 note claimed the failover
line is "spoken exactly as the on-screen 'Main model failed — trying
the backup model...' appears" — that is not accurate. The banner
appears TWICE (during the APK check ~0:42 and the DHL check ~1:06),
while the line is spoken ONCE, at ~1:21-1:25, while the safe-message
receipt shows "Model: gemini-3.1-flash-lite (backup)" (verified in
frame t=82 and by transcription of shot4.mp3: the line runs ~16.5-
20.7 s into shot 4, which starts at 64.648 s). The line is honestly
supported by the receipt visible at that moment — the backup model
did answer that check — so NO video change is needed; only this note
is corrected.

v6-v5 (20 Nov 2026, polish luar — "Pelajari dan terapkan"): shot 6
RE-RECORDED — the blue "Check before sending" button IS clicked and
the red warning card ("Stop — this message contains sensitive
information: One-time code (OTP) — 48••16") is shown and held before
the "Senior mode" toggle is clicked (outbound check is local-only, no
debug token needed); narration says "Senior Mode" (was "Parent Mode",
the on-screen button says "Senior mode"); slow zoom 1.00 -> 1.12 on
the stills s3b (APK Scam 100 card), s3c (aduan nomor/cekrekening
links), s5b (screenshot verdict + privacy receipt); 1.0 s dead air
trimmed after shot 1 ("So, we built TipuCek" -> BCA example); music
regenerated at the new total 149.67 s. Final: 149.67 s.

Structure: 7 shots. Narration: about 390 words (update the exact
count after the v6 recording; TTS default pace is ~170 wpm).

## Shot 1 — Hook (0:00–0:15) — homepage, OJK stat

Visual: the TipuCek homepage in English, hero stat visible:
"Rp 9.1 trillion (~US$500 million) lost to scams in 411,000+
reports · Nov 2024–Dec 2025 · OJK (IASC)".

> "In Indonesia, scams caused around five hundred million dollars in
> losses — across more than four hundred eleven thousand reports. And
> many victims never report them. They are afraid to upload private
> chats and bank screenshots to a cloud server. So we built TipuCek."

## Shot 2 — The BCA OTP check (0:15–0:42) — sample, interim panel, verdict + toast

Visual: click the "Fake bank OTP warning" sample button. The exact
text fills the input box (English translation of the Indonesian BCA
case — NOT Bank of America):
"BCA: Your OTP code is 482916. Never share this code with anyone,
including bank staff. If you did not request this transaction, call
us immediately at 0812-9876-5432."
Click **Check message**. The interim code-check panel flashes first,
then the result card appears: Safe, 5
out of 100, badge "Answered in the cloud", and the green
"✓ Check complete" toast at the bottom edge. The toast is shown on
screen only — it is not mentioned in the narration.

> "Take this message. It looks like a real bank warning — BCA, a
> one-time code, and a number to call. TipuCek checks it in two
> layers. First, an instant on-device code check. Then the cloud AI
> reads the whole message. Safe — five out of one hundred. A fake
> one looks exactly the same, so always check before you trust."

(v7 correction, 20 Nov 2026: the script previously ended this shot
with "And a green check tells you the moment the check is complete."
— that line was NEVER spoken in the recorded narration, verified by
transcription + audio envelope (shot 2 is 23.0 s and ends 0.5 s after
"...check before you trust."). The sentence is removed here so the
script matches the recording; the green toast itself is still visible
on screen. The narration audio is NOT re-recorded.)

## Shot 3 — The fake APK (0:42–1:05) — file sample, verdict, report links

Visual: click the "Wedding invite APK" sample button, click Check.
The verdict card appears: Scam, 100 out of
100, with the suspicious-file box (invite.apk) and the report lines
— phone numbers to aduannomor.id, bank accounts to cekrekening.id.
These are LINKS to the official report pages, not an API
integration — narrate them as "where to report", never as an
integration.

> "Some scams don't send links — they send apps. This fake wedding
> invitation hides an Android install file. TipuCek flags the file
> itself — invite dot apk — and shows the same verdict card: scam,
> one hundred out of one hundred. Then it tells you exactly where to
> report the scammer: phone numbers to aduannomor dot id, bank
> accounts to cekrekening dot id."

## Shot 4 — DHL, then a safe message (1:05–1:30) — two quick checks

Visual: click the "Suspicious example" sample (DHL courier), click
Check. Verdict Scam, 95 out of 100.
Then click the "Safe example" sample (meeting moved to Thursday),
click Check. Verdict Safe, 0 out of 100,
no red flags.

> "Or this courier message — a parcel held at customs, a small fee,
> a strange tracking link. Same button, same check: scam, ninety-five
> out of one hundred. And a normal message? A meeting moved
> to Thursday, ten o'clock, room 3B. The main model was busy, so the
> backup answered — the check never stops. Safe, zero out of one
> hundred. No false alarm."

## Shot 5 — Hybrid: the screenshot check (1:30–1:55) — upload, verdict, receipt

Visual: switch to the screenshot section, upload
test-samples/screenshot-penipu.png, click "Check screenshot". The
verdict card appears: Scam, 100 out of 100,
with the text read from the image shown next to the verdict, and
the privacy receipt at the bottom of the card (where it was
answered, how long it took, where it is stored).

> "Here is the hybrid part. Text is checked on your device first —
> fast, and private. But a photo can't be checked as text, so
> Firebase AI Logic in the cloud reads the words in the image and
> checks them the same way — with the text it read shown right next to the verdict. The
> receipt tells you where every answer came from: on-device, or in
> the cloud."

## Shot 6 — Unique features (1:55–2:15) — montage, no narration overlap

Visual: quick montage (2–3 seconds each): the "Check before you
send" tab (type a message containing an OTP, CLICK the blue "Check
before sending" button — the red warning card "Stop — this message
contains sensitive information: One-time code (OTP)" appears and is
held on screen), then the "Senior Mode" toggle (text and buttons grow,
senior note appears).

> "It also stops scams before you send them. Write a message first
> — if it contains a one-time code or a password, TipuCek warns you
> before it leaves your phone. And Senior Mode makes the text bigger
> and reads the result aloud, so older family members can check a
> message themselves."

## Shot 7 — History, privacy, closing (2:15–2:40) — history + closing card

Visual: the History tab (toggle "Save history only on this device"
checked), then the closing card with the live URL and repo address
(closing.png / PIL still, as in v5 — disclosed, not app footage).

> "Your history stays on your device by default — only the verdict
> is synced, and only if you choose to. Share any verdict as a
> warning card, or install the app and share messages to it straight
> from WhatsApp. TipuCek. Private by design, hybrid by default. Try
> it live — the links are in the description."

---

## Production notes (v6)

- Record at 1280x720, 60fps, with the rekam-layar-browser skill:
  `record.js --fps 60` (Xvfb + Chromium headed + ffmpeg x11grab),
  scenario JSON, cursor STRAIGHT like Guesty (bend: 0, smoothstep
  easing). Run `verify-cursor.py` on every raw take — it must PASS.
- Keep the mouse still while the verdict card is on screen (2–3
  seconds per card so viewers can read it, and so the 5-second
  "Check complete" toast is visible in the footage).
- Narration: TTS default voice (Helio), English, about 170 wpm.
  Measure the real TTS length per shot and cut the footage to it
  (v5 pattern: motion clips for clicks + stills for verdict cards).
- On-screen text: live URL https://tipucek.web.app and repo
  https://github.com/Myudenn/tipucek in the closing shot and in the
  video description.
- HONESTY (binding): all footage must be the real app running. In
  the VM every AI verdict is answered in the cloud (or the code-only
  fallback) — NEVER narrate or show an on-device AI verdict from VM
  footage. The interim panel is the on-device CODE check, not the
  Gemini Nano model — narrate it as "on-device code check". The
  aduannomor.id / cekrekening.id lines are outbound links to report
  pages, never an integration. The OJK figure is ~US$500 million
  (current rate ~Rp 18,260/USD), never $570M. The English OTP sample
  is the BCA case, never Bank of America.
- If a check falls back to the code-only card during recording, that
  shot shows "Code-check result — no AI verdict yet": either re-take
  the shot (one retry) or narrate it honestly as the offline
  fallback — never present it as an AI verdict.
- If the first Check click fails (a 401 was seen once on a stale
  cached page load), reload the page once and run the check again.
- DO NOT upload the video anywhere. DO NOT sync GitHub. The final
  file is `~/workspace/pesanaman/video/tipucek-demo-v6.mp4` (≤180 s).
- v5 (`tipucek-demo-v5.mp4`, 161.43 s, 2 sessions spliced, scores
  scam 99 / APK 95 / screenshot 95 / safe 0, all IN_CLOUD) is kept
  for reference only; it must NOT be uploaded (stale flow + 25fps
  cursor). v4 is likewise obsolete and must NOT be uploaded.

---

## v6-v6 (20 Nov 2026, 147.70 s) — polish round 2

Build: `video/build-v6-v6.sh` (+ `make-music-v6.py`, `mix-audio-v6.py`,
`mix-v6.sh`; stills via `video/capture-v6-stills.cjs`). v5 kept as backup.

- Hero re-taken from live (`raw/v6-hero-v6.png`): the "Source: OJK —
  Indonesia Anti-Scam Centre (IASC)" link now shows in the opening
  still (verified in frame + DOM).
- Zoom fixed (was linear centred zoompan — felt zig-zag at 00:46–01:04
  and 01:39–01:51): single-keyframe In -> Hold -> Out with smoothstep
  ease in/out, anchored RIGHT where the verdict card sits, X/Y locked
  flat during the hold. s3b/s3c (APK 100 card, report links) and s5b
  (screenshot verdict + receipt): 0.5 s ease 1.00 -> 1.15, hold, 0.5 s
  ease back to 1.00. Hold verified: frames 4 s apart in the hold
  differ no more than a static clip's encoder noise (mean abs diff
  0.26–1.48 vs control 1.19).
- Intro alive: hero still gets a very slow eased zoom 1.00 -> 1.04 over
  the full 15 s opening instead of a static frame.
- Outro trimmed by intent, not by the reviewer's timestamp: the
  reviewer estimated narration ends 02:23, but measured (silencedetect
  + RMS) the last words ("...the links are in the description.") run
  to 145.27 s (02:25.3) — cutting at 02:25 would clip the final word.
  Video now ends 147.70 s, i.e. 2.4 s of quiet music after the last
  word (was 4.4 s). Music bed regenerated to 147.70 s, fade-out over
  the last 3 s.
- Audio: narration + ambient pad, peak -3.7 dBFS (no clipping), music
  -26 dBFS under narration with ducking. Scores / narration / shot 6
  unchanged (OTP Safe 5/100, APK 100/100, DHL 95/100, safe 0/100,
  screenshot 100/100).

BLOCKED — s5b still NOT re-taken: the screenshot check needs a real
cloud AI verdict, but the VM browser gets App Check 403
`exchangeRecaptchaEnterpriseToken` (throttled 24 h, verified 07:26–
07:28). A temp debug token would unblock it, but the Firebase CLI
login is dead ("credentials are no longer valid" — refresh token
expired; `firebase login --reauth` needed, interactive browser login).
So s5b still uses the old still (`raw/v6-verdict-screenshot-20261120-
040110.png`) and the duplicate "Community counts and link tracing..."
line is STILL in that frame. To finish: re-auth Firebase, create a
temp debug token, run `capture-v6-stills.cjs --s5b`, verify the new
still shows the line only once + Scam 100/100, delete the token,
rebuild (swap the s5b image in `build-v6-v6.sh`).

(Update 15:17: Firebase WAS re-authed 14:55 and two re-takes were
done (14:57, 15:11) — the duplicate line is gone in the new stills,
but both scored Scam 95/100, not 100/100, and the narration says
"one hundred". Myuden chose "Tetap pakai v6": the duplicate line
stays in the one s5b frame. The new 95 stills are kept at
`video/raw/v6-verdict-screenshot-v6.png` /
`v6-verdict-screenshot-v6-95.png` for reference.)

---

## v6-v7 (20 Nov 2026, 147.70 s) — audit total, nol-celah

Build: `video/build-v6-v7.sh` (+ `make-music-v7.py`, `mix-audio-v7.py`,
`mix-v7.sh`, `verify-v7.py`). v6 kept as backup.

- Black bar fixed: frames 1499-1500 (t=24.9833 s, 25.0000 s) showed a
  black tooltip bar (~380x28 px) over the "CONGRATULATIONS! You have
  won $50,000 in the Mega Prize Draw." line in the "Scam example"
  card (dark tooltip background rendered without text while the cursor
  hovered the title, last 2 frames of the s2a clip). Replaced with the
  clean neighbour frame 1498; 60fps scan of 24.0-25.2 s is clean (worst
  ROI black pixels 102 = cursor baseline, the bar was 9966); the
  patched frame differs from the donor only by encoder noise (mean abs
  diff 3.10). Frame count unchanged (8862).
- Music rebuilt (v7 bed): the v6 bed was inaudible on phone speakers
  (RMS -40.0 dBFS, 93.5% energy 20-200 Hz, 0% above 740 Hz). v7: a
  louder pad (peak -18 dBFS) + a very soft pentatonic bell melody +
  a faint high shimmer (3520-6272 Hz, above the speech band). Measured:
  gap RMS -25.6 dBFS, >1 kHz energy 23.7%, speech-band ratio mix/nar
  1.32 (narration dominant), final peak -2.6 dBFS (no clipping).
  Ducking -4 dB (was -7 dB). Lesson, measured: a loud mid-range bed
  masks this low-pitched narration — the first v7 attempt (melody
  0.80) gave speech-band SNR median -6.2 dB in the mix, i.e. the bells
  were louder than the voice in its own band. The mid melody must stay
  very soft (0.10); phone audibility comes from the high shimmer, not
  from loud mids. The shimmer sits after the low-pass but before the
  soft compression, so its peaks do not force the peak normalisation
  down.
- Script only: shot 2 corrected (the "green check" line was never
  spoken — see Shot 2 above); failover note corrected (see v6-v3
  correction above). No narration re-record.
- Scores / narration / shot 6 / zoom / intro / outro UNCHANGED
  (OTP Safe 5/100, APK 100/100, DHL 95/100, safe 0/100, screenshot
  100/100 — spot-checked in v7 frames at t=55 and t=105). s5b duplicate
  line STAYS (accepted by Myuden 15:17).

---

## v6-v8 (20 Nov 2026, 147.70 s) — musik baru, narasi diutamakan

Build: `video/make-music-v8.py`, `video/mix-audio-v8.py`,
`video/mix-v8.sh`, `video/verify-v8.py`. v7 kept as backup (untouched).
Video stream is `-c:v copy` of the v7 video — framemd5 identical to
v7 (8862 frames each). Narration, scores, shot 6, zoom, intro, outro
UNCHANGED.

- Music rebuilt (v8 bed, 100% procedural — no downloads, no samples,
  no copyrighted material, no audio watermark, no spoken/brand tag;
  no artist to credit and none is written anywhere): corporate/tech
  upbeat ~110 BPM, bright C major, I-V-vi-IV (C-G-Am-F), steady
  pulse — soft four-on-the-floor kick + off-beat hat, warm pulsing
  synth bass (8th notes, root/octave), airy pad, simple bright pluck
  motif (one note per beat), high shimmer 3520-6272 Hz (above the
  speech band, as in v7). Style reference was a short corporate ad
  (IPPeak, ~110 BPM, dense loud bed under voiceover); its audio was
  used ONLY for analysis and was deleted — none of it is in this video.
- Level CORRECTED by Myuden 17:55 ("suara musik diturunkan supaya
  suara presentasi terdengar jelas"): the first v8 target (gap RMS
  -20 dBFS) was too loud. Final bed: peak -17.6 dBFS, median 1 s RMS
  -23.0 dBFS. Measured in the final mp4: gap RMS median -23.9 dBFS
  (about v7's -22.6 dBFS, already clearly audible); final peak
  -3.3 dBFS (no clipping). Spectrum 60-70 s: 20-200 Hz 48.9%,
  200-740 Hz 34.4%, 3000-8000 Hz 9.6% — energy spread 200 Hz-8 kHz
  50.4% (v6 was 93.5% sub-200 Hz and inaudible on phones).
- Ducking -12 dB (v7: -4 dB) so the music sits clearly UNDER the
  voice. Measured in the final mp4: in the 300-3400 Hz speech band
  the music is 11.4 dB below the narration (median, 1 s windows;
  14.4 dB at 20 ms scale — requirement >= 10 dB); 800-3400 Hz
  mix/narration ratio 1.08 (v7: 1.32). Narration dominant and clear
  is the priority; the music is an accompaniment that is felt, not a
  competitor to the voice.
- BUG FOUND AND FIXED in the ducking (v8): `smooth_env` attacks fast
  when the value RISES and releases slow when it FALLS — correct for
  the narration envelope, but INVERTED for gain_db (ducking = gain
  falling must be fast; un-ducking = gain rising must be slow). The
  v7 script called it unswapped, so v7's ducking fell with the 0.8 s
  time constant and snapped back in 0.1 s: measured with DUCK_DB=-12
  the effective ducking during active speech was only -2.7 dB
  (median) and the gain reached -10 dB just 1% of the time. The v8
  mix swaps the arguments (attack 0.25 s / release 0.05 s for the
  gain call): effective ducking median -11.1 dB (20 ms windows),
  -10.7 dB (100 ms), -7.2 dB (1 s). Lesson: a ducking depth number
  means nothing until the effective ducking is measured — verify the
  gain curve, not just the parameter.
- Verify v8: ALL PASS (duration, 1280x720 60fps, peak, gap RMS,
  speech-band separation, spectrum spread, framemd5 vs v7).

---

## v6-v9 (20 Nov 2026, 147.70 s) — musik tenang mengikuti referensi baru

Build: `video/make-music-v9.py`, `video/mix-audio-v9.py`,
`video/verify-v9.py` (hasil di `video/verify-v9-audio.txt`). v8
kept as backup (untouched). Muxing DONE in this build (lihat
bagian VIDEO di bawah — tipucek-demo-v6-v9.mp4, 147,783 dtk,
audio mixed-v9.wav). Narration, scores, shot 6, zoom, intro,
outro UNCHANGED (kecuali perbaikan kursor di bawah).

- REFERENSI BARU (Myuden, 20 Nov 2026 18:08 — PENGALIHAN TOTAL,
  tugas perbaikan pluck/shimmer v8 DIBATALKAN): video TikTok
  @alec_koff_music, track "Balance" oleh MrClaps — musik latar
  presentasi bisnis/edukasi. Audio referensi HANYA untuk analisis
  dan SUDAH DIHAPUS — tidak diunduh, tidak dipakai, tidak ada
  sampel/materi berhak cipta dalam video ini. Terukur dari
  referensi: durasi 218 dtk, RMS -13,2 dBFS sangat stabil, tempo
  ~55 BPM (PELAN dan tenang), spektrum HANGAT dan LEMBUT — 92,6%
  energi di 20-1000 Hz, hampir NOL di atas 3 kHz (3-4 kHz 0,3%,
  4-6 kHz 0,2%, di atas 8 kHz 0%). Inilah suara yang Myuden mau —
  dan ini menjelaskan kenapa v8 terdengar nyaring (pluck cerah +
  shimmer + drive 110 BPM justru kebalikan dari referensi ini).
- Music rebuilt (v9 bed, 100% procedural, dibuat dari NOL — bukan
  adaptasi v8): tempo 55 BPM (beat 1,09 dtk), piano lembut +
  pad hangat + bass lembut, akor C-G-Am-F (I-V-vi-IV). TANPA pluck
  cerah, TANPA shimmer, TANPA hat/kick yang menonjol (tanpa drive
  perkusif sama sekali). Piano: arpeggio diatonis satu nada per
  ketuk, fundamental 220-523 Hz (kehadiran mid 200-1000 Hz supaya
  terdengar di speaker HP — bukan kesalahan v6 yang energinya
  menumpuk di bawah 200 Hz); attack 25 ms, decay ~1,1 dtk. Pad:
  attack/crossfade 1 dtk yang pelan. Bass: root di ketuk 1,
  fifth di ketuk 3 tiap bar. Roll-off di atas ~3 kHz: low-pass
  Butterworth orde-2 di 2600 Hz yang dipasang SETELAH kompresi
  tanh (supaya harmonik kompresi tidak mengembalikan energi di
  atas 3 kHz).
- Level: gap RMS median -23,0 dBFS (bed) / -23,3 dBFS (mix akhir,
  seperti v8). Peak cap bed -15,0 dBFS (BUKAN -17,6 seperti v8 —
  tekstur piano yang lebih renggang punya crest factor lebih
  tinggi: setelah normalisasi RMS -23,0 dBFS puncaknya -15,5
  dBFS; cap v8 akan memotong seluruh bed 2,2 dB dan gap RMS jadi
  -25,1 dBFS. Cap hanya menjaga puncak bed jauh di bawah puncak
  narasi -4,1 dBFS; -15,5 dBFS masih 11,4 dB di bawahnya).
- Tuning (20 Nov 18:20): build pertama mengukur pemisahan pita
  suara hanya 9,5 dB (butuh >= 10 dB) — bed v9 menaruh energi
  13,79% di 300-3400 Hz vs v8 11,83%. Harmonik ditipiskan
  (piano: 2nd 0,45 -> 0,25, 3rd 0,20 -> 0,08, 5th dihapus; pad:
  2nd 0,35 -> 0,25; piano amp 0,32 -> 0,30) — fundamental tetap,
  hanya overtone yang dipangkas. Pemisahan naik ke 11,1 dB.
- Ducking -12 dB (v7 bug TIDAK terulang — smooth_env untuk gain
  tetap dipanggil dengan argumen terbalik, attack 0,25 dtk /
  release 0,05 dtk). Efektif TERUKUR dari file mix dengan
  proyeksi least-squares (mix = narasi + bed x gain): median
  -11,2 dB (20 ms), -11,3 dB (100 ms); cross-check kurva gain
  -11,9 dB (20 ms), -11,8 dB (100 ms), -11,2 dB (1 dtk).
  PELAJARAN VERIFIKASI: dua upaya awal mengukur ducking dengan
  membandingkan level pita 300-3400 Hz di celah vs saat bicara
  memberi -6,2 / -8,9 / -4,7 dB — semuanya SALAH, karena level
  pita bed bervariasi per akor/nada piano/fase swell sampai
  beberapa dB antar posisi waktu. Proyeksi (mix lawan bed di
  jendela YANG SAMA) membatalkan variasi waktu itu.
- Verify v9: ALL PASS. Bed (10-140 dtk): energi di atas 3 kHz
  0,00% (v8 14,57%; referensi ~0,5%); 200-1000 Hz 23,0%;
  20-1000 Hz 99,7% (referensi 92,6%); tempo terukur 55,0 BPM
  (autokorelasi envelope 500-3000 Hz, puncak lag 1,09 dtk,
  r=0,73; periode bar 2,18 dtk juga muncul). Mix akhir: durasi
  147,70 dtk; puncak -3,1 dBFS stereo (tanpa clipping); gap RMS
  median -23,3 dBFS; pemisahan 300-3400 Hz median 11,1 dB
  (p10 2,7 dB); rasio 800-3400 Hz mix/nar 1,01; sebaran energi
  200 Hz-8 kHz 50,6%.

### VIDEO v9 — perbaikan kursor vs narasi (audit v7) + zoom halus

Build: `video/build-v6-v9.sh` (22 segmen, concat lalu mux dengan
mixed-v9.wav, AAC 192k). Output: `video/tipucek-demo-v6-v9.mp4`
(147,783 dtk, 1280x720, 60fps, 8867 frame, 9.316.198 byte).
Durasi +0,083 dtk dari nominal 147,70 (pembulatan potong per
segmen +-1 frame; audio tetap 147,70 dtk, 0,08 dtk terakhir
sunyi — tidak terdengar). v7/v8 TIDAK tersentuh (md5 v7
eb0131e8637b48d9abf937bfa8ed5c30, v8 8a39cca2b11dceffced8afa42ada5027,
mtime tetap). Batas segmen AKTUAL di file final (terukur):
cover [0,00-2,00], s1 [2,00-16,98], s2a' [16,98-25,08], s2b
[25,08-40,77], s3a' [40,77-46,47], s3b [46,47-55,58], s3c-1
[55,58-59,05], s3c-2 [59,05-63,55], s3c-3 [63,55-64,70], s4a'
[64,70-70,00], s4b [70,00-76,13], s4c [76,13-84,63], s4d
[84,63-91,02], s5a' [91,02-98,97], s5b-1 [98,97-103,65], s5b-2
[103,65-105,88], s5b-3 [105,88-111,82], s6a' [111,82-118,32],
s6b' [118,32-122,32], s6c [122,32-128,00], s7a [128,00-137,38],
endcard [137,38-147,78].

- PERBAIKAN 1 (M4+M5, SEDANG, t~89-94): s5a' REKAM ULANG
  (Session B, raw/tipucek-v9-shot5-20261120-111919.mp4). Kursor
  panah DIAM di atas foto WhatsApp selama narasi on-device
  ("Text is checked on your device first", frame 93 dtk dan
  95 dtk: kursor di gambar), bergerak ke tombol "Check
  screenshot" saat kalimat "But a photo can't be checked as
  text" hampir selesai, KLIK di 98,47 dtk (0,39 dtk SESUDAH
  kalimat berakhir 98,08 dtk — timing kata terukur
  faster-whisper di shot5); tombol ber-spinner di 98,5 dtk.
  Catatan jujur: kursor TIBA di tombol 0,74 dtk sebelum kalimat
  berakhir (tengah kata terakhir "text,"), kliknya sendiri
  sesudah kalimat. Batas s5a/s5b bergeser 97,447 -> 98,966
  (s5a' 7,950 dtk, s5b total 12,850 dtk); total tetap.
- PERBAIKAN 2 (M6, t~114-120): s6a'/s6b' REKAM ULANG
  (Session C, raw/tipucek-v9-shot6-20261120-112237.mp4). Pesan
  DITIK di dalam klip selama narasi "Write a message first"
  (frame 115 dtk: teks "Hi, my OTP is 482916, can you send it
  to me?" sudah terisi + kartu merah sudah tampil). Sesudah klik
  "Check before sending", kursor TURUN ke kartu merah — frame
  117 dtk: tangan putih TEPAT di baris "One-time code (OTP) -
  48..16" saat narasi menyebut "one-time code". Lalu ke toggle
  Senior Mode: klik di 120,08 dtk, frame 120 dtk tangan di
  toggle + banner "Senior mode on: bigger text and buttons,
  results read out loud." + teks membesar (G1 dipertahankan).
- PERBAIKAN 3 (V1, t~57-63): s3c DIBELAH — tengahnya 4,5 dtk
  (s3c-2, 59,05-63,55) kini menampilkan kartu vonis ATAS
  (still raw/v6-verdict-apk-20261120-040039.png, static tanpa
  zoom) dengan baris "Report the scammer: phone numbers at
  aduannomor.id (Komdigi), accounts at cekrekening.id." TERBACA
  JELAS (frame 61 dtk) selama narasi menyebut aduannomor.id /
  cekrekening.id (59,0-63,5 dtk — selaras 0,05 dtk).
- PERBAIKAN 4 (V2, t~102-105): s5b DIBELAH — tengahnya 2,24 dtk
  (s5b-2, 103,65-105,88) kini menampilkan kartu vonis screenshot
  ATAS (still raw/v9-verdict-screenshot-ocr.png, diekstrak dari
  raw v6 t=66,0 dtk, static tanpa zoom): "100/100 Scam" +
  "Text read from the image: WhatsApp - Pesan Masuk Selamat!
  A... memenangkan hadiah Rp 50.000.000 dari undian berhadiah.
  Se... klaim: bit.ly/hadiah-2026 Bayar biaya administrasi Rp
  150.000 ke..." (frame 104 dtk) selama narasi "with the text
  it read, shown right next to the verdict." (103,58-105,82
  dtk). Catatan: di still itu kursor tangan terparkir di tombol
  "Check before sending" (bawaan take v6) — diterima, vonis +
  teks OCR mendominasi frame.
- PERBAIKAN 5 (M1-M3, ringan, t~18-21 / 42-45 / 66-69): s2a'/
  s3a'/s4a' REKAM ULANG (sesi segar per cek: A2 OTP, A3 APK, A6
  DHL — cek ke-2/ke-3 dalam satu browser jatuh ke code-only
  ~1-4 dtk dan akan menampilkan SKOR SALAH; cek pertama tetap
  "Checking..." 13-16 dtk). Sesudah tiap klik "Check", kursor
  I-beam pindah ke pesan yang dibahas: OTP frame 19 dtk dan
  21 dtk (di "If you did not request this transaction, call us
  immediately at 0812-9876-5432"), APK frame 43 dtk (tepat di
  tautan "https://wedding-invite-2026.xyz/invite.apk"), DHL
  frame 67 dtk (di "Please verify your details here:
  https://dhl-track-parcel-verify.xyz/update"). Panel interim
  code-check terlihat di kanan (40/100, 38/100, 58/100) — itu
  skor code check, BUKAN vonis AI. Semua gerakan kursor LURUS
  (simpangan maks dari garis lurus 0,0-0,1 px per segmen trace).
- ZOOM (Myuden 18:03 — "semua gerakan ZOOM harus HALUS, jangan
  zig-zag"): audit video/zoom-audit-v9.md mengukur skala/anchor
  per frame di keempat segmen zoom (s1, s3b, s3c, s5b) — SEMUA
  HALUS: In monoton naik, Hold DATAR mutlak (range 0,0000), Out
  monoton turun, tanpa lompatan anchor, tanpa goyang. TIDAK ADA
  REBUILD; s1/s3b/s3c/s5b dipakai ulang dari v7 (s3c/s5b hanya
  dipotong untuk split V1/V2, profil zoom-nya tidak berubah).
  Still s3c-2/s5b-2 statis (tanpa zoom).
- SKOR TIDAK BERUBAH (terverifikasi di file final): OTP Safe
  5/100 (frame 30 dtk), APK Scam 100/100 (50 dtk), DHL Scam
  95/100 (72 dtk), pesan aman Safe 0/100 (88 dtk), screenshot
  Scam 100/100 (100 dtk, 104 dtk). Klip baru hanya menampilkan
  "Checking..." + panel interim code-check — tidak pernah vonis
  akhir yang salah. Skenario rekam di video/scenarios-v9/
  (session-a2-otp, session-a3-apk, session-a6-dhl, session-b-v9,
  session-c-v9); take yang dibuang: tipucek-v9-main (vonis
  code-only salah 38/100, 58/100), A4/A5 DHL (framing salah).
- CATATAN PENTING (untuk agen induk): AI cloud TIDAK menjawab
  dari VM saat rekam ulang (probe video/probe-check-v9.cjs: vonis
  code-only 40/100 setelah 16,5 dtk; 1x 403 pre-flight App Check
  ke content-firebaseappcheck.googleapis.com). Klip baru berakhir
  saat "Checking...", jadi video tidak terpengaruh — tapi jalur
  cloud dari VM saat ini mati dan perlu dicek sebelum demo live.
- VERIFIKASI AKHIR v9 (file final, bukan segmen): durasi
  147,783 dtk, 1280x720, 60fps, 8867 frame; audio = mixed-v9.wav
  utuh (puncak -3,9 dBFS mono, tanpa clipping; gap RMS -23,9
  dBFS; energi >3 kHz di mix 2,17% — itu suara narasi, bed-nya
  0,00% per verify-v9-audio.txt). Satu frame batas di tepat
  91,0 dtk (0,016 dtk sebelum s5a mulai) menampilkan bayangan
  transisi; frame 91,05 dtk ke atas bersih (kursor di foto) —
  tidak terlihat di 60fps, dicatat apa adanya. V3-V5 (audit
  kursor) TIDAK masuk v9 — tetap seperti v7.

## v6-v10 (20 Nov 2026, 147.783 s) — musik dibangun ulang agar benar-benar sama dengan referensi
- ALASAN (Myuden 20 Nov 18:52: "Music nya belum benar benar sama"):
  perbandingan agen induk — v9 juga berkunci Bb, TAPI akornya
  berubah-ubah tiap segmen (Bb-Eb-Gm-F) dan spektrumnya salah:
  20-200 Hz 77%, 500-1000 Hz hanya 2%, 1000-2000 Hz 0% — jadi
  terdengar seperti dengung rendah yang redam, tanpa suara melodi
  di midrange. Referensi "Balance" (MrClaps): kunci Bb mayor,
  chroma stabil Bb 16% / D 12% / F 11-13% di semua segmen;
  spektrum 44 / 27 / 23 / 5 / 2 / ~0%; tempo ~55 BPM; melodi
  piano lembut yang jelas di 500-1000 Hz.
- DESAIN v10 (make-music-v10.py, 100% prosedural, tanpa sampel/
  unduhan/musik berhak cipta): kunci Bb mayor; harmoni STABIL —
  mayoritas Bb, sesekali F/Eb saja, 1 akor per 4 bar (17,45 dtk),
  jadi chroma tetap Bb-D-F di semua segmen; melodi piano lembut
  yang JELAS di 500-1000 Hz (nada C5-Bb5, pentatonik Bb mayor,
  nada triad Bb/D/F di 69% ketukan, tanpa attack tajam); pad
  disuarakan lebih tinggi (233-587 Hz, bukan 87-196 Hz seperti v9)
  supaya bass sendiri yang mengisi 20-200 Hz; tanpa pluck,
  tanpa shimmer, tanpa hat/kick; roll-off di atas ~3 kHz.
- ITERASI gain (4x, diukur dengan measure-bed.py): iter 1
  (500-1000 Hz 51% / 20-200 Hz 13% — melodi terlalu keras, bass
  terlalu pelan); iter 2 (22% / 48%); iter 3 (26% / 45%,
  chroma Q2 diperbaiki dengan akor F6/Ebmaj7 yang memuat D);
  iter 4 FINAL (24% / 44%).
- HASIL UKUR (verify-v10.py, verify-v10-audio.txt, ALL PASS):
  spektrum 20-200 Hz 43,75%, 200-500 26,31%, 500-1000 24,34%,
  1000-2000 4,86%, 2000-3000 0,67%, di atas 3 kHz 0,02%
  (target 44 / 27 / 23 / 5 / 2 / ~0); chroma keseluruhan
  Bb 28,1% / F 26,2% / D 17,9% — Bb teratas, Bb/D/F top-3 di
  SEMUA kuartal; tempo 55,0 BPM; mix puncak -3,3 dBFS (tanpa
  clipping); gap RMS median -23,9 dBFS; separasi SAAT BICARA
  (jendela 20 ms) median 11,4 dB.
- DUCKING v10: -18 dB (lebih dalam dari v8/v9 yang -12 dB) —
  karena melodi v10 kini hidup di pita suara (500-1000 Hz),
  ducking -12 dB hanya memberi separasi 5,0 dB (diukur);
  -18 dB mengembalikannya ke 11,4 dB saat bicara. Level celah
  tetap ~-23 dBFS (celah tanpa narasi tidak kena ducking).
- CATATAN JUJUR: (1) 2000-3000 Hz 0,67% (target ~2%) — sengaja
  dipertahankan rendah untuk menghindari nyaring (keluhan Myuden
  di v8); (2) separasi metode lama (jendela 1 dtk) 9,3 dB —
  bukan gate: metode itu mencampur jeda di dalam jendela, dan
  saat jeda musik memang kembali keras karena tidak ada narasi
  yang dilawan; gate yang dipakai adalah separasi saat bicara
  20 ms (11,4 dB); (3) p10 separasi saat bicara -3,1 dB —
  jendela 20 ms di awal/akhir kata yang sangat pelan; sesaat,
  median 11,4 dB yang menentukan kejelasan narasi.
- VIDEO TIDAK BERUBAH (stream copy dari v9, framemd5 identik,
  8877 frame); skor tidak berubah; durasi tetap 147,783 dtk;
  v7/v8/v9 tidak tersentuh (md5 v7 eb0131e8, v8 8a39cca2,
  v9 81509ed8); tanpa watermark, tanpa kredit musik
  sama sekali.
- FILE: video/make-music-v10.py, video/measure-bed.py,
  video/mix-audio-v10.py, video/build-v6-v10.sh,
  video/verify-v10.py, video/verify-v10-audio.txt,
  video/music-v10.wav, video/mixed-v10.wav.

## v6-v11 (20 Nov 2026, 147.783 s) — musik = track yang dikirim Myuden
- ALASAN (Myuden 20 Nov 19:28: "Pasangkan saja music yang saya
  kirim" + "Tanpa watermark"): v10 dinilai Myuden 19:27 "Music nya
  tidak mirip sama sekali". Keputusan ini MEMBALIKKAN keputusan
  18:57 (versi prosedural v10) — Myuden sudah tahu track ini
  "Balance" MrClaps (AudioJungle, Content ID terdaftar) dan tetap
  memilihnya.
- KOREKSI KUNCI (diukur 20 Nov 19:33, dua metode kroma): track
  aslinya BUKAN berkunci Bb mayor seperti klaim analisis 18:55 —
  kromanya G 21,2% / D 15,6% / C 12,6% (top-3 G/D/C, stabil di
  semua kuartal, bed 0-147,78 dtk sama persis dengan track penuh
  218 dtk). Itu kemungkinan besar alasan v10 (dibangun di Bb
  mayor) terdengar tidak mirip sama sekali. Untuk v11 ini tidak
  relevan lagi: bed-nya ADALAH track itu sendiri.
- BED v11 (music-v11.wav): 147,783 dtk PERTAMA dari track 218 dtk,
  hanya level yang diubah (gain -9,95 dB, RMS -22,5 dBFS, puncak
  -10,0 dBFS). TIDAK ADA watermark suara di bagian yang dipakai
  (lonjakan 106 dtk terbukti melodi piano, bukan ucapan; lonjakan
  214 dtk di luar bagian yang dipakai).
- HASIL UKUR (verify-v11.py, verify-v11-audio.txt, ALL PASS):
  spektrum bed 20-200 Hz 42,75%, 200-500 25,67%, 500-1000 24,13%,
  1000-2000 4,94%, 2000-3000 1,64%, di atas 3 kHz 0,86%;
  kroma bed = kroma track penuh (top-3 G/D/C, sama di semua
  kuartal); tempo keluarga 55/110 BPM (r=0,73 di 1,09 dtk,
  r=0,75 di 0,545 dtk); mix puncak -3,9 dBFS (tanpa clipping);
  gap RMS median -23,6 dBFS; separasi SAAT BICARA (jendela
  20 ms) median 10,7 dB; ducking efektif -16,8 dB.
- DUCKING v11: -18 dB (sama seperti v10 — melodi track hidup di
  pita suara 500-1000 Hz, jadi -12 dB tidak cukup). Level celah
  tetap ~-23 dBFS.
- VIDEO TIDAK BERUBAH (stream copy dari v9, framemd5 identik,
  8877 frame); skor tidak berubah; durasi tetap 147,783 dtk;
  v7/v8/v9/v10 tidak tersentuh (md5 v7 eb0131e8, v8 8a39cca2,
  v9 81509ed8, v10 0fd896b3); tanpa watermark, tanpa kredit
  musik sama sekali.
- AUDIT PENUH (Myuden 20 Nov 19:33): video/audit-v11.md —
  putusan MASIH ADA 5, v11 TIDAK dinyatakan bersih. Lima temuan
  ringan, semuanya belum diperbaiki (butuh rebuild segmen / ganti
  still / ubah aplikasi): (1) teks OCR terpotong di still s5b-2
  t=103,65–105,88 dtk; (2) narasi berbagi/instal tanpa tampilan
  t≈134–139 dtk; (3) tab "Check before sending" terpotong jadi
  "Check before" t≈17–111 dtk (layout aplikasi 1280 px, butuh
  ubah CSS + rekam ulang); (4) 1 frame bayangan transisi di
  tepat t=91,0 dtk (tidak terlihat di 60fps); (5) endcard masih
  github.com/Myudenn/tipucek padahal username diganti Myudenn
  20 Nov 19:26 (tautan masih jalan lewat redirect). Yang lolos:
  narasi kata-per-kata cocok naskah, semua skor benar, watermark
  0/15 segmen, tanpa bar hitam, kursor M1–M6 cocok, zoom halus.
- FILE: video/mix-audio-v11.py, video/build-v6-v11.sh,
  video/verify-v11.py, video/verify-v11-audio.txt,
  video/music-v11.wav, video/mixed-v11.wav,
  video/audit-v11.md.

## v6-v12 (20 Nov 2026, DALAM PROSES — bertahap) — perbaiki kelima temuan audit v11
- ALASAN (Myuden 20 Nov 20:04: "Pokoknya harus terbaik jangan ada
  kesalahan sedikit pun ketika uji demo juri"): jawaban atas pilihan
  "Perbaiki kelima temuan itu". Target audit v12: 0 temuan.
- URUTAN (Myuden 20 Nov 20:13: "Buat sekarang, video ikut
  diperbarui"): tombol pill "Tanya Aman" diganti tombol bulat wajah
  robot Aman + panel obrolan (dibangun agen lain, akan di-deploy ke
  live). Karena itu v12 dikerjakan BERTAHAP: dulu perbaikan yang
  TIDAK butuh rekam ulang dari live, lalu rekam ulang segmen yang
  menampilkan tombol Aman DITUNDA sampai panel baru live (supaya
  video menampilkan tombol Aman yang baru di semua frame — jangan
  rekam dengan tombol lama).
- SELESAI (tanpa live, 20 Nov ~20:10): (5) endcard — closing-v2.png
  di-render ulang dari video/make-cards-v2.py baris 54 (sudah
  "Code: github.com/Myudenn/tipucek", terverifikasi visual);
  (4) frame bayangan t=91,0 — frame 5460 (blend, MAD 21,82 vs
  5459 dan 17,32 vs 5461) diganti donor frame bersih 5461
  (teknik v7: trim + hold 1 frame + concat, build-v6-v12/
  v11-ghostfix-video.mp4, 8867 frame, durasi tetap 147,783 dtk,
  v11 TIDAK tersentuh md5 e5d339fa; verifikasi: MAD f5460 baru
  vs f5461 0,651, vs f5459 22,19 — itu potongan keras antar-shot
  yang benar, bukan blend).
- KOREKSI ENDCARD (20 Nov ~21:00, dibaca langsung frame t=140
  ghostfix): video ghostfix MASIH menampilkan endcard LAMA
  "Code: github.com/kyleweb3/tipucek" — perbaikan (5) baru
  selesai di level FILE closing-v2.png, BELUM masuk ke video
  mana pun. Rakitan v12 WAJIB mengganti segmen endcard
  (137,289–147,783) dengan still dari closing-v2.png
  (build-v6-v12.sh melakukannya; verify-v12.py memeriksa
  MAD frame t=140 vs closing-v2.png < 3 dan vs endcard lama > 3).
- BASIS GHOSTFIX TERVERIFIKASI (20 Nov ~21:00): build-v6-v12/
  v11-ghostfix-video.mp4 = 1280x720, 60fps, 8867 frame,
  147,783 dtk, md5 3e067616400645b5c8d46d027848fde8; frame t=91,0
  dibaca langsung — bersih (bagian screenshot, gambar preview
  WhatsApp, tanpa blend); frame t=140 dibaca langsung — endcard
  lama (lihat koreksi di atas).
- URUTAN DEPLOY FINAL (Myuden 20:50–20:51): situs berubah SEKALI
  LAGI sebelum final — (a) tab "Tanya Aman" DIHAPUS dari baris
  "Fitur lainnya" (satu-satunya pintu masuk Aman tinggal tombol
  bulat melayang); (b) header panel Aman jadi biru gradien;
  (c) perbaikan prompt Aman + auto-scroll log; (d) service
  worker skipWaiting. Karena itu JANGAN tangkap segmen tab
  sampai deploy final ini live (agen induk memberitahu).
  Still s5b-2 dan ekor shot 7 BOLEH jalan lebih dulu, TAPI bila
  frame-nya menampilkan baris tab "Fitur lainnya", tunda juga.
  Jangan rekam apa pun dengan tampilan lama.
- PERLUASAN CAKUPAN PILL (20 Nov ~20:44–20:51, dibaca dari frame):
  tombol pill lama "Ask Aman" terlihat di hampir semua segmen
  footage lama — s1 t=10, s2a t=18, s2b t=30/35/40, s3c-2 t=60,
  s4c t=78, s4d t=86, s5a t=95, s6a t=115, s6c t=125, s7a t=130;
  hanya s5b-1 t=100 dan s5b-3 t=108 (zoom) yang pill-nya tinggal
  selip biru kecil di pojok. Agar "tombol Aman baru di semua
  frame", v12 merekam ulang SEMUA segmen gerak: s1 (still hero
  baru + zoom), s2a/s2b (OTP), s3a (APK), s4a–d (DHL + safe),
  s5a (screenshot), s6a–c (outbound + Senior), s7a (History +
  Share). Yang dipakai ulang dari ghostfix hanya: cover,
  s5b-1/s5b-3 (zoom, pill selip), dan TIDAK ADA segmen tab lain
  — s5a, s5b-1, s5b-3 TIDAK menampilkan baris tab "Fitur lainnya"
  (terverifikasi dari frame t=95/100/108), jadi tidak butuh
  rekam ulang untuk temuan 3.
- MENUNGGU DEPLOY FINAL: (1) still s5b-2 baru dari live — DICARI
  di 16 still + 4 take mentah v6 + take v9-shot5: TIDAK ADA
  frame OCR penuh skor 100/100 (yang OCR-nya penuh semuanya
  95/100; yang 100/100 semuanya terpotong/tertutup tombol Aman)
  — tangkap baru dari live sesudah deploy final (3 screenshot
  kandidat a/b/c di sesi shot5, pilih yang OCR-nya penuh);
  (2) rekam ulang ekor shot 7; (3) rekam ulang segmen tab dari
  live baru (tab sudah wrap penuh di live Round 7 — terverifikasi
  probe: 4 tab terbaca penuh, wrap 2 baris; vonis cloud OTP Safe
  5/100 keluar 6,7 dtk — jalur tangkap terbukti jalan, yang
  tertunda hanya panel Aman).
- PERSIAPAN SELESAI (20 Nov ~21:00, belum ada rekaman baru):
  8 skenario baru di video/scenarios-v12/ (v12-otp, v12-apk,
  v12-dhl, v12-safe, v12-shot5, v12-shot6, v12-s1, v12-shot7)
  — ditulis BARU dari sumber terverifikasi (skrip probe/rekam
  v12, kode aplikasi index.html/src/main.js/src/i18n.js, frame
  video yang dibaca langsung), BUKAN dari file scenarios-v9/
  (satu hasil exec berisi skenario v9 ditandai sistem tidak lolos
  pemeriksaan prompt-injection — file itu tidak dijalankan dan
  isinya tidak dipakai sebagai instruksi). Driver satu token
  video/run-v12-captures.sh (1 token debug "v12-final", cek skor
  via eval tiap sesi, retry maks 3x, hapus token + verifikasi
  kosong; nilai token TIDAK PERNAH ditulis ke laporan/file).
  Rakitan video/build-v6-v12.sh (basis ghostfix + segmen baru +
  still endcard closing-v2.png + audio mixed-v11.wav, total
  147,783 dtk). Pemotong video/cut-plan.py (jendela potong
  dihitung dari waktu klik di cursor-trace). Verifikasi
  video/verify-v12.py (durasi/res/fps, audio = v11, md5 v7–v11
  utuh, MAD frame 91,0, endcard = closing-v2.png, frame
  s5b-2/s3c-2 = still baru). Token debug App Check: 2 dibuat
  saat probe sebelumnya (v12-capture + yatim root@htch-runtime),
  keduanya DIHAPUS dan terverifikasi kosong ("No App Check debug
  tokens found.", dicek agen induk 20 Nov ~21:00); nilai token
  tidak pernah ditulis ke mana pun.
- EKOR SHOT 7 (desain rekam, dari kode aplikasi): entri History
  TIDAK bisa diklik (src/main.js renderHistory ~780: <li> polos,
  tanpa tombol/aksi) — jadi ekor shot 7: tampilkan History (5
  entri, "Save history only on this device" tercentang) →
  scroll ke atas ke kartu vonis terakhir → kursor ke tombol
  "Share warning card" (#share-card-btn, main.js:519,599) →
  klik → tombol jadi "Card downloaded" 2 dtk (navigator.share
  tidak tersedia di Chromium VM → jatuh ke unduh PNG; shelf
  unduhan browser di luar viewport, tidak terlihat). TIDAK ADA
  tombol instal khusus — instal PWA lewat menu browser
  ("Tambahkan ke Layar utama", footer pwaInstallHint index.html:
  419). Klik Share sudah memenuhi temuan 2 ("tampilkan klik
  Share warning card / tombol instal").
- RISIKO MODEL STRUK vs NARASI FAILOVER: kalimat narasi shot 4
  "The main model was busy, so the backup answered — the check
  never stops." (~1:21–1:25) didukung jujur HANYA bila struk
  vonis pesan aman menampilkan "Model: gemini-3.1-flash-lite
  (backup)" (terverifikasi frame t=82 di v11). Bila sesi rekam
  baru dijawab model UTAMA (3.5-flash-lite), struk menampilkan
  model utama dan narasi itu tidak lagi didukung footage —
  cek model dari hasil eval tiap sesi (skenario mencatat
  model di EVAL) dan putuskan saat audit v12.
- AUDIO TIDAK BERUBAH (mixed-v11.wav — narasi + track kiriman
  Myuden); durasi akhir tetap ~147,783 dtk; tanpa watermark,
  tanpa kredit musik.
- REKAM ULANG DARI LAYOUT BARU (20 Nov 21:47, live bundle
  index-TUIQHOHG.js, SW tipucek-v9, logo Aman F md5 0109b2b4):
  layout dashboard baru (hero besar + tombol Cek pesan /
  Laporkan penipuan, statistik 2×2, checker sesudah statistik,
  tren minggu ini, Fitur lainnya urutan baru, kartu Bagikan, nav
  bawah, footer Myudenn; bahasa HANYA ID + EN, mode terang).
  Semua take v12 lama BASI dan diarsipkan ke build-v6-v12/
  takes-old-layout-20261120/ (take -ok + stills TIDAK dipakai
  lagi). Skenario diperbarui seminimal mungkin (posisi checker/
  sampel/screenshot bergeser ke bawah; #share-card-btn tetap
  dinamis di kartu hasil). 6 temuan agen v12 lama DIPERBAIKI
  sebelum run: (1) harvest_shots: glob berstempel + "cp -p"
  (dulu still salah skor karena mtime target = sekarang);
  (2) hapus token: delete pakai Resource Name lengkap dari
  output create (delete pakai nilai UUID 404 — resource id-nya
  base64 dari UUID LAIN, bukan dari nilai token; terverifikasi
  2 token uji: delete UUID 404, delete resource name OK,
  kembali 0 token); (3) retry APK naik 3→6, shot5 3→4;
  (4) jendela s4d dari mark "verdict" di trace (dulu offset
  tetap T+2 menampilkan "Checking..." sampai ~16,5 dtk);
  (5) risiko narasi shot 4 vs model struk DICATAT apa adanya di
  audit (tidak dipalsukan); (6) toast menutup kartu diperiksa
  di audit. Myuden 21:51: "kalau serasa ada yang kurang pas
  atau apapun itu bisa diterapkan dan perbaiki yang kurangnya"
  — perbaikan di dalam tugas video diizinkan langsung.

- PERUBAHAN NAV/MENU 21 Nov 08:49 (Myuden, sebelum rekam ulang v12):
  (a) panel "Periksa cepat" DIHAPUS — form Periksa hanya ada di
  dashboard ("Periksa pesan mencurigakan", 4 tab); (b) bagian Riwayat
  di halaman DIHAPUS — riwayat hanya ada di panel Riwayat; (c) nav
  bawah tinggal 2 item (Beranda, Riwayat); (d) "Lainnya" pindah ke
  tombol hamburger di header kiri atas, sebelum logo (semua lebar,
  seperti YouTube). KOREKSI 21 Nov 09:05: menu BUKAN full-layar —
  melainkan DRAWER dari sisi KIRI (~85% lebar, maks 380px, area luar
  meredup): Beranda; Riwayat;
  grup "Fitur" (terbuka, 9 alat); grup "Pengaturan" (tertutup: tema,
  ukuran teks, Bahasa, Mode Orang Tua, sakelar privasi); grup FAQ;
  "Pasang aplikasi"; tombol merah "Laporkan Penipuan" menempel di
  bawah drawer. Tombol tema (matahari/bulan) juga ada di header,
  dengan menu Gelap/Terang/Sistem — Sistem mengikuti perangkat.
  Segmen video yang menampilkan nav bawah 4 item / panel Periksa /
  bagian Riwayat halaman / menu full-layar adalah tampilan lama —
  jangan pakai.
- RESTRUKTUR RAPIAN 21 Nov 09:58 + koreksi (Myuden) — MENGGANTIKAN
  drawer di atas TOTAL: (a) hamburger + drawer kiri DIHAPUS total,
  tidak ada lagi menu samping; (b) HANYA 2 dashboard: Dashboard 1
  (Beranda: hero, form periksa 4 tab, statistik, tren, lalu 8 ALAT
  DALAM GRID 4x2 — Cek Tautan, Cek File, Cek Chat, Laporkan,
  Kontak Resmi, Panduan Darurat, Kuis, Cara kerja — 2 baris, 8 kartu
  pas, tanpa sel kosong); Dashboard 2
  (Riwayat halaman penuh: daftar, cari, lencana, hapus, sakelar
  privasi + Pengaturan: ukuran teks, warna aksen, Mode Orang Tua);
  KOREKSI 21 Nov 11:22 (Myuden): kartu Riwayat DIHAPUS dari grid —
  Riwayat hanya dibuka dari nav bawah, bukan lagi dari grid;
  KOREKSI 21 Nov 12:12 (Myuden, opsi b): tautan "Riwayat" di header
  khusus desktop (≥1024px, tersembunyi di mobile) — jalan masuk ke
  Dashboard 2 di desktop, karena nav bawah tersembunyi di sana;
  KOREKSI 21 Nov 12:29 (Myuden): grid jadi 4 kolom × 2 baris —
  "4 4 jadi 2 pas", 8 kartu pas tanpa sel kosong; "atur sebagus
  mungkin" — jarak seimbang, ikon + label sejajar, kartu sama tinggi,
  rapi di tema gelap/terang, ID/EN, 390px maupun desktop;
  (c) header STATIS (ikut tergulir, tidak nempel) dan SATU BARIS di
  390px — hanya logo TipuCek, ID/EN, tombol tema, titik hijau
  status; Mode Orang Tua pindah ke Pengaturan Dashboard 2;
  (d) tombol Aman melayang SEMBUNYI saat footer terlihat, muncul
  lagi saat footer keluar layar; (e) nav bawah Beranda ↔ Riwayat
  tetap menempel (di desktop tersembunyi — jalan masuk ke Dashboard
  2 di desktop adalah tautan "Riwayat" di header, dan jalan pulang
  adalah tombol "← Beranda" di atas Dashboard 2). Segmen video yang menampilkan drawer/hamburger/
  chip "Fitur lainnya" terpotong / panel Riwayat adalah tampilan
  lama — jangan pakai. Rekam ulang v12 menunggu tampilan final
  ini (deploy oleh agen induk).
- STATS KOSONG 21 Nov 09:05 (Myuden): pengguna baru (riwayat kosong)
  TIDAK lagi melihat "0" di kartu "Pesan Anda Diperiksa" /
  "Penipuan Terdeteksi" — melainkan tanda "–" + ajakan memeriksa
  pesan pertama; grafik 7 hari menampilkan "Belum ada data —
  periksa pesan dulu." Begitu ada 1 pemeriksaan, angka asli tampil.

## v12 REKAM ULANG 22 Nov 2026 — tampilan FINAL (web BEKU, bundle index-BIbX0-Dj.js)

- Web dibekukan setelah audit-12 deploy 22 Nov ~18:10 (bundle
  index-BIbX0-Dj.js; layout desktop baru 1200px di 1440px; semua
  perbaikan audit 4–12 live). Semua take lama BASI (layout lama).
- KEPUTUSAN MYUDEN 22 Nov 18:26 — APK RETRY SAMPAI 100: contoh APK
  tidak pernah 100 dalam 18 percobaan (17×95 + 1×99). Ulangi
  pemeriksaan APK sampai skor 100, maks 20 percobaan
  (run-v12-captures.sh: v12-apk 12→20); bila belum 100 juga,
  BERHENTI dan laporkan semua skor + saran, jangan ubah contoh
  tanpa izin, jangan palsukan skor.
- SKENARIO DIPERBARUI 22 Nov (probe DOM live, v12-dom-probe.cjs):
  (a) modal onboarding "Start in 3 steps" muncul di profil baru —
  tiap skenario menutupnya via eval `#onboard-close` sesudah goto
  (eval = tanpa klik kursor, jadi indeks klik cut-plan tidak
  berubah); (b) `#module-tab-history` SUDAH TIDAK ADA — Riwayat
  adalah Dashboard 2, dibuka via `#header-history-link` (desktop,
  tampil di 1280px), pulang via `#history-back-btn` (shot7);
  (c) `#senior-toggle` pindah ke Pengaturan Dashboard 2 — shot6
  membuka Dashboard 2 dulu via header History, lalu scroll ke
  toggle dan klik (cut-plan.py: klik shot6 = [tab, tombol,
  history-link, senior]; S6_T2 = klik ke-4); (d) baris "Model:"
  DIHAPUS dari kartu vonis 21 Nov — model penjawab TIDAK tampil
  di struk lagi; v12-safe mencatat model dari entri riwayat
  localStorage (`pesanaman_history_v1`, field `model`) via eval
  tambahan, untuk putusan narasi shot 4.
- NARASI SHOT 4 — BELUM DIPUTUSKAN: "The main model was busy, so
  the backup answered — the check never stops." didukung jujur
  HANYA bila pemeriksaan pesan aman dijawab model CADANGAN
  (gemini-3.1-flash-lite). Karena baris model dihapus dari struk,
  dukungan tidak lagi terlihat di frame — putusan memakai model
  dari riwayat (eval) + banner failover bila muncul di footage.
  Bila model UTAMA yang menjawab, narasi itu SALAH dan final
  TIDAK BOLEH dirakit dengan narasi itu (opsi: ubah narasi jadi
  "model utama" + rekam ulang baris itu, atau yang lain —
  keputusan Myuden).
- DRY RUN 22 Nov (v12-dryrun-otp.sh, 1 sesi OTP, token dibuat +
  dihapus + terverifikasi 0): pipeline jalan penuh (token,
  rekaman 60fps headed, video 1280x720 60fps 35,13 dtk, trace,
  onboarding tertutup). TAPI skor OTP 0/100 (Safe, "Answered in
  the cloud", 8.329,4 md) — bukan 5/100 seperti narasi. Model
  non-deterministik; driver mengulang OTP maks 3x. Bila 3x tetap
  bukan 5, laporkan distribusinya — jangan palsukan skor.
- SKILL VIDEO TERBARU (Myuden 22 Nov 18:28, "pakai skill terbaru
  supaya lebih maksimal"): dibaca + diterapkan di rakitan/
  verifikasi v12 — video-explainer-maker, video-shotcraft,
  visual-skills-video, remotion, motion-design, edit-video-yt-
  shorts, klip-shorts, ffmpeg-skill. Footage TETAP aplikasi asli
  (tanpa visual AI / video gambar-kode); narasi tetap
  narration-mix-v6.wav; musik tetap track kiriman Myuden
  (mixed-v11.wav). Teknik yang dipakai dicatat di laporan v12.
- TAHAN 22 Nov 18:36 (Myuden): tangkapan v12 DIHENTIKAN di tengah jalan
  (driver sudah jalan 11:36–11:39 UTC: OTP attempt 1 DITERIMA skor 5,
  APK attempt 1–2 skor 95, attempt 3 terpotong). Alasan: Myuden minta
  demo layout desktop baru (jawaban di samping form, bukan di bawah)
  dulu sebelum layout final diputuskan. Bundle index-BIbX0-Dj.js
  TIDAK LAGI FINAL — akan ada deploy baru sesudah demo disetujui.
  Driver dimatikan + token debug v12-final dihapus + terverifikasi 0;
  semua take run itu dipindah ke build-v6-v12/
  takes-aborted-20261122-hold/ (BASI, jangan dipakai rakitan).
  Skenario/driver sudah siap; TAPI skenario mungkin perlu
  di-probe ulang sesudah deploy baru (bila demo mengubah
  selektor/layout). Lanjut hanya sesudah parent kirim bundle final
  + perintah lanjut.
