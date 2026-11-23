// TipuCek — real-file inspection by magic bytes (client-side only).
//
// Reads the first bytes of an uploaded file and identifies its true
// type from its signature, not its extension (a ".pdf" can really be
// an .exe). For ZIP-based files it walks the local file headers to
// list entry names, so an APK (a ZIP holding AndroidManifest.xml /
// classes.dex) and an archive hiding a program are told apart.
//
// Honest limits: this is a STRUCTURE check, not a malware scan. It
// never sends the file anywhere (the SHA-256 fingerprint is computed
// locally too, see fileHash). A clean result never proves a file safe.

const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
const ZIP_EMPTY_SIG = [0x50, 0x4b, 0x05, 0x06]; // PK\x05\x06 (empty zip)
const RAR_SIG = [0x52, 0x61, 0x72, 0x21]; // "Rar!"
const SEVENZ_SIG = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]; // "7z...."
const MZ_SIG = [0x4d, 0x5a]; // "MZ" — DOS/Windows executable
const PDF_SIG = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0]; // old Office (doc/xls) / MSI installer
const ELF_SIG = [0x7f, 0x45, 0x4c, 0x46]; // Linux binary
// Audit 13 ("cek file apa saja"): images, audio/video, compressed
// archives and software packages, by magic bytes — not by extension.
const JPEG_SIG = [0xff, 0xd8, 0xff];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF_SIG = [0x47, 0x49, 0x46, 0x38]; // "GIF8"
const BMP_SIG = [0x42, 0x4d]; // "BM"
const ICO_SIG = [0x00, 0x00, 0x01, 0x00];
const MP3_ID3_SIG = [0x49, 0x44, 0x33]; // "ID3"
const OGG_SIG = [0x4f, 0x67, 0x67, 0x53]; // "OggS"
const FLAC_SIG = [0x66, 0x4c, 0x61, 0x43]; // "fLaC"
const MKV_SIG = [0x1a, 0x45, 0xdf, 0xa3];
const GZ_SIG = [0x1f, 0x8b];
const BZ2_SIG = [0x42, 0x5a, 0x68]; // "BZh"
const XZ_SIG = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];
const ZST_SIG = [0x28, 0xb5, 0x2f, 0xfd];
const DEB_SIG = [0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e, 0x0a]; // "!<arch>\n"
const RPM_SIG = [0xed, 0xab, 0xee, 0xdb];
// Signatures that sit at an offset, not at byte 0.
const RIFF_SIG = [0x52, 0x49, 0x46, 0x46]; // "RIFF" at 0 (WebP/WAV/AVI)
const WEBP_SIG = [0x57, 0x45, 0x42, 0x50]; // "WEBP" at 8
const WAV_SIG = [0x57, 0x41, 0x56, 0x45]; // "WAVE" at 8
const AVI_SIG = [0x41, 0x56, 0x49, 0x20]; // "AVI " at 8
const FTYP_SIG = [0x66, 0x74, 0x79, 0x70]; // "ftyp" at 4 (MP4/MOV/M4A)
const TAR_SIG = [0x75, 0x73, 0x74, 0x61, 0x72]; // "ustar" at 257
const ISO_SIG = [0x43, 0x44, 0x30, 0x30, 0x31]; // "CD001" at 32769
const DMG_TRAILER = [0x6b, 0x6f, 0x6c, 0x79]; // "koly" (last 512 bytes)

// Script extensions: programs written as text. They are read and
// scored like a text file (see inspectFile) — a clean content score
// never makes a script safe to RUN; the reason text says so.
export const SCRIPT_EXTS = new Set([
  "js", "mjs", "ps1", "psm1", "sh", "bash", "bat", "cmd", "py", "vbs",
  "rb", "pl", "php",
]);

function startsWith(buf, sig) {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  return true;
}

/** True when buf holds sig at the given byte offset. */
function startsWithAt(buf, sig, off) {
  if (buf.length < off + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[off + i] !== sig[i]) return false;
  return true;
}

