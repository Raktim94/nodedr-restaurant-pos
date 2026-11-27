// Standalone onboarding, persisted settings and paired menu refresh in a real WebView-compatible browser.
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { chromium } = require('playwright-core');

const origin = 'http://127.0.0.1:1995';
const restaurant = { name: 'Cafe', currency: 'EUR', timezone: 'Europe/Paris', upiVpa: 'old@bank' };
const branch = { id: 'branch', name: 'Cafe' };
const snapshot = {
  restaurant, branch, user: { id: 'owner', name: 'Owner' }, floors: [], categories: [],
  items: [{ id: 'coffee', name: 'Coffee', price: 1234.5, sellOffline: true, taxRate: 0 }],
};

async function servePhone(route) {
  const path = new URL(route.request().url()).pathname;
  if (path.startsWith('/api/')) {
    let json = {};
    if (path.endsWith('/branches')) json = [branch];
    if (path.endsWith('/setup-status')) json = { isSetup: true };
    if (path.endsWith('/snapshot')) json = snapshot;
    if (path.endsWith('/sales') && route.request().method() === 'POST') {
      const { sales } = route.request().postDataJSON();
      json = { results: sales.map((s) => ({ id: s.id, status: 'accepted', orderNumber: 42 })) };
    }
    if (path.endsWith('/server-info')) json = { product: 'orderrestro', capabilities: {} };
    return route.fulfill({ json });
  }
  const contentType = /\.m?js$/.test(path) ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html';
  try { await route.fulfill({ contentType, body: await readFile(join(__dirname, '../www', path)) }); }
  catch { await route.fulfill({ status: 404 }); }
}

