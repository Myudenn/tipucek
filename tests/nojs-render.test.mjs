// No-JS render check for the 19 Nov 2026 stale-cache fix.
// Serves the built dist/ over a local static server and opens it in
// Chromium with JavaScript DISABLED: the page must show a neutral
// mode label ("…"), zero "Mode demo"/"Demo mode" in visible text, and
// the Indonesian hero — i.e. even with no JS at all, nothing claims
// a demo mode. Skips gracefully when Playwright is unavailable.
// Run: node --test tests/nojs-render.test.mjs
// (requires a prior `npm run build` so dist/ is current)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PLAYWRIGHT_PATH = path.join(
  process.env.HOME || "",
  "workspace/tools/rekam-layar/node_modules/playwright",
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

function serveDist() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const file =
        urlPath === "/"
          ? path.join(DIST, "index.html")
          : path.join(DIST, urlPath);
      if (!file.startsWith(DIST) || !existsSync(file)) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] || "application/octet-stream",
      });
      res.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

describe("no-JS render: neutral label, no mode claim, Indonesian hero", () => {
  it("dist page without JS shows … label and no demo-mode claim", async (t) => {
    if (!existsSync(path.join(DIST, "index.html"))) {
      t.skip("dist/ not built (run npm run build first)");
      return;
    }
    let playwright;
    try {
      playwright = createRequire(import.meta.url)(PLAYWRIGHT_PATH);
    } catch {
      t.skip("Playwright not available at " + PLAYWRIGHT_PATH);
      return;
    }
    const server = await serveDist();
    const port = server.address().port;
    const browser = await playwright.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
      const ctx = await browser.newContext({ javaScriptEnabled: false });
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:${port}/`, {
        waitUntil: "load",
        timeout: 30000,
      });
      const label = (await page.locator("#mode-label").innerText()).trim();
      assert.ok(
        label === "" || label === "…",
        `no-JS mode label must be neutral, got ${JSON.stringify(label)}`,
      );
      const bodyText = await page.evaluate(() => document.body.innerText);
      assert.doesNotMatch(
        bodyText,
        /demo mode|mode demo/i,
        "no-JS visible text must not claim a demo mode",
      );
      assert.match(bodyText, /Apakah pesan ini penipuan\?/);
      await ctx.close();
    } finally {
      await browser.close().catch(() => {});
      server.close();
    }
  });
});
