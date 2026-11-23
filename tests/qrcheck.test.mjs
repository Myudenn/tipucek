// QR check tests (23 Nov 2026).
// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF): the "123456789" ->
// 0x29B1 vector is the standard CCITT-FALSE check value, verified
// against Python binascii.crc_hqx("123456789", 0xFFFF) = 0x29b1.
// The QRIS payloads below are built in-test (TLV + our own CRC),
// so a wrong CRC implementation fails the round-trip, not just a
// memorised constant. The decode path (BarcodeDetector / jsQR) needs
// real pixels, so it is covered live in the browser, not here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  crc16ccittFalse,
  parseEmvPayload,
  classifyQrText,
  decodeQrFromImageData,
} from "../src/qrcheck.js";

// TLV helper: tag + 2-digit decimal length + value.
const tlv = (tag, v) => tag + String(v.length).padStart(2, "0") + v;

// A static QRIS payload (merchant "TOKO BERKAH", Jakarta), signed
// with the CRC this module computes. Built once, reused by the tests.
const QRIS_SUB =
  tlv("00", "ID.CO.QRIS.WWW") +
  tlv("01", "9360099999999999") +
  tlv("02", "ID1020023456789") +
  tlv("03", "UMI");
const QRIS_BODY =
  tlv("00", "01") +
  tlv("01", "11") +
  tlv("26", QRIS_SUB) +
  tlv("52", "5399") +
  tlv("53", "360") +
  tlv("58", "ID") +
  tlv("59", "TOKO BERKAH") +
  tlv("60", "JAKARTA") +
  "6304";
const QRIS_CRC = crc16ccittFalse(QRIS_BODY).toString(16).toUpperCase().padStart(4, "0");
const QRIS_PAYLOAD = QRIS_BODY + QRIS_CRC;

describe("CRC-16/CCITT-FALSE", () => {
  it("check value: crc16ccittFalse('123456789') === 0x29B1", () => {
    assert.equal(crc16ccittFalse("123456789"), 0x29b1);
  });
  it("empty string is the init value 0xFFFF", () => {
    assert.equal(crc16ccittFalse(""), 0xffff);
  });
  it("one changed byte changes the CRC", () => {
    assert.notEqual(crc16ccittFalse("123456789"), crc16ccittFalse("123456788"));
  });
});

