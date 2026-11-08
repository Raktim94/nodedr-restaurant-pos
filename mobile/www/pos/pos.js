// OrderRestro standalone POS. Opens with no connection, sells from the menu
// saved on this phone, prints, and sends the sales to the restaurant server
// whenever it can. Plain DOM + modules: nothing here needs a build step.
import { computeBill, round2, settle, upiLink } from './lib/bill.js';
import { escposReceipt, htmlReceipt, toBase64 } from './lib/receipt.js';
import { kots, kv, newId, nextKotNumber, nextLocalNumber, nextOrderNumber, orders, sales, saveKotWithOrder } from './lib/store.js';
import { KOT_NEXT, dayReport, kotDelta, markSent, minutesSince, newOrder, openOrders, saleNote, tableMap, tableTakenBy } from './lib/orders.js';
import { escposKot, htmlKot } from './lib/kot.js';
import { native, pickServer, reachable, savedServers } from './lib/net.js';
import { login, pullSnapshot, syncNow, retrySale } from './lib/sync.js';
import { checkAll } from './lib/net.js';
import { addSection, addTable, removeSection, removeTable, changeLocalPassword, checkLocalPassword, createLocalAccount, eraseLocalAccount, hasLocalAccount, remapSalesToServer, removeDish, upsertDish } from './lib/local.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plugins = () => (window.Capacitor && window.Capacitor.Plugins) || {};
const inr = (n) => `₹${Number(n).toFixed(2)}`;

const S = {
  view: 'sell',
  snap: null,
  cart: new Map(), // menuItemId -> { item, qty }
  category: 'all',
  q: '',
  type: 'TAKEAWAY',
  table: '',
  discountPercent: 0,
  online: false,
  syncing: false,
  pending: 0,
  lastSync: null,
  note: null,
  unlocked: false,
  orderId: null, // the open order the cart belongs to (saved as you go)
  restored: false,
  noteOpen: null, // dish id whose note box is open
  editTables: false,
  showDone: false,
};

const ICON = {
  sell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.1a2 2 0 0 0 2-1.5L21 8H6"/></svg>',
  sales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6"/></svg>',
  tables: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  kitchen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 13a4 4 0 1 1 2-7.5 4 4 0 0 1 8 0A4 4 0 1 1 18 13v7H6z"/><path d="M6 17h12"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18.5 2v4h-4M5.5 22v-4h4"/></svg>',
};

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), ms);
}

// ------------------------------------------------------------------ sheets ---
function openSheet(html, onMount) {
  const s = $('sheet');
  s.innerHTML = `<div class="panel" role="dialog" aria-modal="true">${html}</div>`;
  s.hidden = false;
  s.onclick = (e) => {
    if (e.target === s) closeSheet();
  };
  s.querySelector('[data-close]')?.addEventListener('click', closeSheet);
  onMount && onMount(s.firstElementChild);
}
function closeSheet() {
  const s = $('sheet');
  s.hidden = true;
  s.innerHTML = '';
}

// ------------------------------------------------------------------- state ---
const cartLines = () => [...S.cart.values()].filter((l) => l.qty > 0);
const billOf = (extra = {}) =>
  computeBill(
    cartLines().map((l) => ({ price: l.item.price, quantity: l.qty, taxRate: l.item.taxRate })),
    { taxMode: S.snap.branch.taxMode, discountPercent: S.discountPercent, ...extra },
  );
const cartCount = () => cartLines().reduce((n, l) => n + l.qty, 0);

function saleFrom(localNumber, bill, payments, change) {
  return {
    id: newId(),
    localNumber,
    soldAt: new Date().toISOString(),
    type: S.type,
    tableLabel: S.type === 'DINE_IN' ? S.table || '' : '',
    items: cartLines().map((l) => ({ menuItemId: l.item.id, name: l.item.name, price: l.item.price, taxRate: l.item.taxRate, quantity: l.qty, ...(l.note ? { note: l.note } : {}) })),
    orderId: S.orderId || undefined,
    discountPercent: S.discountPercent || 0,
    bill: { subtotal: bill.subtotal, discountAmount: bill.discountAmount, tax: bill.tax, total: bill.total },
    payments,
    change,
    status: 'pending',
  };
}


// ------------------------------------------------------------- open orders ---
// The cart is an order that is saved as you go: crash, low battery or switching
// to another table never loses it. Orders live on this phone (see Tables).
let saveChain = Promise.resolve();
let saveTimer;
function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushPersist(), 150);
}
function flushPersist() {
  clearTimeout(saveTimer);
  saveChain = saveChain.then(persistOrder).catch(() => toast('Could not save this order on the phone. Is the storage full?', 5000));
  return saveChain;
}
async function persistOrder() {
  const lines = [...S.cart.values()].filter((l) => l.qty > 0 || (l.sent || 0) > 0);
  let o = S.orderId ? await orders.get(S.orderId) : null;
  if (!lines.length) {
    if (o && !(o.kotNumbers || []).length) await orders.del(o.id);
    if (o && !(o.kotNumbers || []).length) S.orderId = null;
    if (!S.orderId) await kv.del('currentOrderId');
    return;
  }
  if (!o) {
    S.orderId = S.orderId || newId();
    o = newOrder({ id: S.orderId, number: await nextOrderNumber() });
  }
  o.type = S.type;
  o.tableLabel = S.type === 'DINE_IN' ? S.table || '' : '';
  o.discountPercent = S.discountPercent || 0;
  o.updatedAt = new Date().toISOString();
  o.items = lines.map((l) => ({ menuItemId: l.item.id, name: l.item.name, price: l.item.price, taxRate: l.item.taxRate, qty: l.qty, sent: l.sent || 0, note: l.note || '' }));
  await orders.put(o);
  await kv.set('currentOrderId', o.id);
}
function resetCart() {
  S.cart = new Map();
  S.orderId = null;
  S.discountPercent = 0;
  S.table = '';
  S.type = 'TAKEAWAY';
  S.noteOpen = null;
  kv.del('currentOrderId');
}
function loadOrder(o) {
  S.cart = new Map(o.items.map((l) => [l.menuItemId, { item: { id: l.menuItemId, name: l.name, price: l.price, taxRate: l.taxRate, sellOffline: true }, qty: l.qty, sent: l.sent || 0, note: l.note || '' }]));
  S.orderId = o.id;
  S.type = o.type;
  S.table = o.tableLabel || '';
  S.discountPercent = o.discountPercent || 0;
  kv.set('currentOrderId', o.id);
}
async function restoreCurrent() {
  S.restored = true;
  if (S.orderId) return;
  const id = await kv.get('currentOrderId');
  const o = id && (await orders.get(id));
  if (o && o.status === 'OPEN') loadOrder(o);
}
const orderBill = (o) =>
  computeBill(
    o.items.filter((l) => l.qty > 0).map((l) => ({ price: l.price, quantity: l.qty, taxRate: l.taxRate })),
    { taxMode: S.snap.branch.taxMode, discountPercent: o.discountPercent || 0 },
  );

/** Move to another order (or a fresh one), keeping the current one saved. */
async function switchTo(o, init) {
  await flushPersist();
  if (o) loadOrder(o);
  else {
    resetCart();
    Object.assign(S, init || {});
  }
  S.view = 'sell';
  render();
}

// -------------------------------------------------------------- kitchen (KOT) ---
async function printKot(kot, { reprint = false } = {}) {
  const np = plugins().NativePrinter;
  const printer = savedPrinter();
  if (!np || !printer) return 'none';
  try {
    await np.btPrint({ address: printer.address, data: toBase64(escposKot({ ...kot, reprint }, S.snap)) });
    return 'printed';
  } catch {
    return 'failed';
  }
}

async function sendToKitchen() {
  await flushPersist();
  if (!S.orderId) return toast('Add something to the order first.');
  const o = await orders.get(S.orderId);
  const d = kotDelta(o);
  if (d.empty) return toast('The kitchen already has everything on this order.');
  const tables = S.snap.floors.flatMap((f) => f.tables);
  if (o.type === 'DINE_IN' && tables.length && !o.tableLabel) return toast('Choose the table first.');
  const number = await nextKotNumber();
  const kot = { id: newId(), number, orderId: o.id, orderNumber: o.number, at: new Date().toISOString(), type: o.type, tableLabel: o.tableLabel, add: d.add, cancel: d.cancel, status: 'NEW', print: 'none' };
  markSent(o, number);
  await saveKotWithOrder(kot, o); // one transaction: the ticket and "sent" are saved together
  for (const l of S.cart.values()) l.sent = l.qty;
  kot.print = await printKot(kot);
  await kots.put(kot);
  toast(kot.print === 'printed' ? `KOT ${number} printed` : kot.print === 'failed' ? `KOT ${number} saved, but the printer did not respond. Open Kitchen to print it again.` : `KOT ${number} is on the Kitchen screen. No printer chosen, so nothing was printed.`, 4200);
}

