// Run against the web app with STAFF_URL and the same CHROME / NODE_PATH as mobile/test.
// The menu, table session and order status are local fixtures. No real order is placed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// CI installs Playwright on NODE_PATH, outside the web workspace.
const { chromium } = createRequire(import.meta.url)('playwright-core');

async function check(browser) {
  const page = await browser.newPage({ locale: 'it-IT', timezoneId: 'Europe/Rome' });
  const menuPath = '/api/v1/public/menu/locale-test';
  const summary = { id: 'order', status: 'OPEN', kitchen: 'PREPARING', paged: false, paid: false };
  const details = {
    ...summary, orderNumber: 'TEST-004', acceptance: 'ACCEPTED', payIntent: 'CASH',
    items: [{ id: 'line', nameSnapshot: 'Risotto', quantity: 1, status: 'PREPARING' }],
  };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**' + menuPath + '**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === menuPath + '/session') return route.fulfill({ json: { token: 'fixture-grant' } });
    if (path === menuPath + '/status') {
      const joined = route.request().headers()['x-table-session'] === 'fixture-grant';
      return route.fulfill({ json: { order: joined ? details : summary, openRequests: [] } });
    }
    assert.equal(path, menuPath);
    return route.fulfill({ json: {
      branchName: 'Osteria', tableName: 'Terrazza', timezone: 'Europe/Zurich', currency: 'CHF',
      taxMode: 'INCLUSIVE', categories: [], session: { required: true },
    } });
  });

  try {
    await page.goto((process.env.STAFF_URL || 'http://localhost:1995') + '/order/locale-test');
    await page.getByLabel('Come ti chiami?').fill('Anna');
    await page.getByRole('button', { name: 'Vai al menù' }).click();
    await page.getByText('In preparazione.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Risotto', { exact: false }).count(), 0);

    await page.getByRole('textbox', { name: 'Codice del tavolo' }).fill('ABC234');
    await page.getByRole('button', { name: 'Accedi al tavolo' }).click();
    await page.getByText('Il tuo ordine n. TEST-004').waitFor();
    await page.getByText('1 × Risotto').waitFor();

    await page.getByRole('combobox', { name: 'Lingua' }).click();
    await page.getByRole('option', { name: 'English' }).click();
    await page.getByText('Your order #TEST-004').waitFor();
    await page.getByText('1 × Risotto').waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
  try { await check(browser); } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