describe("parseEmvPayload — QRIS", () => {
  it("a correctly signed QRIS payload is valid with all fields read", () => {
    const p = parseEmvPayload(QRIS_PAYLOAD);
    assert.equal(p.isQris, true);
    assert.equal(p.valid, true);
    assert.equal(p.crcValid, true);
    assert.equal(p.crcExpected, QRIS_CRC);
    assert.equal(p.crcActual, QRIS_CRC);
    assert.deepEqual(p.errors, []);
    assert.equal(p.fields.initiation, "11");
    assert.equal(p.fields.mcc, "5399");
    assert.equal(p.fields.currency, "360");
    assert.equal(p.fields.amount, null);
    assert.equal(p.fields.country, "ID");
    assert.equal(p.fields.merchantName, "TOKO BERKAH");
    assert.equal(p.fields.merchantCity, "JAKARTA");
    assert.equal(p.fields.nmid, "ID1020023456789");
    assert.equal(p.fields.pan, "9360099999999999");
    assert.equal(p.fields.criteria, "UMI");
  });
  it("a dynamic QRIS payload carries the amount (tag 54)", () => {
    const body =
      tlv("00", "01") +
      tlv("01", "12") +
      tlv("26", QRIS_SUB) +
      tlv("52", "5411") +
      tlv("53", "360") +
      tlv("54", "50000") +
      tlv("58", "ID") +
      tlv("59", "WARUNG KOPI") +
      tlv("60", "BANDUNG") +
      "6304";
    const crc = crc16ccittFalse(body).toString(16).toUpperCase().padStart(4, "0");
    const p = parseEmvPayload(body + crc);
    assert.equal(p.isQris, true);
    assert.equal(p.crcValid, true);
    assert.equal(p.fields.amount, "50000");
    assert.equal(p.fields.initiation, "12");
    assert.equal(p.fields.merchantName, "WARUNG KOPI");
  });
  it("one corrupted digit breaks the CRC but the payload still parses", () => {
    const bad = QRIS_PAYLOAD.slice(0, -1) + (QRIS_CRC.endsWith("0") ? "1" : "0");
    const p = parseEmvPayload(bad);
    assert.equal(p.crcValid, false);
    assert.equal(p.valid, true);
    assert.equal(p.isQris, true);
    assert.ok(p.errors.includes("crc-mismatch"));
    // The corrupted CRC is still read back as the expected value.
    assert.equal(p.crcExpected, bad.slice(-4));
  });
  it("a payload without a CRC tag is unprotected, not unparseable", () => {
    const p = parseEmvPayload(QRIS_PAYLOAD.slice(0, -8));
    assert.equal(p.isQris, true);
    assert.equal(p.valid, true);
    assert.equal(p.crcValid, false);
    assert.equal(p.crcExpected, null);
    assert.equal(p.crcActual, null);
    assert.ok(p.errors.includes("no-crc"));
  });
  it("a truncated payload is invalid", () => {
    const p = parseEmvPayload(QRIS_PAYLOAD.slice(0, 20));
    assert.equal(p.valid, false);
    assert.ok(p.errors.includes("truncated"));
  });
  it("a payload with a broken TLV length inside the QRIS template is invalid", () => {
    // Template 26 claims a longer value than the payload holds.
    const broken = tlv("00", "01") + tlv("01", "11") + "2699" + QRIS_SUB + tlv("53", "360") + "6304";
    const crc = crc16ccittFalse(broken).toString(16).toUpperCase().padStart(4, "0");
    const p = parseEmvPayload(broken + crc);
    assert.equal(p.valid, false);
    assert.ok(p.errors.includes("truncated"));
  });
  it("an EMV payload without the QRIS GUID is not QRIS", () => {
    const other =
      tlv("00", "01") +
      tlv("01", "11") +
      tlv("26", tlv("00", "OTHER.GUID") + tlv("01", "1234")) +
      tlv("53", "360") +
      "6304";
    const crc = crc16ccittFalse(other).toString(16).toUpperCase().padStart(4, "0");
    const p = parseEmvPayload(other + crc);
    assert.equal(p.isQris, false);
    assert.equal(p.valid, true);
    assert.equal(p.crcValid, true);
  });
  it("CoArena audit (23 Nov): a GUID that merely CONTAINS the QRIS GUID is not QRIS", () => {
    const other =
      tlv("00", "01") +
      tlv("01", "11") +
      tlv("26", tlv("00", "XID.CO.QRIS.WWW") + tlv("01", "1234")) +
      tlv("53", "360") +
      "6304";
    const crc = crc16ccittFalse(other).toString(16).toUpperCase().padStart(4, "0");
    const p = parseEmvPayload(other + crc);
    assert.equal(p.isQris, false);
  });
  it("CoArena audit (23 Nov): data after tag 63 makes the payload invalid", () => {
    // A valid QRIS payload with an extra TLV appended AFTER the CRC.
    const extra = QRIS_PAYLOAD + tlv("59", "EXTRA");
    const p = parseEmvPayload(extra);
    assert.equal(p.valid, false);
    assert.ok(p.errors.includes("crc-not-last"));
  });
  it("non-EMV input never throws and reports not-emv", () => {
    for (const bad of ["", "hello world", "https://example.com", null, undefined, 123]) {
      const p = parseEmvPayload(bad);
      assert.equal(p.isQris, false);
      assert.equal(p.valid, false);
      assert.ok(p.errors.includes("not-emv"));
    }
  });
});