function cancelOrderSheet() {
  openSheet(
    `<header><h2>Cancel this order?</h2><button class="x" data-close aria-label="Close">&times;</button></header>
     <div class="body"><label for="cr">Reason</label>
     <select id="cr"><option>Guest left</option><option>Wrong order</option><option>Staff mistake</option><option>Out of stock</option><option>Other</option></select>
     <p class="note mt" id="kw"></p></div>
     <footer><button class="btn line" data-close>Keep it</button><button class="btn" id="yes" style="background:var(--bad)">Cancel order</button></footer>`,
    async (p) => {
      await flushPersist();
      const o = S.orderId ? await orders.get(S.orderId) : null;
      const sentTo = o && (o.kotNumbers || []).length;
      p.querySelector('#kw').textContent = sentTo ? `The kitchen already has KOT ${o.kotNumbers.join(', ')}. Tell them to stop. Their tickets will be marked cancelled.` : 'Nothing was sent to the kitchen. The order is kept as a record, not deleted.';
      p.querySelector('#yes').onclick = async () => {
        if (o) {
          o.status = 'VOID';
          o.voidReason = p.querySelector('#cr').value;
          o.voidedAt = new Date().toISOString();
          await orders.put(o);
          for (const k of await kots.all()) if (k.orderId === o.id && k.status !== 'SERVED' && k.status !== 'CANCELLED') await kots.put({ ...k, status: 'CANCELLED' });
        }
        resetCart();
        closeSheet();
        toast('Order cancelled');
        render();
      };
    },
  );
}

// ----------------------------------------------------------------- printing ---
const PRINTER_KEY = 'orderrestro.btPrinter';
const savedPrinter = () => {
  try {
    return JSON.parse(localStorage.getItem(PRINTER_KEY) || 'null');
  } catch {
    return null;
  }
};

function choosePrinter() {
  return new Promise((resolve) => {
    const np = plugins().NativePrinter;
    if (!np) return resolve(null);
    openSheet(
      `<header><h2>Choose a Bluetooth printer</h2><button class="x" data-close aria-label="Close">&times;</button></header>
       <div class="body"><p class="mute">Switch the printer on and pair it once in the phone's Bluetooth settings. Pick it here.</p><div id="pl"><p class="mute">Looking&hellip;</p></div></div>`,
      async (p) => {
        p.querySelector('[data-close]').onclick = () => {
          closeSheet();
          resolve(null);
        };
        let r;
        try {
          r = await np.btPrinters();
        } catch (e) {
          p.querySelector('#pl').innerHTML = `<div class="note bad">${esc(e.message || e)}</div>`;
          return;
        }
        const note = !r.supported ? 'This phone has no Bluetooth.' : !r.enabled ? 'Bluetooth is off. Turn it on, then reopen this.' : r.devices.length === 0 ? 'No paired printers yet. Pair the printer in the phone\'s Bluetooth settings first.' : '';
        p.querySelector('#pl').innerHTML =
          r.devices.map((d) => `<button class="btn line block" style="justify-content:flex-start;margin-bottom:.5rem" data-addr="${esc(d.address)}" data-name="${esc(d.name)}">${esc(d.name)} <small class="mute">${esc(d.address)}</small></button>`).join('') +
          (note ? `<div class="note">${esc(note)}</div>` : '');
        p.querySelectorAll('[data-addr]').forEach((b) => {
          b.onclick = () => {
            const printer = { name: b.dataset.name, address: b.dataset.addr };
            localStorage.setItem(PRINTER_KEY, JSON.stringify(printer));
            closeSheet();
            resolve(printer);
          };
        });
      },
    );
  });
}

async function printBluetooth(bytes) {
  const np = plugins().NativePrinter;
  if (!np) return toast('Bluetooth printing works in the OrderRestro app.');
  let printer = savedPrinter();
  if (!printer) printer = await choosePrinter();
  if (!printer) return;
  try {
    await np.btPrint({ address: printer.address, data: toBase64(bytes) });
    toast('Sent to the printer');
  } catch (e) {
    toast(e.message || 'Could not print');
  }
}

async function printPdf(sale, opts) {
  const upiSvg = opts.upiUri && window.OrderRestroQR ? await window.OrderRestroQR.svg(opts.upiUri, 240) : null;
  const html = htmlReceipt(sale, S.snap, { provisional: opts.provisional, upiSvg });
  const np = plugins().NativePrinter;
  if (np) {
    try {
      await np.printHtml({ html, name: `Bill ${sale.localNumber}` });
    } catch (e) {
      toast(e.message || 'Could not open the print dialog');
    }
  } else {
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
      w.print();
    }
  }
}

const upiUriFor = (sale) =>
  S.snap.restaurant.upiVpa && sale.bill.total > 0
    ? upiLink({ vpa: S.snap.restaurant.upiVpa, name: S.snap.restaurant.upiPayeeName, amount: sale.bill.total, note: `Bill ${sale.localNumber}`, ref: sale.localNumber })
    : null;

const printActions = (sale, provisional) => `
  <div class="grid">
    <button class="btn ghost" data-pr="bt">Print (Bluetooth)</button>
    <button class="btn ghost" data-pr="pdf">Print / Save PDF</button>
  </div>`;
function bindPrint(root, sale, provisional) {
  root.querySelector('[data-pr=bt]')?.addEventListener('click', () =>
    printBluetooth(escposReceipt(sale, S.snap, { provisional, upiUri: provisional ? upiUriFor(sale) : null })),
  );
  root.querySelector('[data-pr=pdf]')?.addEventListener('click', () => printPdf(sale, { provisional, upiUri: provisional ? upiUriFor(sale) : null }));
}

