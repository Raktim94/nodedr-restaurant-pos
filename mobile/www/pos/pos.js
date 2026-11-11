// OrderRestro standalone POS. Opens with no connection, sells from the menu
// saved on this phone, prints, and sends the sales to the restaurant server
// whenever it can. Plain DOM + modules: nothing here needs a build step.
import { computeBill, round2, settle, upiLink } from './lib/bill.js';
import { escposReceipt, htmlReceipt, toBase64 } from './lib/receipt.js';
import { reservations, expenses, kots, kv, newId, nextKotNumber, nextLocalNumber, nextOrderNumber, orders, readEverything, refunds, replaceEverything, sales, saveKotWithOrder, shifts } from './lib/store.js';
import { backupJson, buildExpense, buildRefund, closeDay, dayBooks, daysAgo, expensesCsv, parseBackup, rangeBooks, refundableLines, refundedTotal, salesCsv, today } from './lib/books.js';
import { KOT_NEXT, dayReport, kotDelta, markSent, minutesSince, newOrder, openOrders, saleNote, tableMap, tableTakenBy } from './lib/orders.js';
import { escposKot, htmlKot } from './lib/kot.js';
import { STATUS_LABEL, clashes, grouped, heldSoon, newBooking, setStatus } from './lib/reservations.js';
import { native, pickServer, reachable, savedServers } from './lib/net.js';
import { login, pullSnapshot, syncNow, retrySale } from './lib/sync.js';
import { checkAll } from './lib/net.js';
import { UNITS, acknowledge, analyseDish, conflicts, emptyBook, ingredientMap, pendingRecipes, removeIngredient, resolveConflict, saveIngredient, saveRecipe } from './lib/costbook.js';
import { addSection, addTable, removeSection, removeTable, changeLocalPassword, checkLocalPassword, createLocalAccount, eraseLocalAccount, hasLocalAccount, remapSalesToServer, removeDish, setSoldOut, upsertDish, useStock } from './lib/local.js';

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
  tablesTab: 'floor', // 'floor' | 'bookings'
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
// History changes run one at a time: a back() is asynchronous, and a push made before it lands would be undone by it.
let skipPop = false;
let histQ = Promise.resolve();
const histDo = (fn) => (histQ = histQ.then(fn).catch(() => {}));
const histPush = (st) => histDo(() => history.pushState(st, ''));
const histReplace = (st) => histDo(() => history.replaceState(st, ''));
const histBackIf = (test) =>
  histDo(
    () =>
      new Promise((resolve) => {
        if (!(history.state && test(history.state))) return resolve();
        skipPop = true;
        const t = setTimeout(resolve, 400);
        window.addEventListener('popstate', () => (clearTimeout(t), resolve()), { once: true });
        history.back();
      }),
  );

function openSheet(html, onMount) {
  const s = $('sheet');
  if (s.hidden) histPush({ sheet: true });
  s.innerHTML = `<div class="panel" role="dialog" aria-modal="true">${html}</div>`;
  s.hidden = false;
  s.onclick = (e) => {
    if (e.target === s) closeSheet();
  };
  s.querySelector('[data-close]')?.addEventListener('click', closeSheet);
  onMount && onMount(s.firstElementChild);
}
let booksDirty = false; // a books sheet changed something: redraw the screen behind it when it closes
function closeSheet(fromBack = false) {
  const s = $('sheet');
  const wasOpen = !s.hidden;
  s.hidden = true;
  if (wasOpen && fromBack !== true) histBackIf((st) => st.sheet);
  s.innerHTML = '';
  if (booksDirty) {
    booksDirty = false;
    if (S.snap) render();
  }
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
    taxMode: S.snap.branch.taxMode || 'INCLUSIVE',
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
  setView('sell');
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

async function printKotPdf(kot, { reprint = false } = {}) {
  const html = htmlKot({ ...kot, reprint });
  const np = plugins().NativePrinter;
  if (np) {
    try {
      await np.printHtml({ html, name: `KOT ${kot.number}` });
      return 'pdf';
    } catch (e) {
      toast(e.message || 'Could not open the print dialog');
      return 'failed';
    }
  }
  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
    w.print();
  }
  return 'pdf';
}

/** Make the KOT for what is new on this order, then print it (Bluetooth) or open it as a PDF. */
async function sendToKitchen(mode = 'bt') {
  await flushPersist();
  if (!S.orderId) return toast('Add something to the order first.');
  const o = await orders.get(S.orderId);
  const d = kotDelta(o);
  if (d.empty) return toast('Everything on this order is already on a KOT. Use Reprint to print the last one again.');
  const tables = S.snap.floors.flatMap((f) => f.tables);
  if (o.type === 'DINE_IN' && tables.length && !o.tableLabel) return toast('Choose the table first.');
  const number = await nextKotNumber();
  const kot = { id: newId(), number, orderId: o.id, orderNumber: o.number, at: new Date().toISOString(), type: o.type, tableLabel: o.tableLabel, add: d.add, cancel: d.cancel, status: 'NEW', print: 'none' };
  markSent(o, number);
  await saveKotWithOrder(kot, o); // one transaction: the ticket and "sent" are saved together
  for (const l of S.cart.values()) l.sent = l.qty;
  kot.print = mode === 'pdf' ? await printKotPdf(kot) : await printKot(kot);
  await kots.put(kot);
  toast(kot.print === 'printed' ? `KOT ${number} printed` : kot.print === 'pdf' ? `KOT ${number} ready to print or save` : kot.print === 'failed' ? `KOT ${number} saved, but it did not print. Tap Reprint last KOT.` : `KOT ${number} saved. No printer chosen: pick one in Sync, or use KOT PDF.`, 4200);
}

