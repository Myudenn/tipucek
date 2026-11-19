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
const OLE_SIG = [0xd0, 0xcf, 0x11, 0xe0]; // old Office (doc/xls)
const ELF_SIG = [0x7f, 0x45, 0x4c, 0x46]; // Linux binary

function startsWith(buf, sig) {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
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
 * Inspect an uploaded File. Returns:
 * { kind, level, reasonKey, fileName, fileSize, sha256, entries,
 *   textContent, textPreview }
 * kind: apk | exe | archive-prog | archive | doc | text | unknown
 * level: high | low
 * textContent/textPreview: only for kind "text" — the first 4,000 /
 * 300 characters of the file, for local scoring. The file is never
 * uploaded; the text is read on the device.
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
    if (isApk) {
      kind = "apk";
      level = "high";
      reasonKey = "fileCheckApk";
    } else if (hasProgram) {
      kind = "archive-prog";
      level = "high";
      reasonKey = "fileCheckArchiveProg";
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
    startsWith(head, PDF_SIG) ||
    startsWith(head, OLE_SIG) ||
    ["pdf", "doc", "docx", "xls", "xlsx"].includes(ext)
  ) {
    kind = "doc";
    level = "low";
    reasonKey = "fileCheckDoc";
  } else if (startsWith(head, ELF_SIG)) {
    kind = "exe";
    level = "high";
    reasonKey = "fileCheckExe";
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
    try {
      const raw = await file.slice(0, 100 * 1024).text();
      textContent = raw.slice(0, 4000);
      textPreview = raw.slice(0, 300);
    } catch {
      textContent = null;
      textPreview = null;
    }
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
