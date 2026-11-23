// qrcheck.js — TipuCek QR payload utilities (23 Nov 2026).
//
// CRC-16/CCITT-FALSE, EMVCo Merchant Presented Mode (MPM) TLV parsing,
// QR text classification, and local-only QR image decoding (tiered:
// BarcodeDetector when the browser has it, then jsQR via dynamic import).
//
// HONEST LIMITS:
//   • A passing CRC check only proves the payload is internally
//     consistent; it does NOT prove the QRIS is genuine or that the
//     sticker was not swapped after printing.
//   • There is no public NMID registry, so this app can never confirm
//     that a merchant is registered or not suspended — the UI must
//     never claim otherwise ("make sure it matches the store; if it
//     does not, do not pay").
//   • Decoding is 100% local: the image never leaves the device.

// ---------------------------------------------------------------------------
// 1. CRC-16/CCITT-FALSE
//    Poly 0x1021, init 0xFFFF, no input/output reflection, no final XOR.
//    Check value (verified against Python binascii.crc_hqx):
//    crc16ccittFalse("123456789") === 0x29B1.
// ---------------------------------------------------------------------------
export function crc16ccittFalseBytes(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc;
}

export function crc16ccittFalse(str) {
  return crc16ccittFalseBytes(new TextEncoder().encode(str));
}

