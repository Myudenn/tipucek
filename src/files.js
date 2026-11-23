// TipuCek — local fake-file detection (no network, no database).
//
// Scam messages in Indonesia very often push a file: a fake wedding
// invitation or package "APK", a Windows program, or an archive hiding
// one. The AI model already flags these, but a local rule makes the
// warning deterministic — it fires the same way in demo mode, in the
// cloud verdict, and on text read from a screenshot. Each match gets a
// level ("low" | "high") plus a reason key the UI translates.
//
// Honest limits: this reads file NAMES in the message text only. It
// cannot open, scan, or verify an actual file, and it never downloads
// anything — the UI says so. A clean name proves nothing on its own.

const FILE_RULES = [
  // Android app file, named or just mentioned ("download APK-nya").
  // In scam traffic "APK" almost always means the malicious installer.
  { re: /[\w.-]+\.apk\b/i, kind: "apk", level: "high", reason: "fileReasonApk" },
  { re: /\bapk\b/i, kind: "apk", level: "high", reason: "fileReasonApk" },
  // Windows program files. NOTE: ".com" is NOT in this list on
  // purpose (21 Nov, Myuden): ".com" is a top-level domain, so a
  // domain or email address in the message ("bca.com",
  // "support@bca.com") was misread as a DOS program file. Real
  // Windows programs pushed in scams are .exe/.msi/.bat/.cmd/.scr —
  // none of those is a public TLD, so they cannot be domains.
  // (An explicit file NAME ending in .com is still exe/high in
  // filecheck.js analyzeFileName — there the user typed a file name,
  // not a domain.)
  { re: /[\w.-]+\.(exe|msi|bat|cmd|scr)\b/i, kind: "exe", level: "high", reason: "fileReasonExe" },
  // Archives can hide a harmful program inside.
  { re: /[\w.-]+\.(zip|rar|7z)\b/i, kind: "archive", level: "low", reason: "fileReasonArchive" },
];

// Documents are only flagged when the message also pushes an install or
// a macro — a plain "laporan.pdf" in a normal message is not suspicious.
const DOC_RE = /[\w.-]+\.(pdf|doc|docx|xls|xlsx)\b/i;
const DOC_TRIGGER_RE = /macro|aktifkan|enable|unduh|download|install|pasang/i;

/** Return the suspicious files mentioned in `text` (at most one per kind). */
export function analyzeFiles(text = "") {
  const found = [];
  const seen = new Set();
  for (const rule of FILE_RULES) {
    const m = text.match(rule.re);
    if (m && !seen.has(rule.kind)) {
      seen.add(rule.kind);
      found.push({ name: m[0], kind: rule.kind, level: rule.level, reason: rule.reason });
    }
  }
  const doc = text.match(DOC_RE);
  if (doc && DOC_TRIGGER_RE.test(text) && !seen.has("doc")) {
    found.push({ name: doc[0], kind: "doc", level: "low", reason: "fileReasonDoc" });
  }
  return found;
}
