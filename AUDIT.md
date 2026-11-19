# TipuCek — AUDIT.md (rombak besar-besaran, 19 Nov 2026)

Audit yang terverifikasi dan jelas (perintah Myuden): tidak ada
perubahan yang dianggap selesai tanpa bukti yang bisa dicek ulang.
Setiap item: LOLOS / GAGAL + bukti (perintah, file:baris, screenshot,
log). Bila ada item GAGAL, ditulis GAGAL + sebabnya — tidak ditutupi.

- Proyek: TipuCek (dulu PesanAman) — #BuildHybridAI, deadline submit
  Devpost 1 Des 2026 05:00 WIB.
- Situs live: https://pesanaman-80d63.web.app (URL/proyek Firebase
  tetap pesanaman-80d63; repo tetap github.com/kyleweb3/pesanaman).
- **Pembaruan 19 Nov 2026 ~14:20 (koordinator perbaikan serius):
  audit ini dibuat saat proyek masih pesanaman-80d63. Sejak itu alamat
  live pindah ke https://tipucek.web.app (proyek Firebase baru
  "tipucek"), repo pindah ke https://github.com/kyleweb3/tipucek,
  dan cache service worker naik ke `tipucek-v5`. Isi audit di bawah
  adalah catatan historis saat itu — angka-angka run test di dalamnya
  tetap berlaku untuk build yang diaudit.**
- Build yang diaudit: `dist/` DEMO (tanpa `.env.local` — config
  Firebase dipindah sementara ke `/tmp/.env.local.moved` supaya
  verifikasi lokal deterministik; badge DEMO, heuristik lokal).
  Build produksi (dengan config) dibuat terakhir, setelah semua
  verifikasi — lihat §F.
- Cara baca: "koordinator" = penulis rombak; "pemeriksa independen"
  = 4 subagen read-only (audit, i18n, PWA+SEO, responsif) yang
  bekerja paralel atas perintah Myuden 19 Nov ~12:54 dan melaporkan
  temuannya — termasuk temuan yang memaksa perbaikan (§K).
- Standar: "Buat dengan serius" (Myuden 19 Nov ~12:20) — TELITI,
  DETAIL, EFISIEN, SEMPURNA; kualitas di atas kuantitas.

## A. Rename PesanAman → TipuCek — LOLOS

| Pemeriksaan | Hasil | Bukti |
|---|---|---|
| `grep -rn "PesanAman" src/ index.html public/ *.md` (kapital) | LOLOS, 0 temuan | audit independen §1; `git grep` ulang koordinator |
| Teks UI live: 0 "PesanAman" di `body.innerText` | LOLOS | suite run 19–23, cek "0 PesanAman in UI text" |
| Title/hero/meta/OG/Twitter/JSON-LD | LOLOS | `TipuCek — Scam-Message Scanner \| Cek Pesan Penipuan` (index.html:16,27,39,53) |
| manifest name/short_name | LOLOS | `TipuCek — Scam-Message Scanner` / `TipuCek` |
| sw.js cache | LOLOS | `tipucek-v4` (naik dari v1 → v2 → v3 → v4 tiap perubahan aset) |
| Tagline 8 bahasa | LOLOS | i18n: EN "Check the message before you trust it", ID "Cek pesannya sebelum kamu percaya", ES/FR/DE/PT/JA/ZH terverifikasi benar |
| Nama asisten tetap Aman | LOLOS | header, panel "Ask Aman", chat, suara, prompt AI, i18n 8 bahasa — semua "Aman"; tidak ada nama lain |

Sisa "pesanaman" (huruf kecil) yang DIBOLEHKAN: URL
`pesanaman-80d63.web.app`, repo `github.com/kyleweb3/pesanaman`,
kunci localStorage `pesanaman_history_v1` + `pesanaman_lang`
(dipertahankan supaya riwayat/bahasa pengguna lama tidak hilang),
debug hook `window.__pesanamanLastTts`, `package.json` name
"pesanaman" (ID paket/proyek, bukan merek). Sisa lain yang
dibersihkan saat audit: komentar `.env.local.example:1`
("PesanAman" → "TipuCek"); judul "Safe Message" diganti
"Scam-Message Scanner" (arti nama lama, bukan nama baru).
Naskah video v3/v4 + skrip build lama di `video/` masih menyebut
PesanAman — sengaja tidak diubah (arsip); video v5 menggantikannya.

## B. Fitur baru — semua LOLOS (dengan perbaikan audit, §K)