// ---------------------------------------------------------------------------
// 2. parseEmvPayload
//    EMVCo MPM TLV: 2-digit tag + 2-digit decimal length + value.
//    Never throws; a non-TLV string returns the not-emv failure.
// ---------------------------------------------------------------------------
export function parseEmvPayload(payload) {
  const emptyFields = {
    initiation: null,
    mcc: null,
    currency: null,
    amount: null,
    country: null,
    merchantName: null,
    merchantCity: null,
    nmid: null,
    pan: null,
    criteria: null,
  };

  const fail = (errors) => ({
    isQris: false,
    valid: false,
    crcValid: false,
    crcExpected: null,
    crcActual: null,
    fields: { ...emptyFields },
    errors,
  });

  if (typeof payload !== "string" || payload.length === 0) {
    return fail(["not-emv"]);
  }

  // Whitespace around a pasted payload is not part of it (the UI
  // trims before classifying, but direct callers may not — QRIS
  // audit, 23 Nov 2026).
  const input = payload.trim();

  // An EMV MPM payload starts with tag 00, length 02, value "01".
  if (!input.startsWith("000201")) {
    return fail(["not-emv"]);
  }

  const errors = [];
  const fields = { ...emptyFields };
  let valid = true;
  let isQris = false;
  let crcExpected = null;
  let crcActual = null;
  let crcValid = false;

  // Parse one TLV blob into a { tag -> value } map plus the position
  // of every tag (byte offsets) and any duplicate tags. Lengths are
  // counted in UTF-8 BYTES, as the EMV spec requires — a JS string
  // length counts UTF-16 code units, so a non-ASCII value (e.g.
  // "CAFÉ", 4 chars but 5 bytes) would otherwise eat the next tag
  // (QRIS audit, 23 Nov 2026). ok=false when a tag header is cut
  // off, a tag/length is not two digits, or a length overruns the
  // remaining bytes.
  function parseTlv(blob) {
    const bytes = new TextEncoder().encode(blob);
    const dec = new TextDecoder();
    const tags = {};
    const positions = [];
    const duplicates = [];
    let pos = 0;
    let ok = true;
    while (pos < bytes.length) {
      if (pos + 4 > bytes.length) {
        ok = false;
        break;
      }
      const tag = dec.decode(bytes.slice(pos, pos + 2));
      const lenStr = dec.decode(bytes.slice(pos + 2, pos + 4));
      if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(lenStr)) {
        ok = false;
        break;
      }
      const len = parseInt(lenStr, 10);
      pos += 4;
      if (pos + len > bytes.length) {
        ok = false;
        break;
      }
      const value = dec.decode(bytes.slice(pos, pos + len));
      if (Object.prototype.hasOwnProperty.call(tags, tag)) duplicates.push(tag);
      tags[tag] = value;
      positions.push({ tag, start: pos - 4, len, value });
      pos += len;
    }
    return { tags, ok, positions, duplicates };
  }

  // Walk the whole payload as TLV (tag 63 included — its 4-hex value
  // parses as an ordinary field) to validate the structure.
  const {
    tags,
    ok: parseOk,
    positions,
    duplicates,
  } = parseTlv(input);

  if (!parseOk) {
    valid = false;
    errors.push("truncated");
  }

  // A tag must not appear twice in one template (EMVCo rule) — a
  // second merchant name (or second CRC) makes the payload
  // ambiguous, so it is malformed, not "last one wins".
  if (duplicates.length > 0) {
    valid = false;
    errors.push("duplicate-tag");
  }

  // A payload that is only the format indicator carries no merchant
  // data at all — it is degenerate, not a valid merchant payload.
  if (parseOk && positions.length === 1 && positions[0].tag === "00") {
    valid = false;
    errors.push("empty-payload");
  }

  // --- CRC handling (tag 63) ---
  // Tag 63 is found from the TLV walk, NEVER by searching for the
  // string "6304": the CRC value itself may be "6304" (a real
  // payload would then be falsely rejected as "no CRC"), and
  // trailing data may start with "6304" (a forged payload would
  // then pass as fully valid) — QRIS audit, 23 Nov 2026. The CRC
  // is computed over the payload bytes up to and INCLUDING the
  // literal "6304" (the tag header, not the CRC value itself).
  const inputBytes = new TextEncoder().encode(input);
  const byteLen = inputBytes.length;
  const tag63s = positions.filter((p) => p.tag === "63");
  if (tag63s.length === 0) {
    errors.push("no-crc");
  } else {
    const last63 = tag63s[tag63s.length - 1];
    const endsAtEnd = last63.start + 4 + last63.len === byteLen;
    if (tag63s.length > 1) {
      valid = false;
      errors.push("crc-not-last");
    }
    if (!endsAtEnd) {
      valid = false;
      if (!errors.includes("crc-not-last")) errors.push("crc-not-last");
    }
    if (endsAtEnd && tag63s.length === 1) {
      if (last63.len !== 4) {
        valid = false;
        errors.push("bad-length");
        crcExpected = last63.value;
      } else if (!/^[0-9A-Fa-f]{4}$/.test(last63.value)) {
        errors.push("crc-malformed");
        crcExpected = last63.value;
      } else {
        crcExpected = last63.value.toUpperCase();
        const computed = crc16ccittFalseBytes(inputBytes.slice(0, last63.start + 4));
        crcActual = computed.toString(16).toUpperCase().padStart(4, "0");
        crcValid = crcActual === crcExpected;
        if (!crcValid) {
          errors.push("crc-mismatch");
        }
      }
    } else {
      // A duplicate CRC tag, or data after it: the CRC cannot be
      // trusted. Show the last claimed value as bad when there is
      // one, so the UI reports damage instead of "no CRC".
      if (last63.value) crcExpected = last63.value;
    }
  }

  // --- Top-level fields ---
  if (tags["01"]) fields.initiation = tags["01"];
  if (tags["52"]) fields.mcc = tags["52"];
  if (tags["53"]) fields.currency = tags["53"];
  if (tags["54"]) fields.amount = tags["54"];
  if (tags["58"]) fields.country = tags["58"];
  if (tags["59"]) fields.merchantName = tags["59"];
  if (tags["60"]) fields.merchantCity = tags["60"];

  // --- QRIS templates: tags 26–51 ---
  // Sub-tag 00 is the GUID; sub-tag 01 the PAN, 02 the NMID, 03 the
  // merchant criteria (UMI/UKE/UME/UBE/URE). Only the first QRIS
  // template fills the fields.
  const QRIS_GUID = "ID.CO.QRIS.WWW";
  for (let t = 26; t <= 51; t++) {
    const tagKey = String(t).padStart(2, "0");
    if (!tags[tagKey]) continue;
    const templateValue = tags[tagKey];
    const { tags: subTags, ok: subOk, duplicates: subDup } = parseTlv(templateValue);
    if (!subOk) {
      valid = false;
      if (!errors.includes("truncated")) errors.push("truncated");
      continue;
    }
    if (subDup.length > 0) {
      valid = false;
      if (!errors.includes("duplicate-tag")) errors.push("duplicate-tag");
    }
    // Sub-tag 00 is the GUID — it must match EXACTLY (CoArena audit,
    // 23 Nov 2026): a GUID that merely CONTAINS the QRIS GUID
    // ("XID.CO.QRIS.WWW") is not a QRIS payload. QRIS also requires
    // currency 360 (IDR) and country ID — a payload with the right
    // GUID but USD/US is not QRIS (QRIS audit, 23 Nov 2026).
    if (
      subTags["00"] &&
      subTags["00"] === QRIS_GUID &&
      fields.currency === "360" &&
      fields.country === "ID"
    ) {
      isQris = true;
      if (subTags["01"] && fields.pan === null) fields.pan = subTags["01"];
      if (subTags["02"] && fields.nmid === null) fields.nmid = subTags["02"];
      if (subTags["03"] && fields.criteria === null) fields.criteria = subTags["03"];
    }
  }

  // A payload without a CRC tag at the end is still a parseable
  // payload — it is just unprotected (crcValid stays false).

  return {
    isQris,
    valid,
    crcValid,
    crcExpected,
    crcActual,
    fields,
    errors,
  };
}

