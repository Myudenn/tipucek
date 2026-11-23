// DOM probe: validate v12 scenario selectors against the FINAL frozen UI.
// Headed 1280x720, fresh profile. No debug token (DOM checks only).
// Usage: node ~/workspace/pesanaman/video/v12-dom-probe.cjs
const { chromium } = require('/home/hatch/workspace/tools/rekam-layar/node_modules/playwright');
const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME;
const PROXY_PORT = 18097;

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
  const out = path.join(HOME, 'workspace/pesanaman/video/build-v6-v12');
  const proxyProc = spawn(process.execPath, [
    path.join(HOME, 'workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js'),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let xvfb = null;
  try {
    await waitForPort('127.0.0.1', PROXY_PORT);
    xvfb = spawn('Xvfb', [':99', '-screen', '0', '1400x900x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((r) => setTimeout(r, 1500));
    const browser = await chromium.launch({
      executablePath: '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
      headless: false,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1280,720', '--window-position=0,0', '--hide-scrollbars', `--proxy-server=http://127.0.0.1:${PROXY_PORT}`],
      ignoreHTTPSErrors: true,
      env: { ...process.env, DISPLAY: ':99' },
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
    await page.goto('https://tipucek.web.app/?lang=en', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2500);

    const check = async (label, selector) => {
      const r = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { present: false };
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return { present: true, visible: cs.display !== 'none' && cs.visibility !== 'hidden' && rect.width > 0 && rect.height > 0, text: (el.innerText || el.value || '').trim().slice(0, 60) };
      }, selector);
      return { label, selector, ...r };
    };
    const checkText = async (label, text) => {
      const r = await page.evaluate((t) => {
        const els = [...document.querySelectorAll('button, a, h1, h2, h3, label, span')].filter((e) => (e.innerText || '').trim() === t);
        if (!els.length) return { present: false };
        const el = els[0];
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return { present: true, visible: cs.display !== 'none' && rect.width > 0 && rect.height > 0 };
      }, text);
      return { label, text, ...r };
    };

    const results = [];
    results.push(await page.evaluate(() => {
      const o = document.querySelector('#onboard');
      return { label: 'onboard modal visible on fresh load', present: !!o, visible: !!o && !o.hidden };
    }));
    // Dismiss via real click on #onboard-start (as a user would)
    const dismissed = await page.evaluate(() => {
      const o = document.querySelector('#onboard');
      if (o && !o.hidden) { document.querySelector('#onboard-start').click(); return true; }
      return false;
    });
    results.push({ label: 'onboard dismissed via #onboard-start', dismissed });
    await page.waitForTimeout(800);
    results.push(await check('sample OTP', '#message-input'));
    for (const t of ['Fake bank OTP warning', 'Wedding invite APK', 'Suspicious example', 'Safe example']) {
      results.push(await checkText(`sample "${t}"`, t));
    }
    for (const s of ['#message-input', '#check-btn', '#tab-btn-outbound', '#outbound-input', '#outbound-btn', '#image-input', '#image-preview', '#header-history-link', '#history-back-btn', '#senior-toggle', '#nav-history', '#nav-home']) {
      results.push(await check(s, s));
    }
    for (const t of ['Or check a screenshot', 'Check screenshot']) {
      results.push(await checkText(`"${t}"`, t));
    }
    results.push(await page.evaluate(() => ({
      label: 'views', homeHidden: document.querySelector('#view-home').hidden, historyHidden: document.querySelector('#view-history').hidden,
      bottomNavDisplay: getComputedStyle(document.querySelector('.bottomnav')).display,
    })));
    // Navigate to history via header link, check senior toggle + back btn
    await page.click('#header-history-link');
    await page.waitForTimeout(1000);
    results.push(await page.evaluate(() => ({
      label: 'after header-history-link', homeHidden: document.querySelector('#view-home').hidden, historyHidden: document.querySelector('#view-history').hidden,
    })));
    results.push(await check('senior-toggle (in history view)', '#senior-toggle'));
    results.push(await check('history-back-btn (in history view)', '#history-back-btn'));
    await page.click('#history-back-btn');
    await page.waitForTimeout(800);
    results.push(await page.evaluate(() => ({
      label: 'after history-back-btn', homeHidden: document.querySelector('#view-home').hidden, historyHidden: document.querySelector('#view-history').hidden,
    })));
    await page.screenshot({ path: path.join(out, 'v12-dom-probe-1280-top.png') });
    console.log(JSON.stringify(results, null, 2));
    await browser.close();
    console.log('PROBE OK');
  } finally {
    proxyProc.kill();
    if (xvfb) xvfb.kill();
  }
})();
