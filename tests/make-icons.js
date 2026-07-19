const { chromium } = require('playwright');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'app', 'icons');

const podSVG = `
<svg viewBox="0 0 140 112" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="70" cy="96" rx="54" ry="13" fill="#dcebf5" stroke="#b9cedd" stroke-width="2"/>
  <path d="M30,74 Q17,80 14,90" stroke="#9fb8c9" stroke-width="9" fill="none" stroke-linecap="round"/>
  <path d="M30,74 Q17,80 14,90" stroke="#ffffff" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M110,62 Q124,50 121,36" stroke="#9fb8c9" stroke-width="9" fill="none" stroke-linecap="round"/>
  <path d="M110,62 Q124,50 121,36" stroke="#ffffff" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M28,96 C28,42 44,24 70,24 C96,24 112,42 112,96 Z" fill="#ffffff" stroke="#b9cedd" stroke-width="2.5"/>
  <path d="M40,52 C42,38 50,30 60,28" stroke="#e6eff6" stroke-width="5" fill="none" stroke-linecap="round"/>
  <circle cx="48" cy="64" r="5" fill="#f9cdd2" opacity=".85"/>
  <circle cx="92" cy="64" r="5" fill="#f9cdd2" opacity=".85"/>
  <circle cx="56" cy="54" r="4.5" fill="#1c2b36"/><circle cx="84" cy="54" r="4.5" fill="#1c2b36"/>
  <path d="M55,66 Q70,78 85,66" stroke="#1c2b36" stroke-width="3.5" fill="none" stroke-linecap="round"/>
</svg>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  await page.setContent(`
    <style>
      body { margin: 0; }
      .icon {
        width: 512px; height: 512px;
        background: linear-gradient(135deg, #0a4266, #0e5a8a 60%, #0f8a8a);
        display: flex; align-items: center; justify-content: center;
      }
      .icon svg { width: 400px; height: auto; filter: drop-shadow(0 8px 16px rgba(0,0,0,.3)); }
    </style>
    <div class="icon">${podSVG}</div>`);
  const el = page.locator('.icon');
  await el.screenshot({ path: path.join(OUT, 'icon-512.png') });
  await page.setViewportSize({ width: 192, height: 192 });
  await page.evaluate(() => {
    const d = document.querySelector('.icon');
    d.style.width = '192px'; d.style.height = '192px';
    d.querySelector('svg').style.width = '150px';
  });
  await el.screenshot({ path: path.join(OUT, 'icon-192.png') });
  await browser.close();
  console.log('icons written');
})();