Setiap fitur: jalan sesuai klaim, tanpa error JS, diuji Playwright
desktop 1280×800 + mobile 390×844 (suite `video/verify-rombak.cjs`,
run 23: **76/76 lolos**, exit 0) + unit test
(`tests/unit.test.mjs`, **43/43 lolos**).

| Fitur | Bukti uji |
|---|---|
| File check (magic bytes + SHA-256 lokal) | APK fixture (ZIP + AndroidManifest.xml + classes.dex) → apk/high; EXE (MZ) → exe/high; teks → unknown/low; SHA-256 "abc" cocok vektor; ZIP bit-3 (data-descriptor) → apk/high + archive-prog/high (unit test baru, audit B3) |
| Kontak resmi (16 entri) | filter bank = 5, cari case-insensitive jalan; nomor terverifikasi via pencarian web (BCA 1500888, BRI 1500017/14017, Mandiri 14000, BNI 1500046, BSI 14040, OVO 1500696, DANA 1500445, Shopee 1500702, OJK 157 + WA 081157157157, Telkomsel 188, Indosat 185, XL 817, Polisi 110). GoPay/Tokopedia/LinkAja: nomor bertentangan/tidak ada → dicantumkan "via aplikasi" TANPA nomor |
| First-aid interaktif (4 skenario × 3 langkah) | Playwright: skenario tampil + langkah tampil; disclaimer bukan nasihat hukum/keuangan |
| Chatlog (ekspor WhatsApp .txt) | Android + iOS (bracket tanpa dash — bug lama diperbaiki) ter-parse; sistem line dilewati; batas 2 MB diukur dalam BYTE (unit test CJK, audit B8); 3 pesan → 1 risky |
| Outbound guard (cek sebelum kirim) | OTP+password+rekening terdeteksi + ter-mask; harga "Rp 100000" BUKAN OTP; nomor HP BUKAN rekening; tahun "2026" BUKAN OTP; solid-16 = KTP, grouped-16 = kartu (unit test, audit B1/B2/B11) |
| Laporan komunitas (hash-only) | Firestore `reports`: hanya {kind,count,firstSeen,lastSeen} kunci hash; tulis hanya auth + App Check + throttle klien; tombol Laporkan eksplisit; hitungan tampil bila cocok |
| Lacak tautan/domain (RDAP + short-link) | bit.ly → "cannot be traced" (CORS, jujur); RDAP tampil tanggal + registrar; domain baru = sinyal merah; di-gate local-only (lihat §D) |
| Kuis tebak penipuan (8 soal ID+EN) | Q1 scam + Q2 safe dijawab benar, skor 2/2; penjelasan = "why" kurasi (audit B6); id soal string q1..q8 unik (audit B5) |
| Cek email phishing | BCA asli → safe/0; spoof Gmail → suspicious/50 (mismatch 30 + free-mail 20); "Abcabc" BUKAN mismatch (audit B7) |
| Cek panggilan telepon | sapaan → safe/0; bank+OTP+ancaman → scam/85 LOCAL; gate laporan (lihat §D) |
| Tempel sekali ketuk | clipboard terisi + cek otomatis jalan; fallback fokus + catatan bila izin ditolak |
| Mode orang tua | toggle tersimpan di localStorage; teks/tombol besar; "Cek pesan ini"; hasil dibacakan (speakNow); note tampil |
| Peringatan keluarga satu ketuk | wa.me/api.whatsapp.com + teks terisi (TipuCek + verdict + red flags, bahasa UI) |
| Laporan PDF sekali ketuk | window.print() dipanggil; seksi cetak berisi verdict + skor + flags + nomor + tanggal-jam; `.print-only` tersembunyi di layar |

## C. HP + PC + PWA — LOLOS (2 catatan jujur)

- Responsif (pemeriksa independen, 4 kombinasi terang/gelap ×
  390/1280): overflow horizontal **0px di 60/60 titik ukur**;
  semua tombol ≥44px (Cek pesan 177×44, Tempel 62×44, tab
  137–182×44, kirim chat 95×50); semua input 16px setelah
  perbaikan (sebelumnya 6 input 15,2px/13,33px — audit responsif
  §3; perbaikan: `font-size: 16px` di aturan dasar textarea +
  `.checker-tab input` + `.assistant-input-row input` +
  `.contacts-controls input`). Input file tersembunyi
  (filecheck/chatlog) terukur 13,33px — BUKAN cacat: elemen
  `hidden` tidak pernah menerima fokus, iOS tidak men-zoom.