/** Walk ZIP local file headers (first 512 KB) and list entry names. */
function zipEntryNames(buf) {
  const names = [];
  const dec = new TextDecoder();
  let off = 0;
  while (off + 30 <= buf.length && names.length < 200) {
    if (!startsWith(buf.subarray(off), ZIP_SIG)) break;
    const flags = buf[off + 6] | (buf[off + 7] << 8);
    const nameLen = buf[off + 26] | (buf[off + 27] << 8);
    const extraLen = buf[off + 28] | (buf[off + 29] << 8);
    const compSize =
      buf[off + 18] |
      (buf[off + 19] << 8) |
      (buf[off + 20] << 16) |
      (buf[off + 21] << 24);
    if (nameLen <= 0 || off + 30 + nameLen > buf.length) break;
    try {
      names.push(dec.decode(buf.slice(off + 30, off + 30 + nameLen)));
    } catch {
      break;
    }
    const dataStart = off + 30 + nameLen + extraLen;
    if (flags & 0x08) {
      // Data-descriptor flag (bit 3): compSize in the local header is
      // 0 — the real size is only in the descriptor AFTER the data.
      // Trusting compSize would stop the walk after the first entry
      // (audit B3). Scan forward for the next PK\x03\x04 signature
      // instead; the descriptor itself (PK\x07\x08) is skipped by
      // the same scan. Best effort: file data can contain the
      // signature bytes by coincidence, but the entry list is only
      // used for kind classification, never as proof.
      let next = -1;
      for (let i = dataStart; i + 4 <= buf.length; i++) {
        if (startsWith(buf.subarray(i), ZIP_SIG)) { next = i; break; }
      }
      if (next < 0) break;
      off = next;
    } else {
      off = dataStart + compSize;
    }
  }
  return names;
}

