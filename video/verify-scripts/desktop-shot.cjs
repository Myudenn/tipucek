// Desktop screenshot of the LIVE site for Myuden (21 Nov 2026).
// Usage: node ~/workspace/pesanaman/video/verify-scripts/desktop-shot.cjs
const { chromium } = require('/home/hatch/workspace/tools/rekam-layar/node_modules/playwright');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME;
const PROXY_PORT = 18098;

async function waitForPort(host, port, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const s = net.connect(port, host);
        s.once('connect', () => { s.end(); resolve(); });
        s.once('error', reject);
      });
      return;
    } catch (_) { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error(`port ${host}:${port} did not open`);
}

(async () => {
  const out = path.join(HOME, 'workspace/pesanaman/video/panel-lainnya-shots');
  fs.mkdirSync(out, { recursive: true });
  const proxyProc = spawn(process.execPath, [
    path.join(HOME, 'workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js'),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await waitForPort('127.0.0.1', PROXY_PORT);
    const browser = await chromium.launch({ executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome', args: [`--proxy-server=http://127.0.0.1:${PROXY_PORT}`], ignoreHTTPSErrors: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
    await page.goto('https://tipucek.web.app', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, 'desktop-top-1280.png') });
    const grid = await page.$('text=Fitur lainnya');
    if (grid) await grid.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, 'desktop-grid-1280.png') });
    await browser.close();
    console.log('OK');
  } finally {
    proxyProc.kill();
  }
})();