// ---------------------------------------------------------------------------
// 3. classifyQrText
//    "qris" (EMV MPM payload with the QRIS GUID) | "url" (link) |
//    "text" (anything else) | "none" (empty).
// ---------------------------------------------------------------------------
// Common public TLDs (subset of the list in src/filecheck.js) — a bare
// domain is only a URL when it ends in a real TLD, so ordinary dotted
// text ("my.file", "version 2.0") stays plain text (CoArena audit,
// 23 Nov 2026).
const URL_TLDS = new Set([
  "com", "net", "org", "io", "co", "id", "ly", "me", "gg", "xyz", "top",
  "site", "online", "info", "biz", "edu", "gov", "tv", "cc", "ai", "us",
  "uk", "de", "fr", "jp", "cn", "au", "sg", "my", "ph", "th", "vn", "in",
  "br", "ru", "kr", "nl", "es", "it", "ca", "mx", "app", "dev", "link",
  "click", "live", "shop", "store", "blog",
]);

export function classifyQrText(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { kind: "none", value: "", qris: null };
  }

  const trimmed = text.trim();

  // QRIS: starts with "000201" and parses as a QRIS payload.
  if (trimmed.startsWith("000201")) {
    const qris = parseEmvPayload(trimmed);
    if (qris.isQris) {
      return { kind: "qris", value: trimmed, qris };
    }
  }

  // URL: http/https/www prefix, or a bare domain with a path
  // ("bit.ly/3abc", "example.com/path").
  const urlPattern = /^(https?:\/\/|www\.)/i;
  const bareDomainPattern = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z]{2,}){1,}\/\S*/i;

  if (urlPattern.test(trimmed) || bareDomainPattern.test(trimmed)) {
    return { kind: "url", value: trimmed, qris: null };
  }

  // Bare domain without a path ("example.com") — only when it ends
  // in a real TLD, so dotted plain text stays plain text.
  const bareDomain = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.exec(trimmed);
  if (bareDomain) {
    const tld = trimmed.split(".").pop().toLowerCase();
    if (URL_TLDS.has(tld)) {
      return { kind: "url", value: trimmed, qris: null };
    }
  }

  return { kind: "text", value: trimmed, qris: null };
}

// ---------------------------------------------------------------------------
// 4. decodeQrFromImageData
//    Tiered local decode: BarcodeDetector (0 KB, Chromium/Edge) first,
//    then jsQR (lazy dynamic import — stays out of the main bundle).
//    Never throws, never uploads: returns the decoded string or null.
// ---------------------------------------------------------------------------
export async function decodeQrFromImageData(imageData) {
  if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
    return null;
  }

  // Tier 1: BarcodeDetector (built into Chromium/Edge).
  if (typeof BarcodeDetector !== "undefined") {
    try {
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      const results = await detector.detect(imageData);
      if (results && results.length > 0) {
        // Return the first result that actually carries a value
        // (CoArena audit, 23 Nov 2026): results[0] may be empty
        // while a later result holds the code.
        const found = results.find(
          (r) => typeof r.rawValue === "string" && r.rawValue.length > 0,
        );
        if (found) return found.rawValue;
      }
      // Found nothing usable — fall through to tier 2.
    } catch {
      // BarcodeDetector threw — fall through to tier 2.
    }
  }

  // Tier 2: jsQR (lazy-loaded, so it stays out of the main bundle).
  try {
    const jsQRModule = await import("jsqr");
    const jsQR = jsQRModule.default ?? jsQRModule;
    const result = jsQR(imageData.data, imageData.width, imageData.height);
    return result ? (result.data ?? null) : null;
  } catch {
    return null;
  }
}