export async function sha256HexOfBlob(blob) {
  if (!("crypto" in globalThis) || !crypto.subtle) return null;
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Inspect a file NAME only (no file uploaded). Returns
 * { kind, level, reasonKey, fileName } — kind: apk | exe | archive |
 * doc | unknown | url. A name alone never proves a file safe; the
 * result says so. Double extensions (.pdf.exe) are the classic
 * disguise: the file pretends to be a document but is really a
 * program.
 */

// Common public suffixes (a real TLD, not a file extension). A bare
// "example.com" ends in one — it is a domain, not a Windows program.
// Deliberately NOT here: zip/mov/app/dev — those are also real file
// extensions, and a file name ending in them is far more common than
// a domain ending in them.
const PUBLIC_TLDS = new Set([
  "com", "net", "org", "io", "co", "id", "ly", "me", "gg", "xyz", "top",
  "site", "online", "info", "biz", "edu", "gov", "tv", "cc", "ai", "us",
  "uk", "de", "fr", "jp", "cn", "au", "sg", "my", "ph", "th", "vn", "in",
  "br", "ru", "kr", "nl", "es", "it", "ca", "mx", "ar", "cl", "pe", "ve",
  "za", "ng", "ke", "eg", "sa", "ae", "tr", "pl", "cz", "hu", "ro", "gr",
  "pt", "se", "no", "dk", "fi", "be", "ch", "at", "nz", "hk", "tw",
]);

/** True when the typed text is a URL, a domain, or an email address — not a file name. */
function looksLikeUrlOrDomain(name) {
  const s = String(name || "").trim();
  if (!s) return false;
  if (/^(https?:\/\/|www\.)/i.test(s)) return true;
  // An "@" alone does not make an email (CoArena review, audit 7):
  // "invoice@2025.pdf" is a file name, not an address. Only an
  // email SHAPE counts — local@domain with a real TLD.
  if (/^[^@\s]+@[\w-]+(\.[\w-]+)*\.[a-z]{2,}$/i.test(s) && PUBLIC_TLDS.has(s.toLowerCase().split(".").pop())) return true;
  // "bit.ly/3abc": a domain followed by a path.
  if (s.includes("/")) {
    const head = s.split("/")[0];
    if (/^[\w-]+(\.[\w-]+)+$/.test(head) && PUBLIC_TLDS.has(head.toLowerCase().split(".").pop())) return true;
  }
  // Bare domain: labels of letters/digits/hyphens, ending in a real TLD.
  if (/^[\w-]+(\.[\w-]+)+$/.test(s) && PUBLIC_TLDS.has(s.toLowerCase().split(".").pop())) return true;
  return false;
}

export function analyzeFileName(rawName) {
  const name = String(rawName || "").trim();
  const base = name.toLowerCase().split(/[\\/]/).pop() || "";
  // A domain or URL typed into the file-name field is not a file
  // (22 Nov audit 7): "example.com" was read as a Windows .com
  // program and "bit.ly/3abc" as a file with a nonsense type
  // ("LY/3ABC"). Those go to the link checker instead — only a real
  // file name gets classified here. A genuine ".com" DOS program is
  // sacrificed on purpose: a domain is the far more common input,
  // and the message says where to check it.
  if (looksLikeUrlOrDomain(name)) {
    return { kind: "url", level: "low", reasonKey: "fileNameIsUrl", fileName: name };
  }
  // Double extension first — it ends in .exe/.apk too, and the
  // disguise itself is the strongest signal.
  if (/\.(pdf|docx?|xlsx?|jpe?g|png|txt|md)\.(exe|msi|bat|cmd|scr|com|apk)$/.test(base)) {
    return { kind: "exe", level: "high", reasonKey: "fileNameDoubleExt", fileName: name };
  }
  // The word "apk" alone in a file NAME is not an APK file — only a
  // real .apk ending counts (a .pdf.exe-style disguise is caught
  // above). "catatan apk rapat.txt" used to score apk/high.
  if (/\.apk$/.test(base)) {
    return { kind: "apk", level: "high", reasonKey: "fileReasonApk", fileName: name };
  }
  if (/\.(exe|msi|bat|cmd|scr|com)$/.test(base)) {
    return { kind: "exe", level: "high", reasonKey: "fileReasonExe", fileName: name };
  }
  // Audit 13: a script NAME is a program name — .js/.ps1/.sh/.py and
  // friends are code that runs, not documents. (The .bat/.cmd case
  // above already returns "exe"; the rest land here as "script".)
  const ext = (base.split(".").pop() || "").toLowerCase();
  if (SCRIPT_EXTS.has(ext)) {
    return { kind: "script", level: "high", reasonKey: "fileReasonScript", fileName: name };
  }
  if (/\.(zip|rar|7z)$/.test(base)) {
    return { kind: "archive", level: "low", reasonKey: "fileReasonArchive", fileName: name };
  }
  if (/\.(pdf|docx?|xlsx?)$/.test(base)) {
    return { kind: "doc", level: "low", reasonKey: "fileNameDoc", fileName: name };
  }
  return { kind: "unknown", level: "low", reasonKey: "fileNameUnknown", fileName: name };
}

/**
 * Display label for the "Detected type" line. The kind is a
 * category — "doc" hides whether the file is really a PDF, DOCX or
 * XLSX, which read as "not detected" (21 Nov live: a .pdf showed
 * "doc"). For category kinds, show the file's real extension;
 * for the magic-confirmed danger kinds (apk/exe) the kind itself
 * is the honest label — the extension there can be a disguise
 * (laporan.pdf.exe is really an .exe, and a .pdf that is really
 * an .exe must never be labelled "PDF").
 */
export function fileTypeDisplay(info) {
  const name = (info && info.fileName) || "";
  const m = /\.([^.]+)$/.exec(name);
  const ext = m ? m[1].toUpperCase() : "";
  const kind = (info && info.kind) || "unknown";
  if (kind === "url") return "URL";
  if (kind === "apk" || kind === "exe") return kind.toUpperCase();
  if (ext) return ext;
  return kind;
}

/**
 * Inspect an uploaded File. Returns:
 * { kind, level, reasonKey, fileName, fileSize, sha256, entries,
 *   textContent, textPreview }
 * kind: apk | exe | archive-prog | archive | doc | text | script |
 *   image | audio | video | unknown
 * level: high | low
 * textContent/textPreview: only for kinds "text" and "script" — the
 * first 4,000 / 300 characters of the file, for local scoring. The
 * file is never uploaded; the text is read on the device.
 * Honest limit (unchanged): this is a STRUCTURE check, not a malware
 * scan. A clean result never proves a file safe — and an
 * unrecognized file is reported as "unknown" (never "safe").
 */
export async function inspectFile(file) {
  const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  const name = file.name || "";
  const ext = (name.split(".").pop() || "").toLowerCase();
  let kind = "unknown";
  let level = "low";
  let reasonKey = "fileCheckUnknown";
  let entries = [];
  let textContent = null;
  let textPreview = null;

  // Read the first bytes of a TEXT-like file (plain text or script)
  // so the caller can score its content like a pasted message.
  const readText = async () => {
    try {
      const raw = await file.slice(0, 100 * 1024).text();
      textContent = raw.slice(0, 4000);
      textPreview = raw.slice(0, 300);
    } catch {
      textContent = null;
      textPreview = null;
    }
  };

  if (startsWith(head, ZIP_SIG) || startsWith(head, ZIP_EMPTY_SIG)) {
    entries = zipEntryNames(head);
    const lower = entries.map((e) => e.toLowerCase());
    const isApk =
      lower.some((e) => e === "androidmanifest.xml") ||
      lower.some((e) => e === "classes.dex") ||
      ext === "apk";
    const hasProgram = lower.some((e) =>
      /\.(exe|msi|bat|cmd|scr|com)$/.test(e),
    );
    // Audit 13: a ZIP that is really an Office document (.docx/.xlsx/
    // .pptx) is a document, not a generic archive — its entries carry
    // word/, xl/ or ppt/ parts. (A .docx used to read as "archive".)
    const isOfficeDoc =
      ["docx", "xlsx", "pptx"].includes(ext) ||
      lower.some((e) => e === "word/document.xml" || e === "xl/workbook.xml" || e === "ppt/presentation.xml");
    if (isApk) {
      kind = "apk";
      level = "high";
      reasonKey = "fileCheckApk";
    } else if (hasProgram) {
      kind = "archive-prog";
      level = "high";
      reasonKey = "fileCheckArchiveProg";
    } else if (isOfficeDoc) {
      kind = "doc";
      level = "low";
      reasonKey = "fileCheckDoc";
    } else {
      kind = "archive";
      level = "low";
      reasonKey = "fileCheckArchive";
    }
  } else if (startsWith(head, MZ_SIG)) {
    kind = "exe";
    level = "high";
    reasonKey = "fileCheckExe";
  } else if (startsWith(head, RAR_SIG) || startsWith(head, SEVENZ_SIG)) {
    kind = "archive";
    level = "low";
    reasonKey = "fileCheckArchive";
  } else if (
    startsWith(head, GZ_SIG) ||
    startsWith(head, BZ2_SIG) ||
    startsWith(head, XZ_SIG) ||
    startsWith(head, ZST_SIG) ||
    startsWith(head, DEB_SIG) ||
    startsWith(head, RPM_SIG) ||
    startsWithAt(head, TAR_SIG, 257)
  ) {
    // Compressed archives + software packages (.deb/.rpm are `ar`
    // archives that install programs; .tar/.gz/.bz2/.xz/.zst are
    // plain compressed archives).
    kind = "archive";
    level = "low";
    reasonKey = "fileCheckArchive";
  } else if (startsWithAt(head, ISO_SIG, 32769)) {
    // ISO 9660 disc image ("CD001" at byte 32769).
    kind = "archive";
    level = "low";
    reasonKey = "fileCheckArchive";
  } else if (
    startsWith(head, JPEG_SIG) ||
    startsWith(head, PNG_SIG) ||
    startsWith(head, GIF_SIG) ||
    startsWith(head, BMP_SIG) ||
    startsWith(head, ICO_SIG) ||
    (startsWith(head, RIFF_SIG) && startsWithAt(head, WEBP_SIG, 8))
  ) {
    // Audit 13: images are now recognized by magic bytes instead of
    // reading as "unknown". An image's structure says nothing about
    // the scam text it may contain — the reason text points at the
    // screenshot check (OCR) for that.
    kind = "image";
    level = "low";
    reasonKey = "fileCheckImage";
  } else if (
    startsWith(head, MP3_ID3_SIG) ||
    (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) ||
    (startsWith(head, RIFF_SIG) && startsWithAt(head, WAV_SIG, 8)) ||
    startsWith(head, OGG_SIG) ||
    startsWith(head, FLAC_SIG)
  ) {
    // Audio: MP3 (ID3 tag or bare MPEG frame sync), WAV
    // ("RIFF....WAVE"), OGG, FLAC.
    kind = "audio";
    level = "low";
    reasonKey = "fileCheckMedia";
  } else if (
    startsWithAt(head, FTYP_SIG, 4) ||
    startsWith(head, MKV_SIG) ||
    (startsWith(head, RIFF_SIG) && startsWithAt(head, AVI_SIG, 8))
  ) {
    // Video / media containers: MP4/MOV/M4A ("ftyp" at offset 4),
    // Matroska/WebM (EBML header), AVI ("RIFF....AVI "). An .m4a
    // is audio in an MP4 container — the extension is shown as the
    // detected type, so it reads as audio to the user.
    kind = ext === "m4a" || ext === "aac" ? "audio" : "video";
    level = "low";
    reasonKey = "fileCheckMedia";
  } else if (startsWith(head, PDF_SIG)) {
    kind = "doc";
    level = "low";
    reasonKey = "fileCheckDoc";
  } else if (startsWith(head, OLE_SIG)) {
    // Old Office compound file — but an .msi installer uses the same
    // container, and an installer is a program, not a document.
    if (ext === "msi") {
      kind = "exe";
      level = "high";
      reasonKey = "fileCheckExe";
    } else {
      kind = "doc";
      level = "low";
      reasonKey = "fileCheckDoc";
    }
  } else if (["pdf", "doc", "docx", "xls", "xlsx"].includes(ext)) {
    kind = "doc";
    level = "low";
    reasonKey = "fileCheckDoc";
  } else if (startsWith(head, ELF_SIG)) {
    kind = "exe";
    level = "high";
    reasonKey = "fileCheckExe";
  } else if (ext === "dmg") {
    // Apple disk image: no header magic — the "koly" trailer lives
    // in the last 512 bytes. Read the tail to confirm it.
    let isDmg = false;
    try {
      const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 512)).arrayBuffer());
      for (let i = 0; i + 4 <= tail.length; i++) {
        if (startsWith(tail.subarray(i), DMG_TRAILER)) { isDmg = true; break; }
      }
    } catch {
      isDmg = false;
    }
    if (isDmg) {
      kind = "archive";
      level = "low";
      reasonKey = "fileCheckArchive";
    }
  } else if (SCRIPT_EXTS.has(ext)) {
    // Audit 13: scripts are programs written as text — read the
    // content and score it like a pasted message. A clean content
    // score never makes a script safe to RUN (the reason text says
    // so); the kind label itself says "script".
    kind = "script";
    level = "low";
    reasonKey = "fileCheckScript";
    await readText();
  } else if (
    ["txt", "md", "csv", "log", "json", "xml", "html", "htm"].includes(ext)
  ) {
    // Plain-text file: no magic bytes to match, so read the content
    // itself (first 100 KB) and score it like a pasted message. A
    // .txt can carry a scam message or a fake invoice — "unknown
    // type" would hide all of that.
    kind = "text";
    level = "low";
    reasonKey = "fileCheckText";
    await readText();
  }

  // SHA-256 of the whole file, computed locally. Files over 50 MB are
  // skipped honestly (too big to hash in the browser tab).
  let sha256 = null;
  if (file.size <= 50 * 1024 * 1024) {
    try {
      sha256 = await sha256HexOfBlob(file);
    } catch {
      sha256 = null;
    }
  }

  return { kind, level, reasonKey, fileName: name, fileSize: file.size, sha256, entries, textContent, textPreview };
}
