# Fonts — TipuCek

## Plus Jakarta Sans (G2 — Ramah)

- File: `plus-jakarta-sans-latin.woff2` (27 KB)
- Source: Google Fonts, downloaded 2026-11-20
- License: **SIL Open Font License 1.1 (OFL)** — free to use, bundle, and
  redistribute. Copyright: Tokotype / Google Fonts contributors.
- Coverage: latin subset (U+0000–00FF + punctuation). Indonesian and English
  text are fully covered; no other subset is needed.
- Format: Google Fonts distributes Plus Jakarta Sans as a **variable font** —
  this single file covers weights 200–800, so the 400 / 500 / 600 / 700 / 800
  weights the app uses all render from it. Declared in CSS as one
  `@font-face` with `font-weight: 200 800`.
- Served locally from this folder (`/fonts/...` via Vite `public/`). The app
  never loads a font from the internet at runtime, so the PWA works offline.

## Fallback

If the bundled font fails to load, the stack falls back to system sans:
`-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