- PWA (pemeriksa independen): manifest TipuCek + `display:
  standalone` + `theme_color #1a56db` + ikon 192/512/maskable +
  apple-touch-icon 180 (semua turunan avatar robot baru, hash
  terverifikasi); SW terdaftar + aktif, cache `tipucek-v4`
  berisi shell + **semua ikon** (perbaikan: ikon masuk precache);
  `/aman.png` yang disajikan = robot baru (SHA-256
  `1e575bc2…58f`, 207.939 byte); share_target live LOLOS
  (`?text+url` → textarea terisi + hasil 42/100 Suspicious);
  param `title` kini dipakai bila `text` kosong.
- SEO on-page: title, meta description dwibahasa 383 karakter
  (catatan: SERP menampilkan ~155–160 karakter pertama —
  pembuka sudah memuat inti), canonical, robots meta, OG +
  Twitter (gambar baru `og-image.png` 1200×630, terverifikasi
  visual — teks lengkap, margin kanan 199px), JSON-LD
  WebApplication valid, robots.txt + sitemap.xml HTTP 200.
- Favicon: petir ungu #863bff DIGANTI perisai biru→ungu +
  centang (SVG baru, terverifikasi visual — terbaca jelas di
  ukuran kecil).
- **Catatan jujur 1 — mode standalone TIDAK bisa dibuktikan
  headless**: `matchMedia('(display-mode: standalone)')` tetap
  `false` lewat CDP di semua kombinasi; kriteria install
  (manifest + SW + ikon + HTTPS) semuanya terpenuhi, tapi
  tampilan standalone live butuh uji instalasi nyata
  (Add to Home Screen) di perangkat — jangan klaim
  "standalone terverifikasi" sebelum itu.
- **Catatan jujur 2 — Search Console / indeks Google BELUM**:
  situs belum terindeks (site: → 0 hasil); Search Console butuh
  browser + login Google (tugas agen browser, setelah deploy
  final dengan nama TipuCek).

## D. Privasi — LOLOS setelah perbaikan (1 GAGAL audit → DIPERBAIKI)

| Poin | Hasil | Bukti |
|---|---|---|
| (a) addDoc `checks` tanpa message mentah | LOLOS | `src/history.js:116-128` — field eksplisit status/riskScore/redFlags/summary/source/createdAt/ownerUid; audit independen (a) LOLOS |
| (b) Toggle local-only (default ON) lewati Firestore | LOLOS | `history.js:29-35` default true; `:105` return "local" sebelum Firestore; toggle `main.js:1163-1167`; suite: 0 request Firestore saat cek pertama |
| (c) Lookup hash + lacak tautan hormati local-only | **GAGAL (audit) → DIPERBAIKI → LOLOS** | Lihat bawah |
| (d) Riwayat per-pengguna (ownerUid) | LOLOS | `history.js` ownerUid + `firestore.rules` create/read `ownerUid == auth.uid`, update/delete false |
| Aturan `checks` batasi field (defense in depth) | LOLOS (ditambah saat audit) | `firestore.rules`: `keys().hasOnly([status, riskScore, redFlags, summary, source, createdAt, ownerUid])` — alasan: bila suatu saat klien mengirim `message`, rules menolak. Perubahan rules dilaporkan di sini sesuai perintah |
| Alur demo juri | LOLOS | cek → riwayat tampil lengkap (salinan lokal berisi pesan lengkap) → reload → tetap lengkap (suite: history tampil + reload) |

**Temuan (c) — rincian + perbaikan.** Audit independen menemukan
3 jalur lookup TANPA gate `isLocalOnly()`, bertentangan dengan
janji UI "When on, checks are never sent to the cloud":
1. handler filecheck (`main.js`, dulu ~1078):
   `getReportCount(info.sha256)` otomatis tiap cek file.
2. `analyzeCall` (`callcheck.js:58-59`): hash nomor + lookup
   tiap cek panggilan.
3. `enrichResult` bagian link-track (`main.js`, dulu 464-491):
   `resolveShortLink` (fetch ke shortener) + `lookupDomain`
   (fetch ke rdap.org) tiap hasil cek.
Perbaikan (19 Nov, terverifikasi ulang):
1. filecheck: `if (info.sha256 && !isLocalOnly())` — tidak ada
   hitungan + tidak ada request saat local-only ON.
2. `analyzeCall(..., { allowReports })` — default `false`;
   UI memanggil dengan `allowReports: !isLocalOnly()`.
   Unit test: default → reportCount null, skor pola 85, Scam;
   `allowReports:true` di demo (tanpa Firebase) → tetap null,
   skor sama.
3. link-track: `if (trackEl && !isLocalOnly())` — kotak tetap
   kosong saat local-only ON.
