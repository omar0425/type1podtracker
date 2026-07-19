# T1D Supply Failure Tracker

A free tool for Type 1 diabetes families: log every Dexcom sensor & Omnipod at
change time, catch early failures, and build replacement claims with printable
forms and color-coded Excel exports. Includes Poddy, the pod mascot.

## Layout

```
server.js              Express server: static site + /api/contact
package.json           npm start → node server.js (Railway auto-detects this)
public/
  index.html           Landing page (video demo, install instructions)
  about.html           Our story (drop your photo at public/img/family.jpg)
  contact.html         "Request a device" form → /api/contact
  img/                 family.jpg goes here (placeholder shown until then)
  media/demo.mp4/.webm The recorded demo video
  app/                 The tracker app itself (installable PWA, works offline)
```

## Run locally

```
npm install
npm start          # http://localhost:3000
```

## Deploy to Railway

1. Push this folder to a GitHub repo (or use `railway up` with the Railway CLI).
2. On railway.com: **New Project → Deploy from GitHub repo** — it auto-detects
   Node and runs `npm start`. No build step needed.
3. Under the service → **Settings → Networking → Generate Domain** to get your
   public URL (e.g. `t1d-tracker.up.railway.app`).
4. **Variables** to set:
   - `ADMIN_KEY` — any secret string. Read contact submissions at
     `https://YOUR-URL/api/messages?key=YOUR_ADMIN_KEY` and visitor stats at
     `https://YOUR-URL/api/stats?key=YOUR_ADMIN_KEY` (daily page views +
     unique visitors; privacy-safe, no raw IPs stored).
   - `DATA_DIR=/data` — only if you attach a **Volume** (Storage → Add Volume,
     mount at `/data`) so contact messages & visitor stats survive redeploys.
     Without a volume they reset on each deploy.
   - `RESEND_API_KEY` + `NOTIFY_EMAIL` (optional) — get emailed whenever someone
     submits the contact form. Sign up free at resend.com, create an API key,
     set `NOTIFY_EMAIL` to your address. Without these, messages simply wait in
     the `/api/messages` inbox. (`NOTIFY_FROM` optionally overrides the sender
     once you verify a domain with Resend.)

## Your photo

Replace the placeholder by adding `public/img/family.jpg` (any landscape photo,
roughly 800px wide is plenty). The About page picks it up automatically.

## Testing

Playwright suites live in the Claude session scratchpad: `test-app.js` (57 app
tests), `site-test.js` (17 site tests), `ui-audit.js` / `ui-audit2.js`
(screenshot + layout audits), `demo-video.js` (re-records the demo video),
`make-icons.js` (regenerates PWA icons).
