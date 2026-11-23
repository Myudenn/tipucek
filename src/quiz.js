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
// Simplified 21 Nov 2026 (Myuden: "supaya lebih gampang dipahami
// pengguna"): short simple words, one idea per question, no hard
// terms. Ground truth, order, count and scoring are unchanged —
// every scam signal (link, fee, OTP, deadline, fake domain) is kept.
//
// NOTE: the question identifier is "qid", not "id" — the Indonesian
// translation object is keyed "id" (the language code), and a second
// "id" key would silently overwrite the first (audit B5).

const BANK = [
  {
    qid: "q1",
    scam: true,
    en: {
      text: "CONGRATULATIONS! You won Rp 50,000,000 in the Telkomsel lottery. Click http://bit.ly/prize-2026 and pay a Rp 150,000 admin fee. Claim your prize within 24 hours!",
      why: "You never entered this lottery. The link is short, there is a fee to claim, and a 24-hour deadline. Four scam signs in one message.",
    },
    id: {
      text: "SELAMAT! Anda menang Rp 50.000.000 dari undian Telkomsel. Klik http://bit.ly/hadiah-2026, lalu bayar biaya admin Rp 150.000. Klaim hadiah sebelum 24 jam!",
      why: "Anda tidak pernah ikut undian ini. Tautannya pendek, ada biaya klaim, dan batas waktu 24 jam. Empat tanda penipuan dalam satu pesan.",
    },
  },
  {
    qid: "q2",
    scam: false,
    en: {
      text: "Hi Budi, this is Sari from the office. The team meeting moves to Thursday 10:00 in room 3B. Please bring the Q3 report. See you there!",
      why: "An ordinary work message. The sender is known, no link, no money, no rush. A scammer cannot use anything here.",
    },
    id: {
      text: "Halo Budi, ini Sari dari kantor. Rapat tim pindah ke Kamis pukul 10.00 di ruang 3B. Tolong bawa laporan Q3. Sampai jumpa!",
      why: "Ini pesan kerja biasa. Pengirimnya dikenal, tidak ada tautan, tidak ada uang, tidak ada desakan. Tidak ada yang bisa dipakai penipu.",
    },
  },
  {
    qid: "q3",
    scam: true,
    en: {
      text: "Hello, this is our wedding invitation! Please download the app here: https://wedding-invite-2026.xyz/invite.apk — we hope you can come. Thank you!",
      why: "A wedding invitation that asks you to install an .apk file is the most common APK scam in Indonesia. A real invitation never asks you to install an app.",
    },
    id: {
      text: "Halo, ini undangan pernikahan kami! Silakan unduh aplikasinya di sini: https://undangan-nikah-2026.xyz/invite.apk — mohon kehadirannya ya, terima kasih!",
      why: "Undangan yang meminta Anda memasang file .apk adalah penipuan APK yang paling sering terjadi di Indonesia. Undangan asli tidak pernah meminta Anda memasang aplikasi.",
    },
  },
  {
    qid: "q4",
    scam: true,
    en: {
      text: "Hello, this is BCA customer service on WhatsApp. Please send your OTP code 482916 now to verify your account. If not, your account will be blocked.",
      why: "A real bank NEVER asks for your OTP — not on WhatsApp, not anywhere. Asking for an OTP plus a blocking threat is always a scam.",
    },
    id: {
      text: "Halo, ini customer service BCA di WhatsApp. Untuk verifikasi, kirim kode OTP Anda 482916 sekarang. Kalau tidak, akun Anda akan diblokir.",
      why: "Bank asli TIDAK PERNAH meminta OTP Anda — tidak di WhatsApp, tidak di mana pun. Minta OTP ditambah ancaman blokir selalu penipuan.",
    },
  },
  {
    qid: "q5",
    scam: false,
    en: {
      text: "Good morning, this is Mrs. Ratna from the school. The parents meeting moves to Saturday 09:00. Thank you.",
      why: "An ordinary school notice. The sender is known, no link, no payment, no threat. Safe messages look plain — that is normal.",
    },
    id: {
      text: "Selamat pagi, ini Ibu Ratna dari sekolah. Rapat orang tua murid pindah ke hari Sabtu pukul 09.00. Terima kasih.",
      why: "Ini pemberitahuan sekolah biasa. Pengirimnya dikenal, tidak ada tautan, tidak ada pembayaran, tidak ada ancaman. Pesan aman memang terlihat biasa saja.",
    },
  },
  {
    qid: "q6",
    scam: true,
    en: {
      text: "PART-TIME JOB! Earn Rp 500,000/day working from home, just like and subscribe to YouTube videos. Register now, pay a Rp 100,000 deposit to activate your account. Contact WA 0812-3456-7890.",
      why: "Huge pay for easy work, plus a deposit to 'activate' — the deposit IS the scam. Real employers never ask you to pay to start working.",
    },
    id: {
      text: "LOWONGAN KERJA PARUH WAKTU! Gaji Rp 500.000/hari, kerja dari rumah, hanya like dan subscribe video YouTube. Daftar sekarang, bayar deposit Rp 100.000 untuk mengaktifkan akun. Hubungi WA 0812-3456-7890.",
      why: "Gaji besar untuk kerja mudah, ditambah deposit untuk 'aktivasi' — deposit itu SENDIRI penipuannya. Perusahaan asli tidak pernah meminta Anda membayar untuk mulai bekerja.",
    },
  },
  {
    qid: "q7",
    scam: false,
    en: {
      text: "BCA: Your debit card payment of Rp 250,000 at TOKOPEDIA was successful. Call Halo BCA 1500888 if you did not make this payment.",
      why: "A bank message with NO link and the bank's real official number (1500888). Safe messages tell you where to call — they never ask you to click.",
    },
    id: {
      text: "BCA: Transaksi kartu debit Anda Rp 250.000 di TOKOPEDIA berhasil. Hubungi Halo BCA 1500888 kalau Anda tidak merasa melakukan transaksi ini.",
      why: "Notifikasi bank ini TANPA tautan dan memakai nomor resmi bank (1500888). Notifikasi aman memberi tahu Anda harus menelepon ke mana — tidak pernah meminta Anda mengklik apa pun.",
    },
  },
  {
    qid: "q8",
    scam: true,
    en: {
      text: "Your account will be BLOCKED within 24 hours because of suspicious activity. Verify now at https://bca-secure-verify.xyz/login or you will lose access.",
      why: "A blocking threat, a 24-hour deadline, and a look-alike web address (bca-secure-verify.xyz is not bca.co.id). Urgency plus a fake login page = phishing.",
    },
    id: {
      text: "Akun Anda akan DIBLOKIR dalam 24 jam karena aktivitas mencurigakan. Verifikasi sekarang di https://bca-secure-verify.xyz/login, atau Anda akan kehilangan akses.",
      why: "Ancaman blokir, batas 24 jam, dan alamat web tiruan (bca-secure-verify.xyz, bukan bca.co.id). Desakan ditambah halaman login palsu = phishing.",
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