// -------------------------------------------------------------- sign in ----
async function renderLogin(message) {
  const servers = await savedServers();
  const last = (await kv.get('serverBase')) || servers[0] || '';
  $('app').innerHTML = `
  <form class="login" id="lf" novalidate>
    <img src="../assets/logo.png" alt="">
    <h1 class="center">Standalone point of sale</h1>
    <p class="mute center">Sign in once while you are online. After that this phone can sell with no connection and sends the sales to your server later.</p>
    ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
    <label for="srv">Server address</label>
    ${servers.length ? `<select id="srv">${servers.map((u) => `<option ${u === last ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>` : '<input id="srv" placeholder="192.168.1.20 or pos.example.com" inputmode="url" autocapitalize="none">'}
    <label for="id">Email or phone number</label>
    <input id="id" autocomplete="username" autocapitalize="none" inputmode="email">
    <label for="pw">Password</label>
    <input id="pw" type="password" autocomplete="current-password">
    <button class="btn block mt" id="go" type="submit">Sign in and download the menu</button>
    <p class="center mt"><a href="../index.html?stay=1" class="mute">Back to connect screen</a></p>
    <hr class="sep">
    <button class="btn line block" id="nosrv" type="button">${(await hasLocalAccount()) ? 'Open my account on this phone' : 'No server yet? Create an account on this phone'}</button>
  </form>`;
  $('nosrv').onclick = async () => ((await hasLocalAccount()) ? renderUnlock() : renderSetup());
  $('lf').onsubmit = async (ev) => {
    ev.preventDefault();
    const go = $('go');
    go.disabled = true;
    go.textContent = 'Signing in…';
    let base = $('srv').value.trim();
    if (base && !/^https?:\/\//i.test(base)) base = (/^[\d.]+(:\d+)?$/.test(base) ? 'http://' : 'https://') + base;
    try {
      if (!(await reachable(base))) throw new Error("Can't reach that server from here. Check the address and that you are online.");
      await login(base, $('id').value.trim(), $('pw').value);
      await pullSnapshot(base);
      await kv.set('deviceName', (await kv.get('deviceName')) || `Phone-${newId().slice(0, 4)}`);
      S.snap = await kv.get('snapshot');
      await start();
    } catch (e) {
      renderLogin(e.message);
    }
  };
}


// ------------------------------------------------- on this phone (no server) ---
function renderSetup(message, v = {}) {
  $('app').innerHTML = `
  <form class="login" id="sf" novalidate>
    <img src="../assets/logo.png" alt="">
    <h1 class="center">Create your account</h1>
    <p class="mute center">No server needed. Your menu and sales stay on this phone. You can connect a restaurant server later and your sales will be sent to it.</p>
    ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
    <label for="n">Your name</label>
    <input id="n" autocomplete="name" value="${esc(v.name)}">
    <label for="e">Email <span class="mute">(optional)</span></label>
    <input id="e" type="email" autocomplete="email" autocapitalize="none" value="${esc(v.email)}">
    <label for="r">Restaurant or shop name</label>
    <input id="r" value="${esc(v.restaurant)}">
    <label for="u">UPI id <span class="mute">(optional, shows a Scan to pay code on the bill)</span></label>
    <input id="u" autocapitalize="none" placeholder="name@bank" value="${esc(v.upi)}">
    <label for="p">Password <span class="mute">(at least 6 characters)</span></label>
    <input id="p" type="password" autocomplete="new-password">
    <button class="btn block mt" id="go" type="submit">Create account and start</button>
    <p class="center mt"><a href="#" id="back" class="mute">I already have a server</a></p>
  </form>`;
  $('back').onclick = (e) => (e.preventDefault(), renderLogin());
  $('sf').onsubmit = async (ev) => {
    ev.preventDefault();
    const vals = { name: $('n').value, email: $('e').value, restaurant: $('r').value, upi: $('u').value };
    try {
      S.snap = await createLocalAccount({ ...vals, password: $('p').value, upiVpa: vals.upi });
      S.unlocked = true;
      S.view = 'menu';
      S.note = { text: 'Account created. Add your dishes here, then go to Sell.' };
      render();
    } catch (e) {
      renderSetup(e.message, vals);
    }
  };
}

function renderUnlock(message) {
  $('app').innerHTML = `
  <form class="login" id="uf" novalidate>
    <img src="../assets/logo.png" alt="">
    <h1 class="center">Welcome back</h1>
    ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
    <label for="p">Password</label>
    <input id="p" type="password" autocomplete="current-password">
    <button class="btn block mt" id="go" type="submit">Open</button>
    <p class="center mt"><a href="#" id="srv" class="mute">Sign in to a server instead</a></p>
    <p class="center"><a href="#" id="forgot" class="mute">Forgot my password</a></p>
  </form>`;
  $('forgot').onclick = async (e) => {
    e.preventDefault();
    const n = (await sales.all()).length;
    const t = prompt(`This erases the account, the menu and ${n} sale${n === 1 ? '' : 's'} on this phone, because the password cannot be recovered. Type ERASE to continue.`);
    if (t === null || t.trim().toUpperCase() !== 'ERASE') return;
    await eraseLocalAccount();
    S.snap = null;
    S.unlocked = false;
    renderSetup();
  };
  $('srv').onclick = (e) => (e.preventDefault(), renderLogin());
  $('uf').onsubmit = async (ev) => {
    ev.preventDefault();
    if (!(await checkLocalPassword($('p').value))) return renderUnlock('That password is not right.');
    S.unlocked = true;
    S.snap = await kv.get('snapshot');
    if (!S.snap) return renderLogin();
    render();
  };
}

function viewMenu() {
  const { categories, items } = S.snap;
  const cat = (id) => (categories.find((c) => c.id === id) || {}).name || 'No category';
  $('view').innerHTML = `
    ${S.note ? `<div class="note ${S.note.kind || ''}" role="status">${esc(S.note.text)}</div>` : ''}
    <button class="btn block" id="add">Add a dish</button>
    <div class="mt">${
      items
        .map(
          (i) => `<button class="row dishrow" data-edit="${esc(i.id)}"><div class="grow"><b>${esc(i.name)}</b><br><small>${esc(cat(i.categoryId))}${i.taxRate ? ` &middot; tax ${esc(i.taxRate)}%` : ''}</small></div><b>${inr(i.price)}</b></button>`,
        )
        .join('') || '<p class="mute center mt">Your menu is empty. Tap Add a dish to start.</p>'
    }</div>`;
  $('add').onclick = () => dishSheet();
  document.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => dishSheet(S.snap.items.find((i) => i.id === b.dataset.edit))));
}

function dishSheet(item, message) {
  const cats = S.snap.categories;
  const cur = item ? (cats.find((c) => c.id === item.categoryId) || {}).name || '' : '';
  openSheet(
    `<header><h2>${item ? 'Edit dish' : 'Add a dish'}</h2><button class="x" data-close aria-label="Close">&times;</button></header>
     <div class="body">
       ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
       <label for="dn">Name</label><input id="dn" value="${esc(item && item.name)}">
       <label for="dpr">Price (₹)</label><input id="dpr" type="number" inputmode="decimal" min="0" step="0.01" value="${item ? esc(item.price) : ''}">
       <label for="dc">Category <span class="mute">(optional)</span></label>
       <input id="dc" list="cl" value="${esc(cur)}" placeholder="Starters, Drinks…"><datalist id="cl">${cats.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
       <label for="dt">Tax included in price (%)</label><input id="dt" type="number" inputmode="decimal" min="0" max="100" value="${item ? esc(item.taxRate) : 0}">
       <label class="chk"><input id="dv" type="checkbox" ${!item || item.isVeg ? 'checked' : ''}> Vegetarian</label>
     </div>
     <footer>${item ? '<button class="btn line" id="dd">Delete</button>' : ''}<button class="btn" id="ds">Save</button></footer>`,
    (p) => {
      p.querySelector('#ds').onclick = async () => {
        try {
          S.snap = await upsertDish(S.snap, { id: item && item.id, name: $('dn').value, price: $('dpr').value, taxRate: $('dt').value, isVeg: $('dv').checked, categoryName: $('dc').value });
          closeSheet();
          S.note = null;
          render();
        } catch (e) {
          dishSheet(item, e.message);
        }
      };
      const del = p.querySelector('#dd');
      if (del)
        del.onclick = async () => {
          if (!confirm(`Delete ${item.name} from the menu? Past sales keep it.`)) return;
          S.snap = await removeDish(S.snap, item.id);
          S.cart.delete(item.id);
          closeSheet();
          render();
        };
    },
  );
}

function passwordSheet(message) {
  openSheet(
    `<header><h2>Change password</h2><button class="x" data-close aria-label="Close">&times;</button></header>
     <form class="body" id="pf" novalidate>
       ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
       <label for="op">Current password</label><input id="op" type="password" autocomplete="current-password">
       <label for="np">New password <span class="mute">(at least 6 characters)</span></label><input id="np" type="password" autocomplete="new-password">
       <button class="btn block mt" type="submit">Save new password</button>
     </form>`,
    (p) => {
      p.querySelector('#pf').onsubmit = async (ev) => {
        ev.preventDefault();
        try {
          await changeLocalPassword($('op').value, $('np').value);
          closeSheet();
          S.note = { text: 'Password changed.' };
          render();
        } catch (e) {
          passwordSheet(e.message);
        }
      };
    },
  );
}

/** Switch from "on this phone" to a real server: sign in, match the dishes, send the sales. */
function connectSheet(message) {
  openSheet(
    `<header><h2>Connect to a server</h2><button class="x" data-close aria-label="Close">&times;</button></header>
     <form class="body" id="cf" novalidate>
       <p class="mute">Your account stays on this phone. The sales you took are matched to the server's dishes by name and sent to it.</p>
       ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
       <label for="cs">Server address</label><input id="cs" placeholder="192.168.1.20 or pos.example.com" inputmode="url" autocapitalize="none">
       <label for="ci">Email or phone number</label><input id="ci" autocapitalize="none" autocomplete="username">
       <label for="cp">Password</label><input id="cp" type="password" autocomplete="current-password">
       <button class="btn block mt" id="cg" type="submit">Connect and send my sales</button>
     </form>`,
    (p) => {
      p.querySelector('#cf').onsubmit = async (ev) => {
        ev.preventDefault();
        const b = p.querySelector('#cg');
        b.disabled = true;
        b.textContent = 'Connecting…';
        let base = $('cs').value.trim();
        if (base && !/^https?:\/\//i.test(base)) base = (/^[\d.]+(:\d+)?$/.test(base) ? 'http://' : 'https://') + base;
        try {
          if (!base || !(await reachable(base))) throw new Error("Can't reach that server from here. Check the address and that you are online.");
          const keep = await kv.get('snapshot');
          await login(base, $('ci').value.trim(), $('cp').value);
          const server = await pullSnapshot(base); // replaces the local menu
          const r = await remapSalesToServer(server.items);
          await kv.set('localMenuBackup', keep);
          closeSheet();
          S.snap = server;
          S.view = 'sync';
          S.note = { text: `Connected. ${r.matched} sale${r.matched === 1 ? '' : 's'} ready to send${r.unmatched ? `, ${r.unmatched} with dishes the server does not have (see Sales)` : ''}.` };
          render();
          syncNow().then(afterSync);
        } catch (e) {
          await kv.set('snapshot', S.snap); // keep working on this phone
          await kv.set('branchId', 'local');
          connectSheet(e.message);
        }
      };
    },
  );
}

// ------------------------------------------------------------------- shell ---
function shell() {
  const tabs = [
    ['sell', 'Sell', ICON.sell],
    ['tables', 'Tables', ICON.tables],
    ['kitchen', 'Kitchen', ICON.kitchen],
    ...(S.snap.local ? [['menu', 'Menu', ICON.menu]] : []),
    ['sales', 'Sales', ICON.sales],
    ['sync', 'Sync', ICON.sync],
  ];
  $('app').innerHTML = `
  <header class="top">
    <h1>${esc(S.snap.branch.name)}</h1>
    <span class="pill ${S.snap.local || S.online ? 'on' : 'off'}" id="pill"><i></i>${S.snap.local ? 'On this phone' : S.online ? 'Online' : 'Offline'}</span>
  </header>
  <main class="view" id="view"></main>
  <div id="barwrap"></div>
  <nav class="nav" aria-label="Sections">
    ${tabs.map(([k, label, icon]) => `<button data-tab="${k}" ${S.view === k ? 'aria-current="page"' : ''}>${icon}<span>${label}${k === 'sales' && S.pending ? ` <span class="badge">${S.pending}</span>` : ''}${k === 'kitchen' && S.kitchenOpen ? ` <span class="badge">${S.kitchenOpen}</span>` : ''}</span></button>`).join('')}
  </nav>`;
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
}
function go(v) {
  if (v !== S.view) S.note = null;
  S.view = v;
  render();
}
async function refreshKitchenBadge() {
  S.kitchenOpen = (await kots.all()).filter((k) => k.status !== 'SERVED' && !k.dismissed).length;
}
async function refreshPending() {
  S.pending = (await sales.pending()).length;
}
async function render() {
  if (!S.snap) return renderLogin();
  if (S.snap.local && !S.unlocked) return renderUnlock();
  if (!S.restored) await restoreCurrent();
  await refreshPending();
  await refreshKitchenBadge();
  shell();
  ({ sell: viewSell, tables: viewTables, kitchen: viewKitchen, menu: viewMenu, sales: viewSales, sync: viewSync })[S.view]();
}

// -------------------------------------------------------------------- sell ---
function viewSell() {
  const { categories, items } = S.snap;
  const q = S.q.trim().toLowerCase();
  const shown = items.filter((i) => (S.category === 'all' || i.categoryId === S.category) && (!q || i.name.toLowerCase().includes(q)));
  $('view').innerHTML = `
    ${S.orderId || S.table ? `<div class="note" role="status">${S.type === 'DINE_IN' ? `Dine in${S.table ? ` &middot; <b>${esc(S.table)}</b>` : ''}` : 'Takeaway'}${cartCount() ? ' &middot; saved automatically' : ''}</div>` : ''}
    <input class="search" id="q" type="search" placeholder="Search the menu" value="${esc(S.q)}" aria-label="Search the menu">
    <div class="chips" role="group" aria-label="Categories">
      <button class="chip" data-cat="all" aria-pressed="${S.category === 'all'}">All</button>
      ${categories.map((c) => `<button class="chip" data-cat="${esc(c.id)}" aria-pressed="${S.category === c.id}">${esc(c.name)}</button>`).join('')}
    </div>
    <div class="grid">
      ${shown.map((i) => `<button class="dish" data-add="${esc(i.id)}" ${i.sellOffline ? '' : 'disabled'}>
          <b><span class="veg ${i.isVeg ? '' : 'nv'}"></span>${esc(i.name)}</b>
          <span>${inr(i.price)}${S.cart.get(i.id)?.qty ? ` &middot; <strong style="color:var(--brand)">&times;${S.cart.get(i.id).qty}</strong>` : ''}</span>
          ${i.sellOffline ? '' : '<small>Needs options: use the full app</small>'}
        </button>`).join('') || (S.snap.local && !S.snap.items.length ? '<p class="mute center mt">Your menu is empty. Open the Menu tab to add your dishes.</p>' : '<p class="mute center mt">Nothing matches.</p>')}
    </div>`;
  $('q').oninput = (e) => {
    S.q = e.target.value;
    viewSell();
    $('q').focus();
    $('q').setSelectionRange(S.q.length, S.q.length);
  };
  document.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => ((S.category = b.dataset.cat), viewSell())));
  document.querySelectorAll('[data-add]').forEach(
    (b) =>
      (b.onclick = () => {
        const item = S.snap.items.find((i) => i.id === b.dataset.add);
        const line = S.cart.get(item.id) || { item, qty: 0 };
        line.qty++;
        S.cart.set(item.id, line);
        viewSell();
        renderBar();
        navigator.vibrate && navigator.vibrate(10);
      }),
  );
  renderBar();
}
function renderBar() {
  persistSoon();
  const n = cartCount();
  $('barwrap').innerHTML = n
    ? `<div class="bar"><button class="btn" id="cartbtn"><span>View cart &middot; ${n} item${n > 1 ? 's' : ''}</span><span>${inr(billOf().total)}</span></button></div>`
    : '';
  $('cartbtn') && ($('cartbtn').onclick = openCart);
}

function openCart() {
  const draw = () => {
    persistSoon();
    const lines = cartLines();
    if (!lines.length && ![...S.cart.values()].some((l) => l.sent > 0)) return closeSheet(), render();
    const bill = billOf();
    const tables = S.snap.floors.flatMap((f) => f.tables);
    $('sheet').firstElementChild.innerHTML = `
      <header><h2>Cart</h2><button class="x" data-close aria-label="Close">&times;</button></header>
      <div class="body">
        <div class="seg" role="group" aria-label="Order type">
          <button data-type="TAKEAWAY" aria-pressed="${S.type === 'TAKEAWAY'}">Takeaway</button>
          <button data-type="DINE_IN" aria-pressed="${S.type === 'DINE_IN'}">Dine in</button>
        </div>
        ${S.type === 'DINE_IN' && tables.length ? `<label for="tb">Table</label><select id="tb"><option value="">No table</option>${tables.map((t) => `<option ${S.table === t.label ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>` : ''}
        <div style="margin-top:.6rem">${lines
          .map(
            (l) => `<div class="row"><div class="grow"><b>${esc(l.item.name)}</b><br><small>${inr(l.item.price)} each</small></div>
            <div class="qty"><button data-dec="${esc(l.item.id)}" aria-label="One less">&minus;</button><b>${l.qty}</b><button data-inc="${esc(l.item.id)}" aria-label="One more">+</button></div>
            <b style="min-width:5.5rem;text-align:right">${inr(l.item.price * l.qty)}</b></div>
            <div style="padding:.2rem 0 .5rem;border-bottom:1px solid var(--line)">${S.noteOpen === l.item.id ? `<input data-note="${esc(l.item.id)}" maxlength="80" value="${esc(l.note || '')}" placeholder="e.g. no onion, less spicy" aria-label="Note for ${esc(l.item.name)}">` : `<button class="chip" data-opennote="${esc(l.item.id)}">${l.note ? `Note: ${esc(l.note)}` : '+ Note'}</button>`}${l.sent ? ` <small class="mute">${l.sent} sent to kitchen</small>` : ''}</div>`,
          )
          .join('')}</div>
        <label for="dp">Discount %</label><input id="dp" type="number" inputmode="decimal" min="0" max="${esc(S.snap.restaurant.maxManualDiscountPercent)}" value="${S.discountPercent || ''}" placeholder="0">
        <div class="mt">
          <div class="tot"><span>Subtotal</span><span>${inr(bill.subtotal)}</span></div>
          ${bill.discountAmount > 0 ? `<div class="tot"><span>Discount</span><span>-${inr(bill.discountAmount)}</span></div>` : ''}
          ${bill.tax > 0 ? `<div class="tot mute"><span>${esc(S.snap.branch.taxLabel || 'Tax')} (included)</span><span>${inr(bill.tax)}</span></div>` : ''}
          <div class="tot big"><span>Total</span><span>${inr(bill.total)}</span></div>
        </div>
        <div class="grid mt">
          <button class="btn ghost" id="kot">Send to kitchen (KOT)</button>
          <button class="btn ghost" id="hold">Hold order</button>
        </div>
        <div class="mt">${printActions()}</div>
        <button class="btn line block mt" id="void" style="color:var(--bad)">Cancel this order</button>
      </div>
      <footer><button class="btn block" id="charge" ${lines.length ? '' : 'disabled'}>Charge ${inr(bill.total)}</button></footer>`;
    const root = $('sheet').firstElementChild;
    root.querySelector('[data-close]').onclick = closeSheet;
    root.querySelectorAll('[data-type]').forEach((b) => (b.onclick = () => ((S.type = b.dataset.type), draw())));
    root.querySelector('#tb') && (root.querySelector('#tb').onchange = async (e) => {
      // One open order per table: never put two parties on one table by accident.
      const clash = e.target.value && tableTakenBy(await orders.all(), e.target.value, S.orderId);
      if (clash) {
        toast(`${e.target.value} already has an open order (${clash.number}). Open it from Tables.`, 4000);
        e.target.value = S.table;
        return;
      }
      S.table = e.target.value;
      persistSoon();
    });
    root.querySelectorAll('[data-opennote]').forEach((b) => (b.onclick = () => ((S.noteOpen = b.dataset.opennote), draw(), root.querySelector('[data-note]')?.focus())));
    root.querySelectorAll('[data-note]').forEach((el) => {
      el.oninput = () => (S.cart.get(el.dataset.note).note = el.value.trim());
      el.onblur = () => ((S.noteOpen = null), draw());
    });
    root.querySelector('#kot').onclick = async () => (await sendToKitchen(), draw());
    root.querySelector('#hold').onclick = async () => {
      await flushPersist();
      resetCart();
      closeSheet();
      toast('Order held. Find it under Tables.');
      render();
    };
    root.querySelector('#void').onclick = cancelOrderSheet;
    root.querySelectorAll('[data-inc]').forEach((b) => (b.onclick = () => (S.cart.get(b.dataset.inc).qty++, draw())));
    root.querySelectorAll('[data-dec]').forEach((b) => (b.onclick = () => (S.cart.get(b.dataset.dec).qty--, draw())));
    root.querySelector('#dp').onchange = (e) => {
      const max = Number(S.snap.restaurant.maxManualDiscountPercent) || 100;
      S.discountPercent = Math.min(Math.max(Number(e.target.value) || 0, 0), max);
      draw();
    };
    bindPrint(root, saleFrom('Bill', bill, [], 0), true);
    root.querySelector('#charge').onclick = () => openPay();
  };
  openSheet('', draw);
  draw();
  $('sheet').onclick = (e) => e.target === $('sheet') && (closeSheet(), renderBar(), viewSell());
}

// ------------------------------------------------------------------ payment ---
function openPay() {
  const bill = billOf();
  let rows = [{ method: 'CASH', amount: String(bill.total) }];
  const METHODS = [['CASH', 'Cash'], ['UPI', 'UPI'], ['CARD', 'Card'], ['OTHER', 'Other']];
  const draw = async () => {
    const tenders = rows.map((r) => ({ method: r.method, amount: Number(r.amount) || 0, reference: r.reference }));
    const st = settle(bill.total, tenders);
    const upiRow = rows.find((r) => r.method === 'UPI');
    let qr = '';
    if (upiRow && S.snap.restaurant.upiVpa && window.OrderRestroQR) {
      const amt = Number(upiRow.amount) || bill.total;
      const svg = await window.OrderRestroQR.svg(upiLink({ vpa: S.snap.restaurant.upiVpa, name: S.snap.restaurant.upiPayeeName, amount: amt }), 240);
      qr = `<div class="qr" aria-label="UPI QR code">${svg}</div><p class="center mute">Ask the guest to scan, then confirm below when the payment shows on your phone.</p>`;
    } else if (upiRow) qr = '<div class="note">No UPI id is set for this restaurant. Take the UPI payment on your own phone and note the reference.</div>';
    const root = $('sheet').firstElementChild;
    root.innerHTML = `
      <header><h2>Payment</h2><button class="x" data-close aria-label="Close">&times;</button></header>
      <div class="body">
        <div class="tot big"><span>Total</span><span>${inr(bill.total)}</span></div>
        ${rows
          .map(
            (r, i) => `<div class="mt"><div class="seg" role="group" aria-label="Payment method">${METHODS.map(([m, l]) => `<button data-m="${i}:${m}" aria-pressed="${r.method === m}">${l}</button>`).join('')}</div>
            <label for="am${i}">${r.method === 'CASH' ? 'Cash received' : 'Amount'}</label>
            <input id="am${i}" data-am="${i}" type="number" inputmode="decimal" value="${esc(r.amount)}">
            ${r.method === 'CASH' ? `<div class="chips mt" style="padding-bottom:0">${[bill.total, 100, 200, 500, 2000].map((q) => `<button class="chip" data-q="${i}:${q}">${q === bill.total ? 'Exact' : q}</button>`).join('')}</div>` : ''}
            ${r.method !== 'CASH' ? `<label for="rf${i}">Reference (optional)</label><input id="rf${i}" data-rf="${i}" value="${esc(r.reference || '')}" placeholder="Transaction id">` : ''}</div>`,
          )
          .join('')}
        ${qr}
        <button class="btn line block mt" id="split">+ Add another payment</button>
        <div class="mt">
          ${st.change > 0 ? `<div class="tot big" style="color:var(--ok)"><span>Change to give</span><span>${inr(st.change)}</span></div>` : ''}
          ${!st.fullyPaid ? `<div class="tot big" style="color:var(--bad)"><span>Still to pay</span><span>${inr(st.balance)}</span></div>` : ''}
        </div>
      </div>
      <footer><button class="btn block" id="done" ${st.fullyPaid ? '' : 'disabled'}>Complete sale</button></footer>`;
    root.querySelector('[data-close]').onclick = openCart;
    root.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => ((rows[Number(b.dataset.m.split(':')[0])].method = b.dataset.m.split(':')[1]), draw())));
    root.querySelectorAll('[data-am]').forEach((el) => (el.oninput = () => ((rows[Number(el.dataset.am)].amount = el.value), softRedraw())));
    root.querySelectorAll('[data-rf]').forEach((el) => (el.oninput = () => (rows[Number(el.dataset.rf)].reference = el.value)));
    root.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => ((rows[Number(b.dataset.q.split(':')[0])].amount = b.dataset.q.split(':')[1]), draw())));
    root.querySelector('#split').onclick = () => {
      const left = round2(Math.max(bill.total - tenders.reduce((s, t) => s + t.amount, 0), 0));
      rows.push({ method: 'UPI', amount: String(left || '') });
      draw();
    };
    root.querySelector('#done').onclick = () => complete(st, tenders);
  };
  // typing re-renders the sheet; keep the caret in the field being edited
  let t;
  const softRedraw = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const el = document.activeElement;
      const id = el && el.id;
      const pos = el && el.selectionStart;
      draw().then(() => {
        const n = id && document.getElementById(id);
        if (n) {
          n.focus();
          try {
            n.setSelectionRange(pos, pos);
          } catch {
            /* number inputs have no selection */
          }
        }
      });
    }, 250);
  };
  async function complete(st, tenders) {
    if (!st.fullyPaid) return;
    await flushPersist();
    const number = await nextLocalNumber();
    const sale = saleFrom(number, bill, st.rows.map((r) => ({ ...r })), st.change);
    sale.note = saleNote(sale.items);
    await sales.put(sale);
    const o = S.orderId ? await orders.get(S.orderId) : null;
    if (o) await orders.put({ ...o, status: 'PAID', saleId: sale.id, paidAt: new Date().toISOString() }); // frees the table
    resetCart();
    toast('Sale saved');
    openDone(sale);
    syncNow({ refreshMenu: false }).then(afterSync);
  }
  openSheet('', () => draw());
  draw();
}

