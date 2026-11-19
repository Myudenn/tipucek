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
3. Record per case: `status`, `riskScore`, badge (`ON_DEVICE` /
   `IN_CLOUD` / `LOCAL` / `DEMO`), and seconds shown ("checked in
   X s"). If a check fails, note the error and retry once; a second
   failure counts as a miss for that case.
4. Score the 21 clear cases: exact `status` match counts as correct.
   Report separately: correct / 21, false positives (safe called
   scam/suspicious), false negatives (scam called safe/suspicious),
   and the 4 hard cases (correct / 4, listed individually).
5. Report latency: median and max seconds across the 25 checks, and
   the badge split (how many ON_DEVICE vs IN_CLOUD).
6. Record the run (date, model, site) in the Results section below
   and in DEVPOST-DESCRIPTION.md. AI scores are non-deterministic:
   always quote the latest run's numbers, never an old run's.

## Results

### Run 1 — PENDING (live browser run not done yet)

_ Fill in after the first cloud-browser run: date, correct / 21,
FP, FN, hard cases / 4, latency median/max, badge split. _