/** The newest KOT of the open order again, marked REPRINT so the kitchen does not cook it twice. */
async function reprintLastKot(mode = 'bt') {
  if (!S.orderId) return;
  const mine = (await kots.all()).filter((k) => k.orderId === S.orderId).sort((a, b) => (a.at < b.at ? 1 : -1));
  const k = mine[0];
  if (!k) return toast('There is no KOT for this order yet.');
  if (mode === 'bt' && !savedPrinter()) await choosePrinter();
  k.print = mode === 'pdf' ? await printKotPdf(k, { reprint: true }) : await printKot(k, { reprint: true });
  await kots.put(k);
  toast(k.print === 'failed' ? 'It did not print. Check the printer.' : `KOT ${k.number} sent to print again`);
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
      p.querySelector('#kw').textContent = sentTo ? `KOT ${o.kotNumbers.join(', ')} was already printed. Tell the kitchen to stop.` : 'No KOT was printed. The order is kept as a record, not deleted.';
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
function renderWelcome() {
  $('app').innerHTML = `
  <div class="login" id="welcome">
    <img src="../assets/logo.png" alt="">
    <h1 class="center">Welcome to OrderRestro</h1>
    <p class="mute center">How do you want to start? You can change your mind later: nothing you do now is lost.</p>
    <button class="btn block mt" id="w-phone" type="button">Start on this phone<br><small>Best if you have no server yet. Takes about a minute.</small></button>
    <ul class="mute" style="margin:.5rem 0 1rem;padding-left:1.1rem">
      <li>Menu, tables, bookings, KOT printing and sales all work with no internet.</li>
      <li>Connect a server whenever you are ready: your sales and bookings are sent to it and the menu comes back.</li>
    </ul>
    <button class="btn line block" id="w-server" type="button">I already have a restaurant server<br><small>Sign in and download your menu.</small></button>
  </div>`;
  $('w-phone').onclick = () => renderSetup();
  $('w-server').onclick = () => renderLogin();
}

async function renderLogin(message) {
  if (!message && !(await hasLocalAccount()) && !(await savedServers()).length && !S.fromWelcome) return ((S.fromWelcome = true), renderWelcome());
  S.fromWelcome = true;
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
      S.view = 'sell';
      S.setupDismissed = false;
      await kv.del('setupDismissed');
      S.note = null;
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
    <button class="btn line block mt" id="costs">Recipes &amp; costs</button>
    <div class="mt">${
      items
        .map(
          (i) => `<button class="row dishrow" data-edit="${esc(i.id)}"><div class="grow"><b>${esc(i.name)}</b><br><small>${esc(cat(i.categoryId))}${i.taxRate ? ` &middot; tax ${esc(i.taxRate)}%` : ''}${i.soldOut ? ' &middot; <b>Sold out</b>' : i.stock != null ? ` &middot; ${i.stock} in stock` : ''}</small></div><b>${inr(i.price)}</b></button>`,
        )
        .join('') || '<p class="mute center mt">Your menu is empty. Tap Add a dish to start.</p>'
    }</div>`;
  $('add').onclick = () => dishSheet();
  $('costs').onclick = () => costListSheet();
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
       <label for="dst">Stock <span class="mute">(optional)</span></label><input id="dst" type="number" inputmode="numeric" min="0" step="1" value="${item && item.stock != null ? esc(item.stock) : ''}" placeholder="Leave empty to not count">
       <small class="mute">With a number, each sale takes one off and the dish switches itself off at 0.</small>
       <label class="chk"><input id="dso" type="checkbox" ${item && item.soldOut ? 'checked' : ''}> Sold out for now</label>
     </div>
     <footer>${item ? '<button class="btn line" id="dd">Delete</button>' : ''}<button class="btn" id="ds">Save</button></footer>`,
    (p) => {
      p.querySelector('#ds').onclick = async () => {
        try {
          S.snap = await upsertDish(S.snap, { id: item && item.id, name: $('dn').value, price: $('dpr').value, taxRate: $('dt').value, isVeg: $('dv').checked, categoryName: $('dc').value, stock: $('dst').value, soldOut: $('dso').checked && !(item && item.stock === 0 && Number($('dst').value) > 0) });
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
    ${tabs.map(([k, label, icon]) => `<button data-tab="${k}" ${S.view === k ? 'aria-current="page"' : ''}>${icon}<span>${label}${k === 'sales' && S.pending ? ` <span class="badge">${S.pending}</span>` : ''}</span></button>`).join('')}
  </nav>`;
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
}
// Back button, like any phone app: close the open sheet first, then go back to Sell, then leave the app.
// History: [guard] [root = Sell] [one entry while another tab is open] (+ one while a sheet is open).
function setView(v) {
  if (v === S.view) return render();
  S.note = null;
  const was = S.view;
  S.view = v;
  if (was === 'sell') histPush({ view: v });
  else if (v === 'sell') histBackIf((st) => !!st.view);
  else histReplace({ view: v });
  render();
}
const go = setView;
function initHistory() {
  try {
    history.replaceState({ guard: true }, '');
    history.pushState({ root: true }, '');
  } catch {
    return;
  }
  window.addEventListener('popstate', (e) => {
    if (skipPop) return (skipPop = false);
    if (!$('sheet').hidden) return closeSheet(true); // the entry is already gone
    const st = e.state || {};
    if (st.guard) {
      const app = plugins().App;
      if (app && app.exitApp) return app.exitApp();
      return history.back();
    }
    if (!S.snap || (S.snap.local && !S.unlocked)) return;
    S.view = st.view || 'sell';
    S.note = null;
    render();
  });
}
initHistory();
async function refreshBadges() {
  S.bookingsToday = (await reservations.all()).filter((b) => heldSoon(b, new Date(), 24 * 60) && new Date(b.reservedAt).toDateString() === new Date().toDateString() && b.status !== 'ARRIVED').length;
}
async function refreshPending() {
  S.pending = (await sales.pending()).length;
}
async function render() {
  if (!S.snap) return renderLogin();
  if (S.snap.local && !S.unlocked) return renderUnlock();
  if (!S.restored) await restoreCurrent();
  await refreshPending();
  await refreshBadges();
  shell();
  ({ sell: viewSell, tables: viewTables, menu: viewMenu, sales: viewSales, sync: viewSync })[S.view]();
}

// -------------------------------------------------------------------- sell ---
function setupSteps() {
  const snap = S.snap;
  return [
    { key: 'menu', done: snap.items.length > 0, title: 'Add your dishes', hint: 'Name, price and tax. You can change them any time.', go: 'menu' },
    { key: 'tables', done: snap.floors.some((f) => f.tables.length > 0), title: 'Add your tables', hint: 'Optional. Skip it if you only sell takeaway.', go: 'tables' },
    { key: 'printer', done: !!savedPrinter(), title: 'Choose a Bluetooth printer', hint: 'Optional. For bills and KOTs.', go: 'sync' },
    { key: 'server', done: false, title: 'Connect a server later', hint: 'Optional. Sales and bookings are sent to it, and the menu comes back.', go: 'sync', last: true },
  ];
}
function setupCard() {
  if (!S.snap.local || S.setupDismissed) return '';
  const steps = setupSteps();
  if (steps[0].done && steps[1].done && steps[2].done) return '';
  return `<section class="setup" aria-labelledby="setup-h"><div class="setup-head"><h2 id="setup-h">Get ready to sell</h2><button class="setup-x" id="setup-hide" aria-label="Hide this checklist">&times;</button></div>
    <ol>${steps
      .map((st, i) => `<li><button data-setup="${st.go}" aria-label="${esc(st.title)}${st.done ? ', done' : ''}">
        <span class="n ${st.done ? 'ok' : ''}" aria-hidden="true">${st.done ? '&#10003;' : i + 1}</span><span class="t"><b>${esc(st.title)}</b><small>${esc(st.hint)}</small></span></button></li>`)
      .join('')}</ol></section>`;
}
function bindSetup() {
  document.querySelectorAll('[data-setup]').forEach((b) => (b.onclick = () => go(b.dataset.setup)));
  const h = document.getElementById('setup-hide');
  if (h) h.onclick = async () => ((S.setupDismissed = true), await kv.set('setupDismissed', 1), viewSell());
}

function viewSell() {
  const { categories, items } = S.snap;
  const q = S.q.trim().toLowerCase();
  const shown = items.filter((i) => (S.category === 'all' || i.categoryId === S.category) && (!q || i.name.toLowerCase().includes(q)));
  $('view').innerHTML = `
    ${setupCard()}
    ${S.orderId || S.table ? `<div class="note" role="status">${S.type === 'DINE_IN' ? `Dine in${S.table ? ` &middot; <b>${esc(S.table)}</b>` : ''}` : 'Takeaway'}${cartCount() ? ' &middot; saved automatically' : ''}</div>` : ''}
    ${items.length ? `<input class="search" id="q" type="search" placeholder="Search the menu" value="${esc(S.q)}" aria-label="Search the menu">` : ''}
    <div class="chips" role="group" aria-label="Categories" ${items.length ? '' : 'hidden'}>
      <button class="chip" data-cat="all" aria-pressed="${S.category === 'all'}">All</button>
      ${categories.map((c) => `<button class="chip" data-cat="${esc(c.id)}" aria-pressed="${S.category === c.id}">${esc(c.name)}</button>`).join('')}
    </div>
    <div class="grid dishes">
      ${shown.map((i) => `<button class="dish" data-add="${esc(i.id)}" ${i.sellOffline && !i.soldOut ? '' : 'disabled'}>
          <b><span class="veg ${i.isVeg ? '' : 'nv'}"></span>${esc(i.name)}</b>
          <span>${inr(i.price)}${S.cart.get(i.id)?.qty ? ` &middot; <strong style="color:var(--brand)">&times;${S.cart.get(i.id).qty}</strong>` : ''}</span>
          ${i.soldOut ? '<small>Sold out</small>' : i.sellOffline ? (i.stock != null && i.stock <= 5 ? `<small>${i.stock} left</small>` : '') : '<small>Needs options: use the full app</small>'}
        </button>`).join('') || (S.snap.local && !S.snap.items.length ? '<div class="empty"><b>Your menu is empty</b><p class="mute">Add your first dish to start selling.</p><button class="btn" data-setup="menu">Add a dish</button></div>' : '<p class="mute center mt empty">Nothing matches.</p>')}
    </div>`;
  bindSetup();
  if ($('q')) $('q').oninput = (e) => {
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
        if (item.stock != null && line.qty >= item.stock) return toast(`Only ${item.stock} left in stock`);
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
            <div style="padding:.2rem 0 .5rem;border-bottom:1px solid var(--line)">${S.noteOpen === l.item.id ? `<input data-note="${esc(l.item.id)}" maxlength="80" value="${esc(l.note || '')}" placeholder="e.g. no onion, less spicy" aria-label="Note for ${esc(l.item.name)}">` : `<button class="chip" data-opennote="${esc(l.item.id)}">${l.note ? `Note: ${esc(l.note)}` : '+ Note'}</button>`}${l.sent ? ` <small class="mute">${l.sent} on a KOT</small>` : ''}</div>`,
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
          <button class="btn ghost" id="kot">Print KOT</button>
          <button class="btn ghost" id="kotpdf">KOT as PDF</button>
          ${(S.orderId && lines.some((l) => l.sent)) ? '<button class="btn line" id="kotre">Reprint last KOT</button><button class="btn line" id="kotrepdf">Reprint as PDF</button>' : ''}
          <button class="btn ghost" id="hold" style="grid-column:1/-1">Hold order</button>
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
    root.querySelector('#kot').onclick = async () => (await sendToKitchen('bt'), draw());
    root.querySelector('#kotpdf').onclick = async () => (await sendToKitchen('pdf'), draw());
    root.querySelector('#kotre') && (root.querySelector('#kotre').onclick = () => reprintLastKot('bt'));
    root.querySelector('#kotrepdf') && (root.querySelector('#kotrepdf').onclick = () => reprintLastKot('pdf'));
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
    if (S.snap.local) S.snap = await useStock(S.snap, sale.items);
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


// ---------------------------------------------------------------- bookings ---
const pad2 = (n) => String(n).padStart(2, '0');
const localInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const whenText = (iso) => {
  const d = new Date(iso);
  const t = new Date();
  const day = d.toDateString() === t.toDateString() ? 'Today' : d.toDateString() === new Date(t.getTime() + 864e5).toDateString() ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};

async function viewBookings() {
  const all = await reservations.all();
  const { upcoming, past } = grouped(all);
  const tables = S.snap.floors.flatMap((f) => f.tables);
  const row = (b) => `<div class="row orow" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;justify-content:space-between;gap:.5rem"><div class="grow"><b>${esc(b.customerName)}</b> &middot; ${b.guestCount} guest${b.guestCount === 1 ? '' : 's'}${b.tableLabel ? ` &middot; ${esc(b.tableLabel)}` : ''}<br><small>${esc(whenText(b.reservedAt))}${b.phone ? ` &middot; ${esc(b.phone)}` : ''}${b.specialRequests ? `<br>${esc(b.specialRequests)}` : ''}</small></div>
        <span class="pill ${b.status === 'ARRIVED' ? 'on' : 'off'}" style="align-self:flex-start">${esc(STATUS_LABEL[b.status] || b.status)}</span></div>
      ${b.dirty && !S.snap.local ? '<small class="mute">Not on the server yet</small>' : ''}${b.syncError ? `<small class="bad">${esc(b.syncError)}</small>` : ''}
      ${['RESERVED', 'CONFIRMED', 'ARRIVED'].includes(b.status) ? `<div class="grid mt">
        ${b.status === 'ARRIVED' ? `<button class="btn ghost" data-bs="${esc(b.id)}" data-to="COMPLETED">Done</button>` : `<button class="btn" data-seat="${esc(b.id)}">Guests arrived</button>`}
        <button class="btn line" data-bs="${esc(b.id)}" data-to="CANCELLED">Cancel</button>
        ${b.status !== 'ARRIVED' ? `<button class="btn line" data-bs="${esc(b.id)}" data-to="NO_SHOW">No-show</button>` : ''}</div>` : ''}</div>`;
  $('view').innerHTML = `
    ${tablesSeg()}
    ${S.note ? `<div class="note ${S.note.kind || ''}" role="status">${esc(S.note.text)}</div>` : ''}
    <button class="btn block" id="newbk">+ New booking</button>
    <h2 class="sec">Coming up</h2>
    ${upcoming.map(row).join('') || '<p class="mute center">No bookings yet. Tap New booking when a guest calls.</p>'}
    ${past.length ? `<h2 class="sec">Earlier</h2>${past.map(row).join('')}` : ''}
    <p class="mute mt">${S.snap.local ? 'Bookings are kept on this phone. Connect a server later and they are sent to it.' : 'Bookings are shared with the server both ways. If the server was changed after you edited here, the server version is kept.'}</p>`;
  bindSeg();
  $('newbk').onclick = () => bookingSheet(tables);
  document.querySelectorAll('[data-bs]').forEach(
    (b) =>
      (b.onclick = async () => {
        const cur = await reservations.get(b.dataset.bs);
        if (!cur) return;
        if (b.dataset.to === 'CANCELLED' && !confirm(`Cancel the booking for ${cur.customerName}?`)) return;
        await reservations.put(setStatus(cur, b.dataset.to));
        syncNow({ refreshMenu: false }).then(afterSync);
        viewBookings();
      }),
  );
  document.querySelectorAll('[data-seat]').forEach(
    (b) =>
      (b.onclick = async () => {
        const cur = await reservations.get(b.dataset.seat);
        if (!cur) return;
        await reservations.put(setStatus(cur, 'ARRIVED'));
        syncNow({ refreshMenu: false }).then(afterSync);
        if (cur.tableLabel) {
          S.tablesTab = 'floor';
          return switchTo(null, { type: 'DINE_IN', table: cur.tableLabel });
        }
        S.note = { text: `${cur.customerName} is seated. Pick a table under Floor to start their order.` };
        viewBookings();
      }),
  );
}

function bookingSheet(tables) {
  const soon = new Date(Date.now() + 3600e3);
  soon.setMinutes(0, 0, 0);
  openSheet(
    `<header><h2>New booking</h2><button class="x" data-close aria-label="Close">&times;</button></header>
    <div class="body">
      <p id="bkerr" class="note bad" role="alert" hidden></p>
      <label for="bn">Guest name</label><input id="bn" autocomplete="off" maxlength="100">
      <label for="bp">Phone <span class="mute">(optional)</span></label><input id="bp" type="tel" inputmode="tel" autocomplete="off">
      <label for="bg">Guests</label><input id="bg" type="number" inputmode="numeric" min="1" value="2">
      <label for="ba">Date and time</label><input id="ba" type="datetime-local" value="${localInput(soon)}">
      ${tables.length ? `<label for="bt">Table <span class="mute">(optional)</span></label><select id="bt"><option value="">Any table</option>${tables.map((t) => `<option>${esc(t.label)}</option>`).join('')}</select>` : ''}
      <label for="bnote">Notes <span class="mute">(optional)</span></label><input id="bnote" maxlength="300" placeholder="Birthday, high chair…">
    </div>
    <footer><button class="btn" id="ok">Save booking</button></footer>`,
    (p) => {
      p.querySelector('#ok').onclick = async () => {
        const err = p.querySelector('#bkerr');
        try {
          const b = newBooking({ id: newId(), name: p.querySelector('#bn').value, phone: p.querySelector('#bp').value, guests: p.querySelector('#bg').value, at: p.querySelector('#ba').value, tableLabel: p.querySelector('#bt') ? p.querySelector('#bt').value : '', notes: p.querySelector('#bnote').value });
          const clash = clashes(await reservations.all(), b);
          if (clash) throw new Error(`${b.tableLabel} is already booked for ${clash.customerName} at ${whenText(clash.reservedAt)}.`);
          await reservations.put(b);
          closeSheet();
          S.note = { text: `Booked ${b.customerName} for ${whenText(b.reservedAt)}.` };
          syncNow({ refreshMenu: false }).then(afterSync);
          viewBookings();
        } catch (e) {
          err.textContent = e.message;
          err.hidden = false;
        }
      };
    },
  );
}

// ------------------------------------------------------------------ tables ---
const tablesSeg = () => `<div class="seg" role="tablist" aria-label="Tables or bookings"><button role="tab" data-seg="floor" aria-selected="${S.tablesTab === 'floor'}">Floor</button><button role="tab" data-seg="bookings" aria-selected="${S.tablesTab === 'bookings'}">Bookings${S.bookingsToday ? ` <span class="badge">${S.bookingsToday}</span>` : ''}</button></div>`;
function bindSeg() {
  document.querySelectorAll('[data-seg]').forEach((b) => (b.onclick = () => ((S.tablesTab = b.dataset.seg), viewTables())));
}

async function viewTables() {
  if (S.tablesTab === 'bookings') return viewBookings();
  const os = await orders.all();
  const taken = tableMap(os);
  const held = new Map((await reservations.all()).filter((b) => b.tableLabel && heldSoon(b)).map((b) => [b.tableLabel, b]));
  const open = openOrders(os).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  const floors = S.snap.floors;
  const local = !!S.snap.local;
  const now = Date.now();
  $('view').innerHTML = `
    ${tablesSeg()}
    ${S.note ? `<div class="note ${S.note.kind || ''}" role="status">${esc(S.note.text)}</div>` : ''}
    <button class="btn block" id="takeaway">+ New takeaway order</button>
    ${open.length ? `<h2 class="sec">Open orders</h2>${open
      .map((o) => `<button class="row orow" data-resume="${esc(o.id)}"><div class="grow"><b>${o.type === 'DINE_IN' ? esc(o.tableLabel || 'Dine in (no table)') : 'Takeaway'}</b> <small>${esc(o.number)}</small><br><small>${o.items.reduce((n, l) => n + l.qty, 0)} items &middot; ${minutesSince(o.createdAt, now)} min${(o.kotNumbers || []).length ? ` &middot; KOT ${o.kotNumbers.join(', ')}` : ' &middot; no KOT yet'}${S.orderId === o.id ? ' &middot; <b>on screen</b>' : ''}</small></div><b>${inr(orderBill(o).total)}</b></button>`)
      .join('')}` : ''}
    <h2 class="sec">Tables</h2>
    ${floors.length ? floors.map((f) => `<h3 class="floor">${esc(f.name)}${S.editTables && local ? ` <button class="mini" data-delsec="${esc(f.id)}" aria-label="Remove section ${esc(f.name)}">Remove</button>` : ''}</h3>
      <div class="tables">${f.tables.map((t) => {
        const o = taken.get(t.label);
        const hb = !o && held.get(t.label);
        return `<button class="tbl ${o ? 'busy' : ''}" data-tbl="${esc(t.label)}" aria-label="${esc(t.label)}, ${o ? `occupied, ${inr(orderBill(o).total)}, ${minutesSince(o.createdAt, now)} minutes` : hb ? `booked for ${esc(hb.customerName)} at ${esc(whenText(hb.reservedAt))}` : `free, seats ${t.capacity}`}">
          <b>${esc(t.label)}</b><small>${o ? `${inr(orderBill(o).total)} &middot; ${minutesSince(o.createdAt, now)}m` : hb ? `Booked ${new Date(hb.reservedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : `Free &middot; ${t.capacity} seats`}</small>
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
  bindSeg();
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

// ------------------------------------------------------------------- sales ---
async function viewSales() {
  const all = await sales.all();
  const label = { pending: 'Waiting to sync', synced: 'Synced', refused: 'Needs attention', dismissed: 'Set aside' };
  const nAttention = all.filter((x) => x.status === 'refused').length;
  const nReview = all.filter((x) => x.review && x.review.length).length;
  const rep = dayReport(all, await orders.all());
  const rfs = await refunds.all();
  const books = dayBooks({ sales: all, refunds: rfs, expenses: await expenses.all() });
  const reportCard = `<div class="card"><h2 style="font-size:1.05rem">Today on this phone</h2>
    <div class="tot big"><span>${rep.count} sale${rep.count === 1 ? '' : 's'}</span><span>${inr(rep.total)}</span></div>
    <dl class="kv">${Object.entries(rep.byMethod).filter(([, v]) => v).map(([m, v]) => `<dt>${{ CASH: 'Cash', UPI: 'UPI', CARD: 'Card', OTHER: 'Other' }[m]}</dt><dd>${inr(v)}</dd>`).join('')}
      ${rep.tax ? `<dt>${esc(S.snap.branch.taxLabel || 'Tax')} included</dt><dd>${inr(rep.tax)}</dd>` : ''}${rep.discount ? `<dt>Discounts</dt><dd>${inr(rep.discount)}</dd>` : ''}
      ${books.refundTotal ? `<dt>Refunds</dt><dd>&minus;${inr(books.refundTotal)}</dd><dt>Net sales</dt><dd><b>${inr(books.net)}</b></dd>` : ''}${books.expenseTotal ? `<dt>Expenses</dt><dd>&minus;${inr(books.expenseTotal)}</dd>` : ''}
      ${rep.voids ? `<dt>Cancelled orders</dt><dd>${rep.voids} (${inr(rep.voidValue)})</dd>` : ''}</dl>
    ${rep.top.length ? `<p class="mute" style="margin:.5rem 0 0">Top: ${rep.top.map((t) => `${esc(t.name)} &times;${t.qty}`).join(', ')}</p>` : ''}
    <p class="mute" style="margin:.5rem 0 0">Only sales taken on this phone, for today by the phone's clock.${S.snap.local ? '' : ' It is not the server total.'}${rep.notSynced ? ` ${rep.notSynced} not on the server yet.` : ''}</p></div>`;
  $('view').innerHTML = `
    ${reportCard}
    <button class="btn line block mt" id="books">Books &amp; backup: expenses, close the day, reports</button>
    ${S.pending ? `<div class="note warn" role="status">${S.pending} sale${S.pending > 1 ? 's' : ''} saved on this phone, not on the server yet.</div>` : ''}
    ${nAttention ? `<div class="note bad" role="status">${nAttention} sale${nAttention > 1 ? 's were' : ' was'} refused by the server and still need${nAttention > 1 ? '' : 's'} a decision. Open ${nAttention > 1 ? 'each' : 'it'} to retry or set aside.</div>` : ''}
    ${nReview ? `<div class="note warn" role="status">${nReview} sale${nReview > 1 ? 's were' : ' was'} recorded at a price that differs from the server's menu. Open to see which.</div>` : ''}
    <div class="mt">${
      all
        .map(
          (s) => `<button class="row" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line);text-align:left" data-sale="${esc(s.id)}">
            <div class="grow"><b>${esc(s.localNumber)}</b>${s.serverOrderNumber ? ` <small>#${esc(s.serverOrderNumber)}</small>` : ''}${refundedTotal(s, rfs) ? ' <small style="color:var(--bad)">Refunded</small>' : ''}<br><small>${esc(new Date(s.soldAt).toLocaleString())} &middot; ${s.items.reduce((n, i) => n + i.quantity, 0)} items</small></div>
            <div style="text-align:right"><b>${inr(s.bill.total)}</b><br><span class="status ${s.status}">${label[s.status]}</span></div></button>`,
        )
        .join('') || '<p class="mute center mt">No sales on this phone yet.</p>'
    }</div>`;
  $('books').onclick = booksMenu;
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
             ${refundedTotal(s, rfs) ? `<div class="tot" style="color:var(--bad)"><span>Refunded</span><span>&minus;${inr(refundedTotal(s, rfs))}</span></div>${rfs.filter((r) => r.saleId === s.id).map((r) => `<small class="mute">${esc(new Date(r.at).toLocaleString())} &middot; ${esc(METHOD_LABEL[r.method] || r.method)} &middot; ${r.lines.map((l) => `${l.qty} &times; ${esc(l.name)}`).join(', ')}${r.reason ? ` &middot; ${esc(r.reason)}` : ''}</small>`).join('<br>')}` : ''}
             ${S.snap.local && refundableLines(s, rfs).some((l) => l.left > 0) ? '<button class="btn line block mt" id="refund">Refund…</button>' : ''}
             <div class="mt">${printActions()}</div>
           </div>`,
          (p) => {
            bindPrint(p, s, false);
            if (p.querySelector('#refund')) p.querySelector('#refund').onclick = () => refundSheet(s.id);
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

// ------------------------------------------------------------------- books ---
// Refunds, expenses, closing the day, reports, export and backup. All of it is
// kept on this phone; none of it is sent to a server (the server has no
// endpoint for it), and the screens say so.
const fmtDay = (key) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const stamp = () => new Date().toISOString().slice(0, 10);
const slug = () => String(S.snap.branch.name || 'orderrestro').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'orderrestro';
const head = (title, back) => `<header><h2>${esc(title)}</h2><button class="x" data-close aria-label="Close">&times;</button></header>`;
const METHOD_LABEL = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', OTHER: 'Other' };

async function shareFile(name, mime, text) {
  const np = plugins().NativePrinter;
  if (np && np.shareFile) {
    try {
      await np.shareFile({ name, mime, text });
      return true;
    } catch (e) {
      toast(e.message || 'Could not share the file', 4500);
      return false;
    }
  }
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return true;
  } catch {
    toast('Could not save the file');
    return false;
  }
}

const allBooks = async () => ({ sales: await sales.all(), refunds: await refunds.all(), expenses: await expenses.all() });

function booksMenu() {
  openSheet(
    `${head('Books & backup')}
     <div class="body">
       <button class="btn line block" data-b="expenses">Expenses (money paid out)</button>
       <button class="btn line block mt" data-b="close">Close the day (count the cash)</button>
       <button class="btn line block mt" data-b="report">Reports</button>
       <button class="btn line block mt" data-b="csv">Share sales as a spreadsheet</button>
       ${S.snap.local ? `<button class="btn line block mt" data-b="backup">Back up everything</button>
       <button class="btn line block mt" data-b="restore">Restore from a backup</button>` : ''}
       <p class="mute mt">Refunds, expenses and cash counts are kept on this phone. ${S.snap.local ? 'Back up often: if the phone is lost or its data cleared, a backup is the only copy.' : 'They are not sent to the server.'}</p>
     </div>`,
    (p) => {
      const go = { expenses: expensesSheet, close: closeDaySheet, report: reportSheet, csv: shareCsv, backup: shareBackup, restore: restoreSheet };
      p.querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => go[b.dataset.b]()));
    },
  );
}

async function shareCsv() {
  const b = await allBooks();
  if (!b.sales.length) return toast('No sales to share yet');
  await shareFile(`${slug()}-sales-${stamp()}.csv`, 'text/csv', salesCsv(b.sales, b.refunds));
}

async function shareBackup() {
  const data = await readEverything();
  await shareFile(`${slug()}-backup-${stamp()}.json`, 'application/json', backupJson(data));
  await kv.set('lastBackupAt', Date.now());
}

function restoreSheet(message) {
  openSheet(
    `${head('Restore from a backup')}
     <div class="body">
       ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
       <div class="note warn">Restoring <b>replaces</b> the menu, sales, open orders, expenses and refunds on this phone with the ones in the file. Your password stays as it is.</div>
       <label for="rf">Backup file</label><input id="rf" type="file" accept=".json,application/json">
     </div>
     <footer><button class="btn block" id="go">Restore</button></footer>`,
    (p) => {
      p.querySelector('#go').onclick = async () => {
        const f = $('rf').files[0];
        if (!f) return restoreSheet('Choose the backup file first.');
        try {
          const b = parseBackup(await f.text());
          if (!confirm(`Replace everything on this phone with the backup from ${new Date(b.savedAt).toLocaleString()}? It has ${b.sales.length} sale${b.sales.length === 1 ? '' : 's'}.`)) return;
          b.snapshot.local = true; // a backup restores a phone account, never a server menu
          await replaceEverything(b);
          booksDirty = true;
          S.snap = b.snapshot;
          S.cart = new Map();
          S.orderId = null;
          S.restored = false;
          closeSheet();
          toast('Backup restored');
          render();
        } catch (e) {
          restoreSheet(e.message || 'Could not restore that file.');
        }
      };
    },
  );
}

// ---- expenses
async function expensesSheet(message, draft = {}) {
  const list = (await expenses.all()).sort((a, b) => (a.at < b.at ? 1 : -1));
  const cats = [...new Set(list.map((e) => e.category).filter(Boolean))];
  const todays = list.filter((e) => new Date(e.at).toDateString() === new Date().toDateString());
  const sum = todays.reduce((n, e) => n + e.amount, 0);
  openSheet(
    `${head('Expenses')}
     <div class="body">
       ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
       <label for="ea">Amount (₹)</label><input id="ea" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(draft.amount || '')}">
       <label for="en">What for</label><input id="en" value="${esc(draft.note || '')}" placeholder="Vegetables, gas, salary advance…">
       <label for="ec">Category <span class="mute">(optional)</span></label><input id="ec" list="ecl" value="${esc(draft.category || '')}" placeholder="Groceries, Rent, Staff…"><datalist id="ecl">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
       <label>Paid from</label><div class="seg" role="group" aria-label="Paid from"><button data-m="CASH" aria-pressed="${draft.method !== 'OTHER'}">Cash drawer</button><button data-m="OTHER" aria-pressed="${draft.method === 'OTHER'}">Bank / UPI / other</button></div>
       <button class="btn block mt" id="add">Add expense</button>
       <h3 style="margin:1.2rem 0 .3rem">Today: ${inr(sum)}</h3>
       ${list.slice(0, 40).map((e) => `<div class="row"><div class="grow"><b>${esc(e.note)}</b><br><small>${esc(new Date(e.at).toLocaleString())}${e.category ? ` &middot; ${esc(e.category)}` : ''} &middot; ${e.method === 'CASH' ? 'Cash' : 'Other'}</small></div><div style="text-align:right"><b>${inr(e.amount)}</b><br><button class="btn line" data-del="${esc(e.id)}" style="min-height:36px;padding:.2rem .7rem">Delete</button></div></div>`).join('') || '<p class="mute center mt">No expenses yet.</p>'}
       ${list.length ? '<button class="btn line block mt" id="csv">Share expenses as a spreadsheet</button>' : ''}
     </div>`,
    (p) => {
      let method = draft.method === 'OTHER' ? 'OTHER' : 'CASH';
      const grab = () => ({ amount: $('ea').value, note: $('en').value, category: $('ec').value, method });
      p.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => ((method = b.dataset.m), p.querySelectorAll('[data-m]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))))));
      p.querySelector('#add').onclick = async () => {
        try {
          await expenses.put(buildExpense({ id: newId(), ...grab() }));
          booksDirty = true;
          toast('Expense added');
          expensesSheet();
        } catch (e) {
          expensesSheet(e.message, grab());
        }
      };
      p.querySelectorAll('[data-del]').forEach(
        (b) =>
          (b.onclick = async () => {
            if (!confirm('Delete this expense? It leaves the books.')) return;
            await expenses.del(b.dataset.del);
            booksDirty = true;
            expensesSheet();
          }),
      );
      const csv = p.querySelector('#csv');
      if (csv) csv.onclick = () => shareFile(`${slug()}-expenses-${stamp()}.csv`, 'text/csv', expensesCsv(list));
    },
  );
}

// ---- close the day
async function closeDaySheet(message, draft = {}) {
  const day = today();
  const b = await allBooks();
  const float = draft.float != null ? draft.float : (await kv.get(`float:${day}`)) ?? '';
  const books = dayBooks({ ...b, float: Number(float) || 0, day });
  const done = await shifts.get(day);
  const past = (await shifts.all()).sort((x, y) => (x.day < y.day ? 1 : -1)).slice(0, 7);
  const line = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  openSheet(
    `${head('Close the day')}
     <div class="body">
       ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
       <label for="fl">Cash in the drawer when you opened (₹)</label><input id="fl" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(float)}" placeholder="0">
       <dl class="kv mt">
         ${line('Sales', `${books.sales} &middot; ${inr(books.gross)}`)}
         ${books.refundTotal ? line('Refunds', `&minus;${inr(books.refundTotal)}`) : ''}
         ${line('Net sales', `<b>${inr(books.net)}</b>`)}
         ${Object.entries(books.byMethod).filter(([, v]) => v).map(([m, v]) => line(METHOD_LABEL[m], inr(v))).join('')}
         ${books.expenseTotal ? line('Expenses', `&minus;${inr(books.expenseTotal)}`) : ''}
         ${line('Left after expenses', `<b>${inr(books.profit)}</b>`)}
       </dl>
       <div class="tot big mt"><span>Cash that should be there</span><span>${inr(books.expectedCash)}</span></div>
       <p class="mute" style="margin:.2rem 0 0">Opening cash + cash sales &minus; cash refunds &minus; cash expenses.</p>
       <label for="cc">Cash you counted (₹)</label><input id="cc" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(draft.counted ?? (done ? done.countedCash : ''))}">
       ${done ? `<div class="note warn">This day was closed at ${esc(new Date(done.closedAt).toLocaleTimeString())}. Closing again replaces that count.</div>` : ''}
       <button class="btn block mt" id="close">${done ? 'Close again' : 'Close the day'}</button>
       ${past.length ? `<h3 style="margin:1.2rem 0 .3rem">Recent days</h3>${past.map((d) => `<div class="row"><div class="grow"><b>${esc(fmtDay(d.day))}</b><br><small>Net ${inr(d.net)} &middot; counted ${inr(d.countedCash)}</small></div><b style="color:${d.difference < 0 ? 'var(--bad)' : d.difference > 0 ? 'var(--warn)' : 'var(--ok)'}">${d.difference === 0 ? 'Matches' : `${d.difference > 0 ? '+' : '&minus;'}${inr(Math.abs(d.difference))}`}</b></div>`).join('')}` : ''}
     </div>`,
    (p) => {
      p.querySelector('#fl').onchange = async () => {
        await kv.set(`float:${day}`, $('fl').value);
        closeDaySheet(null, { float: $('fl').value, counted: $('cc').value });
      };
      p.querySelector('#close').onclick = async () => {
        try {
          await kv.set(`float:${day}`, $('fl').value);
          const rec = closeDay({ books: dayBooks({ ...b, float: Number($('fl').value) || 0, day }), counted: $('cc').value });
          await shifts.put(rec);
          booksDirty = true;
          const word = rec.difference === 0 ? 'The cash matches.' : rec.difference < 0 ? `Cash is short by ${inr(-rec.difference)}.` : `Cash is over by ${inr(rec.difference)}.`;
          toast(`Day closed. ${word}`, 5000);
          closeDaySheet();
        } catch (e) {
          closeDaySheet(e.message, { float: $('fl').value, counted: $('cc').value });
        }
      };
    },
  );
}

// ---- reports
async function reportSheet(range = 7) {
  const b = await allBooks();
  const to = today();
  const from = range === 1 ? to : daysAgo(range - 1);
  const r = rangeBooks({ ...b, from, to });
  openSheet(
    `${head('Reports')}
     <div class="body">
       <div class="seg" role="group" aria-label="Period">${[[1, 'Today'], [7, '7 days'], [30, '30 days']].map(([n, l]) => `<button data-r="${n}" aria-pressed="${range === n}">${l}</button>`).join('')}</div>
       <div class="tot big mt"><span>${r.sales} sale${r.sales === 1 ? '' : 's'}</span><span>${inr(r.gross)}</span></div>
       <dl class="kv mt">
         ${r.refundTotal ? `<dt>Refunds</dt><dd>&minus;${inr(r.refundTotal)}</dd>` : ''}
         <dt>Net sales</dt><dd><b>${inr(r.net)}</b></dd>
         ${r.expenseTotal ? `<dt>Expenses</dt><dd>&minus;${inr(r.expenseTotal)}</dd>` : ''}
         <dt>Left after expenses</dt><dd><b>${inr(r.profit)}</b></dd>
       </dl>
       ${r.top.length ? `<h3 style="margin:1.2rem 0 .3rem">Best sellers</h3>${r.top.map((t) => `<div class="tot"><span>${esc(t.name)}</span><span>&times;${t.qty}</span></div>`).join('')}` : '<p class="mute center mt">No sales in this period.</p>'}
       <p class="mute mt">Sales taken on this phone, by the phone's clock.</p>
     </div>`,
    (p) => p.querySelectorAll('[data-r]').forEach((x) => (x.onclick = () => reportSheet(Number(x.dataset.r)))),
  );
}

// ---- refunds
async function refundSheet(saleId, message, draft = {}) {
  const sale = await sales.get(saleId);
  const rs = await refunds.all();
  const lines = refundableLines(sale, rs).filter((l) => l.left > 0);
  const method = draft.method || (sale.payments[0] && sale.payments[0].method) || 'CASH';
  const qty = draft.qty || {};
  openSheet(
    `${head(`Refund ${sale.localNumber}`)}
     <div class="body">
       ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
       ${lines.length ? lines.map((l) => `<div class="row"><div class="grow"><b>${esc(l.item.name)}</b><br><small>${inr(l.item.price)} &middot; up to ${l.left}</small></div>
          <input type="number" inputmode="numeric" min="0" max="${l.left}" step="1" data-q="${l.index}" value="${esc(qty[l.index] ?? '')}" placeholder="0" aria-label="How many ${esc(l.item.name)} to refund" style="width:5rem"></div>`).join('') : '<p class="mute center">Everything on this sale is already refunded.</p>'}
       <label>Paid back by</label><div class="seg" role="group" aria-label="Paid back by">${Object.entries(METHOD_LABEL).map(([m, l]) => `<button data-m="${m}" aria-pressed="${method === m}">${l}</button>`).join('')}</div>
       <label for="rr">Reason <span class="mute">(optional)</span></label><input id="rr" value="${esc(draft.reason || '')}" placeholder="Wrong dish, cold food…">
       <div class="tot big mt"><span>Pay back</span><span id="amt">${inr(0)}</span></div>
       <p class="mute">Recorded in this phone's books and taken off the day's sales. ${S.snap.local ? 'Dishes are not put back into stock.' : ''}</p>
     </div>
     <footer><button class="btn block" id="go" ${lines.length ? '' : 'disabled'}>Refund</button></footer>`,
    (p) => {
      let m = method;
      const picks = () => [...p.querySelectorAll('[data-q]')].map((i) => ({ index: Number(i.dataset.q), qty: Number(i.value) || 0 }));
      const preview = () => {
        try {
          $('amt').textContent = inr(buildRefund({ id: 'x', sale, refunds: rs, picks: picks() }).amount);
        } catch {
          $('amt').textContent = inr(0);
        }
      };
      p.querySelectorAll('[data-q]').forEach((i) => (i.oninput = preview));
      p.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => ((m = b.dataset.m), p.querySelectorAll('[data-m]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))))));
      p.querySelector('#go').onclick = async () => {
        const keep = () => ({ method: m, reason: $('rr').value, qty: Object.fromEntries(picks().map((x) => [x.index, x.qty || ''])) });
        try {
          const r = buildRefund({ id: newId(), sale, refunds: rs, picks: picks(), method: m, reason: $('rr').value });
          if (!confirm(`Pay back ${inr(r.amount)} by ${METHOD_LABEL[m]}?`)) return;
          await refunds.put(r);
          booksDirty = true;
          toast(`Refunded ${inr(r.amount)}`);
          closeSheet();
          render();
        } catch (e) {
          refundSheet(saleId, e.message, keep());
        }
      };
      preview();
    },
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
      ${mayCost() ? '<button class="btn line block mt" id="costs">Recipes &amp; costs</button>' : ''}
      <button class="btn line block mt" id="out">${S.hasPhoneAccount ? 'Disconnect and go back to my phone account' : 'Sign out of standalone mode'}</button>
    </div>`;
  $('syncnow').onclick = doSync;
  if ($('costs')) $('costs').onclick = () => costListSheet();
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


// ------------------------------------------------------- recipes & costs ---
// Cost of a dish from its ingredients, computed on the phone with the same engine as the server, so it
// works with no connection. Phone-account mode edits ingredients and may apply a suggested price to the
// phone's own menu; server mode edits recipes (queued and sent on sync, conflicts held for you to settle).
const mayCost = () => !!S.snap && (S.snap.local || (S.snap.user.permissions || []).includes('inventory.manage'));
const getBook = async () => (await kv.get('costbook')) || emptyBook();
const putBook = (b) => kv.set('costbook', b);
const unitOpts = (sel) => UNITS.map((u) => `<option value="${u}" ${u === sel ? 'selected' : ''}>${u.toLowerCase()}</option>`).join('');
const pct = (n) => (n == null ? '—' : `${n}%`);

async function costListSheet(message) {
  const book = await getBook();
  const rows = S.snap.items.map((i) => ({ i, a: analyseDish(book, i) }));
  const waiting = pendingRecipes(book).length;
  const held = conflicts(book);
  openSheet(
    `${head('Recipes & costs')}
     <div class="body">
       ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
       ${held.length ? `<div class="note warn" role="alert">${held.length} recipe${held.length > 1 ? 's were' : ' was'} changed on the server while you were offline. Open ${held.length > 1 ? 'them' : 'it'} to choose which version to keep.</div>` : ''}
       ${!S.snap.local && waiting ? `<div class="note">${waiting} recipe change${waiting > 1 ? 's' : ''} waiting to be sent. They go when you sync.</div>` : ''}
       ${S.snap.local ? '<button class="btn line block" id="ings">Ingredients and what they cost</button>' : `<p class="mute">${book.ingredients.length} ingredients${book.fetchedAt ? ` · saved ${esc(new Date(book.fetchedAt).toLocaleString())}` : ' · not downloaded yet. Sync once while online.'}</p>`}
       <div class="mt">${
         rows
           .map(({ i, a }) => `<button class="row dishrow" data-d="${esc(i.id)}"><div class="grow"><b>${esc(i.name)}</b>${book.recipes[i.id] && book.recipes[i.id].conflict ? ' <span class="badge">conflict</span>' : ''}<br><small>${a.hasRecipe ? (a.cost.costPerPortion === null ? 'Some ingredients have no price' : `Costs ${inr(a.cost.costPerPortion)} &middot; margin ${pct(a.profit && a.profit.grossMarginPercent)}${a.alert && a.alert.level !== 'OK' && a.alert.level !== 'UNKNOWN' ? ` &middot; <b>${esc(a.alert.message)}</b>` : ''}`) : 'No recipe yet'}</small></div><b>${inr(i.price)}</b></button>`)
           .join('') || '<p class="mute center mt">Add dishes to the menu first.</p>'
       }</div>
     </div>`,
    (p) => {
      const ing = p.querySelector('#ings');
      if (ing) ing.onclick = () => ingredientsSheet();
      p.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => dishCostSheet(b.dataset.d)));
    },
  );
}

async function ingredientsSheet(message) {
  const book = await getBook();
  openSheet(
    `${head('Ingredients')}
     <div class="body">
       ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
       <button class="btn block" id="new">Add an ingredient</button>
       <div class="mt">${
         book.ingredients
           .map((i) => `<button class="row dishrow" data-i="${esc(i.id)}"><div class="grow"><b>${esc(i.name)}</b><br><small>${i.purchasePrice != null ? `${inr(i.purchasePrice)} for ${esc(i.purchaseQuantity)} ${esc((i.purchaseUnit || i.unit).toLowerCase())}` : 'No price yet'} &middot; usable ${esc(i.yieldPercent ?? 100)}%</small></div></button>`)
           .join('') || '<p class="mute center mt">No ingredients yet.</p>'
       }</div>
       <button class="btn line block mt" id="back">Back to recipes</button>
     </div>`,
    (p) => {
      p.querySelector('#new').onclick = () => ingredientSheet();
      p.querySelector('#back').onclick = () => costListSheet();
      p.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => ingredientSheet(b.dataset.i)));
    },
  );
}

async function ingredientSheet(id, message, draft) {
  const book = await getBook();
  const cur = id ? book.ingredients.find((i) => i.id === id) : null;
  const d = draft || (cur ? { name: cur.name, unit: cur.unit, purchaseQuantity: cur.purchaseQuantity ?? '', purchaseUnit: cur.purchaseUnit || cur.unit, purchasePrice: cur.purchasePrice ?? '', yieldPercent: cur.yieldPercent ?? 100, per: (cur.conversions && cur.conversions[0] && cur.conversions[0].per) || '', cunit: (cur.conversions && cur.conversions[0] && cur.conversions[0].unit) || 'G' } : { unit: 'KG', purchaseUnit: 'KG', yieldPercent: 100, cunit: 'G' });
  openSheet(
    `${head(cur ? 'Edit ingredient' : 'Add an ingredient')}
     <div class="body">
       ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
       <label for="in">Name</label><input id="in" value="${esc(d.name || '')}">
       <label for="iu">Unit you count it in</label><select id="iu">${unitOpts(d.unit)}</select>
       <label>What you paid</label>
       <div style="display:grid;grid-template-columns:1fr 6rem 1fr;gap:.4rem"><input id="iq" type="number" inputmode="decimal" min="0" step="any" placeholder="Bought" aria-label="Quantity bought" value="${esc(d.purchaseQuantity ?? '')}"><select id="ipu" aria-label="Unit bought">${unitOpts(d.purchaseUnit)}</select><input id="ip" type="number" inputmode="decimal" min="0" step="any" placeholder="Price ₹" aria-label="Price" value="${esc(d.purchasePrice ?? '')}"></div>
       <label for="iy">Usable after trimming (%)</label><input id="iy" type="number" inputmode="decimal" min="1" max="100" value="${esc(d.yieldPercent ?? 100)}">
       <small class="mute">80 means you pay for 1.25 kg to get 1 kg usable. Counted once, here.</small>
       <label>Unit bridge <span class="mute">(only to mix weight and volume)</span></label>
       <div style="display:grid;grid-template-columns:auto 1fr 6rem;gap:.4rem;align-items:center"><span>1 unit =</span><input id="ic" type="number" inputmode="decimal" min="0" step="any" aria-label="Amount" value="${esc(d.per ?? '')}"><select id="icu" aria-label="Bridge unit">${unitOpts(d.cunit)}</select></div>
     </div>
     <footer>${cur ? '<button class="btn line" id="id">Delete</button>' : ''}<button class="btn" id="is">Save</button></footer>`,
    (p) => {
      const grab = () => ({ name: $('in').value, unit: $('iu').value, purchaseQuantity: $('iq').value, purchaseUnit: $('ipu').value, purchasePrice: $('ip').value, yieldPercent: $('iy').value, per: $('ic').value, cunit: $('icu').value });
      p.querySelector('#is').onclick = async () => {
        const g = grab();
        try {
          const b = saveIngredient(await getBook(), { ...g, conversions: g.per ? [{ unit: g.cunit, per: g.per }] : [] }, id, newId());
          await putBook(b);
          ingredientsSheet();
        } catch (e) {
          ingredientSheet(id, e.message, g);
        }
      };
      const del = p.querySelector('#id');
      if (del) del.onclick = async () => {
        try {
          await putBook(removeIngredient(await getBook(), id));
          ingredientsSheet();
        } catch (e) {
          ingredientSheet(id, e.message, grab());
        }
      };
    },
  );
}

async function dishCostSheet(dishId, message, draft) {
  const book = await getBook();
  const dish = S.snap.items.find((i) => i.id === dishId);
  if (!dish) return costListSheet();
  const saved = book.recipes[dishId];
  const r = draft || saved || { lines: [], batchOutputQty: 1, overheads: [], targetMarginPercent: '', targetMarkupPercent: '' };
  const a = analyseDish(book, dish, saved && !draft ? saved : r.lines.some((l) => l.ingredientId && Number(l.quantity) > 0) ? { ...r, lines: r.lines.filter((l) => l.ingredientId && Number(l.quantity) > 0), batchOutputQty: Number(r.batchOutputQty) || 0 } : undefined);
  const mp = ingredientMap(book);
  const lineHtml = (l, i) => `<div class="card" style="padding:.6rem;margin-top:.5rem">
      <select data-l="${i}" data-k="ingredientId" aria-label="Ingredient"><option value="">Choose ingredient…</option>${book.ingredients.map((x) => `<option value="${esc(x.id)}" ${x.id === l.ingredientId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <div style="display:grid;grid-template-columns:1fr 6rem auto;gap:.4rem;margin-top:.4rem"><input data-l="${i}" data-k="quantity" type="number" inputmode="decimal" min="0" step="any" placeholder="Quantity" aria-label="Quantity" value="${esc(l.quantity ?? '')}"><select data-l="${i}" data-k="unit" aria-label="Unit"><option value="">${esc(((mp.get(l.ingredientId) || {}).unit || 'unit').toLowerCase())}</option>${UNITS.map((u) => `<option value="${u}" ${u === l.unit ? 'selected' : ''}>${u.toLowerCase()}</option>`).join('')}</select><button class="btn line" data-rm="${i}" aria-label="Remove line" style="min-height:44px">&times;</button></div></div>`;
  const over = r.overheads || [];
  openSheet(
    `${head(dish.name)}
     <div class="body">
       ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
       ${saved && saved.conflict ? `<div class="note warn" role="alert"><b>Changed on the server while you were offline.</b><br>Keep your version (sent on top of theirs) or take theirs.<div class="seg mt"><button class="btn line" id="ckm">Keep mine</button><button class="btn line" id="cks">Take theirs</button></div></div>` : ''}
       ${saved && saved.error ? `<div class="note bad" role="alert">${esc(saved.error)}</div>` : ''}
       ${a.alert && (a.alert.level === 'WATCH' || a.alert.level === 'LOSS') ? `<div class="note warn" role="alert"><b>${esc(a.alert.message)}</b><br><small>Margin was ${pct(a.alert.baselineMarginPercent)}, now ${pct(a.alert.currentMarginPercent)}. Your price has not been changed.</small><br><button class="btn line mt" id="ack">Price is fine, stop warning</button></div>` : ''}
       <label>Ingredients <span class="mute">(usable amount for the whole batch)</span></label>
       <div id="lines">${r.lines.map(lineHtml).join('')}</div>
       <button class="btn line block mt" id="addl">Add ingredient</button>
       <label for="rb">Portions per batch</label><input id="rb" type="number" inputmode="decimal" min="0" step="any" value="${esc(r.batchOutputQty ?? 1)}">
       <label>Packaging, labour, energy <span class="mute">(optional)</span></label>
       <div id="oh">${over.map((o, i) => `<div style="display:grid;grid-template-columns:1fr 5rem 7rem auto;gap:.3rem;margin-top:.3rem"><select data-o="${i}" data-k="kind" aria-label="Kind">${['PACKAGING', 'LABOUR', 'ENERGY', 'OTHER'].map((k) => `<option value="${k}" ${k === o.kind ? 'selected' : ''}>${k.toLowerCase()}</option>`).join('')}</select><input data-o="${i}" data-k="amount" type="number" inputmode="decimal" min="0" step="any" aria-label="Amount" value="${esc(o.amount ?? '')}"><select data-o="${i}" data-k="basis" aria-label="Applies"><option value="PER_BATCH" ${o.basis === 'PER_BATCH' ? 'selected' : ''}>per batch</option><option value="PER_PORTION" ${o.basis === 'PER_PORTION' ? 'selected' : ''}>per portion</option></select><button class="btn line" data-orm="${i}" aria-label="Remove" style="min-height:44px">&times;</button></div>`).join('')}</div>
       <button class="btn line block mt" id="addo">Add a cost</button>
       <div class="card mt" aria-live="polite">${
         !a.hasRecipe ? '<p class="mute">Add ingredients to see the cost.</p>' : `<dl class="kv"><dt>Ingredients (batch)</dt><dd>${inr(a.cost.ingredientCost)}</dd>${a.cost.yieldLossCost > 0 ? `<dt>&nbsp;&nbsp;of which trimming loss</dt><dd>${inr(a.cost.yieldLossCost)}</dd>` : ''}<dt>Other costs (batch)</dt><dd>${inr(a.cost.overheadCost)}</dd><dt>Batch cost</dt><dd><b>${inr(a.cost.batchCost)}</b></dd><dt>Cost per portion</dt><dd><b>${a.cost.costPerPortion === null ? '—' : inr(a.cost.costPerPortion)}</b></dd></dl>${a.cost.complete ? '' : `<p class="note bad mt">Incomplete: ${esc((a.cost.issues[0] || {}).message || 'fix the lines')}. No price suggestion until every line is priced.</p>`}`
       }</div>
       ${a.profit ? `<div class="card mt"><dl class="kv"><dt>Selling price</dt><dd>${inr(dish.price)}</dd><dt>Revenue before tax</dt><dd>${inr(a.profit.netRevenue)}</dd><dt>Gross profit</dt><dd>${inr(a.profit.grossProfit)}</dd><dt>Food cost</dt><dd>${pct(a.profit.foodCostPercent)}</dd><dt>Gross margin</dt><dd>${pct(a.profit.grossMarginPercent)}</dd></dl></div>` : ''}
       <div class="card mt"><b>Suggested price</b>
         <div class="seg mt" role="group" aria-label="Pricing method"><button data-m="MARGIN" aria-pressed="true">Target margin</button><button data-m="MARKUP" aria-pressed="false">Markup on cost</button></div>
         <input id="sp" type="number" inputmode="decimal" min="0" step="any" aria-label="Percent" placeholder="%" value="${esc(r.targetMarginPercent ?? '')}" class="mt">
         <small class="mute" id="sh">Margin price = cost ÷ (1 − margin%).</small>
         <div id="sr" class="mt"></div></div>
     </div>
     <footer><button class="btn" id="rs">Save recipe</button></footer>`,
    (p) => {
      const grab = () => {
        const lines = [...p.querySelectorAll('#lines .card')].map((c) => ({ ingredientId: c.querySelector('[data-k=ingredientId]').value, quantity: c.querySelector('[data-k=quantity]').value, unit: c.querySelector('[data-k=unit]').value || null }));
        const overheads = [...p.querySelectorAll('#oh > div')].map((c) => ({ kind: c.querySelector('[data-k=kind]').value, amount: c.querySelector('[data-k=amount]').value, basis: c.querySelector('[data-k=basis]').value }));
        return { lines, overheads, batchOutputQty: $('rb').value, targetMarginPercent: r.targetMarginPercent ?? '', targetMarkupPercent: r.targetMarkupPercent ?? '' };
      };
      p.querySelector('#addl').onclick = () => dishCostSheet(dishId, null, { ...grab(), lines: [...grab().lines, { ingredientId: '', quantity: '', unit: null }] });
      p.querySelector('#addo').onclick = () => dishCostSheet(dishId, null, { ...grab(), overheads: [...grab().overheads, { kind: 'PACKAGING', amount: '', basis: 'PER_PORTION' }] });
      p.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => dishCostSheet(dishId, null, { ...grab(), lines: grab().lines.filter((_, i) => i !== Number(b.dataset.rm)) })));
      p.querySelectorAll('[data-orm]').forEach((b) => (b.onclick = () => dishCostSheet(dishId, null, { ...grab(), overheads: grab().overheads.filter((_, i) => i !== Number(b.dataset.orm)) })));
      p.querySelectorAll('#lines select, #lines input, #oh select, #oh input, #rb').forEach((x) => (x.onchange = () => dishCostSheet(dishId, null, grab())));
      // suggestion
      let method = 'MARGIN';
      const showSuggestion = () => {
        const v = $('sp').value;
        const sg = a.hasRecipe && a.cost.costPerPortion !== null && v !== '' ? a.sug(method, v) : null;
        $('sh').textContent = method === 'MARGIN' ? 'Margin price = cost ÷ (1 − margin%). 60% margin means 60% of the price (before tax) is profit.' : 'Markup price = cost × (1 + markup%). 60% markup adds 60% of the cost on top.';
        $('sr').innerHTML = sg
          ? `<b>${inr(sg.priceBeforeTax)}</b> <small class="mute">before tax</small>${Number(dish.taxRate) > 0 ? `<br><small class="mute">Enter as ${inr(sg.listedPrice)} (includes ${esc(dish.taxRate)}% tax)</small>` : ''}${S.snap.local ? `<br><button class="btn line mt" id="ap">Use this price</button><small class="mute"><br>Your price is only changed if you press this.</small>` : '<br><small class="mute">Change the price from the dashboard. Your menu price is never changed here.</small>'}`
          : '<small class="mute">Needs a fully priced cost and a valid percentage (margin under 100%).</small>';
        const ap = $('ap');
        if (ap) ap.onclick = async () => {
          if (!confirm(`Change the price of ${dish.name} from ${inr(dish.price)} to ${inr(sg.listedPrice)}?`)) return;
          const cat = (S.snap.categories.find((c) => c.id === dish.categoryId) || {}).name || '';
          S.snap = await upsertDish(S.snap, { id: dish.id, name: dish.name, price: sg.listedPrice, taxRate: dish.taxRate, isVeg: dish.isVeg, categoryName: cat, stock: dish.stock, soldOut: !!dish.soldOut });
          const b = acknowledge(await getBook(), dishId, S.snap.items.find((i) => i.id === dishId));
          await putBook(b);
          toast('Price updated');
          dishCostSheet(dishId);
        };
      };
      p.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => {
        method = b.dataset.m;
        p.querySelectorAll('[data-m]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        $('sp').value = method === 'MARGIN' ? (r.targetMarginPercent ?? '') : (r.targetMarkupPercent ?? '');
        showSuggestion();
      }));
      $('sp').oninput = () => {
        r[method === 'MARGIN' ? 'targetMarginPercent' : 'targetMarkupPercent'] = $('sp').value;
        showSuggestion();
      };
      showSuggestion();
      p.querySelector('#rs').onclick = async () => {
        const g = grab();
        g.targetMarginPercent = r.targetMarginPercent ?? '';
        g.targetMarkupPercent = r.targetMarkupPercent ?? '';
        try {
          await putBook(saveRecipe(await getBook(), dishId, g));
          booksDirty = true;
          toast('Recipe saved');
          dishCostSheet(dishId);
          if (!S.snap.local) syncNow({ refreshMenu: false }).then(afterSync);
        } catch (e) {
          dishCostSheet(dishId, e.message, g);
        }
      };
      const ack = p.querySelector('#ack');
      if (ack) ack.onclick = async () => (await putBook(acknowledge(await getBook(), dishId, dish)), dishCostSheet(dishId));
      const km = p.querySelector('#ckm');
      if (km) km.onclick = async () => (await putBook(resolveConflict(await getBook(), dishId, 'mine')), dishCostSheet(dishId));
      const ks = p.querySelector('#cks');
      if (ks) ks.onclick = async () => (await putBook(resolveConflict(await getBook(), dishId, 'server')), dishCostSheet(dishId));
    },
  );
}

// ------------------------------------------------------------------- start ---
async function start() {
  S.snap = await kv.get('snapshot');
  S.setupDismissed = !!(await kv.get('setupDismissed'));
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


start().catch((e) => {
  $('app').innerHTML = `<div class="login"><div class="note bad">Could not start: ${esc(e.message)}</div></div>`;
});
