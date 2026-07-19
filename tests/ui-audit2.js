const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const { pathToFileURL } = require('url');
const APP = pathToFileURL(path.join(__dirname, '..', 'public', 'app', 'index.html')).href;
const SHOTS = path.join(__dirname, 'shots2');
fs.mkdirSync(SHOTS, { recursive: true });

const overlap = (a, b) => !(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('dialog', d => d.accept());
  const iso = d => d.toISOString().slice(0, 10);
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

  await page.goto(APP);
  await page.evaluate(([d4, d2, d1, d0]) => {
    localStorage.setItem('t1d_items', JSON.stringify([
      { id: 'a1', device: 'Dexcom G7 Sensor', serial: '210001234567', lot: '', seq: '', dateOn: d4, expiry: '', status: 'In use', dateFail: '', dateEnd: '', problem: '', ref: '' },
      { id: 'a3', device: 'Omnipod 5 Pod', serial: '', lot: 'L88877', seq: '0099887', dateOn: d4, expiry: '', status: 'Submitted', dateFail: d2, dateEnd: '', problem: 'Screeching pod error alarm during bolus', ref: 'CS-0012345' }
    ]));
    localStorage.setItem('t1d_patient', JSON.stringify({ name: 'Alex Morgan', caregiver: 'Jamie Morgan', phone: '(555) 010-2030', email: 'jamie@example.com', address: '12 Maple St, Springfield, IL 62704' }));
    localStorage.setItem('t1d_tour_done', '1');
  }, [daysAgo(4), daysAgo(2), daysAgo(1), daysAgo(0)]);

  // ---- header mascot overlap across widths ----
  for (const w of [1400, 1280, 1100, 1000, 900, 830, 780, 760, 720, 500, 375]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.reload();
    const r = await page.evaluate(() => {
      const m = document.querySelector('.mascot');
      const p = document.querySelector('header.app p');
      const h1 = document.querySelector('header.app h1');
      const mv = m && getComputedStyle(m).display !== 'none';
      const box = el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
      const bub = document.querySelector('.bubble');
      const bubv = bub && getComputedStyle(bub).display !== 'none';
      return {
        mascotVisible: mv, bubbleVisible: bubv,
        overlapP: mv ? JSON.stringify([box(m), box(p)]) : null,
        pOverlap: mv ? undefined : false,
        boxes: mv ? { m: box(m), p: box(p), h1: box(h1) } : null
      };
    });
    if (r.mascotVisible) {
      const oP = overlap(r.boxes.m, r.boxes.p);
      const oH = overlap(r.boxes.m, r.boxes.h1);
      console.log(`w=${w}: mascot visible, bubble=${r.bubbleVisible}, overlap-with-subtitle=${oP}, overlap-with-title=${oH}`);
    } else {
      console.log(`w=${w}: mascot hidden`);
    }
  }

  // shots at suspicious widths
  for (const w of [960, 830, 780]) {
    await page.setViewportSize({ width: w, height: 500 });
    await page.reload();
    await page.screenshot({ path: path.join(SHOTS, `header-${w}.png`) });
  }

  // ---- modal: sad pod vs fields across widths ----
  for (const w of [1280, 900, 700, 560, 500, 420]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.reload();
    await page.locator('#activeBody tr').first().locator('button:has-text("It failed")').click();
    const r = await page.evaluate(() => {
      const pod = document.querySelector('.modal [data-pod]');
      const v = pod && getComputedStyle(pod).display !== 'none';
      if (!v) return { visible: false };
      const box = el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
      const collisions = [];
      document.querySelectorAll('.modal input, .modal select, .modal textarea, .modal label, .modal h3, .modal .which').forEach(el => {
        const a = box(pod), b = box(el);
        if (!(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1))
          collisions.push((el.tagName + ' ' + (el.innerText || el.id || '').slice(0, 25)).trim());
      });
      return { visible: true, collisions };
    });
    console.log(`modal w=${w}: pod=${r.visible ? 'visible' : 'hidden'}${r.visible && r.collisions.length ? ' COLLIDES: ' + r.collisions.join(' | ') : r.visible ? ' clean' : ''}`);
    await page.screenshot({ path: path.join(SHOTS, `modal-${w}.png`) });
    await page.click('#overlay button:has-text("Cancel")');
  }

  // populated desktop + mobile fresh shots with mascot
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.screenshot({ path: path.join(SHOTS, 'populated-1280.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await page.screenshot({ path: path.join(SHOTS, 'populated-375.png'), fullPage: true });

  // empty state (pods in empty slots)
  await page.evaluate(() => localStorage.removeItem('t1d_items'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await page.screenshot({ path: path.join(SHOTS, 'empty-1280.png'), fullPage: true });

  await page.evaluate(() => localStorage.clear());
  await browser.close();
  console.log('shots in ' + SHOTS);
})().catch(e => { console.error('CRASH:', e); process.exit(2); });
