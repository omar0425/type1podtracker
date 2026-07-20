const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const { pathToFileURL } = require('url');
const APP = pathToFileURL(path.join(__dirname, '..', 'public', 'app', 'index.html')).href;
const DL_DIR = path.join(__dirname, 'downloads');
fs.mkdirSync(DL_DIR, { recursive: true });

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   << ' + (detail || '')));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true });

  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  // dialog handling: record all, accept unless told to dismiss
  const dialogs = [];
  let dismissNext = false;
  page.on('dialog', async d => {
    dialogs.push({ type: d.type(), msg: d.message() });
    if (dismissNext) { dismissNext = false; await d.dismiss(); } else await d.accept();
  });

  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const today = new Date();
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

  await page.goto(APP);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();

  /* ---------- 1. load ---------- */
  check('Page loads with XLSX library', await page.evaluate(() => typeof XLSX !== 'undefined'));
  check('No console errors on load', consoleErrors.length === 0, consoleErrors.join(' | '));

  /* ---------- 1b. onboarding tour ---------- */
  check('Onboarding tour shows on first run', await page.locator('#tour.open').count() === 1);
  check('Back button hidden on first step',
    await page.locator('#tourBack').evaluate(el => getComputedStyle(el).visibility) === 'hidden');
  await page.click('#tourNext'); await page.click('#tourNext'); await page.click('#tourNext');
  check('Last tour step shows "Let\'s go!"', (await page.locator('#tourNext').innerText()).includes("Let's go"));
  await page.click('#tourNext');
  check('Tour closes after finishing', await page.locator('#tour.open').count() === 0);
  await page.reload();
  check('Tour does not reappear after completion', await page.locator('#tour.open').count() === 0);

  /* ---------- 2. patient info persistence ---------- */
  await page.fill('#pName', 'Test Kid');
  await page.fill('#pCaregiver', 'Test Parent');
  await page.fill('#pPhone', '555-0100');
  await page.click('button:has-text("Save my info")');
  await page.reload();
  check('Patient info persists after reload', await page.inputValue('#pName') === 'Test Kid');

  /* ---------- 3. validation ---------- */
  async function addDevice(device, fields, dateOn) {
    await page.selectOption('#fDevice', device);
    for (const [sel, val] of Object.entries(fields)) await page.fill(sel, val);
    if (dateOn) await page.fill('#fDateOn', dateOn);
    await page.click('#saveBtn');
  }

  let nDialogs = dialogs.length;
  await addDevice('Omnipod 5 Pod', { '#fLot': 'L11111' }, daysAgo(1)); // missing seq
  check('Omnipod missing sequence # blocked with alert',
    dialogs.length === nDialogs + 1 && /BOTH/i.test(dialogs.at(-1).msg),
    JSON.stringify(dialogs.at(-1)));
  check('Blocked Omnipod not added', await page.locator('#activeBody tr').count() === 0);

  nDialogs = dialogs.length;
  await addDevice('Dexcom G7 Sensor', {}, daysAgo(1)); // missing serial
  check('Dexcom missing serial blocked with alert',
    dialogs.length === nDialogs + 1 && /serial/i.test(dialogs.at(-1).msg));

  /* ---------- 4. valid adds ---------- */
  await addDevice('Dexcom G7 Sensor', { '#fSerial': '210000111111' }, daysAgo(4));
  await addDevice('Omnipod 5 Pod', { '#fLot': 'L22222', '#fSeq': '0055555' }, daysAgo(1));
  check('Two valid devices appear in active table', await page.locator('#activeBody tr').count() === 2);

  const dexRow = page.locator('#activeBody tr', { hasText: 'Dexcom' });
  check('Day counter correct (Day 4 of 10)', (await dexRow.innerText()).includes('Day 4 of 10'));
  const expectChange = (() => { const d = new Date(); d.setDate(d.getDate() - 4 + 10);
    return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + '/' + d.getFullYear(); })();
  check('Change-by date = put on + 10 days', (await dexRow.innerText()).includes(expectChange),
    'expected ' + expectChange + ' in: ' + await dexRow.innerText());

  /* ---------- 5. rapid double-add (id collision fix) ---------- */
  await addDevice('Dexcom G6 Sensor', { '#fSerial': '210000222222' }, daysAgo(2));
  await addDevice('Dexcom G6 Sensor', { '#fSerial': '210000333333' }, daysAgo(2));
  check('Rapid adds do not overwrite each other', await page.locator('#activeBody tr').count() === 4);

  /* ---------- 6. persistence of items ---------- */
  await page.reload();
  check('Items persist after reload', await page.locator('#activeBody tr').count() === 4);

  /* ---------- 7. mark-failed flow ---------- */
  await page.locator('#activeBody tr', { hasText: 'Omnipod' }).locator('button:has-text("It failed")').click();
  check('Fail modal opens', await page.locator('#overlay.open').count() === 1);

  nDialogs = dialogs.length;
  await page.click('#modalSave'); // empty problem
  check('Empty problem description blocked', dialogs.length === nDialogs + 1 && /describe/i.test(dialogs.at(-1).msg));

  nDialogs = dialogs.length;
  await page.fill('#mProblem', 'Pod error alarm mid-bolus');
  await page.fill('#mDateFail', daysAgo(5)); // before put-on date (1 day ago)
  await page.click('#modalSave');
  check('Failure date before put-on date blocked', dialogs.length === nDialogs + 1 && /before/i.test(dialogs.at(-1).msg));

  await page.fill('#mDateFail', daysAgo(0));
  await page.click('#modalSave');
  check('Valid failure saved; moved out of active', await page.locator('#activeBody tr').count() === 3);
  const histRow = page.locator('#histBody tr', { hasText: 'Omnipod' });
  check('Failure appears in history with Not submitted pill', (await histRow.innerText()).includes('Not submitted'));

  /* ---------- 8. overwear warning ---------- */
  await page.locator('#activeBody tr', { hasText: '210000111111' }).locator('button:has-text("It failed")').click();
  await page.fill('#mDateFail', daysAgo(0)); // worn 4 days, rated 10 -> no warning
  const warnHidden = await page.locator('#modalWarn').isHidden();
  await page.fill('#mDateFail', iso(new Date(today.getTime() + 8 * 86400000))); // day 12 > 10
  await page.dispatchEvent('#mDateFail', 'change');
  const warnShown = await page.locator('#modalWarn').isVisible();
  check('Overwear warning only when past rated days', warnHidden && warnShown);
  await page.click('#overlay button:has-text("Cancel")');
  check('Modal cancel leaves device active', await page.locator('#activeBody tr').count() === 3);

  /* ---------- 9. worn full life + undo ---------- */
  await page.locator('#activeBody tr', { hasText: '210000222222' }).locator('button:has-text("Worn full life")').click();
  check('Completed device leaves active table', await page.locator('#activeBody tr').count() === 2);
  check('Completed hidden from history by default', !(await page.locator('#histBody').innerText()).includes('210000222222'));
  await page.check('#showCompleted');
  check('Checkbox reveals completed device', (await page.locator('#histBody').innerText()).includes('Completed OK'));
  await page.locator('#histBody tr', { hasText: '210000222222' }).locator('button:has-text("Undo")').click(); // confirm auto-accepted
  check('Undo returns device to active', await page.locator('#activeBody tr').count() === 3);

  /* ---------- 10. delete: dismiss vs accept ---------- */
  dismissNext = true;
  await page.locator('#activeBody tr', { hasText: '210000333333' }).locator('button.secondary').last().click();
  check('Delete cancelled keeps device', await page.locator('#activeBody tr').count() === 3);
  await page.locator('#activeBody tr', { hasText: '210000333333' }).locator('button.secondary').last().click();
  check('Delete confirmed removes device', await page.locator('#activeBody tr').count() === 2);

  /* ---------- 11. status pipeline + persistence ---------- */
  await page.locator('#histBody tr', { hasText: 'Omnipod' }).locator('select').selectOption('Submitted');
  await page.reload();
  await page.check('#showCompleted');
  check('Status change persists after reload',
    (await page.locator('#histBody tr', { hasText: 'Omnipod' }).innerText()).includes('Submitted'));

  /* ---------- 12. XSS / injection ---------- */
  await addDevice('Dexcom G7 Sensor', { '#fSerial': '<img src=x onerror=window.__xss=1>' }, daysAgo(1));
  await page.waitForTimeout(300);
  check('Serial field HTML is escaped in table', await page.evaluate(() => !window.__xss) &&
    await page.locator('#activeBody img').count() === 0);

  // fail it with an XSS problem description, then print
  await page.locator('#activeBody tr', { hasText: 'onerror' }).locator('button:has-text("It failed")').click();
  await page.fill('#mProblem', '<script>window.__xss2=1<\/script><img src=x onerror=window.__xss3=1>');
  await page.click('#modalSave');
  await page.evaluate(() => { window.print = () => {}; });
  await page.locator('#histBody tr', { hasText: 'onerror' }).locator('button:has-text("Print form")').click();
  await page.waitForTimeout(300);
  check('Problem text escaped in print form', await page.evaluate(() =>
    !window.__xss2 && !window.__xss3 && document.querySelectorAll('#printArea img, #printArea script').length === 0));
  check('Print form contains failure details', (await page.locator('#printArea').innerText()).includes('Pod error') === false &&
    (await page.locator('#printArea').innerText()).includes('onerror')); // shows literal text

  /* ---------- 13. print form for pod has lot/seq + Insulet ---------- */
  await page.locator('#histBody tr', { hasText: 'Omnipod' }).locator('button:has-text("Print form")').click();
  const claim = await page.locator('#printArea').innerText();
  check('Pod claim form: lot, seq, Insulet phone',
    claim.includes('L22222') && claim.includes('0055555') && claim.includes('1-800-641-2049'));
  check('Pod claim form shows patient info', claim.includes('Test Kid') && claim.includes('Test Parent'));

  /* ---------- 14. Excel + CSV download ---------- */
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download Excel")')]);
  const xlsxPath = path.join(DL_DIR, 'out.xlsx');
  await dl.saveAs(xlsxPath);
  const buf = fs.readFileSync(xlsxPath);
  check('XLSX downloads, is a valid zip (PK), non-trivial size', buf.length > 5000 && buf[0] === 0x50 && buf[1] === 0x4b, 'size=' + buf.length);
  check('XLSX contains styles.xml (highlighting present)', buf.toString('latin1').includes('styles.xml'));

  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Download CSV backup")')]);
  const csvPath = path.join(DL_DIR, 'out.csv');
  await dl2.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  check('CSV has BOM + header + failed pod row', csv.charCodeAt(0) === 0xFEFF && csv.includes('Serial Number') && csv.includes('L22222'));

  /* ---------- 15. edit flows ---------- */
  await page.locator('#activeBody tr', { hasText: '210000222222' }).locator('button:has-text("Edit")').click();
  check('Edit prefills form', await page.inputValue('#fSerial') === '210000222222');
  await page.fill('#fSerial', '210000444444');
  await page.click('#saveBtn');
  check('Edit saves changed serial', (await page.locator('#activeBody').innerText()).includes('210000444444'));
  check('Edit does not duplicate item', await page.locator('#activeBody tr').count() === 2);

  // history "Edit" opens modal prefilled
  await page.locator('#histBody tr', { hasText: 'Omnipod' }).locator('button:has-text("Edit")').click();
  check('History edit opens modal with saved details',
    await page.inputValue('#mProblem') === 'Pod error alarm mid-bolus' &&
    await page.locator('#modalTitle').innerText() === 'Edit failure details');
  await page.click('#overlay button:has-text("Cancel")');

  /* ---------- 15aa. backup & restore ---------- */
  check('Backup nag shows with 3+ devices and no backup yet', await page.locator('#backupNag').isVisible());
  await page.click('button:has-text("Remind me later")');
  check('Nag hides when snoozed', await page.locator('#backupNag').isHidden());
  await page.evaluate(() => { localStorage.removeItem('t1d_backup_snooze'); updateBackupNag(); });
  check('Nag returns after snooze expires', await page.locator('#backupNag').isVisible());
  const beforeCount = await page.evaluate(() => items.length);
  const [bdl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Save backup file")')]);
  const bakPath = path.join(DL_DIR, 'backup.json');
  await bdl.saveAs(bakPath);
  const bak = JSON.parse(fs.readFileSync(bakPath, 'utf8'));
  check('Backup file has all devices + patient info',
    bak.app === 't1d-supply-tracker' && bak.items.length === beforeCount && bak.patient.name === 'Test Kid',
    'items=' + (bak.items && bak.items.length) + ' name=' + (bak.patient && bak.patient.name));
  check('Nag disappears after backing up', await page.locator('#backupNag').isHidden());
  await page.evaluate(() => { items = []; persist(); render(); });
  check('Log emptied before restore test', await page.evaluate(() => items.length) === 0);
  await page.setInputFiles('#restoreFile', bakPath); // confirm dialog auto-accepted
  await page.waitForTimeout(400);
  check('Restore brings all devices back', await page.evaluate(() => items.length) === beforeCount);
  check('Restore keeps devices rendered', await page.locator('#activeBody tr').count() > 0);
  const badPath = path.join(DL_DIR, 'bad.json');
  fs.writeFileSync(badPath, '{"hello":"world"}');
  nDialogs = dialogs.length;
  await page.setInputFiles('#restoreFile', badPath);
  await page.waitForTimeout(400);
  check('Invalid backup file rejected with alert',
    dialogs.length === nDialogs + 1 && /doesn't look like/i.test(dialogs.at(-1).msg), JSON.stringify(dialogs.at(-1)));
  check('Invalid restore changed nothing', await page.evaluate(() => items.length) === beforeCount);

  /* ---------- 15ab. auto-save to a real file ---------- */
  check('Auto-save setup offered (Chromium has the file API)', await page.locator('#linkFileBtn').isVisible());
  await page.evaluate(() => {
    window.__fileData = null;
    window.showSaveFilePicker = async () => ({
      name: 'T1D-log.json',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      createWritable: async () => ({ write: async d => { window.__fileData = d; }, close: async () => {} }),
      getFile: async () => new Blob([window.__fileData || '{}'])
    });
  });
  await page.click('#linkFileBtn');
  await page.waitForTimeout(400);
  check('Linking writes the whole log to the file immediately', await page.evaluate(() => {
    try { const d = JSON.parse(window.__fileData); return d.app === 't1d-supply-tracker' && d.items.length === items.length; }
    catch (e) { return false; }
  }));
  check('Status shows the linked filename', (await page.locator('#fileStatus').innerText()).includes('Auto-saving to T1D-log.json'));
  await page.evaluate(() => { items[0].ref = 'AUTOSAVE-TEST'; persist(); });
  await page.waitForTimeout(1300);
  check('Data changes auto-save to the file (debounced)',
    await page.evaluate(() => (window.__fileData || '').includes('AUTOSAVE-TEST')));
  // disaster recovery: browser data wiped, file intact
  const rec = await page.evaluate(async () => {
    const before = items.length;
    items = []; localStorage.removeItem('t1d_items'); render();
    await maybeRecoverFromFile(); // confirm dialog auto-accepted
    return { before, after: items.length };
  });
  check('Cleared browser + linked file -> full recovery', rec.after === rec.before && rec.after > 0, JSON.stringify(rec));
  await page.click('#unlinkFileBtn'); // confirm auto-accepted
  check('Stop auto-save returns to setup state', await page.locator('#linkFileBtn').isVisible());

  /* ---------- 15b. date-range export ---------- */
  // from > to -> alert
  nDialogs = dialogs.length;
  await page.fill('#expFrom', daysAgo(0));
  await page.fill('#expTo', daysAgo(5));
  await page.click('button:has-text("Download Excel")');
  await page.waitForTimeout(200);
  check('Range from > to blocked with alert', dialogs.length === nDialogs + 1 && /swap/i.test(dialogs.at(-1).msg));

  // empty range -> friendly alert, no download
  nDialogs = dialogs.length;
  await page.fill('#expFrom', daysAgo(30));
  await page.fill('#expTo', daysAgo(20));
  await page.click('button:has-text("Download Excel")');
  await page.waitForTimeout(200);
  check('Empty date range shows friendly alert', dialogs.length === nDialogs + 1 && /No devices found/i.test(dialogs.at(-1).msg));

  // narrow range: only the G7 put on 4 days ago (no failures in range)
  const rangeResult = await page.evaluate(([f, t]) => {
    document.getElementById('expFrom').value = f;
    document.getElementById('expTo').value = t;
    let cap = null; const orig = XLSX.writeFile;
    XLSX.writeFile = (wb, name) => { cap = { name, full: XLSX.utils.sheet_to_json(wb.Sheets['Full Log'], { header: 1 }), fail: XLSX.utils.sheet_to_json(wb.Sheets['Failed Devices'], { header: 1 }) }; };
    try { exportExcel(); } finally { XLSX.writeFile = orig; }
    document.getElementById('expFrom').value = ''; document.getElementById('expTo').value = '';
    return cap;
  }, [daysAgo(4), daysAgo(3)]);
  const fullRows = rangeResult.full.slice(3); // after title, blank, header
  check('Range filter: only in-range device in Full Log',
    fullRows.length === 1 && String(fullRows[0]).includes('210000111111'), JSON.stringify(fullRows));
  check('Range filter: no failures listed when none in range', rangeResult.fail.length <= 4, 'rows=' + rangeResult.fail.length);
  check('Range in filename', rangeResult.name.includes(daysAgo(4) + '_to_' + daysAgo(3)), rangeResult.name);
  check('Range shown in sheet title', String(rangeResult.full[0]).includes('Date range'));

  // range including today catches devices that FAILED today even if put on earlier
  const rangeToday = await page.evaluate(([f, t]) => {
    document.getElementById('expFrom').value = f;
    document.getElementById('expTo').value = t;
    let cap = null; const orig = XLSX.writeFile;
    XLSX.writeFile = (wb, name) => { cap = XLSX.utils.sheet_to_json(wb.Sheets['Failed Devices'], { header: 1 }).slice(4); };
    try { exportExcel(); } finally { XLSX.writeFile = orig; }
    document.getElementById('expFrom').value = ''; document.getElementById('expTo').value = '';
    return cap;
  }, [daysAgo(0), daysAgo(0)]);
  check('Range catches failure date, not just put-on date',
    rangeToday.some(r => String(r).includes('L22222')), JSON.stringify(rangeToday));

  /* ---------- 16. export with nothing logged ---------- */
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('t1d_tour_done', '1'); });
  await page.reload();
  nDialogs = dialogs.length;
  await page.click('button:has-text("Download Excel")');
  await page.waitForTimeout(300);
  check('Export with empty log shows friendly alert', dialogs.length === nDialogs + 1 && /Nothing to export/i.test(dialogs.at(-1).msg));

  /* ---------- 17. console errors during entire run ---------- */
  check('No console/page errors during entire run', consoleErrors.length === 0, consoleErrors.join(' | '));

  await browser.close();

  const fails = results.filter(r => !r.pass);
  console.log('\n========== ' + results.filter(r => r.pass).length + '/' + results.length + ' passed ==========');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('RUNNER CRASH:', e); process.exit(2); });

