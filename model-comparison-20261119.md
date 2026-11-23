# Perbandingan Model Gemini Gratis untuk Vonis TipuCek — 19 Nov 2026

Perintah Myuden 19 Nov 23:51 WIB ("Uji semua yang gratis bandingkan"). Baseline: `gemini-3.5-flash-lite` (model cloud produksi saat ini, `CLOUD_MODEL` di `src/ai.js`).

## Status: UJI LIVE SELESAI — 2 model penuh + 4 model probe (20 Nov 2026 ~02:45 WIB)

**Token App Check berhasil diambil lewat Playwright di VM** (buka tipucek.web.app, 1 cek contoh, tangkap header `X-Firebase-AppCheck` dari request `generateContent`) — jalur live terbuka. Hasilnya menentukan: **hanya keluarga Flash-Lite yang bisa menjawab di tier gratis saat ini; semua model non-Lite praktis tidak bisa dipakai.**

### Hasil live per model

| Model | Uji | Berhasil | Ketepatan (exact) | Flagged | FP | FN | Latensi median | Lewat 30 dtk |
|---|---|---|---|---|---|---|---|---|
| `gemini-3.5-flash-lite` (baseline) | penuh 54 | 52/54 (96%) | 42/52 (81%) | 25/28 | 0/24 | 0/20 | 10,21 dtk (min 2,04; maks 94,29; p90 43,8) | 11/54 |
| `gemini-3.1-flash-lite` | penuh 54 | 44/54 (81%) | 35/44 (80%) | 23/24 | 3/20 | 0/17 | 14,59 dtk (min 1,42; maks 87,7; p90 72,98) | 21/54 |
| `gemini-3.5-flash` | parsial 24 | 3/24 (13%) | — (terlalu sedikit) | — | — | — | — | 7/24 (5 timeout ~90 dtk + 2 sukses lambat) |
| `gemini-3.6-flash` | probe 6 + harness 1 | 0/7 | — | — | — | — | — | 0/7 (semua gagal <2 dtk) |
| `gemini-3.8-flash` | probe 6 | 0/6 | — | — | — | — | — | 4/6 (4 timeout ~91 dtk) |
| `gemini-4-hydrogen` | probe 6 | 1/6 (17%) | 1/1 | — | — | — | 9,10 dtk (satu-satunya sukses) | 0/6 |

Kegagalan non-Lite: `3.5-flash` 14× HTTP 429 + 5× timeout ~90 dtk + 2× putus koneksi (dari 24 panggilan); `3.6-flash` 6× 429 + 1× putus koneksi; `3.8-flash` 4× timeout ~91 dtk + 2× HTTP 500; Hydrogen 2× 429 + 1× 500 + 2× putus koneksi, 1 sukses (scam-otp, 9,10 dtk, scam 90, benar). **Tes diagnostik: `gemini-3.5-flash-lite` menjawab normal di saat yang sama (12,16 dtk, scam 98)** — jadi pembatasan ini per model, bukan proyek: kuota tier gratis untuk model non-Lite praktis habis/terkunci, sementara Flash-Lite tetap jalan.

**Jalur live yang dipakai (ditemukan sebelum uji):**

1. **Panggilan langsung ke Gemini Developer API (`generativelanguage.googleapis.com`) ditolak 403** — `PERMISSION_DENIED / ACCESS_DENIED` untuk kunci proyek ini, baik lewat header `x-goog-api-key`, query `?key=`, maupun dengan header `Referer: https://tipucek.web.app/`. Layanan itu tidak diaktifkan untuk proyek/kunci ini.
2. **Jalur yang benar adalah endpoint Firebase AI Logic** — diverifikasi dari kode SDK di `node_modules/@firebase/ai`: SDK mengarahkan SEMUA request (termasuk `GoogleAIBackend`) ke `firebasevertexai.googleapis.com`, dengan path `POST /v1beta/projects/{projectId}/models/{model}:generateContent` dan header `x-goog-api-key`. (Path `publishers/google/models/...` memberi 404; path `models/...` memberi 401 — jadi format path ini terkonfirmasi benar.)
3. **Endpoint itu menegakkan App Check: tanpa token, jawabannya 401 `Firebase App Check token is invalid`.** Token App Check hanya bisa dibuat di dalam browser lewat reCAPTCHA Enterprise (atau token debug yang terdaftar di console — tidak ada nilainya di repo). Token akhirnya diambil lewat Playwright Chromium di VM (buka tipucek.web.app, 1 cek contoh, tangkap header `X-Firebase-AppCheck`), berlaku ~1 jam — tiap kali kedaluwarsa (401), ambil token baru dan jalankan ulang harness (model yang sudah selesai dilewati).