async function italianSetup(browser, locale, country, currency, timezoneId) {
  const page = await browser.newPage({ locale, timezoneId });
  try {
    page.setDefaultTimeout(5000);
    await page.route(origin + '/**', servePhone);
    await page.goto(origin + '/pos/index.html');
    await page.getByRole('heading', { name: 'Crea il tuo account' }).waitFor();
    assert.equal(await page.locator('#sf').getAttribute('lang'), 'it');
    assert.equal(await page.getByLabel('Codice paese').inputValue(), country);
    assert.equal(await page.getByLabel('Valuta').inputValue(), currency);
    assert.equal(await page.getByLabel('Fuso orario').inputValue(), timezoneId);
    await page.getByRole('button', { name: 'Crea account e inizia' }).click();
    await page.getByRole('alert').filter({ hasText: 'Inserisci il tuo nome.' }).waitFor();
    await page.getByLabel('Il tuo nome').fill('Giulia');
    await page.getByLabel('Nome del ristorante o del negozio').fill('Bistrot');
    await page.getByLabel('Password').fill('local-test');
    await page.getByRole('button', { name: 'Crea account e inizia' }).click();
    await page.locator('[data-tab="sync"]').click();
    const settings = page.getByRole('form', { name: 'Impostazioni regionali' });
    assert.equal(await settings.getByLabel('Valuta').inputValue(), currency);
    await settings.getByLabel('Valuta').fill('ZZZ');
    await settings.getByRole('button', { name: 'Salva impostazioni regionali' }).click();
    await page.locator('#toast').filter({ hasText: 'Inserisci un codice valuta valido' }).waitFor();
    assert.equal(await page.locator('#toast').getAttribute('lang'), 'it');
    await settings.getByLabel('Codice paese').fill('IN');
    await settings.getByLabel('Valuta').focus();
    await settings.getByLabel('ID UPI').fill('invalid');
    await settings.getByRole('button', { name: 'Salva impostazioni regionali' }).click();
    await page.locator('#toast').filter({ hasText: 'Un ID UPI ha il formato nome@banca.' }).waitFor();
    await settings.getByLabel('Codice paese').fill('US');
    await settings.getByLabel('Valuta').focus();
    assert.equal(await settings.getByLabel('Valuta').inputValue(), 'USD');
    await settings.getByLabel('Fuso orario').fill('America/New_York');
    await settings.getByRole('button', { name: 'Salva impostazioni regionali' }).click();
    await page.locator('#toast').filter({ hasText: 'Impostazioni regionali salvate.' }).waitFor();
    const saved = await page.evaluate(async () => (await import('/pos/lib/store.js')).kv.get('snapshot'));
    assert.equal(saved.branch.country, 'US');
    assert.equal(saved.restaurant.currency, 'USD');
    assert.equal(saved.restaurant.timezone, 'America/New_York');
  } finally { await page.close(); }
}

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  try {
    await italianSetup(browser, 'it-IT', 'IT', 'EUR', 'Europe/Rome');
    await italianSetup(browser, 'it-CH', 'CH', 'CHF', 'Europe/Zurich');
    const page = await browser.newPage({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    page.setDefaultTimeout(5000);
    await page.route(origin + '/**', servePhone);
    await page.clock.setFixedTime(new Date('2026-03-08T03:30:00Z'));
    await page.goto(origin + '/pos/index.html');
    await page.getByRole('heading', { name: 'Create your account' }).waitFor();
    assert.equal(await page.getByLabel('Country code').inputValue(), 'BR');
    assert.equal(await page.getByLabel('Currency').inputValue(), 'BRL');
    assert.equal(await page.getByLabel('Time zone').inputValue(), 'America/Sao_Paulo');
    await page.getByLabel('Your name').fill('Owner');
    await page.getByLabel('Restaurant or shop name').fill('Cafe');
    await page.getByLabel('Password').fill('local-test');
    await page.getByRole('button', { name: 'Create account and start' }).click();
    await page.locator('[data-tab="sync"]').click();
    await page.getByLabel('Currency').fill('ZZZ');
    await page.getByRole('button', { name: 'Save regional settings' }).click();
    await page.locator('#toast').filter({ hasText: /valid currency/ }).waitFor();
    await page.getByLabel('Currency').fill('EUR');
    await page.getByLabel('Time zone').fill('America/New_York');
    await page.getByRole('button', { name: 'Save regional settings' }).click();
    await page.waitForFunction(async () => (await (await import('/pos/lib/store.js')).kv.get('snapshot')).restaurant.currency === 'EUR');
    await page.reload();
    await page.getByLabel('Password').fill('local-test');
    await page.locator('#uf button[type=submit]').click();
    await page.locator('[data-tab="menu"]').click();
    await page.locator('#add').click();
    await page.getByLabel('Price (EUR)', { exact: true }).waitFor();
    await page.locator('#dn').fill('Coffee');
    await page.locator('#dpr').fill('12.5');
    await page.locator('#ds').click();
    await page.locator('[data-tab="sell"]').click();
    await page.locator('[data-add]').first().click();
    await page.locator('#cartbtn').click();
    await page.locator('#charge').click();
    await page.locator('#done').click();
    await page.getByRole('heading', { name: 'Sale complete' }).waitFor();
    await page.locator('#newsale').click();
    await page.locator('[data-tab="sales"]').click();
    await page.locator('[data-sale]').filter({ hasText: /07\/03\/2026.*22:30/ }).waitFor();
    await page.locator('#books').click();
    await page.locator('[data-b="close"]').click();
    await page.locator('#cc').fill('12.5');
    await page.locator('#close').click();
    await page.waitForFunction(async () => (await (await import('/pos/lib/store.js')).shifts.get('2026-03-07'))?.expectedCash === 12.5);
    await page.locator('[data-close]').click();
    await page.locator('[data-tab="sync"]').click();
    restaurant.currency = 'BRL';
    await page.locator('#conn').click();
    await page.locator('#cs').fill(origin);
    await page.locator('#ci').fill('owner@example.com');
    await page.locator('#cp').fill('test-password');
    await page.locator('#cg').click();
    await page.getByRole('alert').filter({ hasText: /EUR.*BRL/ }).waitFor();
    const saved = await page.evaluate(async () => {
      const { kv, sales } = await import('/pos/lib/store.js');
      return { local: (await kv.get('snapshot')).local, sales: await sales.pending() };
    });
    assert.equal(saved.local, true);
    assert.equal(saved.sales.length, 1);
    assert.equal(saved.sales[0].currency, 'EUR');
    assert.equal(saved.sales[0].bill.total, 12.5);
    assert.match(saved.sales[0].items[0].menuItemId, /^loc-/);
    restaurant.currency = 'EUR';

    await page.locator('#cs').fill(origin);
    await page.locator('#ci').fill('owner@example.com');
    await page.locator('#cp').fill('test-password');
    const pushed = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/standalone/sales?'));
    await page.locator('#cg').click();
    const payload = (await pushed).postDataJSON().sales[0];
    assert.equal(payload.currency, 'EUR');
    assert.equal(payload.items[0].unitPrice, 12.5);
    await page.waitForFunction(async () => Boolean(await (await import('/pos/lib/store.js')).kv.get('lastSync')));
    await page.locator('[data-tab="sell"]').click();
    const item = page.locator('[data-add="coffee"]');
    await item.filter({ hasText: /€\s1\.234,50|1\.234,50\s€/ }).waitFor();
    await item.click();
    await page.locator('#cartbtn').click();
    await page.locator('#charge').click();
    await page.getByRole('heading', { name: 'Payment' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'UPI', exact: true }).count(), 0);
    restaurant.currency = 'BRL';
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await item.filter({ hasText: /R\$\s1\.234,50/ }).waitFor();
    assert.equal(await page.locator('#sheet').isVisible(), false);
    console.log('Passed Italian and Swiss Italian onboarding, phone defaults, persisted settings, localized pricing, cross-currency refusal, matching sale upload and paired refresh.');
  } finally { await browser.close(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
