// Records the demo video with a synchronized neural-TTS voiceover.
// Pipeline: generate narration clips -> measure durations -> drive the app with
// segment pacing matched to each clip -> mix audio into the video with ffmpeg.
const { chromium } = require('playwright');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');

const APP = pathToFileURL(path.join(__dirname, '..', 'public', 'app', 'index.html')).href;
const OUT_DIR = path.join(__dirname, 'video-out');
const VO_DIR = path.join(OUT_DIR, 'vo');
const MEDIA = path.join(__dirname, '..', 'public', 'media');
const VOICE = 'en-US-JennyNeural';

const SEGMENTS = [
  { id: 's0', cap: 'Meet Poddy — every new family gets a quick tour',
    nar: 'This is the T1D Supply Failure Tracker — a free app for type 1 diabetes families. When a sensor or pod fails early, the maker will replace it, if you have the numbers. This app makes sure you always do.' },
  { id: 's1', cap: 'Step 1: Save your info once',
    nar: 'Start by saving your info once — it goes onto every claim form automatically.' },
  { id: 's2', cap: 'Step 2: Log each device when you put it on — 30 seconds',
    nar: 'Then, at every sensor change, take thirty seconds to log the new device. The serial number is saved before the box ever hits the trash.' },
  { id: 's3', cap: 'Pods too — lot & sequence numbers captured right away',
    nar: 'Pods too — the lot and sequence numbers Insulet asks for are captured right away.' },
  { id: 's4', cap: 'Live wear countdowns for everything on the body',
    nar: 'Everything currently on the body shows a live wear countdown, so you always know what is due for a change.' },
  { id: 's5', cap: 'A pod dies early? One tap.',
    nar: 'When a pod dies early, one tap records the failure — while the details are still fresh.' },
  { id: 's6', cap: 'Track every claim to the finish',
    nar: 'Then track every claim, from submitted, to replaced.' },
  { id: 's7', cap: 'Print an official-style claim form',
    nar: 'Print a clean, one-page claim form for each failed device — with exactly what the company asks for.' },
  { id: 's8', cap: 'Export a color-coded Excel log',
    nar: 'Or download a color-coded Excel log — failures highlighted, ready for insurance or supply counts.' },
  { id: 's9', cap: 'Auto-save keeps your log in a real file',
    nar: 'Your data never leaves your device. And with auto-save, a live copy is kept in a real file that your browser can never delete.' },
  { id: 's10', cap: 'Free · private · built by a T1D family',
    nar: 'Free, private, and built by a T1D family. Get every replacement you are owed.' }
];

const pause = ms => new Promise(r => setTimeout(r, ms));
const ffprobe = f => parseFloat(execFileSync('ffprobe',
  ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }));

