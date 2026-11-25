// Real-IndexedDB regression tests (headless Chrome) for offline checkout stock and phone backups:
//  - useStock never half-applies: a failed save leaves the snapshot untouched, a retry deducts once
//  - a backup carries the numbering counters, restore resumes after them
//  - an old backup without counters never reissues a number found in its own data
// Run:  CHROME=/usr/bin/google-chrome node mobile/test/stock-and-backup.chrome.cjs
//   (needs playwright-core: npm i --no-save playwright-core)
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '../www/pos/lib');
const srv = http.createServer((q, r) => {
  if (q.url === '/') { r.setHeader('content-type', 'text/html'); return r.end('<html></html>'); }
  fs.readFile(path.join(root, q.url.split('?')[0]), (e, d) => {
    if (e) { r.statusCode = 404; return r.end(); }
    r.setHeader('content-type', 'text/javascript'); r.end(d);
  });
}).listen(0, async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.error('PAGE ERROR', e.message));
  await p.goto(`http://localhost:${srv.address().port}/`);
  const res = await p.evaluate(async () => {
    const store = await import('/store.js');
    const local = await import('/local.js');
    const out = {};
    const snap = () => ({ items: [{ id: 'd1', stock: 5, soldOut: false }, { id: 'd2', stock: null }], floors: [] });

    // 1. a failed save leaves the snapshot untouched; the retry deducts exactly once
    const s0 = snap();
    const realSet = store.kv.setMany;
    store.kv.setMany = async () => { throw new Error('disk full'); };
    let threw = false;
    try { await local.useStock(s0, [{ menuItemId: 'd1', quantity: 2 }]); } catch { threw = true; }
    store.kv.setMany = realSet;
    out.failedSaveThrew = threw;
    out.stockAfterFailure = s0.items[0].stock;
    const s1 = await local.useStock(s0, [{ menuItemId: 'd1', quantity: 2 }]);
    out.stockAfterRetry = s1.items[0].stock;
    out.persisted = (await store.kv.get('snapshot')).items[0].stock;
    const s2 = await local.useStock(s1, [{ menuItemId: 'd1', quantity: 9 }]);
    out.floorsAtZero = [s2.items[0].stock, s2.items[0].soldOut];

    // 1b. the stock levels and the 'stock deducted' marker commit together
    const s3 = snap();
    const after = await local.useStock(s3, [{ menuItemId: 'd1', quantity: 1 }], [['pendingSale', { saleId: 'x', stockApplied: true }]]);
    out.markerWithStock = [after.items[0].stock, (await store.kv.get('pendingSale')).stockApplied, (await store.kv.get('snapshot')).items[0].stock];
    await store.kv.del('pendingSale');
    const s4 = snap();
    store.kv.setMany = async () => { throw new Error('disk full'); };
    try { await local.useStock(s4, [{ menuItemId: 'd1', quantity: 1 }], [['pendingSale', { saleId: 'y', stockApplied: true }]]); } catch {}
    store.kv.setMany = realSet;
    out.noMarkerOnFailure = (await store.kv.get('pendingSale')) === undefined;

    // 2. a backup carries counters and restore resumes after them
    const a = await store.nextLocalNumber(new Date(2026, 10, 24));
    await store.nextLocalNumber(new Date(2026, 10, 24));
    await store.nextOrderNumber(new Date(2026, 10, 24));
    await store.nextKotNumber(new Date(2026, 10, 24));
    const backup = await store.readEverything();
    out.counterKeys = Object.keys(backup.counters).sort();
    // simulate a wiped phone: counters gone
    for (const k of Object.keys(backup.counters)) await store.kv.del(k);
    await store.replaceEverything(backup);
    out.nextAfterRestore = await store.nextLocalNumber(new Date(2026, 10, 24));
    out.firstWas = a;

    // 3. an old backup (no counters) never reissues a number inside its own data
    for (const k of Object.keys(backup.counters)) await store.kv.del(k);
    const old = { snapshot: snap(), sales: [{ id: 's9', localNumber: 'OFF-261124-007' }], orders: [{ id: 'o9', number: 'ORD-261124-004' }], kots: [{ id: 'k9', number: 6, at: new Date(2026, 10, 24, 12).toISOString() }] };
    await store.replaceEverything(old);
    out.oldBackupNext = [
      await store.nextLocalNumber(new Date(2026, 10, 24)),
      await store.nextOrderNumber(new Date(2026, 10, 24)),
      await store.nextKotNumber(new Date(2026, 10, 24)),
    ];
    // restoring an old backup on a phone that is already ahead keeps the higher counter
    await store.kv.set('seq:261124', 50);
    await store.replaceEverything(old);
    out.aheadNext = await store.nextLocalNumber(new Date(2026, 10, 24));

    // 4. a backup WITH counters is also a floor, not an overwrite
    const withCounters = await store.readEverything();
    await store.kv.set('seq:261124', 80);
    await store.replaceEverything(withCounters);
    out.aheadWithCounters = await store.nextLocalNumber(new Date(2026, 10, 24));

    // 5. finishing a checkout marks the order PAID and consumes the marker together
    await store.orders.put({ id: 'o_done', status: 'OPEN', number: 'ORD-261124-099' });
    await store.kv.set('pendingSale', { saleId: 's_done', sig: 'x', stockApplied: true });
    await store.completeCheckout('o_done', 's_done', '2026-11-24T00:00:00.000Z');
    const done = await store.orders.get('o_done');
    out.finalized = [done.status, done.saleId, await store.kv.get('pendingSale')];
    return out;
  });
  console.log(JSON.stringify(res));
  const fail = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fail.push(`${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
  eq('failed save throws', res.failedSaveThrew, true);
  eq('stock untouched after failed save', res.stockAfterFailure, 5);
  eq('retry deducts once', res.stockAfterRetry, 3);
  eq('persisted', res.persisted, 3);
  eq('marker commits with stock', res.markerWithStock, [4, true, 4]);
  eq('no marker when the save fails', res.noMarkerOnFailure, true);
  eq('sold out at zero', res.floorsAtZero, [0, true]);
  eq('counters in backup', res.counterKeys, ['kotseq:261124', 'ordseq:261124', 'seq:261124']);
  eq('restore resumes numbering', res.nextAfterRestore, 'OFF-261124-003');
  eq('old backup numbering', res.oldBackupNext, ['OFF-261124-008', 'ORD-261124-005', 7]);
  eq('phone ahead keeps higher counter', res.aheadNext, 'OFF-261124-051');
  eq('with-counters restore keeps higher counter', res.aheadWithCounters, 'OFF-261124-081');
  eq('checkout finalises order and clears marker', res.finalized, ['PAID', 's_done', undefined]);
  if (fail.length) { console.error('FAIL\n' + fail.join('\n')); process.exitCode = 1; } else console.log('OK');
  await b.close(); srv.close();
});
