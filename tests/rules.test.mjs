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