(async () => {
  // ---- 1. narration clips ----
  console.log('Generating narration (' + VOICE + ')...');
  for (const s of SEGMENTS) {
    const dir = path.join(VO_DIR, s.id);
    fs.mkdirSync(dir, { recursive: true });
    const tts = new MsEdgeTTS();
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    await tts.toFile(dir, s.nar);
    s.file = path.join(dir, 'audio.mp3');
    s.dur = ffprobe(s.file);
    console.log('  ' + s.id + ': ' + s.dur.toFixed(1) + 's');
  }

  // ---- 2. record the demo with matched pacing ----
  console.log('Recording demo...');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 800 } }
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  page.on('dialog', d => d.accept());

  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
  const type = async (sel, text) => { await page.click(sel); await page.type(sel, text, { delay: 40 }); };

  const markers = [];
  let segEndsAt = 0; // wall-clock ms when the current narration finishes
  async function seg(id) {
    const s = SEGMENTS.find(x => x.id === id);
    const wait = segEndsAt - Date.now();
    if (wait > 0) await pause(wait); // let the previous line finish before moving on
    markers.push({ id, atMs: Date.now() - t0 });
    segEndsAt = Date.now() + s.dur * 1000 + 700;
    await page.evaluate(text => {
      let c = document.getElementById('__cap');
      if (!c) {
        c = document.createElement('div');
        c.id = '__cap';
        c.style.cssText = 'position:fixed;bottom:26px;left:50%;transform:translateX(-50%);' +
          'background:rgba(10,66,102,.93);color:#fff;font:600 21px "Segoe UI",sans-serif;' +
          'padding:12px 28px;border-radius:12px;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.4);' +
          'white-space:nowrap;pointer-events:none';
        document.body.appendChild(c);
      }
      c.textContent = text;
    }, s.cap);
  }

  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await pause(800);

  await seg('s0'); // tour
  for (let i = 0; i < 4; i++) { await pause(2400); await page.click('#tourNext'); }

  await seg('s1'); // info
  await type('#pName', 'Brooklyn M.');
  await type('#pCaregiver', 'Mom & Dad');
  await type('#pPhone', '(555) 010-2030');
  await page.click('button:has-text("Save my info")');

  await seg('s2'); // dexcom
  await page.selectOption('#fDevice', 'Dexcom G7 Sensor');
  await pause(500);
  await type('#fSerial', '210001234567');
  await page.fill('#fDateOn', daysAgo(4));
  await pause(500);
  await page.click('#saveBtn');

  await seg('s3'); // pod
  await page.selectOption('#fDevice', 'Omnipod 5 Pod');
  await pause(500);
  await type('#fLot', 'L91234');
  await type('#fSeq', '0123456');
  await page.fill('#fDateOn', daysAgo(1));
  await pause(500);
  await page.click('#saveBtn');

  await seg('s4'); // wear countdowns
  await page.locator('#activeBody').scrollIntoViewIfNeeded();

  await seg('s5'); // fail
  await page.locator('#activeBody tr', { hasText: 'Omnipod' }).locator('button:has-text("It failed")').click();
  await pause(800);
  await type('#mProblem', 'Pod Error alarm during a bolus — screeching sound, pod shut down.');
  await pause(400);
  await page.click('#modalSave');

  await seg('s6'); // status
  await page.locator('#histBody').scrollIntoViewIfNeeded();
  await pause(800);
  await page.locator('#histBody tr', { hasText: 'Omnipod' }).locator('select').selectOption('Submitted');

  await seg('s7'); // print form
  await page.evaluate(() => { window.print = () => {}; });
  await page.locator('#histBody tr', { hasText: 'Omnipod' }).locator('button:has-text("Print form")').click();
  await page.emulateMedia({ media: 'print' });
  await pause(Math.max(2500, SEGMENTS.find(s => s.id === 's7').dur * 1000 - 500));
  await page.emulateMedia({ media: 'screen' });

  await seg('s8'); // excel
  await page.locator('button:has-text("Download Excel")').scrollIntoViewIfNeeded();
  await pause(900);
  await page.click('button:has-text("Download Excel")');

  await seg('s9'); // auto-save
  await page.evaluate(() => {
    window.showSaveFilePicker = async () => ({
      name: 'T1D-log.json',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      getFile: async () => new Blob(['{}'])
    });
  });
  await page.locator('#fileLinkWrap').scrollIntoViewIfNeeded();
  await pause(900);
  await page.click('#linkFileBtn');

  await seg('s10'); // close on the header
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // let the last line breathe
  const tail = segEndsAt - Date.now();
  if (tail > 0) await pause(tail);
  await pause(600);

  await page.evaluate(() => localStorage.clear());
  const video = page.video();
  await ctx.close();
  const rawVideo = await video.path();
  await browser.close();

  // ---- 3. mix ----
  console.log('Mixing audio...');
  const inputs = [];
  const filters = [];
  const labels = [];
  SEGMENTS.forEach((s, i) => {
    inputs.push('-i', s.file);
    const m = markers.find(x => x.id === s.id);
    const d = Math.max(0, Math.round(m.atMs));
    filters.push(`[${i + 1}:a]adelay=${d}|${d}[a${i}]`);
    labels.push(`[a${i}]`);
  });
  const filter = filters.join(';') + ';' + labels.join('') +
    `amix=inputs=${SEGMENTS.length}:duration=longest:normalize=0[aout]`;

  execFileSync('ffmpeg', ['-y', '-i', rawVideo, ...inputs, '-filter_complex', filter,
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '96k',
    path.join(MEDIA, 'demo.mp4')], { stdio: 'pipe' });
  execFileSync('ffmpeg', ['-y', '-i', rawVideo, ...inputs, '-filter_complex', filter,
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'libopus', '-b:a', '64k',
    path.join(MEDIA, 'demo.webm')], { stdio: 'pipe' });

  const mp4 = path.join(MEDIA, 'demo.mp4');
  console.log('done: demo.mp4 ' + Math.round(fs.statSync(mp4).size / 1024) + ' KB, ' +
    ffprobe(mp4).toFixed(1) + 's; demo.webm ' +
    Math.round(fs.statSync(path.join(MEDIA, 'demo.webm')).size / 1024) + ' KB');
})().catch(e => { console.error('CRASH:', e); process.exit(2); });
