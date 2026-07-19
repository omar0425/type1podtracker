const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const { pathToFileURL } = require('url');
const APP = pathToFileURL(path.join(__dirname, '..', 'public', 'app', 'index.html')).href;
const VID_DIR = path.join(__dirname, 'video-out');
fs.mkdirSync(VID_DIR, { recursive: true });

const pause = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: VID_DIR, size: { width: 1280, height: 800 } }
  });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept());

  const iso = d => d.toISOString().slice(0, 10);
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
  const type = async (sel, text) => { await page.click(sel); await page.type(sel, text, { delay: 45 }); };

  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await pause(1500);

  // --- Poddy tour (all 4 steps) ---
  for (let i = 0; i < 4; i++) { await pause(2600); await page.click('#tourNext'); }
  await pause(1200);

  // --- your info ---
  await type('#pName', 'Brooklyn M.');
  await type('#pCaregiver', 'Mom & Dad');
  await type('#pPhone', '(555) 010-2030');
  await page.click('button:has-text("Save my info")');
  await pause(1400);

  // --- log a Dexcom ---
  await page.selectOption('#fDevice', 'Dexcom G7 Sensor');
  await pause(600);
  await type('#fSerial', '210001234567');
  await page.fill('#fDateOn', daysAgo(4));
  await pause(700);
  await page.click('#saveBtn');
  await pause(1600);

  // --- log a pod ---
  await page.selectOption('#fDevice', 'Omnipod 5 Pod');
  await pause(600);
  await type('#fLot', 'L91234');
  await type('#fSeq', '0123456');
  await page.fill('#fDateOn', daysAgo(1));
  await pause(700);
  await page.click('#saveBtn');
  await pause(1800);

  // --- scroll to the active table ---
  await page.locator('#activeBody').scrollIntoViewIfNeeded();
  await pause(1600);

  // --- the pod fails ---
  await page.locator('#activeBody tr', { hasText: 'Omnipod' }).locator('button:has-text("It failed")').click();
  await pause(1200);
  await type('#mProblem', 'Pod Error alarm during a bolus — screeching sound, pod shut down.');
  await pause(700);
  await page.click('#modalSave');
  await pause(1800);

  // --- failure log + status ---
  await page.locator('#histBody').scrollIntoViewIfNeeded();
  await pause(1400);
  await page.locator('#histBody tr', { hasText: 'Omnipod' }).locator('select').selectOption('Submitted');
  await pause(1600);

  // --- show the printable claim form ---
  await page.evaluate(() => { window.print = () => {}; });
  await page.locator('#histBody tr', { hasText: 'Omnipod' }).locator('button:has-text("Print form")').click();
  await page.emulateMedia({ media: 'print' });
  await pause(3200);
  await page.emulateMedia({ media: 'screen' });
  await pause(800);

  // --- excel download + backup ---
  await page.locator('button:has-text("Download Excel")').scrollIntoViewIfNeeded();
  await pause(1000);
  await page.click('button:has-text("Download Excel")');
  await pause(1800);
  await page.locator('button:has-text("Save backup file")').scrollIntoViewIfNeeded();
  await pause(2200);

  await page.evaluate(() => localStorage.clear());
  const video = page.video();
  await ctx.close();
  const raw = await video.path();
  const out = path.join(__dirname, '..', 'public', 'media', 'demo.webm');
  fs.copyFileSync(raw, out);
  await browser.close();
  console.log('video saved: ' + out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
})().catch(e => { console.error('CRASH:', e); process.exit(2); });
