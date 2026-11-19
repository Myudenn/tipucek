// TipuCek — "Scam or safe?" quiz bank (local, no network).
//
// 8 questions in Indonesian + English (other languages fall back to
// English — the quiz text is deliberately short so the fallback stays
// readable). Each question carries its ground truth (scam / safe) and
// a "why" written in the author's own words; the live explanation in
// the UI shows ONLY that curated "why", never the live heuristic
// flags — the heuristic often disagrees with the bank, and showing
// its flags next to the correct answer contradicted the lesson
// (audit B6). The "why" texts are written to reflect the checker's
// real rules (prize + fee + short link, OTP never asked by banks…).
//
// NOTE: the question identifier is "qid", not "id" — the Indonesian
// translation object is keyed "id" (the language code), and a second
// "id" key would silently overwrite the first (audit B5).

const BANK = [
  {
    qid: "q1",
    scam: true,
    en: {
      text: "CONGRATULATIONS! You won Rp 50,000,000 in the Telkomsel lottery. Click http://bit.ly/prize-2026 and pay a Rp 150,000 admin fee to claim your prize within 24 hours!",
      why: "A prize you never entered, a shortened link, a fee to claim it, and a 24-hour deadline — four classic scam signs in one message.",
    },
    id: {
      text: "SELAMAT! Anda memenangkan Rp 50.000.000 dari undian Telkomsel. Klik http://bit.ly/hadiah-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam!",
      why: "Hadiah yang tidak pernah Anda ikuti, tautan pendek, biaya untuk klaim, dan batas waktu 24 jam — empat tanda penipuan klasik dalam satu pesan.",
    },
  },
  {
    qid: "q2",
    scam: false,
    en: {
      text: "Hi Budi, this is Sari from the office. The team meeting is moved to Thursday 10:00 in room 3B. Please bring the Q3 report. See you there!",
      why: "An ordinary work message: a known sender, no link, no money, no urgency, nothing to click. There is nothing here a scammer can use.",
    },
    id: {
      text: "Halo Budi, ini Sari dari kantor. Rapat tim dipindah ke hari Kamis pukul 10.00 di ruang 3B. Tolong bawa laporan Q3. Sampai jumpa!",
      why: "Pesan kerja biasa: pengirim dikenal, tanpa tautan, tanpa uang, tanpa desakan, tidak ada yang perlu diklik. Tidak ada yang bisa dipakai penipu di sini.",
    },
  },
  {
    qid: "q3",
    scam: true,
    en: {
      text: "Hello, this is our wedding invitation! Please download the app here: https://wedding-invite-2026.xyz/invite.apk — we hope you can come, thank you!",
      why: "A wedding invitation that asks you to install an .apk file is the most common APK scam in Indonesia. A real invitation never needs an app install.",
    },
    id: {
      text: "Halo, ini undangan pernikahan kami! Silakan download aplikasinya di sini: https://undangan-nikah-2026.xyz/invite.apk — mohon kehadirannya ya, terima kasih!",
      why: "Undangan pernikahan yang meminta Anda menginstal file .apk adalah penipuan APK paling umum di Indonesia. Undangan asli tidak pernah butuh instal aplikasi.",
    },
  },
  {
    qid: "q4",
    scam: true,
    en: {
      text: "Hello, this is BCA customer service on WhatsApp. For verification, please send your OTP code 482916 now, otherwise your account will be blocked.",
      why: "A real bank NEVER asks for your OTP — not on WhatsApp, not anywhere. An OTP request plus a blocking threat is always a scam.",
    },
    id: {
      text: "Halo, ini customer service BCA di WhatsApp. Untuk verifikasi, mohon kirim kode OTP Anda 482916 sekarang, kalau tidak akun Anda akan diblokir.",
      why: "Bank asli TIDAK PERNAH meminta OTP Anda — bukan di WhatsApp, bukan di mana pun. Minta OTP ditambah ancaman blokir selalu penipuan.",
    },
  },
  {
    qid: "q5",
    scam: false,
    en: {
      text: "Good morning, this is Mrs. Ratna from the school. The parents meeting is moved to Saturday 09:00. Thank you.",
      why: "An ordinary school notice: a known sender, no link, no payment, no threat. Safe messages look boring — that is the point.",
    },
    id: {
      text: "Selamat pagi, ini Ibu Ratna dari sekolah. Rapat orang tua wali murid diundur ke hari Sabtu pukul 09.00. Terima kasih.",
      why: "Pemberitahuan sekolah biasa: pengirim dikenal, tanpa tautan, tanpa pembayaran, tanpa ancaman. Pesan aman memang terlihat membosankan — memang begitu.",
    },
  },
  {
    qid: "q6",
    scam: true,
    en: {
      text: "PART-TIME JOB! Earn Rp 500,000/day working from home, just like & subscribe YouTube videos. Register now, pay a Rp 100,000 deposit to activate your account. Contact WA 0812-3456-7890.",
      why: "Huge pay for trivial work plus a deposit to 'activate' — the deposit IS the scam. Real employers never ask you to pay to start working.",
    },
    id: {
      text: "LOWONGAN KERJA PARUH WAKTU! Gaji Rp 500.000/hari, kerja dari rumah, hanya like & subscribe video YouTube. Daftar sekarang, bayar deposit Rp 100.000 untuk aktivasi akun. Hubungi WA 0812-3456-7890.",
      why: "Gaji besar untuk kerja sepele ditambah deposit untuk 'aktivasi' — depositnya ITULAH penipuannya. Perusahaan asli tidak pernah meminta Anda membayar untuk mulai bekerja.",
    },
  },
  {
    qid: "q7",
    scam: false,
    en: {
      text: "BCA: Your debit card transaction of Rp 250,000 at TOKOPEDIA was successful. Call Halo BCA 1500888 if you did not make this transaction.",
      why: "A bank notification with NO link and the bank's real official number (1500888). Safe notifications tell you where to call — they never ask you to click.",
    },
    id: {
      text: "BCA: Transaksi kartu debit Anda Rp 250.000 di TOKOPEDIA berhasil. Hubungi Halo BCA 1500888 bila Anda tidak merasa melakukan transaksi ini.",
      why: "Notifikasi bank TANPA tautan dan memakai nomor resmi bank (1500888). Notifikasi aman memberi tahu Anda ke mana harus menelepon — tidak pernah meminta Anda mengklik.",
    },
  },
  {
    qid: "q8",
    scam: true,
    en: {
      text: "Your account will be BLOCKED within 24 hours due to suspicious activity. Verify now at https://bca-secure-verify.xyz/login or you will lose access.",
      why: "A blocking threat with a 24-hour deadline and a look-alike domain (bca-secure-verify.xyz is not bca.co.id). Urgency + a fake login page = phishing.",
    },
    id: {
      text: "Akun Anda akan DIBLOKIR dalam 24 jam karena aktivitas mencurigakan. Verifikasi sekarang di https://bca-secure-verify.xyz/login atau Anda kehilangan akses.",
      why: "Ancaman blokir dengan batas 24 jam dan domain tiruan (bca-secure-verify.xyz bukan bca.co.id). Desakan + halaman login palsu = phishing.",
    },
  },
];

/** Questions for a UI language (en fallback for languages without a bank). */
export function getQuizQuestions(lang) {
  return BANK.map((q) => {
    const bank = q[lang] || q.en;
    return { id: q.qid, scam: q.scam, text: bank.text, why: bank.why };
  });
}
