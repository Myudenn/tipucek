# SETUP-MYUDEN — Cara Menghubungkan Firebase ke TipuCek

Panduan ini untuk Myuden. Semua langkah dilakukan di browser / Firebase
Console — **tidak ada password yang perlu dikirim ke siapa pun**, dan
jangan pernah menempel kredensial apa pun di chat.

Waktu yang dibutuhkan: sekitar 15–20 menit. Gratis (pakai tier gratis
Firebase + Gemini Developer API).

## 1. Buat project Firebase

1. Buka https://console.firebase.google.com/ dan login dengan akun Google kamu.
2. Klik **Add project** (atau **Create a project**).
3. Nama project: `tipucek` (bebas, tapi ini yang rapi).
4. Google Analytics: boleh dimatikan (tidak dibutuhkan) — klik Continue
   sampai project selesai dibuat, lalu klik **Continue** / buka project.

## 2. Daftarkan aplikasi Web

1. Di halaman utama project, klik ikon Web (`</>`) — **Add app**.
2. Nickname aplikasi: `TipuCek Web`.
3. **Jangan** centang "Also set up Firebase Hosting" (tidak perlu).
4. Klik **Register app**. Akan muncul kode config seperti ini:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "tipucek.firebaseapp.com",
     projectId: "tipucek",
     storageBucket: "tipucek.firebasestorage.app",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc..."
   };
   ```
5. Salin nilai-nilai itu ke file `.env.local` di repo TipuCek
   (salin `.env.local.example` dulu), dengan nama variabel
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
   `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`,
   `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.
   **`.env.local` sudah di-`.gitignore` — tidak akan pernah ikut
   ter-commit ke repo publik.** Kode membaca config dari sana
   (`src/firebase-config.js`); placeholder `YOUR_...` berarti Demo mode.

## 3. Aktifkan AI Logic (ini yang memberi "otak" AI-nya)

1. Di menu kiri Firebase Console, cari **Build → AI Logic** (atau ketik
   "AI Logic" di kotak pencarian atas).
2. Klik **Get started**.
3. Saat ditanya backend/API, pilih **Gemini Developer API** (bukan Vertex
   AI — yang ini gratis dan paling sederhana).
4. Ikuti wizard sampai selesai. Tidak ada kartu kredit yang diminta
   untuk pemakaian dalam batas gratis.

Catatan: model cloud yang dipakai aplikasi adalah
`gemini-3.5-flash-lite` (sudah ditulis eksplisit di `src/ai.js`). Kalau
suatu hari Firebase mengganti nama model default, aplikasi tetap memakai
nama ini sampai diubah manual.

## 4. Aktifkan Anonymous Authentication (untuk riwayat)

1. Menu kiri: **Build → Authentication** → tab **Sign-in method**.
2. Cari **Anonymous**, klik, aktifkan (**Enable**), lalu **Save**.
3. Tanpa ini, riwayat tetap jalan — tapi hanya tersimpan di localStorage
   browser, bukan di Firestore.

## 5. Buat database Firestore (untuk riwayat)

1. Menu kiri: **Build → Firestore Database** → **Create database**.
2. Lokasi: pilih yang terdekat, mis. `asia-southeast1 (Singapore)`.
3. Mode: **Start in production mode** (nanti atur rules), atau test mode
   untuk coba-coba.