function openDone(sale) {
  openSheet(
    `<header><h2>Sale complete</h2><button class="x" data-close aria-label="Close">&times;</button></header>
     <div class="body center">
       <div style="font-size:3rem;color:var(--ok)" aria-hidden="true">&#10003;</div>
       <h2>${inr(sale.bill.total)}</h2>
       <p class="mute">Bill ${esc(sale.localNumber)}${sale.change > 0 ? ` &middot; give change ${inr(sale.change)}` : ''}</p>
       <p class="note">${S.snap.local ? 'Saved on this phone. Connect a server later (Sync tab) and it is sent then.' : 'Saved on this phone. It goes to the server by itself when you are online.'}</p>
       <div class="mt">${printActions()}</div>
     </div>
     <footer><button class="btn block" id="newsale">New sale</button></footer>`,
    (p) => {
      bindPrint(p, sale, false);
      p.querySelector('#newsale').onclick = () => (closeSheet(), (S.view = 'sell'), render());
      p.querySelector('[data-close]').onclick = () => (closeSheet(), render());
    },
  );
}

// ------------------------------------------------------------------ tables ---
async function viewTables() {
  const os = await orders.all();
  const taken = tableMap(os);
  const open = openOrders(os).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const floors = S.snap.floors;
  const local = !!S.snap.local;
  const now = Date.now();
  $('view').innerHTML = `
    ${S.note ? `<div class="note ${S.note.kind || ''}" role="status">${esc(S.note.text)}</div>` : ''}
    <button class="btn block" id="takeaway">+ New takeaway order</button>
    ${open.length ? `<h2 class="sec">Open orders</h2>${open
      .map((o) => `<button class="row orow" data-resume="${esc(o.id)}"><div class="grow"><b>${o.type === 'DINE_IN' ? esc(o.tableLabel || 'Dine in (no table)') : 'Takeaway'}</b> <small>${esc(o.number)}</small><br><small>${o.items.reduce((n, l) => n + l.qty, 0)} items &middot; ${minutesSince(o.createdAt, now)} min${(o.kotNumbers || []).length ? ` &middot; KOT ${o.kotNumbers.join(', ')}` : ' &middot; not sent to kitchen'}${S.orderId === o.id ? ' &middot; <b>on screen</b>' : ''}</small></div><b>${inr(orderBill(o).total)}</b></button>`)
      .join('')}` : ''}
    <h2 class="sec">Tables</h2>
    ${floors.length ? floors.map((f) => `<h3 class="floor">${esc(f.name)}${S.editTables && local ? ` <button class="mini" data-delsec="${esc(f.id)}" aria-label="Remove section ${esc(f.name)}">Remove</button>` : ''}</h3>
      <div class="tables">${f.tables.map((t) => {
        const o = taken.get(t.label);
        return `<button class="tbl ${o ? 'busy' : ''}" data-tbl="${esc(t.label)}" aria-label="${esc(t.label)}, ${o ? `occupied, ${inr(orderBill(o).total)}, ${minutesSince(o.createdAt, now)} minutes` : `free, seats ${t.capacity}`}">
          <b>${esc(t.label)}</b><small>${o ? `${inr(orderBill(o).total)} &middot; ${minutesSince(o.createdAt, now)}m` : `Free &middot; ${t.capacity} seats`}</small>
          ${S.editTables && local ? `<span class="mini" data-deltbl="${esc(t.id)}" role="button" aria-label="Remove table ${esc(t.label)}">&times;</span>` : ''}</button>`;
      }).join('') || '<p class="mute">No tables in this section.</p>'}
        ${local ? `<button class="tbl add" data-addtbl="${esc(f.id)}"><b>+ Table</b></button>` : ''}</div>`).join('')
      : `<div class="note">${local ? 'No tables yet. Add a section (for example Ground floor), then its tables.' : 'No tables are set up on the server. Add them in the full app, then sync.'}</div>`}
    ${local ? `<div class="mt grid"><button class="btn ghost" id="addsec">+ Add section</button><button class="btn ghost" id="edt">${S.editTables ? 'Done editing' : 'Edit tables'}</button></div>` : ''}
    <p class="mute mt">${local ? 'Tables and open orders are kept on this phone only. Another phone will not see them.' : 'Table status here is for this phone only. Other devices do not see these open orders until a sale is paid and synced.'}</p>`;
  $('takeaway').onclick = () => switchTo(null, { type: 'TAKEAWAY' });
  document.querySelectorAll('[data-resume]').forEach((b) => (b.onclick = async () => switchTo(await orders.get(b.dataset.resume))));
  document.querySelectorAll('[data-tbl]').forEach(
    (b) =>
      (b.onclick = async (ev) => {
        if (ev.target.dataset.deltbl) return;
        const label = b.dataset.tbl;
        const fresh = tableMap(await orders.all()).get(label);
        if (fresh) return switchTo(fresh);
        if (S.editTables) return;
        switchTo(null, { type: 'DINE_IN', table: label });
      }),
  );
  if (!local) return;
  const fail = (e) => ((S.note = { kind: 'bad', text: e.message }), viewTables());
  $('edt').onclick = () => ((S.editTables = !S.editTables), viewTables());
  $('addsec').onclick = () =>
    openSheet(`<header><h2>Add a section</h2><button class="x" data-close aria-label="Close">&times;</button></header><div class="body"><label for="sn">Name</label><input id="sn" placeholder="Ground floor, Terrace, Garden"></div><footer><button class="btn" id="ok">Add</button></footer>`, (p) => {
      p.querySelector('#ok').onclick = async () => {
        try {
          S.snap = await addSection(S.snap, p.querySelector('#sn').value);
          S.note = null;
          closeSheet();
          viewTables();
        } catch (e) {
          closeSheet();
          fail(e);
        }
      };
    });
  document.querySelectorAll('[data-addtbl]').forEach(
    (b) =>
      (b.onclick = () =>
        openSheet(`<header><h2>Add a table</h2><button class="x" data-close aria-label="Close">&times;</button></header><div class="body"><label for="tn">Table name or number</label><input id="tn" placeholder="T1"><label for="tc">Seats</label><input id="tc" type="number" inputmode="numeric" value="4"></div><footer><button class="btn" id="ok">Add</button></footer>`, (p) => {
          p.querySelector('#ok').onclick = async () => {
            try {
              S.snap = await addTable(S.snap, b.dataset.addtbl, { label: p.querySelector('#tn').value, capacity: p.querySelector('#tc').value });
              S.note = null;
              closeSheet();
              viewTables();
            } catch (e) {
              closeSheet();
              fail(e);
            }
          };
        })),
  );
  document.querySelectorAll('[data-deltbl]').forEach(
    (b) =>
      (b.onclick = async (ev) => {
        ev.stopPropagation();
        const t = S.snap.floors.flatMap((f) => f.tables).find((x) => x.id === b.dataset.deltbl);
        if (tableMap(await orders.all()).has(t.label)) return fail(new Error(`${t.label} has an open order. Settle or cancel it first.`));
        S.snap = await removeTable(S.snap, t.id);
        S.note = null;
        viewTables();
      }),
  );
  document.querySelectorAll('[data-delsec]').forEach(
    (b) =>
      (b.onclick = async () => {
        const f = S.snap.floors.find((x) => x.id === b.dataset.delsec);
        const taken2 = tableMap(await orders.all());
        if (f.tables.some((t) => taken2.has(t.label))) return fail(new Error('A table in this section has an open order. Settle or cancel it first.'));
        S.snap = await removeSection(S.snap, f.id);
        S.note = null;
        viewTables();
      }),
  );
}

