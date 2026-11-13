// Fills a FRESH demo database with realistic sample data, through the real application APIs and a little direct database
// setup, so every feature shown on the website has something to look at. Safe to run again (it skips what exists).
//
// Run it inside the backend container (or any place with the backend's node_modules and DATABASE_URL), with the demo
// server running (DEMO_MODE=true, DEMO_USER_EMAIL=demo@orderrestro.nodedr.com):
//   cat seed-demo.mjs | docker exec -i orderrestro-demo-backend sh -c 'cd /app && node --input-type=module -'
// It never touches any other database: it only talks to http://localhost:$PORT and to DATABASE_URL.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(process.cwd() + '/');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();
const BASE = `http://localhost:${process.env.PORT || 4000}/api/v1`;
const EMAIL = process.env.DEMO_USER_EMAIL || 'demo@orderrestro.nodedr.com';

const log = (m) => console.log('  ' + m);
const must = async (label, p) => { try { return await p; } catch (e) { console.log(`  ! ${label}: ${e.message}`); return null; } };

const restaurant = await prisma.restaurant.findFirstOrThrow({ orderBy: { createdAt: 'asc' } });
const branch = await prisma.branch.findFirstOrThrow({ where: { restaurantId: restaurant.id }, orderBy: { createdAt: 'asc' } });
const owner = await prisma.role.findFirstOrThrow({ where: { restaurantId: restaurant.id, name: 'OWNER' } });

// 1. The demo visitor: an owner-role user nobody can sign in as with a password (the password is random and thrown away).
let user = await prisma.user.findFirst({ where: { email: EMAIL } });
if (!user) {
  user = await prisma.user.create({ data: { restaurantId: restaurant.id, roleId: owner.id, name: 'Demo Visitor', email: EMAIL, passwordHash: await bcrypt.hash(randomBytes(24).toString('hex'), 10), isActive: true } });
  await prisma.userBranch.create({ data: { userId: user.id, branchId: branch.id } }).catch(() => {});
  log('created the demo visitor');
}
await prisma.restaurant.update({ where: { id: restaurant.id }, data: { manufacturingEnabled: true, requireTableSession: true } });