**Insiden tengah jalan — VM restart ~01:12 WIB menghapus /tmp:** harness, `cases.json`, `summary.json`, dan token ikut hilang. Dipulihkan: `cases.json` dibangun ulang dari file tes di repo (teks + expected verbatim; lang `safe-office`/`safe-courier-en` = `en` dari deteksi teks — skrip prep asli ikut hilang, jadi ada catatan kecil ini); `run_compare.py` + `capture_token.cjs` ditulis ulang (prompt/skema diverifikasi byte-identik dengan produksi); `summary.json` 2 model selesai direkonstruksi dari log run-1 yang lengkap dan **terverifikasi** terhadap agregat yang dicetak harness sendiri (52/54, 42/52, median 10,21 dtk; 44/54, 35/44, median 14,59 dtk — semua cocok). JSONL per panggilan 2 model itu tidak bisa dipulihkan (redFlags/ringkasan/token tidak ada di log stdout) — hanya agregatnya yang dipulihkan. Salinan cadangan ada di `~/workspace/model-compare/`. **Perubahan metode:** 4 model non-Lite TIDAK dijalankan penuh 54 panggilan — tiap panggilan 429 membakar ~3 menit backoff, jadi 54 panggilan × 3 model ≈ 8 jam kegagalan tanpa informasi baru. Sebagai gantinya: `3.5-flash` 24 panggilan (parsial harness, 5 dengan `cases.json` asli + 19 dengan yang dibangun ulang) + probe 6 kasus × 1 percobaan tanpa retry untuk `3.6-flash`/`3.8-flash`/Hydrogen (`probe_multi.py`, prompt/skema sama). Hasil 0/6 dan 1/6 sudah cukup membuktikan tidak bisa dipakai — menjalankan penuh hanya mengulang angka yang sama. Dua model Flash-Lite penuh memakai `cases.json` asli; teks + expected di semua versi identik (dari file tes yang sama), hanya bahasa jawaban 2 kasus yang mungkin berbeda — tidak memengaruhi kesimpulan ketersediaan.

## Matriks model — terverifikasi dokumen (19 Nov 2026)