// ----------------------------------------------------------------- kitchen ---
const KOT_LABEL = { NEW: 'New', PREPARING: 'Preparing', READY: 'Ready', SERVED: 'Served', CANCELLED: 'Cancelled' };
const KOT_ACTION = { NEW: 'Start preparing', PREPARING: 'Mark ready', READY: 'Mark served' };
async function viewKitchen() {
  const all = (await kots.all()).sort((a, b) => (a.at < b.at ? -1 : 1));
  const active = all.filter((k) => k.status !== 'SERVED' && !k.dismissed);
  const done = all.filter((k) => k.status === 'SERVED' || k.dismissed).reverse().slice(0, 30);
  const now = Date.now();
  const card = (k) => {
    const mins = minutesSince(k.at, now);
    return `<article class="kot ${k.status === 'CANCELLED' ? 'cx' : mins >= 20 ? 'late' : ''}" aria-label="KOT ${k.number}">
      <header><b>KOT ${k.number}</b> <span>${k.type === 'DINE_IN' ? esc(k.tableLabel || 'Dine in') : 'Takeaway'}</span><span class="grow"></span><span class="status ${k.status}">${KOT_LABEL[k.status]}</span> <small>${mins} min</small></header>
      ${k.status === 'CANCELLED' ? '<div class="note bad">Order cancelled - stop making these.</div>' : ''}
      ${k.add.map((l) => `<div class="kl"><b>${l.qty} &times; ${esc(l.name)}</b>${l.note ? `<br><small>&gt;&gt; ${esc(l.note)}</small>` : ''}</div>`).join('')}
      ${k.cancel.map((l) => `<div class="kl cxl"><b>CANCEL ${l.qty} &times; ${esc(l.name)}</b></div>`).join('')}
      <small class="mute">${k.print === 'printed' ? 'Printed' : k.print === 'failed' ? 'Printer did not respond - it may have partly printed. Check the paper before printing again.' : 'Not printed'}</small>
      <div class="grid" style="margin-top:.5rem">
        ${KOT_NEXT[k.status] ? `<button class="btn" data-next="${esc(k.id)}">${KOT_ACTION[k.status]}</button>` : `<button class="btn ghost" data-dismiss="${esc(k.id)}">Dismiss</button>`}
        <button class="btn ghost" data-reprint="${esc(k.id)}">Print again</button>
      </div></article>`;
  };
  $('view').innerHTML = `
    ${S.note ? `<div class="note ${S.note.kind || ''}" role="status">${esc(S.note.text)}</div>` : ''}
    ${active.length ? active.map(card).join('') : '<div class="note">No tickets waiting. Send an order to the kitchen from the cart and it shows up here.</div>'}
    ${done.length ? `<button class="btn line block mt" id="showdone">${S.showDone ? 'Hide' : 'Show'} finished tickets (${done.length})</button>${S.showDone ? done.map(card).join('') : ''}` : ''}
    <p class="mute mt">This is the kitchen screen of this phone only. For a screen in the kitchen that shows orders from every phone, connect the OrderRestro server and use its Kitchen display.</p>`;
  $('showdone') && ($('showdone').onclick = () => ((S.showDone = !S.showDone), viewKitchen()));
  document.querySelectorAll('[data-next]').forEach(
    (b) =>
      (b.onclick = async () => {
        const k = await kots.get(b.dataset.next);
        k.status = KOT_NEXT[k.status] || k.status;
        await kots.put(k);
        render();
      }),
  );
  document.querySelectorAll('[data-dismiss]').forEach((b) => (b.onclick = async () => ((await kots.put({ ...(await kots.get(b.dataset.dismiss)), dismissed: true })), render())));
  document.querySelectorAll('[data-reprint]').forEach(
    (b) =>
      (b.onclick = async () => {
        const k = await kots.get(b.dataset.reprint);
        if (k.print === 'printed' && !confirm('This ticket already printed. Print it again? It will say REPRINT so the kitchen does not make it twice.')) return;
        const np = plugins().NativePrinter;
        if (!np) {
          const w = window.open('', '_blank');
          if (w) {
            w.document.write(htmlKot({ ...k, reprint: k.print === 'printed' }));
            w.document.close();
            w.print();
          }
          return;
        }
        if (!savedPrinter()) await choosePrinter();
        k.print = await printKot(k, { reprint: k.print === 'printed' });
        await kots.put(k);
        toast(k.print === 'printed' ? 'Printed' : 'The printer did not respond');
        render();
      }),
  );
}