// 2. Sign in the way a visitor does (no password) and use the real API.
const res = await fetch(`${BASE}/auth/demo-login`, { method: 'POST' });
if (!res.ok) throw new Error(`demo-login failed (${res.status}). Is DEMO_MODE=true and DEMO_USER_EMAIL set?`);
const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const q = `?branchId=${branch.id}`;
const api = async (method, path, body) => {
  const r = await fetch(BASE + path + (path.includes('?') ? '' : q), { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${typeof j === 'string' ? j : j.message}`);
  return j;
};

// 3. Stock with real costs.
const have = new Map((await api('GET', '/inventory/ingredients')).map((i) => [i.name, i]));
const item = async (name, unit, extra = {}) => have.get(name) ?? (await must(`item ${name}`, api('POST', '/inventory/ingredients', { name, unit, ...extra })));
const rice = await item('Rice', 'KG', { category: 'Rice, grains & flour', storageLocation: 'Dry store', reorderLevel: 10, parLevel: 40 });
const dal = await item('Urad dal', 'KG', { category: 'Pulses & lentils', storageLocation: 'Dry store', reorderLevel: 5, parLevel: 20 });
const oil = await item('Sunflower oil', 'L', { category: 'Oils & fats', storageLocation: 'Dry store', reorderLevel: 5, parLevel: 20 });
const milk = await item('Milk', 'L', { category: 'Dairy & eggs', storageLocation: 'Walk-in fridge', reorderLevel: 10, parLevel: 30 });
const idli = await item('Idli', 'PIECE', { kind: 'PREPARED', category: 'Made in the kitchen' });
const sambar = await item('Sambar', 'L', { kind: 'PREPARED', category: 'Made in the kitchen' });
const recv = (i, qty, unit, unitCost, extra = {}) => i && must(`receive ${i.name}`, api('POST', '/inventory/journal/receipts', { ingredientId: i.id, quantity: qty, unit, unitCost, reference: 'Opening stock', ...extra }));
if (rice && Number(rice.currentStock ?? 0) === 0) {
  await recv(rice, '60', 'KG', '62'); await recv(dal, '25', 'KG', '118.5'); await recv(oil, '20', 'L', '148');
  await recv(milk, '30', 'L', '58', { expiryDate: new Date(Date.now() + 2 * 86400000).toISOString() });
  log('stocked ingredients with costs');
}

// 4. A finished product linked to a menu item, then costed batches with a price change, a reversal and a correction.
const cats = await api('GET', '/menu/categories');
const items = await api('GET', '/menu/items');
let plate = items.find((m) => m.name === 'Idli plate (2 pcs)');
if (!plate && idli) {
  plate = await must('menu item', api('POST', '/menu/items', { categoryId: cats[0].id, name: 'Idli plate (2 pcs)', price: 55, taxRatePercent: 5 }));
  if (plate) await must('link', api('PATCH', `/inventory/menu-items/${plate.id}/tracking`, { inventoryTracking: 'DIRECT', stockIngredientId: idli.id, stockQuantityPerSale: 2 }));
}
const batch = (qty, ricekg, dalg, extra = {}) => ({
  inputs: [{ ingredientId: rice.id, quantity: String(ricekg), unit: 'KG' }, { ingredientId: dal.id, quantity: String(dalg), unit: 'G' }, { ingredientId: oil.id, quantity: '300', unit: 'ML' }],
  outputs: [{ ingredientId: idli.id, quantity: String(qty), unit: 'PIECE' }],
  costing: { enabled: true, costs: [{ category: 'Labour', description: '2 cooks, 2 h', amount: '180', included: true }, { category: 'Fuel & utilities', amount: '60', included: true }, { category: 'Rent share', amount: '400', included: false }] , ...(extra.menuPrice ? { menuPrice: extra.menuPrice } : {}) },
  shift: 'Morning', location: 'Main kitchen', post: true, idempotencyKey: `demo-${randomBytes(8).toString('hex')}`,
});
if (idli && rice && plate) {
  const done = (await api('GET', '/inventory/production')).length > 0;
  if (!done) {
    const a = await must('batch 1', api('POST', '/inventory/production', batch(150, 6, 2000)));
    const b = await must('batch 2', api('POST', '/inventory/production', batch(120, 5, 1600, { menuPrice: { menuItemId: plate.id, newPrice: '60', expectedCurrentPrice: '55.00' } })));
    const wrong = await must('batch 3', api('POST', '/inventory/production', batch(40, 2, 600)));
    if (wrong) await must('reverse', api('POST', `/inventory/production/${wrong.id}/void`, { reason: 'Entered twice by mistake' }));
    if (a) await must('correct', api('POST', `/inventory/production/${a.id}/correct`, { reason: 'Counted 148, not 150', ...batch(148, 6, 2000), post: undefined, idempotencyKey: undefined }));
    log('posted costed production batches (one reversed, one corrected, one with a menu price change)');
  }
  await must('waste', api('POST', '/inventory/waste/entries', { ingredientId: idli.id, quantity: '6', unit: 'PIECE', reason: 'OVER_PRODUCTION', shift: 'Evening', note: 'End of service' }));
}

// 5. Places and a stock take, so the Areas screen is not empty.
const places = await api('GET', '/inventory/locations');
if (!places.length) {
  const dry = await must('place', api('POST', '/inventory/locations', { name: 'Dry store' }));
  const fr = await must('place', api('POST', '/inventory/locations', { name: 'Walk-in fridge' }));
  if (dry && rice) await must('move', api('POST', '/inventory/locations/transfers', { ingredientId: rice.id, toLocationId: dry.id, quantity: '40', unit: 'KG' }));
  if (fr && milk) await must('move', api('POST', '/inventory/locations/transfers', { ingredientId: milk.id, toLocationId: fr.id, quantity: '30', unit: 'L' }));
  log('set up stock areas');
}

// 6. Tables: QR links for the first three, one polling buzzer, and a customer screen with sample adverts.
const floors = await api('GET', '/tables/floors');
const tables = floors.flatMap((f) => f.tables).slice(0, 3);
for (const t of tables) if (!t.qrToken) await must('qr', api('POST', `/tables/${t.id}/qr-token`));
if (tables[0] && !(await api('GET', '/paging/buzzers')).length) await must('buzzer', api('POST', '/paging/buzzers', { name: 'Buzzer 1', number: '1', tableId: tables[0].id }));
let term = await prisma.displayTerminal.findFirst({ where: { branchId: branch.id } });
if (!term) {
  term = await prisma.displayTerminal.create({ data: { branchId: branch.id, name: 'Counter 1', token: randomBytes(18).toString('base64url'), idleSeconds: 30, adSlideSeconds: 6 } });
  for (const [i, f] of ['sample-ad-1.png', 'sample-ad-2.png'].entries()) await prisma.displayAd.create({ data: { branchId: branch.id, kind: 'IMAGE', url: `/api/uploads/${f}`, title: `Sample advert ${i + 1}`, durationSec: 6, sortOrder: i + 1 } });
  log('created a customer screen with sample adverts');
}

// 7. A few paid orders with ratings, so the Ratings screen has real feedback to read.
if ((await prisma.orderRating.count({ where: { branchId: branch.id } })) === 0 && plate) {
  const comments = [[5, 'Lovely idlis, quick service.'], [4, 'Great sambar. Could be a little hotter.'], [5, null], [3, 'Good food but a long wait on Saturday.']];
  for (const [stars, comment] of comments) {
    const o = await must('order', api('POST', '/orders', { type: 'TAKEAWAY', items: [{ menuItemId: plate.id, quantity: 1, modifierIds: [] }] }));
    if (!o) continue;
    await must('pay', api('POST', `/orders/${o.id}/checkout`, { payments: [{ method: 'CASH', amount: Number(o.totalAmount) }] }));
    await prisma.orderRating.create({ data: { branchId: branch.id, orderId: o.id, stars, comment } });
  }
  log('added sample paid orders with ratings');
}

console.log(`Demo ready: branch "${branch.name}". Sign in at /demo.`);
await prisma.$disconnect();