describe("classifyQrText", () => {
  it("QRIS payload -> qris with the parse result attached", () => {
    const c = classifyQrText(QRIS_PAYLOAD);
    assert.equal(c.kind, "qris");
    assert.equal(c.value, QRIS_PAYLOAD);
    assert.equal(c.qris.isQris, true);
    assert.equal(c.qris.fields.merchantName, "TOKO BERKAH");
  });
  it("URLs -> url (https, www, bare domain with path, bare domain)", () => {
    assert.equal(classifyQrText("https://example.com/x").kind, "url");
    assert.equal(classifyQrText("http://bit.ly/3abc").kind, "url");
    assert.equal(classifyQrText("www.example.com/promo").kind, "url");
    assert.equal(classifyQrText("bit.ly/3abc").kind, "url");
    // CoArena audit (23 Nov): a bare domain is a URL too.
    assert.equal(classifyQrText("example.com").kind, "url");
    assert.equal(classifyQrText("sub.example.co.id").kind, "url");
  });
  it("CoArena audit (23 Nov): dotted plain text is NOT a URL", () => {
    assert.equal(classifyQrText("my.file").kind, "text");
    assert.equal(classifyQrText("version 2.0").kind, "text");
    assert.equal(classifyQrText("halo dunia").kind, "text");
  });
  it("plain text -> text", () => {
    assert.equal(classifyQrText("halo ini teks biasa").kind, "text");
    assert.equal(classifyQrText("Kode: 482916").kind, "text");
  });
  it("empty or whitespace -> none", () => {
    assert.deepEqual(classifyQrText(""), { kind: "none", value: "", qris: null });
    assert.deepEqual(classifyQrText("   "), { kind: "none", value: "", qris: null });
    assert.deepEqual(classifyQrText(null), { kind: "none", value: "", qris: null });
  });
});