// ------------------------------------------------------------------- sales ---
async function viewSales() {
  const all = await sales.all();
  const label = { pending: 'Waiting to sync', synced: 'Synced', refused: 'Needs attention', dismissed: 'Set aside' };
  const nAttention = all.filter((x) => x.status === 'refused').length;
  const nReview = all.filter((x) => x.review && x.review.length).length;
  const rep = dayReport(all, await orders.all());
  const reportCard = `<div class="card"><h2 style="font-size:1.05rem">Today on this phone</h2>
    <div class="tot big"><span>${rep.count} sale${rep.count === 1 ? '' : 's'}</span><span>${inr(rep.total)}</span></div>
    <dl class="kv">${Object.entries(rep.byMethod).filter(([, v]) => v).map(([m, v]) => `<dt>${{ CASH: 'Cash', UPI: 'UPI', CARD: 'Card', OTHER: 'Other' }[m]}</dt><dd>${inr(v)}</dd>`).join('')}
      ${rep.tax ? `<dt>${esc(S.snap.branch.taxLabel || 'Tax')} included</dt><dd>${inr(rep.tax)}</dd>` : ''}${rep.discount ? `<dt>Discounts</dt><dd>${inr(rep.discount)}</dd>` : ''}
      ${rep.voids ? `<dt>Cancelled orders</dt><dd>${rep.voids} (${inr(rep.voidValue)})</dd>` : ''}</dl>
    ${rep.top.length ? `<p class="mute" style="margin:.5rem 0 0">Top: ${rep.top.map((t) => `${esc(t.name)} &times;${t.qty}`).join(', ')}</p>` : ''}
    <p class="mute" style="margin:.5rem 0 0">Only sales taken on this phone, for today by the phone's clock.${S.snap.local ? '' : ' It is not the server total.'}${rep.notSynced ? ` ${rep.notSynced} not on the server yet.` : ''}</p></div>`;
  $('view').innerHTML = `
    ${reportCard}
    ${S.pending ? `<div class="note warn" role="status">${S.pending} sale${S.pending > 1 ? 's' : ''} saved on this phone, not on the server yet.</div>` : ''}
    ${nAttention ? `<div class="note bad" role="status">${nAttention} sale${nAttention > 1 ? 's were' : ' was'} refused by the server and still need${nAttention > 1 ? '' : 's'} a decision. Open ${nAttention > 1 ? 'each' : 'it'} to retry or set aside.</div>` : ''}
    ${nReview ? `<div class="note warn" role="status">${nReview} sale${nReview > 1 ? 's were' : ' was'} recorded at a price that differs from the server's menu. Open to see which.</div>` : ''}
    <div class="mt">${
      all
        .map(
          (s) => `<button class="row" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line);text-align:left" data-sale="${esc(s.id)}">
            <div class="grow"><b>${esc(s.localNumber)}</b>${s.serverOrderNumber ? ` <small>#${esc(s.serverOrderNumber)}</small>` : ''}<br><small>${esc(new Date(s.soldAt).toLocaleString())} &middot; ${s.items.reduce((n, i) => n + i.quantity, 0)} items</small></div>
            <div style="text-align:right"><b>${inr(s.bill.total)}</b><br><span class="status ${s.status}">${label[s.status]}</span></div></button>`,
        )
        .join('') || '<p class="mute center mt">No sales on this phone yet.</p>'
    }</div>`;
  document.querySelectorAll('[data-sale]').forEach(
    (b) =>
      (b.onclick = async () => {
        const s = await sales.get(b.dataset.sale);
        openSheet(
          `<header><h2>${esc(s.localNumber)}</h2><button class="x" data-close aria-label="Close">&times;</button></header>
           <div class="body">
             <p><span class="status ${s.status}">${label[s.status]}</span> ${s.serverOrderNumber ? `Server order #${esc(s.serverOrderNumber)}` : ''}</p>
             ${s.status === 'refused' ? `<div class="note bad"><b>${esc(REFUSAL_TITLE[s.refusedCode] || REFUSAL_TITLE.OTHER)}</b><br>${esc(s.refusedReason)}<br><small>The sale is still on this phone and nothing was lost. ${esc(REFUSAL_HELP[s.refusedCode] || REFUSAL_HELP.OTHER)}</small></div>
               <button class="btn block mt" id="retry">Try sending again</button>
               <button class="btn line block mt" id="aside">Set aside (keep a copy here)</button>` : ''}
             ${s.status === 'dismissed' ? `<div class="note">Set aside on ${esc(new Date(s.dismissedAt).toLocaleString())}. The server does not have this sale. It is kept here as a record.</div><button class="btn line block mt" id="retry">Try sending again</button>` : ''}
             ${s.review && s.review.length ? `<div class="note warn"><b>Recorded at the price shown on this phone</b><br>${s.review.map((r) => `${esc(r.name)}: charged ${inr(r.phonePrice)}, server menu now ${inr(r.serverPrice)}`).join('<br>')}<br><small>The customer paid what the phone showed, so the receipt was not changed. The server order carries a review note.</small></div>` : ''}
             ${s.items.map((i) => `<div class="tot"><span>${i.quantity} &times; ${esc(i.name)}</span><span>${inr(i.price * i.quantity)}</span></div>`).join('')}
             <div class="tot big mt"><span>Total</span><span>${inr(s.bill.total)}</span></div>
             <div class="mt">${printActions()}</div>
           </div>`,
          (p) => {
            bindPrint(p, s, false);
            const back = async () => (await refreshPending(), closeSheet(), render());
            if (p.querySelector('#retry')) p.querySelector('#retry').onclick = async () => ((await retrySale(s.id)), await back(), doSync());
            if (p.querySelector('#aside'))
              p.querySelector('#aside').onclick = async () => {
                if (!confirm('Set this sale aside? It stays on this phone as a record but will not be sent to the server unless you try again.')) return;
                s.status = 'dismissed';
                s.dismissedAt = new Date().toISOString();
                await sales.put(s);
                await back();
              };
          },
        );
      }),
  );
}

const REFUSAL_TITLE = {
  ITEM_UNAVAILABLE: 'A dish is no longer on the server menu',
  ALREADY_STARTED: 'The server already has an unfinished copy',
  PRICE_CONFLICT: 'Two prices for the same dish',
  PAYMENT_REJECTED: 'The server did not accept the payment or discount',
  OTHER: 'The server did not accept this sale',
};
const REFUSAL_HELP = {
  ITEM_UNAVAILABLE: 'Ask the owner to switch the dish back on, then try again.',
  ALREADY_STARTED: 'Ask the owner to check Orders for this sale, then try again or set it aside.',
  PRICE_CONFLICT: 'Set it aside and enter it again from the full app.',
  PAYMENT_REJECTED: 'Ask the owner to check the discount limit or payment, then try again.',
  OTHER: 'Ask the owner, then try again or set it aside.',
};

/** Local and online server cards: reachability, version, speed and what the server supports. */
async function serverCards() {
  const r = await checkAll();
  if (!r.rows.length) return '';
  const cap = (c) => Object.entries(c || {}).filter(([, v]) => v).map(([k]) => k.replace(/([A-Z])/g, ' $1').toLowerCase()).join(', ');
  return `<div class="card mt"><h2 style="font-size:1.05rem">Servers</h2>${r.rows
    .map(
      (x) => `<dl class="kv"><dt>${x.kind}</dt><dd>${esc(x.url)}</dd>
        <dt>Status</dt><dd>${x.info ? `Reachable &middot; ${x.info.ms} ms${r.using && x.kind.toLowerCase() === r.using ? ' &middot; in use' : ''}` : 'Not reachable from here'}</dd>
        ${x.info ? `<dt>Version</dt><dd>${esc(x.info.version)}${x.info.legacy ? ' (older server: update it to see more)' : ''}</dd><dt>Supports</dt><dd>${esc(cap(x.info.capabilities)) || '—'}</dd>` : ''}</dl>`,
    )
    .join('<hr style="border:0;border-top:1px solid var(--line)">')}
    <p class="mute">The local address needs this phone on the restaurant WiFi. The online address works from anywhere.</p></div>`;
}

// -------------------------------------------------------------------- sync ---
async function viewSyncLocal() {
  const printer = savedPrinter();
  $('view').innerHTML = `
    ${S.note ? `<div class="note ${S.note.kind || ''}" role="status">${esc(S.note.text)}</div>` : ''}
    <div class="card mt">
      <dl class="kv">
        <dt>Account</dt><dd>${esc(S.snap.user.name)} &middot; ${esc(S.snap.restaurant.name)}</dd>
        <dt>Where it is kept</dt><dd>On this phone only</dd>
        <dt>Sales taken</dt><dd>${(await sales.all()).length}</dd>
        <dt>Dishes</dt><dd>${S.snap.items.length}</dd>
      </dl>
      <button class="btn block mt" id="conn">Connect to a server</button>
      <p class="mute center">Do this when your restaurant has a server. Your sales are sent to it.</p>
    </div>
    <div class="card mt">
      <h2 style="font-size:1.05rem">Bluetooth printer</h2>
      <p class="mute">${printer ? `Printing on <b>${esc(printer.name)}</b>` : 'No printer chosen yet.'}</p>
      <button class="btn ghost block" id="pick">${printer ? 'Change printer' : 'Choose printer'}</button>
    </div>
    <div class="card mt"><button class="btn line block" id="lock">Lock</button><button class="btn line block mt" id="chpw">Change password</button></div>`;
  $('chpw').onclick = () => passwordSheet();
  $('conn').onclick = () => connectSheet();
  $('pick').onclick = async () => (await choosePrinter(), viewSync());
  $('lock').onclick = async () => (await flushPersist(), (S.unlocked = false), (S.cart = new Map()), (S.orderId = null), (S.restored = false), render());
}

async function viewSync() {
  if (S.snap.local) return viewSyncLocal();
  S.hasPhoneAccount = !!(await kv.get('localAccount')) && !!(await kv.get('localMenuBackup'));
  const snapAt = await kv.get('snapshotAt');
  const last = await kv.get('lastSync');
  const printer = savedPrinter();
  const device = (await kv.get('deviceName')) || 'Phone';
  const servers = await serverCards();
  $('view').innerHTML = `
    ${S.note ? `<div class="note ${S.note.kind || ''}" role="status">${esc(S.note.text)}</div>` : ''}
    <div class="card mt">
      <dl class="kv">
        <dt>Connection</dt><dd>${S.online ? 'Online' : 'Offline'}</dd>
        <dt>Waiting to send</dt><dd>${S.pending} sale${S.pending === 1 ? '' : 's'}</dd>
        <dt>Last sync</dt><dd>${last ? esc(new Date(last).toLocaleString()) : 'Never'}</dd>
        <dt>Menu saved</dt><dd>${snapAt ? esc(new Date(snapAt).toLocaleString()) : 'Never'} (${S.snap.items.length} dishes)</dd>
        <dt>Signed in as</dt><dd>${esc(S.snap.user.name)}</dd>
        <dt>This phone</dt><dd>${esc(device)}</dd>
      </dl>
      <button class="btn block mt" id="syncnow" ${S.syncing ? 'disabled' : ''}>${S.syncing ? 'Syncing…' : 'Sync now'}</button>
      <p class="mute center">Sync sends your sales and refreshes the menu and prices.</p>
    </div>
    ${servers}
    <div class="card mt">
      <h2 style="font-size:1.05rem">Bluetooth printer</h2>
      <p class="mute">${printer ? `Printing on <b>${esc(printer.name)}</b>` : 'No printer chosen yet.'}</p>
      <button class="btn ghost block" id="pick">${printer ? 'Change printer' : 'Choose printer'}</button>
    </div>
    <div class="card mt">
      <button class="btn line block" id="full">Open the full app (needs the server)</button>
      <button class="btn line block mt" id="out">${S.hasPhoneAccount ? 'Disconnect and go back to my phone account' : 'Sign out of standalone mode'}</button>
    </div>`;
  $('syncnow').onclick = doSync;
  $('pick').onclick = async () => (await choosePrinter(), viewSync());
  $('full').onclick = async () => {
    const link = plugins().ServerLink;
    if (link && link.setMode) await link.setMode({ mode: 'app' });
    else location.href = '../index.html?stay=1';
  };
  $('out').onclick = async () => {
    const waiting = (await sales.pending()).length;
    if (waiting && !confirm(`${waiting} sale(s) are not on the server yet. Signing out keeps them on this phone, but they cannot be sent until you sign in again. Sign out anyway?`)) return;
    const back = S.hasPhoneAccount && (await kv.get('localMenuBackup'));
    if (back) {
      // Signed up on this phone, then connected: go back to the phone account (its menu and sales stay).
      await kv.set('snapshot', back);
      await kv.set('branchId', 'local');
      await kv.del('serverBase');
      S.snap = back;
      S.note = { text: 'Back on your phone account.' };
      return render();
    }
    await kv.del('snapshot');
    try {
      localStorage.removeItem('orderrestro.standalone.ready');
    } catch {
      /* storage blocked */
    }
    S.snap = null;
    render();
  };
}

function afterSync(r) {
  S.syncing = false;
  S.online = r.online;
  if (r.authExpired) S.note = { kind: 'warn', text: 'Your sign-in has expired. Selling still works. Sign out and sign in again to send the sales.' };
  else if (r.error) S.note = { kind: 'bad', text: r.error };
  else if (r.online) {
    S.note = r.done ? { text: `${r.done} sale${r.done > 1 ? 's' : ''} sent to the server.` } : null;
    if (r.reviewed) S.note = { kind: 'warn', text: `${r.reviewed} sale${r.reviewed > 1 ? 's were' : ' was'} recorded at a price that differs from the server menu. Open Sales to check.` };
    if (r.refused) S.note = { kind: 'bad', text: `${r.refused} sale${r.refused > 1 ? 's were' : ' was'} refused by the server. Open Sales to retry or set aside.` };
  } else S.note = null;
  kv.get('snapshot').then((s) => s && (S.snap = s));
  if ($('sheet').hidden) render();
}
async function doSync() {
  S.syncing = true;
  S.note = null;
  render();
  const r = await syncNow();
  if (!r.online) S.note = { kind: 'warn', text: 'No connection to the server right now. Your sales are safe on this phone.' };
  afterSync(r);
  if (!r.online) {
    S.note = { kind: 'warn', text: 'No connection to the server right now. Your sales are safe on this phone.' };
    render();
  }
}

// ------------------------------------------------------------------- start ---
async function start() {
  S.snap = await kv.get('snapshot');
  if (!S.snap) return renderLogin();
  if (S.snap.local) return render();
  S.online = !!(await pickServer(await kv.get('serverBase')));
  render();
  if (S.online) syncNow().then(afterSync);
}

// Quietly try again when the phone is back online or the app is reopened.
window.addEventListener('online', () => syncNow().then(afterSync));
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && S.snap && syncNow().then(afterSync));
setInterval(() => S.snap && document.visibilityState === 'visible' && $('sheet').hidden && syncNow({ refreshMenu: false }).then(afterSync), 60000);

setInterval(() => S.snap && S.view === 'kitchen' && document.visibilityState === 'visible' && $('sheet').hidden && render(), 30000);

start().catch((e) => {
  $('app').innerHTML = `<div class="login"><div class="note bad">Could not start: ${esc(e.message)}</div></div>`;
});
