// Regression: concurrent nextOrderNumber/nextKotNumber/nextLocalNumber must never hand out the same
// number twice (they used to read and write the counter in two transactions). Needs a real IndexedDB,
// so it runs in headless Chrome:  npm i --no-save playwright-core && CHROME=/usr/bin/google-chrome node mobile/test/idb-counters.chrome.cjs
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2] || path.join(__dirname, '../www/pos/lib');
const srv = http.createServer((q, r) => {
  const f = path.join(root, q.url.split('?')[0]);
  if (q.url === '/') { r.setHeader('content-type','text/html'); return r.end('<html></html>'); }
  fs.readFile(f, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type','text/javascript'); r.end(d); });
}).listen(0, async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.goto(`http://localhost:${srv.address().port}/`);
  const res = await p.evaluate(async () => {
    const m = await import('/store.js');
    const out = {};
    for (const [name, fn] of [['order', m.nextOrderNumber], ['kot', m.nextKotNumber], ['local', m.nextLocalNumber]]) {
      const got = await Promise.all(Array.from({ length: 25 }, () => fn()));
      out[name] = { total: got.length, unique: new Set(got).size };
    }
    return out;
  });
  console.log(JSON.stringify(res));
  const bad = Object.entries(res).filter(([, v]) => v.unique !== v.total);
  if (bad.length) { console.error('DUPLICATE NUMBERS', bad); process.exitCode = 1; }
  await b.close(); srv.close();
});