describe("QRIS audit fixes (23 Nov 2026)", () => {
  // TLV helper with the length in UTF-8 BYTES (EMV counts bytes, not
  // JS characters) — needed for non-ASCII values.
  const tlvB = (tag, v) =>
    tag + String(new TextEncoder().encode(v).length).padStart(2, "0") + v;
  const crcHex = (body) =>
    crc16ccittFalse(body).toString(16).toUpperCase().padStart(4, "0");

  it("a CRC value of exactly 6304 is accepted (not mistaken for the tag header)", () => {
    // Amount 179484 makes the CRC 0x6304 — found by brute force and
    // verified independently with Python binascii.crc_hqx.
    const body =
      tlv("00", "01") +
      tlv("01", "11") +
      tlv("26", QRIS_SUB) +
      tlv("52", "5399") +
      tlv("53", "360") +
      tlv("54", "179484") +
      tlv("58", "ID") +
      tlv("59", "TOKO BERKAH") +
      tlv("60", "JAKARTA") +
      "6304";
    assert.equal(crcHex(body), "6304");
    const p = parseEmvPayload(body + "6304");
    assert.equal(p.isQris, true);
    assert.equal(p.valid, true);
    assert.equal(p.crcValid, true);
    assert.equal(p.crcExpected, "6304");
    assert.deepEqual(p.errors, []);
  });
  it("trailing data starting with 6304 cannot bypass the crc-not-last guard", () => {
    // Forged: a valid payload, then a second "6304" + a CRC computed
    // over everything before it — the old lastIndexOf search took
    // the second marker for the tag header and called it valid.
    const forged = QRIS_PAYLOAD + "6304" + crcHex(QRIS_PAYLOAD + "6304");
    const p = parseEmvPayload(forged);
    assert.equal(p.valid, false);
    assert.equal(p.crcValid, false);
    assert.ok(p.errors.includes("crc-not-last"));
  });
  it("a payload with the QRIS GUID but foreign currency/country is not QRIS", () => {
    const usd =
      tlv("00", "01") +
      tlv("01", "11") +
      tlv("26", QRIS_SUB) +
      tlv("52", "5399") +
      tlv("53", "840") +
      tlv("58", "US") +
      tlv("59", "TOKO BERKAH") +
      tlv("60", "JAKARTA") +
      "6304";
    const pUsd = parseEmvPayload(usd + crcHex(usd));
    assert.equal(pUsd.isQris, false);
    assert.equal(classifyQrText(usd + crcHex(usd)).kind, "text");
    const sg =
      tlv("00", "01") +
      tlv("01", "11") +
      tlv("26", QRIS_SUB) +
      tlv("52", "5399") +
      tlv("53", "360") +
      tlv("58", "SG") +
      tlv("59", "TOKO BERKAH") +
      tlv("60", "JAKARTA") +
      "6304";
    assert.equal(parseEmvPayload(sg + crcHex(sg)).isQris, false);
  });
  it("a non-ASCII merchant name parses with byte lengths (CAFÉ is 5 bytes, not 4)", () => {
    const body =
      tlv("00", "01") +
      tlv("01", "11") +
      tlv("26", QRIS_SUB) +
      tlv("52", "5399") +
      tlv("53", "360") +
      tlv("58", "ID") +
      tlvB("59", "CAFÉ") +
      tlv("60", "JAKARTA") +
      "6304";
    const p = parseEmvPayload(body + crcHex(body));
    assert.equal(p.fields.merchantName, "CAFÉ");
    assert.equal(p.fields.merchantCity, "JAKARTA");
    assert.equal(p.valid, true);
    assert.equal(p.crcValid, true);
    assert.deepEqual(p.errors, []);
  });
  it("a non-hex CRC value is malformed, not 'no CRC'", () => {
    const p = parseEmvPayload(QRIS_BODY + "ZZZZ");
    assert.equal(p.crcValid, false);
    assert.equal(p.crcExpected, "ZZZZ");
    assert.ok(p.errors.includes("crc-malformed"));
    assert.ok(!p.errors.includes("no-crc"));
  });
  it("tag 63 with the wrong length is bad-length, not no-crc", () => {
    const body = QRIS_BODY.slice(0, -4);
    const p = parseEmvPayload(body + "6305ABCDE");
    assert.equal(p.valid, false);
    assert.ok(p.errors.includes("bad-length"));
    assert.ok(!p.errors.includes("no-crc"));
  });
  it("a duplicated top-level tag is malformed", () => {
    const dup = QRIS_PAYLOAD + tlv("59", "EXTRA");
    const p = parseEmvPayload(dup);
    assert.equal(p.valid, false);
    assert.ok(p.errors.includes("duplicate-tag"));
  });
  it("a payload that is only the format indicator is degenerate, not valid", () => {
    const p = parseEmvPayload("000201");
    assert.equal(p.valid, false);
    assert.ok(p.errors.includes("empty-payload"));
  });
  it("surrounding whitespace is trimmed, not a parse failure", () => {
    const p = parseEmvPayload(`\n${QRIS_PAYLOAD}\n`);
    assert.equal(p.isQris, true);
    assert.equal(p.valid, true);
    assert.equal(p.crcValid, true);
  });
});

describe("decodeQrFromImageData — no-QR path", () => {
  it("returns null (never throws) for missing or empty input", async () => {
    assert.equal(await decodeQrFromImageData(null), null);
    assert.equal(await decodeQrFromImageData({}), null);
    assert.equal(await decodeQrFromImageData({ data: null, width: 10, height: 10 }), null);
  });
  it("returns null for a blank white image (no QR present)", async () => {
    // A 100x100 all-white frame: jsQR finds nothing in it.
    const data = new Uint8ClampedArray(100 * 100 * 4).fill(255);
    assert.equal(await decodeQrFromImageData({ data, width: 100, height: 100 }), null);
  });
});
