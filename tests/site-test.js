const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:3000';
const SHOTS = path.join(__dirname, 'shots-site');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   << ' + (detail || '')));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));

  // ---- landing ----
  const resp = await page.goto(BASE + '/');
  check('Landing page loads (200)', resp.status() === 200);
  check('Hero + install + video sections present',
    await page.locator('.hero').count() === 1 &&
    await page.locator('#install').count() === 1 &&
    await page.locator('video').count() === 1);
  const vidSrcs = await page.locator('video source').evaluateAll(els => els.map(e => e.src));
  for (const src of vidSrcs) {
    const r = await page.request.get(src);
    check('Video source reachable: ' + src.split('/').pop(), r.status() === 200 && (await r.body()).length > 100000);
  }
  await page.screenshot({ path: path.join(SHOTS, 'landing.png'), fullPage: true });

  // ---- app under /app/ with PWA bits ----
  await page.goto(BASE + '/app/');
  check('App loads at /app/', await page.locator('#itemForm').count() === 1);
  await page.evaluate(() => { if (typeof endTour === 'function') endTour(); });
  const mani = await page.request.get(BASE + '/app/manifest.webmanifest');
  check('PWA manifest served', mani.status() === 200 && (await mani.json()).name.includes('T1D'));
  const sw = await page.request.get(BASE + '/app/sw.js');
  check('Service worker served', sw.status() === 200);
  const i192 = await page.request.get(BASE + '/app/icons/icon-192.png');
  const i512 = await page.request.get(BASE + '/app/icons/icon-512.png');
  check('Icons served', i192.status() === 200 && i512.status() === 200);
  await page.waitForTimeout(1200);
  const swActive = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(reg && (reg.active || reg.installing || reg.waiting));
  });
  check('Service worker registers on http', swActive);

  // ---- about ----
  await page.goto(BASE + '/about.html');
  check('About page loads with Brooklyn story', (await page.locator('.card').innerText()).includes('Brooklyn'));
  const photo = await page.request.get(BASE + '/img/family.jpg');
  check('Family photo serves placeholder until real one added',
    photo.status() === 200 && (photo.headers()['content-type'] || '').includes('svg'));
  await page.screenshot({ path: path.join(SHOTS, 'about.png'), fullPage: true });

  // ---- contact ----
  await page.goto(BASE + '/contact.html');
  await page.fill('#cName', 'Test Parent');
  await page.fill('#cEmail', 'parent@example.com');
  await page.fill('#cDevice', 'Freestyle Libre 3');
  await page.fill('#cMsg', 'Please add Libre 3 — failure info is a sensor error code in the app.');
  await page.click('#cSend');
  await page.waitForSelector('#result.ok', { timeout: 5000 });
  check('Contact form submits successfully', true);
  await page.screenshot({ path: path.join(SHOTS, 'contact.png'), fullPage: true });

  // missing required -> error message
  const bad = await page.request.post(BASE + '/api/contact', { data: { name: 'x' } });
  check('Contact API rejects empty message', bad.status() === 400);

  // honeypot silently accepted but not stored
  await page.request.post(BASE + '/api/contact', { data: { device: 'spam', message: 'spam', website: 'http://spam' } });

  // admin endpoint guarded + message stored
  const noKey = await page.request.get(BASE + '/api/messages');
  check('Messages endpoint locked without key', noKey.status() === 403);
  const withKey = await page.request.get(BASE + '/api/messages?key=test123');
  const msgs = await withKey.json();
  check('Message stored & readable with admin key',
    withKey.status() === 200 && msgs.some(m => m.device === 'Freestyle Libre 3'), JSON.stringify(msgs));
  check('Honeypot submission not stored', !msgs.some(m => m.device === 'spam'));

  // visitor stats
  const statsLocked = await page.request.get(BASE + '/api/stats');
  check('Stats endpoint locked without key', statsLocked.status() === 403);
  const statsRes = await page.request.get(BASE + '/api/stats?key=test123');
  const statsData = await statsRes.json();
  const today = new Date().toISOString().slice(0, 10);
  check('Stats count views + unique visitors, no raw IPs',
    statsRes.status() === 200 && statsData.totalViews >= 3 &&
    statsData.days[today] && statsData.days[today].visitors >= 1 &&
    !JSON.stringify(statsData).includes('127.0.0.1'),
    JSON.stringify(statsData));

  check('No console errors across site', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log('\n========== ' + results.filter(r => r.pass).length + '/' + results.length + ' passed ==========');
  process.exit(results.some(r => !r.pass) ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(2); });