Verifikasi ulang (suite run 23, 76/76): "privacy: link-track
stays empty while local-only is ON" LOLOS; "track: link-track
box fills when local-only is OFF" LOLOS (RDAP terisi setelah
toggle dimatikan + cek ulang). Satu-satunya lookup yang sudah
benar sejak awal adalah hitungan laporan di `enrichResult`
(`!isLocalOnly()`, `main.js:451`). Tombol "Laporkan" eksplisit
tetap tanpa gate — ketukan = persetujuan pengguna.
**Sisa yang butuh uji live pasca-deploy** (tidak bisa dibuktikan
di build demo): tulis Firestore `reports` nyata + hitungan
muncul; uji dua sesi privasi ownerUid (A tulis, B tidak boleh
baca); App Check debug token. Dicatat sebagai utang di §L.

## E. Klaim deskripsi — LOLOS setelah tulis ulang

Audit independen menemukan DEVPOST + README kedaluwarsa dan
bertentangan dengan kode (7 poin Devpost + 5 poin README:
Firestore-default, roaming, avatar anime, "Safe Message",
klaim absolut "never leaves device", "no link is followed",
"What's next" komunitas yang sudah dibangun, skor 99/100 yang
tidak dapat dipin). **DIPERBAIKI**: DEVPOST-DESCRIPTION.md
(251 baris) + README.md (294 baris) ditulis ulang penuh oleh
penulis dokumen (subagen) dari fakta terverifikasi + dicek ulang
koordinator: grep "PesanAman"/"roaming"/"anime"/"Safe Message"/
skor spesifik = BERSIH (hanya URL resmi). Klaim privasi ditulis
tepat: janji soal PENYIMPANAN (pesan tidak pernah tersimpan di
cloud; hanya verdict yang disinkronkan, opt-in) — BUKAN soal
input inferensi (fallback cloud mengirim pesan ke Gemini untuk
verdict; badge menunjukkan di mana ia dihitung). Benchmark
dikutip dengan label jujur "local-rules demo, bukan akurasi AI".
Meta description situs LOLOS (ringkas, tidak melebih-lebihkan).

## F. Build + tes — LOLOS

- `npm run build`: LOLOS (2,02 dtk, 46 modul; dist utama
  ~199–241 kB).
- `node --check`: LOLOS untuk 19 file `src/*.js` + semua file
  yang diubah/dibuat (audit independen memverifikasi 19/19).
- Unit test `tests/unit.test.mjs`: **43/43 LOLOS** (dari 25 —
  18 test baru untuk perbaikan audit: outbound FP ×3, KTP/kartu,
  bare-code, maskDigits kosong, ZIP bit-3 ×2, domain ×2, quiz id,
  email brand ×2, call gate ×2, chatlog byte-limit + system line).
- Benchmark aturan lokal `tests/benchmark-local-rules.mjs`:
  **14/14 flagged, 0 false positive, 0 false negative**,
  rerata skor scam 49,4 vs aman 7,7 — LABEL: aturan lokal DEMO
  (analyzeWithHeuristic), BUKAN akurasi AI; ambang "flagged"
  ≥30 (suspicious), bukan ambang scam ≥60.
- Playwright `video/verify-rombak.cjs` (desktop 1280×800 +
  mobile 390×844, via proxy lokal + vite preview):
  run 19/20/21 **75/75**, run 22 **74/75** (1 gagal: link-track
  kosong — ternyata perilaku BENAR setelah gate privasi,
  ekspektasi test kedaluwarsa), run 23 **76/76** (setelah
  perbaikan test: gate diuji dua arah).
- Avatar `video/verify-avatar.cjs`: **16/16 LOLOS** (2 run).
- Desain `video/verify-design.cjs`: **28/28 LOLOS** (3 run).
- **Build produksi**: `.env.local` dikembalikan dari
  `/tmp/.env.local.moved`, `npm run build` diulang dengan
  config — grep `dist/`: 0 "PesanAman" di JS/CSS/HTML;
  keenam nilai config Firebase terisi nilai nyata
  (apiKey, appId, projectId `pesanaman-80d63`, authDomain,
  messagingSenderId, appCheckSiteKey reCAPTCHA Enterprise);
  satu-satunya string "YOUR_" di bundle adalah literal
  fallback di objek config sumber (`|| 'YOUR_API_KEY'` …)
  yang tidak pernah dipakai saat runtime karena nilai env
  ada. `dist/` kini build PRODUKSI — bila suite dijalankan
  ulang terhadapnya, perilaku AI akan mencoba jalur cloud
  (App Check), bukan DEMO; untuk verifikasi ulang, pindahkan
  lagi `.env.local` dan rebuild demo.

