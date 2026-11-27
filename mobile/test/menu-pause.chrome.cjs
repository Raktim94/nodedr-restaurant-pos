// Standalone POS with real IndexedDB and the same menu-pause response as a linked server.
// Run with playwright-core installed and CHROME pointing to the Chromium executable.
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { chromium } = require('playwright-core');

const base = 'http://127.0.0.1:1995';
const root = join(__dirname, '../www/pos');
const dish = { id: 'soup', name: 'Soup', categoryId: 'lunch', price: 30, taxRate: 0, pausedUntil: null, sellOffline: true };
const snapshot = {
  generatedAt: '2026-11-25T09:00:00Z', user: { id: 'server-user' },
  branch: { id: 'br1', name: 'Lunch', taxMode: 'INCLUSIVE' },
  restaurant: { currency: 'INR', timezone: 'UTC', upiVpa: 'lunch@bank' }, floors: [],
  categories: [{ id: 'lunch', name: 'Lunch' }], items: [dish],
};

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const failures = [];
    page.on('pageerror', (error) => failures.push(error.message));
    let paused = false;
    let fullSnapshots = 0;
    await page.route(base + '/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/blank') return route.fulfill({ contentType: 'text/html', body: '<html></html>' });
      if (path.startsWith('/api/')) {
        let json = {};
        if (path.endsWith('/setup-status')) json = { isSetup: true };
        if (path.endsWith('/branches')) json = [snapshot.branch];
        if (path.endsWith('/snapshot')) { fullSnapshots++; json = snapshot; }
        if (path.endsWith('/server-info')) json = { product: 'orderrestro', capabilities: {} };
        if (path.endsWith('/menu-pauses')) {
          assert.equal(new URL(route.request().url()).searchParams.get('branchId'), 'br1');
          json = paused ? [{ id: 'soup', pausedUntil: '2026-11-25T12:00:00Z' }] : [];
        }
        return route.fulfill({ json });
      }
      const file = join(root, path);
      const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
      try { await route.fulfill({ contentType, body: await readFile(file) }); }
      catch { await route.fulfill({ status: 404 }); }
    });
    await page.clock.install({ time: new Date('2026-11-25T09:00:00Z') });
    await page.goto(base + '/blank');
    await page.evaluate(async (snap) => {
      const { kv } = await import('/lib/store.js');
      await kv.setMany([['snapshot', snap], ['branchId', snap.branch.id], ['serverBase', location.origin]]);
    }, snapshot);
    const synced = page.waitForResponse((r) => r.url().includes('/heartbeat'));
    await page.goto(base + '/index.html');
    await synced;
    const add = page.locator('[data-add="soup"]');
    await add.waitFor();

    async function updatePause(active) {
      paused = active;
      const response = page.waitForResponse((r) => r.url().includes('/menu-pauses'));
      await page.clock.fastForward(15001);
      await response;
      await page.waitForFunction((value) => document.querySelector('[data-add="soup"]').disabled === value, active);
    }

    await page.locator('#q').focus();
    await updatePause(true);
    assert.equal(await page.locator('#q').evaluate((el) => el === document.activeElement), true);
    await updatePause(false);
    await add.click();
    await page.locator('#cartbtn').click();
    await page.locator('#charge').click();
    await page.getByRole('button', { name: 'UPI', exact: true }).click();
    await page.locator('.qr').waitFor();
    await updatePause(true);
    await page.getByRole('heading', { name: 'Cart' }).waitFor();
    assert.equal(await page.locator('.qr').count(), 0);
    await page.locator('#charge').click();
    await page.locator('#toast').filter({ hasText: /Remove the unsent quantity/ }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Payment' }).count(), 0);
    await updatePause(false);
    await page.locator('#kot').click();
    await page.locator('#kotre').waitFor();
    await updatePause(true);
    await page.locator('#charge').click();
    await page.getByRole('heading', { name: 'Payment' }).waitFor();
    await page.locator('#done').click();
    await page.getByRole('heading', { name: 'Sale complete' }).waitFor();

    const sig = JSON.stringify([30, [['soup', 1]]]);
    const firstSale = await page.evaluate(async () => {
      const { sales } = await import('/lib/store.js');
      return (await sales.all())[0];
    });

    // Older builds could leave a resume marker alongside an already-paid order.
    await page.locator('#newsale').click();
    await updatePause(false);
    await add.click();
    await page.locator('#cartbtn').click();
    await page.evaluate(async ({ saleId, sig }) => {
      const { kv } = await import('/lib/store.js');
      await kv.set('pendingSale', { saleId, sig, stockApplied: true });
    }, { saleId: firstSale.id, sig });
    await updatePause(true);
    await page.locator('#charge').click();
    await page.locator('#toast').filter({ hasText: /Remove the unsent quantity/ }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Finish saved sale' }).count(), 0);
    assert.equal(await page.evaluate(async () => (await import('/lib/store.js')).kv.get('pendingSale')), undefined);
    await updatePause(false);
    await page.locator('#charge').click();
    await page.locator('#done').click();
    await page.getByRole('heading', { name: 'Sale complete' }).waitFor();

    // Reopen a genuinely interrupted bill after a restart. Editing the record must not request a second payment.
    await page.locator('#newsale').click();
    await add.click();
    await page.clock.runFor(250);
    // Advancing the debounce timer starts the write. IndexedDB commits on its own clock.
    await page.waitForFunction(async () => {
      const { kv, orders } = await import('/lib/store.js');
      const id = await kv.get('currentOrderId');
      return id && (await orders.get(id))?.status === 'OPEN';
    });
    await page.evaluate(async ({ sig, firstSale }) => {
      const { kv, savePendingSale } = await import('/lib/store.js');
      const orderId = await kv.get('currentOrderId');
      await savePendingSale({
        ...firstSale, id: 'interrupted', orderId, localNumber: 'OFF-resume',
        payments: [{ method: 'UPI', amount: 10, reference: 'old-ref' }], change: 0, payLater: true,
        staffId: 'previous', staffName: 'Previous cashier', staffServerId: 'previous-server',
      }, sig);
    }, { sig, firstSale });
    assert.equal(fullSnapshots, 1);
    await page.reload();
    await add.waitFor();
    await updatePause(true);
    await page.locator('#cartbtn').click();
    await page.locator('#charge').click();
    await page.getByRole('heading', { name: 'Finish saved sale' }).waitFor();
    assert.equal(await page.locator('.qr').count(), 0);
    await page.getByRole('button', { name: 'Edit payment details' }).click();
    assert.equal(await page.getByRole('button', { name: 'UPI', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.qr').count(), 0);
    await page.getByRole('button', { name: 'Card', exact: true }).click();
    await page.locator('#am0').fill('30');
    await page.clock.runFor(300);
    await page.locator('#rf0').fill('terminal-77');
    await page.locator('summary').filter({ hasText: 'Customer' }).click();
    await page.locator('#cn').fill('Jamie');
    await page.locator('#done').click();
    await page.getByRole('heading', { name: 'Sale complete' }).waitFor();
    const result = await page.evaluate(async (firstSale) => {
      const { kv, orders, sales } = await import('/lib/store.js');
      const resumed = await sales.get('interrupted');
      return {
        count: (await sales.all()).length, marker: await kv.get('pendingSale'),
        originalOrder: (await orders.get(firstSale.orderId)).saleId,
        order: await orders.get(resumed.orderId), resumed,
      };
    }, firstSale);
    assert.equal(result.count, 3);
    assert.equal(result.marker, undefined);
    assert.equal(result.originalOrder, firstSale.id);
    assert.equal(result.order.status, 'PAID');
    assert.equal(result.order.saleId, 'interrupted');
    assert.equal(result.resumed.localNumber, 'OFF-resume');
    assert.deepEqual(result.resumed.payments, [{ method: 'CARD', amount: 30, reference: 'terminal-77' }]);
    assert.equal(result.resumed.customer.name, 'Jamie');
    assert.equal(result.resumed.staffId, firstSale.staffId);
    assert.equal(result.resumed.staffName, firstSale.staffName);
    assert.equal(result.resumed.staffServerId, firstSale.staffServerId);
    assert.equal(result.resumed.payLater, undefined);
    assert.equal(fullSnapshots, 2); // One full snapshot per launch, including the explicit reload.

    // Fail the real final transaction after the sale has committed. The same bill must finish once on restart.
    await page.locator('#newsale').click();
    await updatePause(false);
    await add.click();
    await page.locator('#cartbtn').click();
    await page.locator('#charge').click();
    await page.locator('#am0').fill('50');
    await page.evaluate(() => {
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, ...args) {
        const tx = transaction.call(this, stores, ...args);
        if (args[0] === 'readwrite' && Array.isArray(stores) && stores.includes('orders') && stores.includes('kv')) {
          IDBDatabase.prototype.transaction = transaction;
          tx.objectStore('kv').add('force finalization rollback', 'pendingSale');
        }
        return tx;
      };
    });
    await page.locator('#done').click();
    await page.getByRole('heading', { name: 'Finish saved sale' }).waitFor();
    await page.locator('#toast').filter({ hasText: /Could not finish the sale/ }).waitFor();
    const interruptedId = await page.evaluate(async () => {
      const { kv, orders, sales } = await import('/lib/store.js');
      const marker = await kv.get('pendingSale');
      const sale = await sales.get(marker.saleId);
      if ((await orders.get(sale.orderId)).status !== 'OPEN') throw Error('Order was closed during rollback');
      return sale.id;
    });
    await page.reload();
    await add.waitFor();
    await updatePause(true);
    await page.locator('#cartbtn').click();
    await page.locator('#charge').click();
    await page.locator('#finish').click();
    await page.getByRole('heading', { name: 'Sale complete' }).waitFor();
    const finished = await page.evaluate(async (id) => {
      const { kv, orders, sales } = await import('/lib/store.js');
      const sale = await sales.get(id);
      return { order: await orders.get(sale.orderId), sale, count: (await sales.all()).length, marker: await kv.get('pendingSale') };
    }, interruptedId);
    assert.equal(finished.count, 4);
    assert.equal(finished.marker, undefined);
    assert.equal(finished.order.status, 'PAID');
    assert.equal(finished.order.saleId, interruptedId);
    assert.deepEqual(finished.sale.payments, [{ method: 'CASH', amount: 30, tendered: 50 }]);
    assert.equal(finished.sale.change, 20);
    assert.deepEqual(failures, []);
    console.log('Passed pause and early resume, stale paid markers, recovery after reload, corrected tender/customer/staff and atomic settlement.');
  } finally {
    await browser.close();
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