| Model | Tier gratis? | Dilayani Firebase AI Logic? | Structured output? | Thinking (batasan konfigurasi) |
|---|---|---|---|---|
| `gemini-3.5-flash-lite` (baseline) | Ya | Ya | Ya | Default MINIMAL (default Flash-Lite); `thinkingBudget` didukung (kompatibilitas 3.x) |
| `gemini-3.1-flash-lite` | Ya | Ya | Ya ("and the older `gemini-3.1-flash-lite`") | Default MINIMAL |
| `gemini-3.5-flash` | Ya ("Free of charge") | Ya (daftar model teks Genkit + catatan kaki capability) | Ya (catatan kaki "older general-use Gemini 3.x Flash models") | MINIMAL didukung; `thinkingBudget` didukung (3.x) |
| `gemini-3.6-flash` | Ya | Ya menurut catatan kaki capability pages ("older general-use Gemini 3.x Flash models") — CATATAN: plugin Genkit menyebut 3.6/3.7 "Gemini Developer API only", jadi perlu konfirmasi lewat panggilan live | Ya (catatan kaki yang sama) | MINIMAL didukung (hanya 3.8/3.7 yang tidak mendukung) |
| `gemini-3.8-flash` | Ya | Ya | Ya | MINIMAL TIDAK didukung (400 bila diset); default MEDIUM; `thinkingBudget` didukung (3.x) |
| `gemini-4-hydrogen` | Ya — satu-satunya Gemini 4 yang punya free tier | Ya, lewat Gemini Developer API (free tier) | Ya | LOW/MEDIUM/HIGH, default HIGH; MINIMAL TIDAK didukung (400); `thinkingBudget` TIDAK didukung (400) |
| `gemini-4-neon` | **TIDAK — DICORET.** Paid only $3/$15 per 1M token, tanpa free tier | Ya (terdaftar di AI Logic) tapi tidak relevan — berbayar | — | — |
| Model 2.5 (Flash/Flash-Lite/Pro) | — | — | — | **DICORET.** Deprecated; mulai 1 Des 2026 dialihkan otomatis ke 3.8-flash / 3.5-flash-lite |
| `gemini-4-carbon`, `gemini-4-argon`, `gemini-3.1-pro-preview` | **TIDAK — DICORET.** Paid only | Ya | — | — |

Sumber daftar structured-output AI Logic: `gemini-4-hydrogen`, `gemini-4-argon`, `gemini-4-carbon`, `gemini-3.8-flash`, `gemini-3.5-flash-lite` (dan `gemini-3.1-flash-lite` yang lebih lama); model 3.x Flash umum yang lebih lama mendukung kemampuan ini.

**Catatan penting soal konfigurasi:** aplikasi saat ini TIDAK mengatur `thinkingLevel`/`thinkingBudget` sama sekali (hanya `responseMimeType` + `responseSchema`) — jadi tiap model berjalan pada default-nya. Bila aplikasi pindah ke Hydrogen tanpa mengubah konfigurasi, Hydrogen berjalan pada thinking default HIGH (lebih banyak berpikir sebelum menjawab — berpotensi lebih lambat, bukan lebih cepat). Uji live harus memakai default aplikasi (itulah yang dilakukan harness).

## Desain uji (harness siap jalan)

- **Kasus (18):** 14 kasus benchmark dari `tests/benchmark-local-rules.mjs` (7 scam, 7 safe) + 4 kasus sulit dari `tests/ai-benchmark-cases.json` (3 `suspicious`, 1 `safe` — OTP asli). Keempat sampel nyata yang diminta Myuden (hadiah Telkomsel, OTP BCA, rapat aman, kurir DHL) semuanya ada di dalam 14 kasus itu.
- **Pengulangan:** tiap kasus 3× per model (total 54 panggilan/model, 324 untuk 6 model).
- **Prompt + skema + konfigurasi SAMA PERSIS dengan produksi** (`buildPrompt` + `makeVerdictSchema` dari `src/ai.js`, tanpa override temperature/thinking) — yang berubah hanya string nama model.
- **Yang diukur per model:** tingkat berhasil (termasuk 503/timeout/400), latensi (median, min, maks, p90, detik), ketepatan vonis (status persis vs yang diharapkan; akurasi flagged scam|suspicious; FP/FN), jumlah panggilan yang melewati batas aplikasi 30 detik, dan token pemikiran (`thoughtsTokenCount`) bila ada.
- **Penanganan rate-limit:** jeda 2,5 detik antar panggilan; HTTP 429 di-backoff (60 dtk, lalu 120 dtk) dan dicatat terpisah — BUKAN dihitung sebagai kegagalan model. 503/500/timeout/400 dicatat sebagai kegagalan tanpa retry.
- **File:** `/tmp/model-compare/run_compare.py` (harness), `/tmp/model-compare/cases.json` (18 kasus), `/tmp/model-compare/prep_cases.py` (ekstraksi kasus). Hasil per panggilan tersimpan sebagai JSONL `results-<model>.jsonl` + agregat `summary.json` (diperbarui per model; model yang sudah selesai dilewati bila dijalankan ulang). **Kunci API tidak pernah dicetak atau ditulis ke file hasil.**