## G. Roaming #aman-roam — DIHAPUS (terbukti menghalangi)

Perintah Myuden 19 Nov ~12:34: uji apakah roamer menutupi
tombol/teks/konten saat bergerak (beberapa posisi, HP 390px +
PC 1280px). Probe `video/probe-roam.cjs` (sampel tiap 400ms,
idle 24 dtk + near 12 dtk + scrolled 12 dtk, `elementsFromPoint`
— probe pertama cacat karena `elementFromPoint` mengembalikan
roamer sendiri; diperbaiki): **240 sampel — roamer menutupi
konten di kedua perangkat, semua fase**. Desktop idle: 20 posisi
berbeda, 13 sampel menutupi elemen interaktif (textarea
#message-input 2×, tab email 1×, label field). Mobile near
(paling fatal): parkir TEPAT DI ATAS cincin skor — 119/150
titik menutupi `.ring-value` "100/100", 30/30 sampel.
Bukti visual: `video/raw/roam-mobile-near-1.png` (avatar
menutupi angka "1" dari "100"). **Penghapusan selesai 19 Nov
~12:36**: `src/assistant.js` (seluruh blok roaming +
`initRoaming()`), `src/main.js` (import + 5 call site
`roamNear`), `index.html` (tombol #aman-roam), `src/styles.css`
(blok `.aman-roam` + keyframes). Nol referensi "roam" di
`src/` + `index.html` + `dist/` (grep 0). Avatar Aman statis
(panel asisten + chat Ask Aman) TIDAK tersentuh. Verifikasi
ulang: 0 elemen `position:fixed` di 4 titik scroll × 4
kombinasi; `elementsFromPoint` di tombol cek/tempel mengenai
tombolnya sendiri (pemeriksa independen). VIDEO-SCRIPT v4
menyebut roaming — draf v5 menghapusnya.

## H. Avatar — FINAL: Robot Perisai + Bintang (nama Aman tetap)

Rantai keputusan Myuden 19 Nov 12:40–12:51: Orb gaya vAPI →
Orb-web (biru #1a56db, terang) → **Robot Simple** (dipasang
12:43, sw cache v2) → kandidat Robot-Logo (TIDAK dipasang,
menunggu pilihan) → **FINAL: Robot Perisai + Bintang**
(dipasang 12:51, sw cache v3). File:
`aman-baru/media-generation-aman-baru-robot-perisai-bintan-0-4dfa7d6f-8d81-45ee-8a9e-c0ca97d73e32.webp`
(perhatikan ejaan "bintan") — WebP valid 84.176 byte,
1600×1600, piksel tengah (70,62,213). `public/aman.png` =
perisai-bintan (PNG 1024×1024, **sha256
`1e575bc271e30f387a4c8f1557d4ef78e900ba0a944c1ec237d86bf79901658f`**,
207.939 byte); ikon diregenerasi (192: 23.007 byte, 512:
85.240 byte, maskable: 61.258 byte, apple-touch: 20.637 byte).
Anime lama disimpan sebagai cadangan
`public/aman-anime.jpg` (file sebenarnya JPEG 1254×1254 —
nama diperbaiki dari `.png` saat audit; hanya komentar
`src/assistant.js:7` yang merujuknya; tidak ditampilkan di
mana pun). Kandidat lain (orb, robot simple, robot-logo, robot
garis, kaca pembesar) TIDAK dipakai. **Nama asisten TETAP Aman**
(keputusan Myuden 19 Nov ~12:51) — semua teks memakai "Aman".
Keterbacaan 88px DILIHAT LANGSUNG (4 kombinasi terang/gelap ×
desktop/mobile, diperbesar 3×): perisai + robot + centang
terbaca jelas; bintang hiasan kecil. Verifikasi avatar 16/16.
Favicon baru: perisai biru→ungu + centang (menggantikan petir
ungu #863bff); OG image baru `og-image.png` 1200×630
(terverifikasi visual, teks lengkap).

## I. Desain — kartu bersih ala vAPI, biru #1a56db — LOLOS

Arah Myuden 19 Nov ~12:47 (tangkapan layar vAPI Network
Discover): kotak kartu putih bersih, garis tipis, angka besar,
minimal — dengan aksen biru TipuCek #1a56db, BUKAN oranye vAPI
(orisinalitas; vAPI adalah pasar API berbayar x402, BUKAN
asisten AI — Aman tetap Firebase AI Logic). Diterapkan di
`src/styles.css`: radius 16px → 12px; shadow jadi hairline
tunggal; skor cincin 1.5rem → **2.1rem**; status hasil 2rem →
**2.4rem** (senior 2.8rem); border-top kartu 5px → 4px;
`.how-grid` auto-fit minmax(200px,1fr); `.how-num` 1.9rem biru.
Hero gradien biru→ungu TETAP (brand sendiri). Verifikasi desain
28/28 (desktop/mobile × terang/gelap: tanpa overflow, cincin
33.6px, status 38.4px, nomor langkah 30.4px, aksen biru
rgb(26,86,219) terang / rgb(107,155,255) gelap, 0 page error).
**Cacat yang ditemukan pemeriksa independen + DIPERBAIKI**:
angka langkah How terpotong di 4/4 kombinasi — override restyle
tidak mereset `width:32px;height:32px;border-radius:50%;
background:gradient` dari aturan dasar, sehingga angka 1.9rem
dipaksa masuk lingkaran 32px. Perbaikan: override kini mereset
keempat properti (`width:auto;height:auto;background:none;
border-radius:0`). Diverifikasi visual (screenshot
`design-desktop-light-how.png` run 3): angka 1, 2, 3 biru
besar, utuh, tanpa lingkaran.

## J. Riset pesaing + matriks juri (jujur)

Riset web pemeriksa penipuan (11 utama + 3 tambahan, dari
situs/GitHub/Play Store mereka) + riset galeri Devpost
#BuildHybridAI (galeri resmi BELUM dipublikasikan saat dicek
19 Nov ~12:33; riset lewat galeri software Firebase Devpost
halaman 4 + halaman proyek + GitHub). Proyek yang dibaca
mendalam: SafeText, Paperlight, SafePaste AI, Ghost Charges,
Hybrid Incident Analyzer, NoteForge, SHTV24, IBITI Guardian.

| Kriteria juri | TipuCek | Pesaing terkuat | Di mana TipuCek KALAH |
|---|---|---|---|
| Implementasi teknis | Hybrid on-device→cloud (badge jujur), OCR, file magic bytes + SHA-256 lokal, RDAP, hash-only reports, 43 unit + 76 Playwright + 28 desain | SafeText: benchmark 16/18 verdict tepat, 0 error cloud; Paperlight: privacy receipt + leak gate + 42 unit + 8 rules test + 20 e2e; SafePaste: zero-leakage pipeline + verifyZeroLeakage + Network Inspector | **Tanpa benchmark AI terpublikasi** (hanya benchmark aturan lokal 14/14); **tanpa privacy receipt / network inspector** (dipotong karena scope); **tanpa test rules Firestore terpublikasi**; **tanpa verifikasi on-device di Chrome desktop sungguhan** |
| Desain | Kartu bersih ala vAPI (biru #1a56db), angka besar, 8 bahasa, HP+PC, PWA, mode orang tua | NoteForge: provenance badges per generasi; SafeText: Vite+TS | Mode standalone belum terbukti live (headless); kuis fallback Inggris untuk 6 bahasa |
| Dampak | Gratis, Indonesia-first (kontak resmi, aduannomor.id, cekrekening.id, OJK), file/APK, ekspor chat, outbound guard, first-aid, peringatan keluarga, laporan PDF | ScamScan.in: direktori resmi India; Trend Micro: Family Circle + Call Block; ScamAdviser: Trust Score | Jangkauan geografis sempit (Indonesia-first adalah pilihan, bukan kecelakaan — tapi juri global mungkin menilai luas) |
| Kualitas ide | Kombinasi yang tidak dimiliki pesaing mana pun sekaligus: gratis + Indonesia + on-device-first + file/APK + outbound guard + hash-only community reports + mode orang tua | Masing-masing pesaing unggul di SATU hal (voice scan, galeri/kuis, tren, QR, blocklist) | Tiap fitur satu per satu sudah dimiliki ≥1 pesaing — keunggulan adalah KOMBINASI, bukan fitur tunggal |

Yang DITERAPKAN dari riset galeri: unit test suite (25→43),
benchmark aturan lokal 14/14, restyle How, dokumentasi routing
per-tugas (OCR + chat = cloud-only, cek pesan =
PREFER_ON_DEVICE, outbound/email/call/chatlog = local-only).
Yang DIPOTONG (dengan alasan): privacy receipt / network
inspector lengkap (scope; local-only + verdict-only sync sudah
terverifikasi sebagai bukti privasi); arsitektur ulang routing
per-tugas (routing sudah ada implisit, hanya didokumentasikan).
Yang DIPOTONG dari riset web (Fase C): tautan hasil cek anonim
(butuh ubah firestore.rules untuk koleksi publik — saat itu
dilarang; koleksi `reports` hash-only yang akhirnya dibangun
adalah versi aman dari ide ini); deteksi kloning suara dari
rekaman audio (SULIT, tidak disarankan di Spark gratis);
daftar laporan komunitas bernilai mentah (risiko fitnah/
moderasi — diganti hash-only); cek QR, cek umur domain
blocklist, umpan tren (sudah dimiliki pesaing / daftar susulan).

## K. Pemeriksaan independen (4 subagen, read-only) — temuan + tindak lanjut

| Pemeriksa | Hasil | Temuan utama | Tindak lanjut |
|---|---|---|---|
| Audit (kode + klaim + bug) | GAGAL bersyarat | (c) lookup hash tidak hormati local-only; Devpost/README kedaluwarsa; 7 bug logika (B1–B7) + catatan B8–B11 | Semua diperbaiki (§B, §D, §E); unit test 25→43; docs ditulis ulang |
| i18n 8 bahasa | LOLOS | **281 key × 8 bahasa, tepat 1×, 0 duplikat, 0 kosong, 0 key mentah** (statis + live); placeholder konsisten. Koreksi: klaim koordinator "151 key" adalah SUBSET (hanya batch baru), bukan total file | Angka 281 dipakai di AUDIT ini; penulis dokumen menulis "8 bahasa, terjemahan penuh" tanpa angka (aman). Saran minor: register id "Anda" vs "kamu" tidak konsisten (outboundHint vs tagline) — belum diubah; loanword "Marketplaces" di es/pt — wajar, dibiarkan; kuis fallback Inggris untuk 6 bahasa — didokumentasikan (§L) |
| PWA + SEO | LOLOS hampir semua | Favicon petir ungu (brand mismatch); ikon tidak masuk precache SW; param `title` share_target diabaikan kode; `aman-anime.png` sebenarnya JPEG | Favicon diganti perisai; ikon masuk precache (cache v4); `title` dipakai sebagai fallback; file di-rename `.jpg` |
| Responsif HP+PC | HAMPIR LOLOS | Angka How terpotong (4/4 kombinasi); 6 input <16px; standalone tidak terbukti headless | Angka diperbaiki (§I); input 16px (§C); standalone dicatat jujur (§C) |

Semua pemeriksa: read-only penuh, tidak ada file sumber yang
diedit/dicommit/dideploy oleh mereka; `.env.local` tetap
dipindah selama kerja mereka.

## L. Keterbatasan yang diketahui (jujur — bukan celah yang ditutupi)

1. **On-device BELUM terverifikasi di Chrome desktop
   sungguhan.** Chromium VM hanya stub (`LanguageModel`
   "downloadable" tapi `session.prompt()` menggemakan input;
   `availability()` dengan expectedInputs = "unavailable").
   Kode hybrid sudah benar (PREFER_ON_DEVICE + fallback jujur);
   bukti butuh browser induk di Chrome desktop + Gemini Nano
   terunduh. Jangan klaim ON_DEVICE sebelum terbukti.
2. **Mode standalone PWA** belum terbukti live headless (§C).
3. **Verifikasi live pasca-deploy masih menunggu**: badge
   IN_CLOUD, tulis + hitungan `reports`, App Check debug token
   (daftar di console atau deploy pakai kunci Enterprise), uji
   dua sesi privasi ownerUid, uji toggle local-only + alur demo
   juri di situs live, Search Console + sitemap + minta indeks.
4. **Skor model non-deterministik**: contoh yang sama keluar
   95/98/99/100 di run berbeda — narasi/deskripsi HARUS pakai
   angka rekaman final (VIDEO-SCRIPT v5 menandai semua skor
   "update from v5 recording").
5. **Skor heuristik demo bergantung bahasa UI** (sampel hadiah:
   100 en vs 98 id) — jangan pin skor sebagai fakta.
6. **Kuis fallback Inggris** untuk es/fr/de/pt/ja/zh (bank soal
   hanya id+en, didokumentasikan di `src/quiz.js`); chrome UI
   tetap terjemahan penuh.
7. **Chatlog**: nama berakhiran gelar ("Dr: Smith") terpotong
   oleh pemisah ": " — keterbatasan format ekspor itu sendiri.
8. **Call check**: klaim "ini BCA" saja = safe/25 (butuh
   koroborasi OTP/ancaman untuk naik) — keputusan desain,
   bukan bug.
9. **Meta description 383 karakter** — SERP memotong di
   ~155–160 karakter; pembuka sudah memuat inti.
10. **Skor "Development expected score" ≠ rank live** (catatan
    umum make.fun, bukan TipuCek).
11. **Suara tidak bisa diverifikasi dari headless** — di HP
    pengguna seharusnya bersuara bila ada mesin TTS
    (mis. Google Text-to-Speech) dengan voice id-ID/en.
12. **Audit ulang independen 19 Nov ~16:00 (QRIS-hapus +
    suara telepon): LULUS BERSYARAT lalu syarat ditutup.**
    Auditor fresh eyes: 7 contoh 7/7, suara telepon 5/5
    (transkrip asli → Scam 95 IN_CLOUD), privasi LOLOS,
    bundle live sha-identik. Syaratnya: (a) kata "QRIS"
    tersisa 1× di komentar `public/sw.js:5` — dihapus
    (19 Nov ~16:00); (b) hook debug `__pesanamanLastTts`
    2× di bundle — diganti `__tipucekLastTts`.
    Temuan auditor soal `verify-rombak` crash 2× di cek
    pertama TERNYATA bukan bug produk: skrip dijalankan
    terhadap build PRODUKSI (bukan demo), sehingga cek AI
    di localhost memakai App Check debug provider yang
    token-nya tidak terdaftar → 403 → timeout. Bukti:
    run ulang dengan prosedur benar 95/95 (2×). Daftarkan
    satu debug token TIDAK memperbaiki ini — tiap konteks
    Playwright fresh menghasilkan token baru. Perbaikan
    proses: `video/verify-rombak.cjs` kini mengatur
    sendiri build demo (pindah `.env.local`, build, uji,
    kembalikan + rebuild produksi, verifikasi bundle
    produksi ≠ bundle demo) — run 95/95 dengan tarian
    itu terverifikasi 19 Nov ~16:00, lalu deploy ulang
    (bundle `index-Cy5R8RGb.js`, sha
    `2249f633…`) + cek live fresh 18/18 LOLOS.

## M. Bukti (lokasi file)

- Suite utama: `video/verify-rombak.cjs` — log
  `/tmp/verify-rombak-run19.log` … `run23.log` (run 23: 76/76).
- Avatar: `video/verify-avatar.cjs` — screenshot
  `video/raw/avatar-{desktop,mobile}-{light,dark}.png` +
  `avatar-*-88px-3x.png`.
- Desain: `video/verify-design.cjs` — screenshot
  `video/raw/design-{desktop,mobile}-{light,dark}-{result,how}.png`.
- Roaming: `video/probe-roam.cjs`, log `/tmp/probe-roam2.log`,
  `video/raw/roam-mobile-near-1.png`.
- Unit + benchmark: `tests/unit.test.mjs` (43),
  `tests/benchmark-local-rules.mjs` + `.json` (14/14).
- Favicon/OG: `video/raw/favicon-new.png`,
  `video/raw/og-image-check.png`.
- Laporan independen (teks lengkap): `/tmp/report-audit.md`,
  `/tmp/report-i18n.md`, `/tmp/report-pwa-seo.md`,
  `/tmp/report-responsive.md`, `/tmp/report-docs.md`.
- Verifikator i18n: `/tmp/verify_i18n.py` (subset 151 key),
  `/tmp/i18n_check_independent.py` (penuh 281 key).
- Fixture uji: `/tmp/verify-fixtures/` (fake-invite.apk,
  program.exe, note.txt, chat-export.txt).
- Dokumen: `DEVPOST-DESCRIPTION.md`, `README.md`,
  `VIDEO-SCRIPT.md` (v5), `firestore.rules`,
  `public/manifest.webmanifest`, `public/robots.txt`,
  `public/sitemap.xml`, `public/sw.js` (cache `tipucek-v4`).

## N. Yang masih menunggu (bukan bagian rombak ini)

Deploy (login Firebase CLI — tugas induk, kartu sign-in
menunggu Myuden); Search Console (browser cloud, properti
URL-prefix, file verifikasi ke `public/` SEBELUM deploy final
— atau deploy kedua bila perlu, lalu sitemap + minta indeks);
video v5 (rekam ulang sesudah rombak, tanpa roaming, avatar
robot perisai-bintang, nama TipuCek); OK Myuden untuk video →
YouTube publik + Devpost sebelum 1 Des 05:00 WIB; bukti
on-device di Chrome desktop sungguhan; peringkat akhir
Axial Drift II (utang lain, bukan TipuCek).
