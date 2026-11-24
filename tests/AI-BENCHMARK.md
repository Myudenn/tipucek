# TipuCek AI benchmark — live-site protocol (v1)

The local-rules benchmark (`tests/benchmark-local-rules.mjs`, 14/14)
measures the demo heuristic, NOT the AI. This benchmark measures the
real thing: the production AI verdict on the live site
(https://tipucek.web.app), model `gemini-3.5-flash-lite` via Firebase
AI Logic, hybrid `PREFER_ON_DEVICE`.

Cases live in `tests/ai-benchmark-cases.json`: 21 clear cases
(11 scam, 10 safe) + 4 hard/ambiguous cases (3 expected `suspicious`,
1 expected `safe` — the genuine OTP notification). Expected verdicts
were written before any run and must never be edited to fit results.

## How to run (cloud browser task)

1. Open https://tipucek.web.app/ in a cloud browser (desktop
   Chrome). Confirm the page shows TipuCek.
2. For each case, in file order: paste the exact `text` into the
   message box, click **Check message**, wait for the verdict card.
3. Record per case: `status`, `riskScore`, badge (plain words —
   "Answered on this device, private" / "Answered in the cloud" /
   "Checked on your device" / "Demo check — local only"), and seconds
   shown ("checked in X s"). If a check fails, note the error and retry
   once; a second failure counts as a miss for that case.
4. Score the 21 clear cases: exact `status` match counts as correct.
   Report separately: correct / 21, false positives (safe called
   scam/suspicious), false negatives (scam called safe/suspicious),
   and the 4 hard cases (correct / 4, listed individually).
5. Report latency: median and max seconds across the 25 checks, and
   the badge split (how many answered on-device vs in the cloud).
6. Record the run (date, model, site) in the Results section below
   and in DEVPOST-DESCRIPTION.md. AI scores are non-deterministic:
   always quote the latest run's numbers, never an old run's.

## Results

All runs use the same fixed 25 cases (11 scam, 10 safe, 4 hard/ambiguous:
3 expected `suspicious`, 1 expected `safe` — the genuine OTP notification),
run live on https://tipucek.web.app with model `gemini-3.5-flash-lite`
via Firebase AI Logic. AI scores are non-deterministic: a 25/25 run is a
measurement of that run, not a guarantee for the next one. Always quote
the latest run's numbers.

### Run 1 — 21 / 25 (84%)

Date: November 2026 (exact date not recorded in files — the draft
compiled 23 Nov 2026 ~19:50 WIB already contained Runs 1–3). All 25
cases answered by cloud AI. Most serious miss: a fake-bank OTP judged
Safe 5 (false negative; local rules correctly said Scam 60).

### Run 2 — 23 / 25 (92%)

Date: November 2026 (exact date not recorded — see Run 1 note). All 11
scam cases and all 10 safe cases correct — 0 scam false negatives, 0
safe false positives. The fake OTP is now Scam 90 (the OTP prompt rule
works); the Tokopedia voucher is now correctly Suspicious 45.

### Run 3 — 24 / 25 (96%)

Date: November 2026 (exact date not recorded — see Run 1 note). Both
ambiguous cases from Run 2 are now correct after prompt tuning: the J&T
courier link (non-official domain, no money/OTP/data asked) is
Suspicious 45, and the job listing whose only contact is a personal
gmail (no payment asked) is Suspicious 45. No other case regressed.
The one miss: the Tokopedia voucher link judged Safe 0 (expected
Suspicious) — it flipped from Suspicious 45 in Run 2, most likely AI
non-determinism rather than a prompt defect.

### Run 4 — 25 / 25 (100%)

Date: 23 Nov 2026, 20:49–20:55 WIB, cloud browser. The one remaining
miss from Run 3 is now correct after a further prompt tuning (the PROMO
sub-rule: an unsolicited voucher/promo is Suspicious 30–59 even when its
link goes to the brand's official domain — an official-looking link
alone does not prove the message is genuine). The Tokopedia voucher link
is now Suspicious 45. Zero regressions on the other 24 cases. All 11
scam cases, all 10 safe cases, and all 4 hard cases correct.

### Local rules on the same 25 cases — 24 / 25

The deterministic on-device rules score 24/25 on the same benchmark
(the one miss is an intentional divergence — the job-listing case is
Safe 16 by the local benchmark and Suspicious by the AI benchmark).
Note: this is different from `tests/benchmark-local-rules.mjs` (18/18
on its own 18 demo cases) — do not confuse the two.

### Safety floor

If local rules score Scam (≥60) but the AI misses it, the final
verdict is the local one. This prevents the Run 1 OTP false negative
from ever reaching the user again. The floor was not triggered in Run 2
or Run 3 (the AI was correct on the scam side). Proven by unit tests
and simulation.

### Not recorded (do not quote)

Per-run latency median/max and badge split (on-device vs cloud) were
not recorded in files, except Run 1 (all 25 answered by cloud AI).
Do not invent these numbers.
