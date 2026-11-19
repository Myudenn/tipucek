// TipuCek — official contact directory (Indonesia).
//
// Verified 19 Nov 2026 against the companies' own sites / help pages.
// Numbers change — the UI says so and tells the user to confirm on the
// company's official channel before calling.
//
// Rules applied while verifying:
// - GoPay: conflicting numbers found (1500729 vs 021-50849000 vs
//   1500-992 vs 1500-128) -> NO number listed, "via the Gojek app".
// - Tokopedia: no official phone number exists -> "via the app
//   (Tokopedia Care)".
// - LinkAja: conflicting numbers (150911 vs 021-80602109) -> via app.
// - DANA: dana.id states "Call Center 1500 445", no CS WhatsApp.
// - Shopee: help.shopee.co.id lists 1500702.
// - OJK: Kontak 157 + WhatsApp 081157157157 + iasc.ojk.go.id.

export const CONTACTS = [
  { name: "BCA", cat: "bank", phone: "1500888", note: "Halo BCA" },
  { name: "BRI", cat: "bank", phone: "1500017 / 14017", note: "" },
  { name: "Mandiri", cat: "bank", phone: "14000", note: "" },
  { name: "BNI", cat: "bank", phone: "1500046", note: "" },
  { name: "BSI", cat: "bank", phone: "14040", note: "" },
  { name: "OVO", cat: "ewallet", phone: "1500696", note: "" },
  { name: "DANA", cat: "ewallet", phone: "1500445", note: "" },
  { name: "GoPay", cat: "ewallet", phone: null, via: "Gojek", note: "" },
  { name: "LinkAja", cat: "ewallet", phone: null, via: "LinkAja", note: "" },
  { name: "Shopee", cat: "marketplace", phone: "1500702", note: "" },
  { name: "Tokopedia", cat: "marketplace", phone: null, via: "Tokopedia Care", note: "" },
  { name: "Telkomsel", cat: "telecom", phone: "188", note: "" },
  { name: "Indosat", cat: "telecom", phone: "185", note: "" },
  { name: "XL", cat: "telecom", phone: "817", note: "" },
  { name: "OJK", cat: "official", phone: "157", note: "WA 081157157157 · iasc.ojk.go.id" },
  { name: "Polisi", cat: "official", phone: "110", note: "" },
];

/** Filter by free-text query and category ("all" = every category). */
export function filterContacts(query, cat) {
  const q = (query || "").trim().toLowerCase();
  return CONTACTS.filter((c) => {
    if (cat && cat !== "all" && c.cat !== cat) return false;
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      (c.phone || "").includes(q) ||
      (c.via || "").toLowerCase().includes(q)
    );
  });
}