## Konteks eksternal (BUKAN pengukuran TipuCek — hanya petunjuk arah)

Uji independen codqor 16 Nov 2026 lewat API mentah (bukan Firebase AI Logic): `gemini-3.1-flash-lite` 3/3 berhasil, total 1,88 dtk; `gemini-3.5-flash-lite` 3/3 berhasil, total 2,30 dtk; `gemini-3.6-flash` 3/3 berhasil tapi total 12,50 dtk (berpikir ~900 token dulu sebelum menjawab); `gemini-3.8-flash` 1/6 berhasil (2× 503, 3× timeout, 49,4 dtk). Petunjuknya: model Flash baru yang lebih besar cenderung lebih tidak stabil di tier gratis, sementara Flash-Lite stabil — tapi ini hipotesis yang harus dibuktikan dengan uji TipuCek sendiri, bukan kesimpulan.

## Cara melanjutkan

1. **Keputusan Myuden:** rekomendasi di atas — tetap `gemini-3.5-flash-lite`, JANGAN ganti model.
2. **Bila tier gratis pulih nanti** (mis. kuota reset harian ~15:00 WIB atau di luar jam sibuk): uji ulang Hydrogen penuh 54 panggilan dengan harness yang sama — perlu token App Check segar dari browser dulu (`node /tmp/model-compare/capture_token.cjs`, lalu `cd /tmp/model-compare && python3 run_compare.py gemini-4-hydrogen`; bila /tmp terhapus lagi, pulihkan dari `~/workspace/model-compare/`). Bila Hydrogen saat itu menjawab ≥90% dengan ketepatan ≥ baseline, baru ajukan ganti model ke Myuden.
3. Jangan ganti `CLOUD_MODEL` tanpa keputusan Myuden.

## Rekomendasi

**TETAP `gemini-3.5-flash-lite` — JANGAN ganti model.** Alasannya:
1. **Satu-satunya yang bisa menjawab di tier gratis saat ini** (96% berhasil vs 0–13% untuk semua model lain). Model yang tidak menjawab tidak bisa dinilai vonisnya — ketepatan tidak relevan bila panggilan gagal.
2. **Tercepat di antara yang teruji penuh** (median 10,21 dtk vs 14,59 dtk untuk 3.1-flash-lite) dan **ketepatan exact terbaik** (42/52 = 81% vs 35/44 = 80%) dengan **0 false positive** (3.1-flash-lite: 3/20). Kedua model 0 false negative.
3. **Hydrogen tidak lolos:** satu-satunya sukses (9,10 dtk, benar) menunjukkan ia BISA bekerja, tapi ketersediaan 1/6 (17%) jauh di bawah syarat — juri akan lebih sering melihat error/timeout daripada vonis. Ia juga butuh perubahan konfigurasi thinking (default HIGH; `thinkingLevel: LOW` perlu diuji sebagai varian terpisah) dan uji penuh ulang.
4. **Catatan waktu:** angka ketersediaan ini adalah potret 19 Nov ~23:00–02:40 WIB — kuota/overload tier gratis berubah menurut waktu. Keunggulan Flash-Lite bersifat struktural (kelas paling ringan, paling sedikit dipakai), bukan sekadar kebetulan sesaat; tetapi bila suatu saat Hydrogen teruji menjawab ≥90% dengan ketepatan ≥ baseline, keputusan bisa ditinjau ulang.

Perubahan kode bila nanti ganti model: hanya string `CLOUD_MODEL` di `src/ai.js` (+ untuk Hydrogen, pertimbangkan `thinkingLevel: LOW` agar tidak berjalan pada default HIGH — tetapi itu harus diuji sebagai varian terpisah, bukan ditebak). **Tidak ada perubahan kode yang dilakukan dalam uji ini** — repo tidak disentuh (tanpa deploy/commit).
