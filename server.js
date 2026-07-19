const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Contact messages are stored as a JSON file. On Railway, attach a Volume and
// set DATA_DIR to its mount path (e.g. /data) so messages survive redeploys.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const MSG_FILE = path.join(DATA_DIR, 'messages.json');

// --- privacy-safe visitor counter ---
// Counts page views and unique visitors per day. Visitors are identified only by a
// one-way hash salted with the date, so no IP addresses are stored and the same
// person can't be tracked from one day to the next. No cookies involved.
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
let stats = {};
try { stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch (e) {}
let statsDirty = false;
setInterval(() => {
  if (statsDirty) { statsDirty = false; fs.writeFile(STATS_FILE, JSON.stringify(stats), () => {}); }
}, 10000).unref();

const COUNTED_PAGES = new Set(['/', '/index.html', '/app/', '/app/index.html', '/about.html', '/contact.html']);
app.use((req, res, next) => {
  if (req.method === 'GET' && COUNTED_PAGES.has(req.path)) {
    const day = new Date().toISOString().slice(0, 10);
    const d = stats[day] = stats[day] || { views: 0, visitors: [] };
    d.views++;
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const hash = crypto.createHash('sha256').update(day + '|' + ip).digest('hex').slice(0, 12);
    if (!d.visitors.includes(hash)) d.visitors.push(hash);
    statsDirty = true;
  }
  next();
});

app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Family photo: until public/img/family.jpg is added, serve the placeholder in its place
// (the static middleware above wins automatically once the real photo exists).
app.get('/img/family.jpg', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'img', 'family-placeholder.svg'));
});

app.post('/api/contact', (req, res) => {
  const { name, email, device, message, website } = req.body || {};
  if (website) return res.json({ ok: true }); // honeypot field — bots fill it, humans never see it
  if (!device || !message) return res.status(400).json({ ok: false, error: 'Please fill in the device name and your message.' });
  let list = [];
  try { list = JSON.parse(fs.readFileSync(MSG_FILE, 'utf8')); } catch (e) {}
  list.push({
    at: new Date().toISOString(),
    name: String(name || '').slice(0, 120),
    email: String(email || '').slice(0, 120),
    device: String(device).slice(0, 120),
    message: String(message).slice(0, 2000)
  });
  fs.writeFileSync(MSG_FILE, JSON.stringify(list, null, 2));
  res.json({ ok: true });
});

// Owner-only: read submitted requests at /api/messages?key=YOUR_ADMIN_KEY
// Set ADMIN_KEY in Railway variables; without it this endpoint stays locked.
app.get('/api/messages', (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) return res.status(403).send('Forbidden');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(MSG_FILE, 'utf8')); } catch (e) {}
  res.json(list);
});

// Owner-only: visitor stats at /api/stats?key=YOUR_ADMIN_KEY
app.get('/api/stats', (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) return res.status(403).send('Forbidden');
  const days = {};
  let totalViews = 0;
  for (const [day, d] of Object.entries(stats).sort()) {
    days[day] = { views: d.views, visitors: d.visitors.length };
    totalViews += d.views;
  }
  res.json({
    totalViews,
    days,
    note: 'visitors = unique devices per day (daily-salted one-way hash; no raw IPs are ever stored)'
  });
});

app.listen(PORT, () => console.log('T1D tracker site running on port ' + PORT));
