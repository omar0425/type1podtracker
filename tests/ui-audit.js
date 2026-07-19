const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const { pathToFileURL } = require('url');
const APP = pathToFileURL(path.join(__dirname, '..', 'public', 'app', 'index.html')).href;
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('dialog', d => d.accept());

  const iso = d => d.toISOString().slice(0, 10);
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // ---- onboarding tour (first run) ----
  await page.screenshot({ path: path.join(SHOTS, '00-tour.png') });
  await page.evaluate(() => { if (typeof endTour === 'function') endTour(); });

  // ---- empty state ----
  await page.screenshot({ path: path.join(SHOTS, '01-empty-desktop.png'), fullPage: true });

  // ---- seed realistic data ----
  await page.evaluate(([d4, d2, d1, d0]) => {
    const seed = [
      { id: 'a1', device: 'Dexcom G7 Sensor', serial: '210001234567', lot: '', seq: '', dateOn: d4, expiry: '', status: 'In use', dateFail: '', dateEnd: '', problem: '', ref: '' },
      { id: 'a2', device: 'Omnipod 5 Pod', serial: '', lot: 'L91234', seq: '0123456', dateOn: d1, expiry: '', status: 'In use', dateFail: '', dateEnd: '', problem: '', ref: '' },
      { id: 'a3', device: 'Omnipod 5 Pod', serial: '', lot: 'L88877', seq: '0099887', dateOn: d4, expiry: '', status: 'Submitted', dateFail: d2, dateEnd: '', problem: 'Screeching pod error alarm in the middle of a bolus, pod deactivated itself. Very long description to test wrapping behaviour in the table and the print form output area.', ref: 'CS-0012345' },
      { id: 'a4', device: 'Dexcom G7 Sensor', serial: '210009876543', lot: '', seq: '', dateOn: d4, expiry: '', status: 'Not submitted', dateFail: d0, dateEnd: '', problem: 'Sensor failed error on day 4', ref: '' },
      { id: 'a5', device: 'Dexcom G6 Sensor', serial: '210005556667', lot: '', seq: '', dateOn: d4, expiry: '', status: 'Completed OK', dateFail: '', dateEnd: d0, problem: '', ref: '' }
    ];
    localStorage.setItem('t1d_items', JSON.stringify(seed));
    localStorage.setItem('t1d_patient', JSON.stringify({ name: 'Alex Morgan', caregiver: 'Jamie Morgan', phone: '(555) 010-2030', email: 'jamie@example.com', address: '12 Maple St, Springfield, IL 62704' }));
  }, [daysAgo(4), daysAgo(2), daysAgo(1), daysAgo(0)]);
  await page.reload();
  await page.check('#showCompleted');
  await page.screenshot({ path: path.join(SHOTS, '02-populated-desktop.png'), fullPage: true });

  // ---- modal ----
  await page.locator('#activeBody tr').first().locator('button:has-text("It failed")').click();
  await page.screenshot({ path: path.join(SHOTS, '03-modal-desktop.png') });
  await page.click('#overlay button:has-text("Cancel")');

  // ---- print preview of claim form ----
  await page.evaluate(() => { window.print = () => {}; });
  await page.locator('#histBody tr', { hasText: 'L88877' }).locator('button:has-text("Print form")').click();
  await page.emulateMedia({ media: 'print' });
  await page.screenshot({ path: path.join(SHOTS, '04-print-claim.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });

  // ---- mobile ----
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await page.check('#showCompleted');
  await page.screenshot({ path: path.join(SHOTS, '05-populated-mobile.png'), fullPage: true });
  await page.locator('#activeBody tr').first().locator('button:has-text("It failed")').click();
  await page.screenshot({ path: path.join(SHOTS, '06-modal-mobile.png'), fullPage: true });
  await page.click('#overlay button:has-text("Cancel")');

  // ---- automated layout checks ----
  const audit = await page.evaluate(() => {
    const out = [];
    // body-level horizontal overflow
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
      out.push('PAGE OVERFLOW: body scrollWidth ' + document.documentElement.scrollWidth + ' > viewport ' + document.documentElement.clientWidth);
    // any element wider than viewport (excluding table wrappers which scroll internally)
    document.querySelectorAll('body *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.left < -1 || r.right > document.documentElement.clientWidth + 1)) {
        if (!el.closest('.tablewrap') && !el.closest('#printArea') && !el.closest('#overlay'))
          out.push('OFFSCREEN: <' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + '> right=' + Math.round(r.right));
      }
    });
    // tap targets under 40px tall on mobile
    document.querySelectorAll('button, select, input[type=checkbox]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < 30)
        out.push('SMALL TAP TARGET (' + Math.round(r.height) + 'px): ' + (el.innerText || el.id || el.type).slice(0, 30));
    });
    return out;
  });
  console.log('MOBILE AUDIT (375px):');
  console.log(audit.length ? audit.map(s => '  ' + s).join('\n') : '  clean');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.check('#showCompleted');
  const audit2 = await page.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
      out.push('PAGE OVERFLOW at desktop width');
    // check status select vs pill duplication visual size
    return out;
  });
  console.log('DESKTOP AUDIT (1280px):');
  console.log(audit2.length ? audit2.map(s => '  ' + s).join('\n') : '  clean');

  await page.evaluate(() => localStorage.clear());
  await browser.close();
  console.log('Screenshots in: ' + SHOTS);
})().catch(e => { console.error('CRASH:', e); process.exit(2); });
