// Builds the Google Play screenshots (1080x1920, 9:16) and feature graphic (1024x500) from REAL app captures.
// Captures in ./captures are unedited screenshots of the running app (phone POS in Chrome at 390x844 @2.77x,
// server screens from the web app inside the app shell). Only the frame, background and caption are added here.
//
//   node build.cjs [path-to-playwright-core]     -> ../screenshots/play-1.39/*.png and ../feature-graphic-1024x500.png
//
// Edit the SHOTS list to change captions. Captions must describe what the capture really shows.
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.argv[2] || 'playwright-core');

const HERE = __dirname;
const OUT = path.join(HERE, '..', 'screenshots', 'play-1.39');
const SERVER = 'With your OrderRestro server';

const SHOTS = [
  { file: '01-take-orders', img: 'phone-sell.png', top: 'Take orders', big: 'in seconds', sub: 'Tap dishes, pick the table, send the KOT.' },
  { file: '02-payments', img: 'phone-pay-upi.png', top: 'Cash, card or', big: 'UPI QR', sub: 'The QR carries the exact amount due.' },
  { file: '03-tables', img: 'phone-tables.png', top: 'Every table', big: 'at a glance', sub: 'Open orders, totals and minutes waiting.' },
  { file: '04-offline', img: 'phone-sales-offline.png', top: 'Keeps selling with', big: 'no internet', sub: 'Sales wait on the phone and sync later.' },
  { file: '05-kitchen', img: 'server-kds.png', top: 'Kitchen display', big: 'on any phone', sub: 'Accept, prepare, mark ready.', tag: SERVER },
  { file: '06-low-stock', img: 'server-low-stock.png', top: 'Get notified of', big: 'low stock', sub: 'An alert when stock reaches its reorder level.', tag: SERVER },
  { file: '07-dashboard', img: 'server-dashboard.png', top: "Today's sales", big: 'live', sub: 'Revenue, orders, tables and the kitchen queue.', tag: SERVER },
];

const css = `
*{box-sizing:border-box;margin:0}
body{width:1080px;height:1920px;overflow:hidden;font-family:Lato,"Liberation Sans",sans-serif;color:#fff;
  background:radial-gradient(900px 700px at 100% 0%,#c21d4b 0%,transparent 60%),linear-gradient(165deg,#a3143f 0%,#7a0e2c 70%,#5e0a22 100%)}
.head{position:absolute;left:84px;right:84px;top:96px}
.tag{display:inline-block;margin-bottom:26px;padding:10px 22px;border-radius:999px;background:rgba(255,255,255,.16);border:2px solid rgba(255,255,255,.35);font-size:30px;font-weight:700;letter-spacing:.01em}
.top{font-size:62px;font-weight:700;line-height:1.05;opacity:.95}
.big{font-size:124px;font-weight:900;line-height:.98;letter-spacing:-.02em;text-transform:uppercase;color:#ffd9a8}
.sub{margin-top:22px;font-size:38px;font-weight:400;line-height:1.3;opacity:.92}
.phone{position:absolute;left:50%;transform:translateX(-50%);width:780px;top:VAR_TOPpx;border-radius:78px 78px 0 0;background:#141414;padding:20px 20px 0;box-shadow:0 40px 90px rgba(0,0,0,.45)}
.phone img{display:block;width:100%;border-radius:60px 60px 0 0}
`;

function shotHtml(s) {
  const top = s.tag ? 640 : 580;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css.replace('VAR_TOP', top)}</style></head><body>
  <div class="head">${s.tag ? `<div class="tag">${s.tag}</div>` : ''}<div class="top">${s.top}</div><div class="big">${s.big}</div><div class="sub">${s.sub}</div></div>
  <div class="phone"><img src="file://${path.join(HERE, 'captures', s.img)}"></div></body></html>`;
}

const featureHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
body{width:1024px;height:500px;overflow:hidden;font-family:Lato,"Liberation Sans",sans-serif;color:#fff;
  background:radial-gradient(500px 400px at 100% 0%,#c21d4b 0%,transparent 65%),linear-gradient(160deg,#a3143f 0%,#7a0e2c 75%)}
.t{position:absolute;left:64px;top:96px;width:520px}
.t img{width:72px;height:72px;border-radius:50%;background:#fff;margin-bottom:22px}
h1{font-size:68px;font-weight:900;letter-spacing:-.02em;line-height:1}
p{margin-top:18px;font-size:30px;line-height:1.3;opacity:.95}
p b{color:#ffd9a8;font-weight:900}
.phone{position:absolute;right:70px;top:46px;width:300px;border-radius:40px 40px 0 0;background:#141414;padding:10px 10px 0;box-shadow:0 24px 50px rgba(0,0,0,.45)}
.phone img{display:block;width:100%;border-radius:31px 31px 0 0}
</style></head><body>
<div class="t"><img src="file://${path.join(HERE, '..', '..', 'www', 'assets', 'logo.png')}" alt=""><h1>OrderRestro</h1>
<p>Restaurant billing, KOT and tables on your phone. <b>Works with no internet.</b></p></div>
<div class="phone"><img src="file://${path.join(HERE, 'captures', 'phone-sell.png')}"></div></body></html>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  for (const s of SHOTS) {
    const html = path.join(HERE, `.tmp-${s.file}.html`);
    fs.writeFileSync(html, shotHtml(s));
    await p.goto(`file://${html}`);
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(OUT, `${s.file}.png`) });
    fs.unlinkSync(html);
  }
  await p.setViewportSize({ width: 1024, height: 500 });
  const fh = path.join(HERE, '.tmp-feature.html');
  fs.writeFileSync(fh, featureHtml);
  await p.goto(`file://${fh}`);
  await p.waitForTimeout(200);
  await p.screenshot({ path: path.join(HERE, '..', 'feature-graphic-1024x500.png') });
  fs.unlinkSync(fh);
  await b.close();
  console.log('built', SHOTS.length, 'screenshots + feature graphic');
})();