4. Rules yang disarankan untuk demo (di tab **Rules**):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /checks/{docId} {
         allow create, read: if request.auth != null;
         allow update, delete: if false;
       }
     }
   }
   ```
   Artinya: hanya pengguna login anonim yang bisa menulis/membaca riwayat
   mereka sendiri, dan tidak bisa mengubah/menghapus.

## 6. App Check (opsional tapi disarankan)

App Check melindungi API key dari penyalahgunaan oleh situs lain.

1. Menu kiri: **Build → App Check**.
2. Pilih aplikasi Web TipuCek → **Register**.
3. Provider: **reCAPTCHA Enterprise** (disebut "Fraud Defense" di
   console). **Jangan pilih reCAPTCHA v3 klasik — formnya sudah
   dinonaktifkan di console.**
   - Buka Google Cloud Console → Security → reCAPTCHA Enterprise,
     buat key baru: label `TipuCek`, tipe **Website, score-based**,
     domain: `localhost` + domain hosting kamu nanti.
   - Salin **Site key** ke `VITE_FIREBASE_APPCHECK_SITE_KEY` di
     `.env.local`.
4. Untuk testing di localhost: aplikasi sudah mengaktifkan
   `FIREBASE_APPCHECK_DEBUG_TOKEN = true` secara otomatis saat jalan di
   `localhost` — buka console browser (F12), salin debug token yang
   tercetak, lalu daftarkan token itu di Firebase Console → App Check →
   tab **Manage debug tokens**. (Token debug TIDAK BOLEH di-hardcode di
   kode — aplikasi tidak melakukannya.)

**Catatan penting (pelajaran 19 Nov 2026):** domain live WAJIB ada di
daftar domain key reCAPTCHA Enterprise. Key TipuCek terdaftar dengan
domain `localhost`, `tipucek.web.app`,
`tipucek.firebaseapp.com` — kalau domain live tidak ada di
daftar ini, pemeriksaan AI gagal dengan error App Check.

## 7. Uji

```bash
npm install
npm run dev
```

Buka http://localhost:5173 — banner "Demo mode" harus **hilang** dan
diganti label "AI mode". Klik salah satu contoh → **Check message** →
kartu hasil muncul dengan badge `ON_DEVICE` (model sudah terunduh) atau
`IN_CLOUD`, dan riwayat tersimpan.

- Kalau muncul badge `Unknown`: baca laporan builder — `inferenceSource`
  tidak dikembalikan SDK; itu dicatat sebagai masalah yang diketahui.
- Kalau check gagal saat offline: itu normal — model on-device harus
  sudah terunduh sekali saat online.

## 8. Yang TIDAK boleh dilakukan

- Jangan pernah kirim API key / password / token apa pun lewat chat.
- Jangan pernah commit `.env.local` ke repo publik — file itu berisi
  config asli dan sudah di-`.gitignore`. (Config TIDAK lagi ada di
  `src/firebase-config.js` — file itu hanya membaca `.env.local`.)
- Jangan ubah model cloud di `src/ai.js` tanpa mencatatnya — nama model
  ditulis eksplisit karena ada dua versi nama di dokumentasi.

## 9. Deploy ke Firebase Hosting (uji live)

Cloud browser tidak bisa menjangkau localhost VM, jadi aplikasi harus
di-deploy dulu ke Hosting baru bisa diuji live.

**URL live:** https://tipucek.web.app
(juga https://tipucek.firebaseapp.com)

**Status 19 Nov 2026 — LIVE dan pemeriksaan AI LOLOS.**
- Deploy pertama 19 Nov ~08:38 WIB (11 file, tier Spark gratis).
- Login CLI Firebase berhasil sebagai fauzanzy1@gmail.com (sesi
  `93165`, `XDG_CONFIG_HOME=/tmp/firebase-config` — wajib, karena
  chown di /home/hatch diblokir).
- `firebase-tools` 15.37.0 di `~/workspace/tools/firebase-tools/`
  (bukan global, supaya tahan restart VM).
- `firebase.json` + `.firebaserc` ada di repo (project
  `tipucek`, Hosting menyajikan folder `dist`, SPA rewrite ke
  `/index.html`).

**Perintah deploy:**
```bash
export PATH="$HOME/workspace/tools/firebase-tools/node_modules/.bin:$PATH"
export XDG_CONFIG_HOME=/tmp/firebase-config
firebase deploy --only hosting --project tipucek
```
(Login ulang bila sesi habis: `firebase login --no-localhost`, buka URL
yang dicetak di browser, login sebagai fauzanzy1@gmail.com, tempel kode
otorisasi kembali ke terminal.)

**Masalah App Check 401 — SUDAH TERATASI 19 Nov ~09:05 WIB.**
Gejala: semua pemeriksaan AI gagal dengan `401 Firebase App Check
token is invalid`, padahal site key, domain, dan appId sudah cocok.
Akar masalah ada di kode, bukan di console: modul riwayat
(`src/history.js`) membuat aplikasi Firebase duluan saat halaman
dimuat (Firestore + anon auth), dan `getFirebaseApp()` di `src/ai.js`
punya early-return `if (getApps().length > 0) return getApp()` yang
melewatkan `initializeAppCheck` sepenuhnya — App Check tidak pernah
aktif, token tidak pernah dibuat. Perbaikan (commit `5ba10d0`):
App Check diinisialisasi pada aplikasi yang sudah ada juga, ditambah
pre-flight `getToken()` dengan pesan galat yang jelas. **Uji live
sesudah perbaikan: Scam 100/100, badge IN_CLOUD, riwayat tersimpan di
Firestore.**

**Checklist uji live (setelah deploy):**
- Buka URL live — halaman termuat, banner "Demo mode" harus HILANG
  (diganti label "AI mode").
- Contoh pesan penipuan → verdict Penipuan + skor tinggi (live: 100/100)
  dengan badge `ON_DEVICE` atau `IN_CLOUD`.
- Contoh pesan aman → verdict Aman + skor rendah (lokal: 0/100).
- Riwayat tersimpan (Firestore / localStorage).
- Tidak ada console error yang fatal (F12 → Console).
