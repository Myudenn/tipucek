// TipuCek — structural tests for firestore.rules.
//
// The Firestore emulator needs Java, which this VM does not have, so
// these tests assert on the rules text itself instead of running them:
// the verdict-only field list, the owner-only read, the hash-only
// report shape, and the deny-by-default update/delete. Labelled
// honestly: a structural test, NOT an emulator rules test. If Java
// becomes available, add @firebase/rules-unit-testing runs on top.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rules = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "firestore.rules"),
  "utf8",
);

test("checks: create allows ONLY the 7 verdict fields, never message text", () => {
  const m = rules.match(
    /match \/checks\/\{checkId\} \{([\s\S]*?)\n    \}/,
  );
  assert.ok(m, "checks rule block found");
  const block = m[1];
  assert.ok(
    block.includes(
      'request.resource.data.keys().hasOnly(["status", "riskScore", "redFlags", "summary", "source", "createdAt", "ownerUid"])',
    ),
    "create hasOnly lists exactly the 7 verdict fields",
  );
  assert.ok(!block.includes('"message"'), "no message field anywhere in checks rules");
  assert.ok(
    block.includes("request.resource.data.ownerUid == request.auth.uid"),
    "create requires ownerUid == caller uid",
  );
});

test("checks: create validates value types/ranges (audit round 7)", () => {
  const m = rules.match(/match \/checks\/\{checkId\} \{([\s\S]*?)\n    \}/);
  assert.ok(m, "checks rule block found");
  const block = m[1];
  assert.ok(
    block.includes('request.resource.data.status in ["scam", "suspicious", "safe"]'),
    "status is one of the three verdicts",
  );
  assert.ok(block.includes("request.resource.data.riskScore is int"), "riskScore must be an int");
  assert.ok(block.includes("request.resource.data.riskScore >= 0"), "riskScore min 0");
  assert.ok(block.includes("request.resource.data.riskScore <= 100"), "riskScore max 100");
  assert.ok(block.includes("request.resource.data.redFlags is list"), "redFlags must be a list");
  assert.ok(block.includes("request.resource.data.summary is string"), "summary must be a string");
  assert.ok(
    block.includes(
      'request.resource.data.source in ["ON_DEVICE", "IN_CLOUD", "DEMO", "LOCAL", "CODE", "Unknown"]',
    ),
    "source is one of the six known sources",
  );
  assert.ok(
    block.includes("request.resource.data.createdAt is string"),
    "createdAt is an ISO string (history.js writes toISOString, not a timestamp)",
  );
});

test("checks: read is owner-only; update/delete are denied", () => {
  const m = rules.match(/match \/checks\/\{checkId\} \{([\s\S]*?)\n    \}/);
  const block = m[1];
  assert.ok(
    block.includes("resource.data.ownerUid == request.auth.uid"),
    "read requires resource ownerUid == caller uid",
  );
  assert.ok(
    block.includes("allow update, delete: if false;"),
    "update/delete denied",
  );
});

test("reports: hash-only shape, count starts at 1, bump by exactly 1", () => {
  const m = rules.match(/match \/reports\/\{hash\} \{([\s\S]*?)\n    \}/);
  assert.ok(m, "reports rule block found");
  const block = m[1];
  assert.ok(
    block.includes(
      'request.resource.data.keys().hasOnly(["kind", "count", "firstSeen", "lastSeen"])',
    ),
    "create hasOnly lists exactly kind/count/firstSeen/lastSeen",
  );
  assert.ok(
    block.includes(
      'request.resource.data.kind in ["phone", "account", "filename", "filehash"]',
    ),
    "kind is one of the four hash kinds",
  );
  assert.ok(
    block.includes("request.resource.data.count == 1"),
    "create starts at count 1",
  );
  assert.ok(
    block.includes(
      'request.resource.data.diff(resource.data).affectedKeys().hasOnly(["count", "lastSeen"])',
    ),
    "update may only touch count + lastSeen",
  );
  assert.ok(
    block.includes("request.resource.data.count == resource.data.count + 1"),
    "update bumps count by exactly 1",
  );
  assert.ok(block.includes("allow delete: if false;"), "delete denied");
  assert.ok(!block.includes('"message"'), "no message field in reports rules");
});

test("rules: no blanket allow-all except public report-count reads", () => {
  const allows = [...rules.matchAll(/allow \w+(?:, \w+)*: if (true|false|request\.[^;]+);/g)];
  assert.ok(allows.length > 0, "allow statements found");
  for (const a of allows) {
    if (a[1] === "true") {
      assert.ok(
        a[0].startsWith("allow read:"),
        `only report-count reads may be public, got: ${a[0]}`,
      );
    }
  }
});

test("crowd_reports: create allows exactly the 6 fields, status pending", () => {
  const m = rules.match(/match \/crowd_reports\/\{reportId\} \{([\s\S]*?)\n    \}/);
  assert.ok(m, "crowd_reports rule block found");
  const block = m[1];
  assert.ok(
    block.includes(
      'request.resource.data.keys().hasOnly(["type", "value", "details", "status", "createdAt", "reporterUid"])',
    ),
    "create hasOnly lists exactly the 6 crowd fields",
  );
  assert.ok(
    block.includes('request.resource.data.type in ["phone", "account", "mode", "message", "file"]'),
    "type is one of the five crowd types",
  );
  assert.ok(
    block.includes("request.resource.data.value is string"),
    "value must be a string",
  );
  assert.ok(
    block.includes("request.resource.data.value.size() > 0"),
    "value must not be empty",
  );
  assert.ok(
    block.includes("request.resource.data.value.size() <= 2000"),
    "message value max length 2000 enforced",
  );
  assert.ok(
    block.includes("request.resource.data.value.size() <= 100"),
    "non-message value max length 100 enforced",
  );
  assert.ok(
    block.includes("request.resource.data.details is string"),
    "details must be a string",
  );
  assert.ok(
    block.includes('request.resource.data.status == "pending"'),
    "status must be pending",
  );
  assert.ok(
    block.includes("request.resource.data.details.size() >= 10"),
    "details min length 10 enforced",
  );
  assert.ok(
    block.includes("request.resource.data.details.size() <= 500"),
    "details max length 500 enforced",
  );
  assert.ok(
    block.includes("request.resource.data.createdAt is timestamp"),
    "createdAt must be a timestamp (serverTimestamp)",
  );
  assert.ok(
    block.includes("request.resource.data.reporterUid == null"),
    "reporterUid may be null (anonymous app)",
  );
  assert.ok(
    block.includes("request.resource.data.reporterUid == request.auth.uid"),
    "reporterUid may be the signer's own UID (future signed-in client)",
  );
});

test("crowd_reports: read/update/delete are denied for clients", () => {
  const m = rules.match(/match \/crowd_reports\/\{reportId\} \{([\s\S]*?)\n    \}/);
  const block = m[1];
  assert.ok(
    block.includes("allow read, update, delete: if false;"),
    "no client read/update/delete — the owner reads in Console",
  );
  // And no separate `allow read: if true` anywhere in the block.
  assert.ok(!/allow read: if true/.test(block), "crowd reports are never public");
});
