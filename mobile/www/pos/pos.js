// OrderRestro standalone POS. Opens with no connection, sells from the menu
// saved on this phone, prints, and sends the sales to the restaurant server
// whenever it can. Plain DOM + modules: nothing here needs a build step.
import { computeBill, round2, settle, upiLink } from './lib/bill.js';
import { escposReceipt, htmlReceipt, toBase64 } from './lib/receipt.js';
import { events, reservations, expenses, kots, kv, newId, nextKotNumber, nextLocalNumber, nextOrderNumber, orders, readEverything, refunds, replaceEverything, sales, saveKotWithOrder, shifts } from './lib/store.js';
import { backupJson, buildCollection, buildExpense, buildRefund, closeDay, dayBooks, daysAgo, dueOf, dueSales, expensesCsv, parseBackup, rangeBooks, refundableLines, refundedTotal, salesCsv, today } from './lib/books.js';
import { buildChoice, defaultPicks, findByCode, lineKey, needsChoice } from './lib/options.js';
import { afterRight, afterWrong, hashPin, lockState, needsManager, pinTaken, validPin, weakPin, whoHasPin } from './lib/staff.js';
import { KOT_NEXT, dayReport, kotDelta, markSent, minutesSince, newOrder, openOrders, saleNote, tableMap, tableTakenBy } from './lib/orders.js';
import { escposKot, htmlKot } from './lib/kot.js';
import { STATUS_LABEL, clashes, grouped, heldSoon, newBooking, setStatus } from './lib/reservations.js';
import { native, pickServer, reachable, request, savedServers, setDeviceId } from './lib/net.js';
import { dismissEvent, queueEvent, retryEvent, shiftState } from './lib/journal.js';
import { NO_RECIPES_FOR_PRODUCT, capsFrom, createInventoryItem, loadCosting, createMenuItem, deleteDraft, emptyForm, fillFromRecipe, formFromDraft, formProblem, friendlyError, loadRecipes, loadStockItems, postDraft, postNew, recipeProblem, saveDraft, saveRecipe, shortRows, voucherBody } from './lib/stockjournal.js';
import { login, pullSnapshot, syncNow, retrySale } from './lib/sync.js';
import { checkAll } from './lib/net.js';
import { addOnsText, addSection, addTable, removeSection, removeTable, changeLocalPassword, checkLocalPassword, createLocalAccount, eraseLocalAccount, hasLocalAccount, remapSalesToServer, removeDish, setSoldOut, upsertDish, useStock } from './lib/local.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plugins = () => (window.Capacitor && window.Capacitor.Plugins) || {};
const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; // ₹1,050.00 / ₹1,25,000.00

let SJ = null; // the open Stock journal form (see "stock journal" below); null when its sheet is closed
const S = {
  view: 'sell',
  snap: null,
  cart: new Map(), // menuItemId -> { item, qty }
  category: 'all',
  q: '',
  type: 'TAKEAWAY',
  table: '',
  discountPercent: 0,
  discountReason: '',
  online: false,
  syncing: false,
  pending: 0,
  pendingEvents: 0,
  failedEvents: 0,
  pendingBookings: 0,
  lastSync: null,
  note: null,
  unlocked: false,
  orderId: null, // the open order the cart belongs to (saved as you go)
  restored: false,
  noteOpen: null, // dish id whose note box is open
  editTables: false,
  tablesTab: 'floor', // 'floor' | 'bookings'
  showDone: false,
  staff: [], // people who switch in with a PIN on this phone (kv 'staff'); empty = no PINs asked
  who: null, // the person switched in right now
  scPct: 0, // voluntary service charge offered, in % (0 = off)
  serviceCharge: false, // the guest agreed to it on this order
  customer: { name: '', phone: '' }, // who the bill is for (needed to leave it unpaid)
};

const ICON = {
  sell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.1a2 2 0 0 0 2-1.5L21 8H6"/></svg>',
  sales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6"/></svg>',
  tables: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  kitchen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 13a4 4 0 1 1 2-7.5 4 4 0 0 1 8 0A4 4 0 1 1 18 13v7H6z"/><path d="M6 17h12"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18.5 2v4h-4M5.5 22v-4h4"/></svg>',
};

/** A phone account can do everything; a server-linked phone only what its server says it takes (see sync.js). */
const can = (cap) => !!(S.snap && S.snap.local) || !!(S.caps && S.caps[cap]);

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
  SJ = null;
  if (booksDirty) {
    booksDirty = false;
    if (S.snap) render();
  }
}

// ------------------------------------------------------------------- state ---
// The cart: line key (dish + portion + add-ons, see lib/options.js) -> { key, item, qty, sent, note, portion, mods, baseName }.
// `item` is the line as sold: its name carries the portion and add-ons and its price includes them.
const cartLines = () => [...S.cart.values()].filter((l) => l.qty > 0);
const keyOf = (l) => l.key || lineKey(l.menuItemId, l.portion, (l.mods || []).map((m) => m.id));
const qtyOf = (itemId) => [...S.cart.values()].filter((l) => l.item.id === itemId).reduce((n, l) => n + l.qty, 0);
const billOf = (extra = {}) =>
  computeBill(
    cartLines().map((l) => ({ price: l.item.price, quantity: l.qty, taxRate: l.item.taxRate })),
    { taxMode: S.snap.branch.taxMode, discountPercent: S.discountPercent, serviceChargePct: S.serviceCharge && can('offlineOptions') ? S.scPct : 0, ...extra },
  );
const cartCount = () => cartLines().reduce((n, l) => n + l.qty, 0);

function saleFrom(localNumber, bill, payments, change) {
  return {
    id: newId(),
    localNumber,
    soldAt: new Date().toISOString(),
    type: S.type,
    tableLabel: S.type === 'DINE_IN' ? S.table || '' : '',
    items: cartLines().map((l) => ({
      menuItemId: l.item.id,
      name: l.item.name,
      baseName: l.baseName || l.item.name,
      price: l.item.price,
      taxRate: l.item.taxRate,
      quantity: l.qty,
      ...(l.note ? { note: l.note } : {}),
      ...(l.portion ? { portion: l.portion } : {}),
      ...(l.mods && l.mods.length ? { modifierIds: l.mods.map((m) => m.id), mods: l.mods } : {}),
    })),
    orderId: S.orderId || undefined,
    ...(S.customer.phone || S.customer.name ? { customer: { name: S.customer.name.trim(), phone: S.customer.phone.trim() } } : {}),
    ...(S.who ? { staffId: S.who.id, staffName: S.who.name, ...(S.who.serverId ? { staffServerId: S.who.serverId } : {}) } : {}),
    discountPercent: S.discountPercent || 0,
    discountReason: S.discountPercent > 0 ? S.discountReason.trim() : '',
    taxMode: S.snap.branch.taxMode || 'INCLUSIVE',
    bill: { subtotal: bill.subtotal, discountAmount: bill.discountAmount, serviceCharge: bill.serviceCharge || 0, tax: bill.tax, total: bill.total },
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
  o.discountReason = S.discountReason || '';
  o.serviceCharge = !!S.serviceCharge;
  o.customer = S.customer.name || S.customer.phone ? { ...S.customer } : undefined;
  o.updatedAt = new Date().toISOString();
  o.items = lines.map((l) => ({ key: keyOf({ ...l, menuItemId: l.item.id }), menuItemId: l.item.id, name: l.item.name, baseName: l.baseName || l.item.name, price: l.item.price, taxRate: l.item.taxRate, qty: l.qty, sent: l.sent || 0, note: l.note || '', ...(l.portion ? { portion: l.portion } : {}), ...(l.mods && l.mods.length ? { mods: l.mods } : {}) }));
  await orders.put(o);
  await kv.set('currentOrderId', o.id);
}
function resetCart() {
  S.cart = new Map();
  S.orderId = null;
  S.discountPercent = 0;
  S.discountReason = '';
  S.table = '';
  S.type = 'TAKEAWAY';
  S.noteOpen = null;
  S.serviceCharge = false;
  S.customer = { name: '', phone: '' };
  kv.del('currentOrderId');
}
function loadOrder(o) {
  S.cart = new Map(
    o.items.map((l) => {
      const key = keyOf(l);
      return [key, { key, item: { id: l.menuItemId, name: l.name, price: l.price, taxRate: l.taxRate, sellOffline: true }, baseName: l.baseName || l.name, qty: l.qty, sent: l.sent || 0, note: l.note || '', portion: l.portion, mods: l.mods || [] }];
    }),
  );
  S.orderId = o.id;
  S.serviceCharge = !!o.serviceCharge;
  S.customer = o.customer ? { name: o.customer.name || '', phone: o.customer.phone || '' } : { name: '', phone: '' };
  S.type = o.type;
  S.table = o.tableLabel || '';
  S.discountPercent = o.discountPercent || 0;
  S.discountReason = o.discountReason || '';
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
    { taxMode: S.snap.branch.taxMode, discountPercent: o.discountPercent || 0, serviceChargePct: o.serviceCharge && can('offlineOptions') ? S.scPct : 0 },
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
        if (sentTo && !(await managerOK(`Cancel order ${o.number}: the kitchen already has KOT ${o.kotNumbers.join(', ')}.`))) return;
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
    // The owner password opens the phone as the owner: a manager for approvals.
    if (staffOn()) S.who = { id: 'owner', name: (S.snap && S.snap.user && S.snap.user.name) || 'Owner', manager: true };
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
          (i) => `<button class="row dishrow" data-edit="${esc(i.id)}"><div class="grow"><b>${esc(i.name)}</b><br><small>${esc(cat(i.categoryId))}${i.taxRate ? ` &middot; tax ${esc(i.taxRate)}%` : ''}${i.soldOut ? ' &middot; <b>Sold out</b>' : i.stock != null ? ` &middot; ${i.stock} in stock` : ''}</small></div><b>${inr(i.price)}</b></button>`,
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
       <label for="dst">Stock <span class="mute">(optional)</span></label><input id="dst" type="number" inputmode="numeric" min="0" step="1" value="${item && item.stock != null ? esc(item.stock) : ''}" placeholder="Leave empty to not count">
       <small class="mute">With a number, each sale takes one off and the dish switches itself off at 0.</small>
       <label class="chk"><input id="dso" type="checkbox" ${item && item.soldOut ? 'checked' : ''}> Sold out for now</label>
       <label for="dh">Half portion price (₹) <span class="mute">(optional)</span></label><input id="dh" type="number" inputmode="decimal" min="0" step="0.01" value="${item && item.halfPrice != null ? esc(item.halfPrice) : ''}" placeholder="Leave empty if there is no half">
       <label for="dad">Add-ons <span class="mute">(optional, one per line: Extra cheese = 30)</span></label><textarea id="dad" rows="3" placeholder="Extra cheese = 30&#10;No onion">${esc(addOnsText(item))}</textarea>
       <label for="dbc">Barcode <span class="mute">(optional, for scanning)</span></label><div class="searchrow"><input id="dbc" inputmode="numeric" value="${esc((item && item.barcode) || '')}" autocomplete="off">${plugins().BarcodeScanner ? '<button class="btn ghost" id="dbcs" type="button">Scan</button>' : ''}</div>
     </div>
     <footer>${item ? '<button class="btn line" id="dd">Delete</button>' : ''}<button class="btn" id="ds">Save</button></footer>`,
    (p) => {
      const dbcs = p.querySelector('#dbcs');
      if (dbcs)
        dbcs.onclick = async () => {
          try {
            const sc = plugins().BarcodeScanner;
            const perm = await sc.requestPermissions();
            if (perm.camera !== 'granted' && perm.camera !== 'limited') return toast('The camera is needed to scan. Type the code instead.');
            const r = await sc.scan({});
            const code = r.barcodes && r.barcodes[0] && r.barcodes[0].rawValue;
            if (code) $('dbc').value = code;
          } catch {
            /* cancelled */
          }
        };
      p.querySelector('#ds').onclick = async () => {
        try {
          if (!(await managerOK(item ? `Change ${item.name} on the menu.` : 'Add a dish to the menu.'))) return;
          S.snap = await upsertDish(S.snap, { id: item && item.id, name: $('dn').value, price: $('dpr').value, taxRate: $('dt').value, isVeg: $('dv').checked, categoryName: $('dc').value, stock: $('dst').value, soldOut: $('dso').checked && !(item && item.stock === 0 && Number($('dst').value) > 0), halfPrice: $('dh').value, barcode: $('dbc').value, addOns: $('dad').value });
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
          if (!(await managerOK(`Delete ${item.name} from the menu.`))) return;
          S.snap = await removeDish(S.snap, item.id);
          for (const [k, l] of S.cart) if (l.item.id === item.id) S.cart.delete(k);
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
    ...(!S.snap.local ? [['shift', 'Shift', ICON.sync]] : []),
    ...(kitchenOn() ? [['kitchen', 'Kitchen', ICON.menu || ICON.sales]] : []),
    ['sales', 'Sales', ICON.sales],
    ['sync', 'Sync', ICON.sync],
  ];
  $('app').innerHTML = `
  <header class="top">
    <h1>${esc(S.snap.branch.name)}</h1>
    ${S.who ? `<button class="who" id="who" type="button" aria-label="${esc(S.who.name)} is using this phone. Switch user">${esc(S.who.name)}</button>` : ''}
    <span class="pill ${S.snap.local || S.online ? 'on' : 'off'}" id="pill"><i></i>${S.snap.local ? 'On this phone' : S.online ? 'Online' : 'Offline'}</span>
  </header>
  <main class="view" id="view"></main>
  <div id="barwrap"></div>
  <nav class="nav" aria-label="Sections">
    ${tabs.map(([k, label, icon]) => `<button data-tab="${k}" ${S.view === k ? 'aria-current="page"' : ''}>${icon}<span>${label}${k === 'sales' && S.pending ? ` <span class="badge">${S.pending}</span>` : ''}${k === 'kitchen' && S.pendingEvents + S.failedEvents ? ` <span class="badge">${S.pendingEvents + S.failedEvents}</span>` : ''}${k === 'sync' && S.failedBooks ? ` <span class="badge">${S.failedBooks}</span>` : ''}</span></button>`).join('')}
  </nav>`;
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  if ($('who')) $('who').onclick = switchUser;
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
  // Kitchen records (and attendance) and table bookings also wait for the server; the phone must say so.
  const all = await events.all();
  const kitchenEv = all.filter((e) => !BOOK_KIND[e.kind]);
  S.pendingEvents = kitchenEv.filter((e) => e.status === 'pending').length;
  S.failedEvents = kitchenEv.filter((e) => e.status === 'failed').length;
  S.pendingBooks = all.filter((e) => BOOK_KIND[e.kind] && e.status === 'pending').length;
  S.failedBooks = all.filter((e) => BOOK_KIND[e.kind] && e.status === 'failed').length;
  S.pendingBookings = (await reservations.all()).filter((b) => b.dirty).length;
}
const waitingText = () => [S.pending && `${S.pending} sale${S.pending === 1 ? '' : 's'}`, S.pendingEvents && `${S.pendingEvents} kitchen/shift record${S.pendingEvents === 1 ? '' : 's'}`, S.pendingBookings && `${S.pendingBookings} booking${S.pendingBookings === 1 ? '' : 's'}`, S.pendingBooks && `${S.pendingBooks} refund/expense/cash record${S.pendingBooks === 1 ? '' : 's'}`].filter(Boolean).join(', ') || 'Nothing';
async function render() {
  if (!S.snap) return renderLogin();
  // With staff set up, a PIN switches someone in (and opens a phone account); the owner password still works.
  if (staffOn() && !S.who && !(S.snap.local && S.unlocked && S.ownerUnlock)) return renderPinLock();
  if (S.snap.local && !S.unlocked) return renderUnlock();
  if (!S.restored) await restoreCurrent();
  await refreshPending();
  await refreshBadges();
  shell();
  ({ sell: viewSell, tables: viewTables, menu: viewMenu, sales: viewSales, sync: viewSync, kitchen: viewKitchen, shift: viewShift })[S.view]();
}

// ------------------------------------------------------------------- staff ---
// A shared phone: each person switches in with their own PIN (kept as a salted hash, never sent anywhere). With
// nobody set up, nothing here is asked: the phone behaves as before.
const staffOn = () => S.staff.some((p) => p.active !== false);
async function loadStaff() {
  S.staff = (await kv.get('staff')) || [];
  S.scPct = Number(await kv.get('serviceChargePct')) || 0;
  S.caps = (await kv.get('serverCaps')) || {};
  S.autoLockMin = Number(await kv.get('autoLockMin')) || 0;
  if (S.who && !S.staff.some((p) => p.id === S.who.id && p.active !== false)) S.who = null;
}
async function saveStaff() {
  await kv.set('staff', S.staff);
}

/** A PIN pad in its own layer, on top of any open sheet. Resolves with the person whose PIN it is, or null. */
function pinPrompt({ title, hint = '', managerOnly = false }) {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'pinlayer';
    box.innerHTML = `<form class="panel" role="dialog" aria-modal="true" aria-labelledby="pin-t" novalidate>
      <header><h2 id="pin-t">${esc(title)}</h2><button type="button" class="x" data-x aria-label="Cancel">&times;</button></header>
      <div class="body">${hint ? `<p class="mute">${esc(hint)}</p>` : ''}
        <label for="pin-in">PIN</label><input id="pin-in" type="password" inputmode="numeric" autocomplete="off" maxlength="8" pattern="[0-9]*">
        <p class="note bad" id="pin-err" role="alert" hidden></p></div>
      <footer><button class="btn block" type="submit">OK</button></footer></form>`;
    document.body.appendChild(box);
    const input = box.querySelector('#pin-in');
    const err = box.querySelector('#pin-err');
    const done = (who) => (box.remove(), resolve(who));
    box.querySelector('[data-x]').onclick = () => done(null);
    box.onclick = (e) => {
      if (e.target === box) done(null);
    };
    setTimeout(() => input.focus(), 30);
    box.querySelector('form').onsubmit = async (ev) => {
      ev.preventDefault();
      const lock = lockState(await kv.get('pinTries'));
      const say = (t) => ((err.textContent = t), (err.hidden = false), (input.value = ''), input.focus());
      if (lock.locked) return say(`Too many wrong PINs. Try again in ${lock.waitSeconds} s.`);
      const who = await whoHasPin(S.staff, input.value);
      if (!who || (managerOnly && !who.manager)) {
        await kv.set('pinTries', afterWrong(await kv.get('pinTries')));
        return say(who ? `${who.name} is not a manager. A manager has to enter their PIN.` : 'That PIN is not right.');
      }
      await kv.set('pinTries', afterRight());
      done(who);
    };
  });
}

/** For things a cashier may not do alone: true straight away for a manager (or with no staff set up), else asks one. */
async function managerOK(why) {
  if (!needsManager(S.staff, S.who)) return true;
  if (document.querySelector('.pinlayer')) return false; // one approval at a time
  const m = await pinPrompt({ title: 'Manager approval', hint: why, managerOnly: true });
  if (m) toast(`Approved by ${m.name}`);
  return !!m;
}

/** Full-screen lock: someone has to switch in before the phone can be used. */
function renderPinLock(message) {
  $('app').innerHTML = `
  <form class="login" id="pl" novalidate>
    <img src="../assets/logo.png" alt="">
    <h1 class="center">Who is using this phone?</h1>
    <p class="mute center">Enter your PIN.</p>
    ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
    <label for="pin">PIN</label>
    <input id="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" pattern="[0-9]*" autofocus>
    <button class="btn block mt" type="submit">Switch in</button>
    ${S.snap && S.snap.local ? '<p class="center mt"><a href="#" id="owner" class="mute">Use the owner password instead</a></p>' : ''}
  </form>`;
  setTimeout(() => $('pin') && $('pin').focus(), 30);
  if ($('owner')) $('owner').onclick = (e) => (e.preventDefault(), (S.ownerUnlock = true), renderUnlock());
  $('pl').onsubmit = async (ev) => {
    ev.preventDefault();
    const lock = lockState(await kv.get('pinTries'));
    if (lock.locked) return renderPinLock(`Too many wrong PINs. Try again in ${lock.waitSeconds} s.`);
    const who = await whoHasPin(S.staff, $('pin').value);
    if (!who) {
      await kv.set('pinTries', afterWrong(await kv.get('pinTries')));
      return renderPinLock('That PIN is not right.');
    }
    await kv.set('pinTries', afterRight());
    S.who = { id: who.id, name: who.name, manager: !!who.manager, serverId: who.serverId };
    S.unlocked = true;
    S.lastTouch = Date.now();
    S.note = { text: `Hello ${who.name}.` };
    render();
  };
}

async function switchUser() {
  await flushPersist();
  S.who = null;
  S.cart = new Map();
  S.orderId = null;
  S.restored = false;
  closeSheet();
  render();
}

// Idle lock: with staff set up and an auto-lock time chosen, the phone asks for a PIN again after that long untouched.
S.lastTouch = Date.now();
['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, () => (S.lastTouch = Date.now()), { capture: true, passive: true }));
setInterval(() => {
  if (S.who && staffOn() && S.autoLockMin > 0 && Date.now() - S.lastTouch > S.autoLockMin * 60000 && !document.querySelector('.pinlayer')) switchUser();
}, 20000);

/** Staff and their PINs. Server-linked phones list the server's staff; a phone account adds its own people. */
async function staffSheet(message) {
  if (staffOn() && !(await managerOK('Only a manager can change staff and PINs.'))) return;
  const server = !S.snap.local ? S.snap.staff || [] : [];
  // Server staff without a PIN yet are listed so a manager can give them one.
  const rows = [...S.staff, ...server.filter((u) => !S.staff.some((p) => p.serverId === u.id)).map((u) => ({ id: `srv-${u.id}`, serverId: u.id, name: u.name, manager: !!u.manager, role: u.role, nopin: true }))].sort((a, b) => Number(!!b.manager) - Number(!!a.manager)); // managers first: the first PIN must be one
  openSheet(
    `${head('Staff & PINs')}
     <div class="body">
       ${message ? `<div class="note ${message.kind || ''}" role="status">${esc(message.text)}</div>` : ''}
       <p class="mute">Each person switches in with their own PIN, so every bill shows who took it. Discounts, refunds, cancelling sent dishes, cash and menu changes then need a manager's PIN.${S.snap.local ? '' : ' Names and roles come from the server; PINs stay on this phone.'}</p>
       ${rows.length ? rows.map((p) => `<div class="row"><div class="grow"><b>${esc(p.name)}</b><br><small>${p.manager ? 'Manager' : 'Staff'}${p.role ? ` &middot; ${esc(p.role)}` : ''}${p.nopin ? ' &middot; no PIN yet' : p.active === false ? ' &middot; switched off' : ''}</small></div><button class="btn line" data-p="${esc(p.id)}" style="min-height:40px">${p.nopin ? 'Set PIN' : 'Change'}</button></div>`).join('') : '<p class="mute center">Nobody yet.</p>'}
       ${S.snap.local ? '<button class="btn block mt" id="addp">Add a person</button>' : ''}
       ${staffOn() ? '<label for="al" class="mt">Lock when not used for</label><select id="al"><option value="0">Never</option><option value="2">2 minutes</option><option value="5">5 minutes</option><option value="15">15 minutes</option></select>' : ''}
     </div>`,
    (p) => {
      if (p.querySelector('#al')) {
        p.querySelector('#al').value = String(S.autoLockMin || 0);
        p.querySelector('#al').onchange = async (e) => ((S.autoLockMin = Number(e.target.value)), await kv.set('autoLockMin', S.autoLockMin));
      }
      if (p.querySelector('#addp')) p.querySelector('#addp').onclick = () => personSheet(null);
      p.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => personSheet(rows.find((r) => r.id === b.dataset.p))));
    },
  );
}

function personSheet(person, message, draft = {}) {
  const isNew = !person || person.nopin;
  const firstOne = !staffOn();
  // After a refused save the form comes back with what was typed (never the PIN itself).
  const draftName = draft.name ?? (person ? person.name : '');
  const draftMgr = draft.manager ?? (person ? !!person.manager : firstOne);
  const fromServer = person && person.serverId;
  openSheet(
    `${head(person && !person.nopin ? `Edit ${person.name}` : person ? `PIN for ${person.name}` : 'Add a person')}
     <form class="body" id="pf" novalidate>
       ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
       ${fromServer ? `<p><b>${esc(person.name)}</b> &middot; ${person.manager ? 'Manager' : 'Staff'} <small class="mute">(from the server)</small></p>` : `<label for="pn">Name</label><input id="pn" value="${esc(draftName)}" maxlength="40" autocomplete="off">
       <label>Role</label><div class="seg" role="group" aria-label="Role"><button type="button" data-r="staff" aria-pressed="${!draftMgr}" ${firstOne && isNew ? 'disabled' : ''}>Staff</button><button type="button" data-r="manager" aria-pressed="${!!draftMgr}">Manager</button></div>
       ${firstOne && isNew ? '<small class="mute">The first person is a manager, so someone can always approve.</small>' : ''}`}
       <label for="pp">${isNew ? 'PIN' : 'New PIN'} <span class="mute">(4 to 8 digits${isNew ? '' : ', leave empty to keep'})</span></label><input id="pp" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password">
       <label for="pp2">Same PIN again</label><input id="pp2" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password">
       <button class="btn block mt" type="submit">Save</button>
       ${person && !person.nopin ? `<button class="btn line block mt" type="button" id="toggle">${person.active === false ? 'Switch on again' : 'Switch off (keeps their past sales)'}</button>` : ''}
     </form>`,
    (p) => {
      let manager = draftMgr;
      p.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => ((manager = b.dataset.r === 'manager'), p.querySelectorAll('[data-r]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))))));
      const tg = p.querySelector('#toggle');
      if (tg)
        tg.onclick = async () => {
          const mgrsLeft = S.staff.filter((x) => x.id !== person.id && x.manager && x.active !== false).length;
          if (person.active !== false && person.manager && !mgrsLeft && S.staff.some((x) => x.id !== person.id && x.active !== false)) return personSheet(person, 'Keep at least one manager switched on.', { name, manager });
          S.staff = S.staff.map((x) => (x.id === person.id ? { ...x, active: x.active === false } : x));
          await saveStaff();
          booksDirty = true;
          staffSheet({ text: `${person.name} switched ${person.active === false ? 'on' : 'off'}.` });
        };
      p.querySelector('#pf').onsubmit = async (ev) => {
        ev.preventDefault();
        const name = fromServer ? person.name : ($('pn').value || '').trim();
        const pin = $('pp').value;
        if (!name) return personSheet(person, 'Enter the name.', { name, manager });
        // The first PIN on this phone must belong to a manager: after it the phone asks a manager to approve changes, and
        // with only a cashier's PIN nobody could (a server-linked phone cannot promote a server cashier itself).
        if (firstOne && !(fromServer ? person.manager : manager)) return personSheet(person, 'Set a manager\'s PIN first, so someone can approve discounts, refunds and staff changes.', { name, manager });
        if (isNew || pin) {
          if (!validPin(pin)) return personSheet(person, 'The PIN must be 4 to 8 digits.', { name, manager });
          if (weakPin(pin)) return personSheet(person, 'That PIN is too easy to guess (like 1111 or 1234). Choose another.', { name, manager });
          if (pin !== $('pp2').value) return personSheet(person, 'The two PINs are not the same.', { name, manager });
          if (await pinTaken(S.staff, pin, person && person.id)) return personSheet(person, 'Someone else already uses that PIN. Choose another.', { name, manager });
        }
        if (!fromServer && person && person.manager && !manager && !S.staff.some((x) => x.id !== person.id && x.manager && x.active !== false)) return personSheet(person, 'Keep at least one manager.', { name, manager });
        const pinRec = pin ? await hashPin(pin) : person && person.pin;
        const id = person && !person.nopin ? person.id : `st-${newId()}`;
        const rec = { id, name, manager: fromServer ? !!person.manager : manager, pin: pinRec, active: person && person.active === false ? false : true, ...(fromServer ? { serverId: person.serverId } : {}) };
        S.staff = [...S.staff.filter((x) => x.id !== id), rec];
        await saveStaff();
        booksDirty = true; // redraw the header (who is on the phone) when the sheet closes
        if (firstOne) S.who = { id: rec.id, name: rec.name, manager: rec.manager, serverId: rec.serverId };
        staffSheet({ text: `${name} saved.${firstOne ? ' From now on this phone asks for a PIN.' : ''}` });
      };
    },
  );
}

/** Server-linked phones: keep names and manager flags in step with the server's staff list. */
async function syncStaffFromServer() {
  if (!S.snap || S.snap.local || !Array.isArray(S.snap.staff)) return;
  let changed = false;
  S.staff = S.staff.map((p) => {
    const u = p.serverId && S.snap.staff.find((x) => x.id === p.serverId);
    if (!p.serverId) return p;
    if (!u) return p.active === false ? p : ((changed = true), { ...p, active: false }); // left the restaurant
    if (u.name !== p.name || !!u.manager !== !!p.manager) return ((changed = true), { ...p, name: u.name, manager: !!u.manager });
    return p;
  });
  if (changed) await saveStaff();
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
    ${items.length ? `<div class="searchrow"><input class="search" id="q" type="search" enterkeyhint="go" placeholder="Search, or type / scan a barcode" value="${esc(S.q)}" aria-label="Search the menu or enter a barcode">${plugins().BarcodeScanner ? '<button class="btn ghost" id="scan" type="button" aria-label="Scan a barcode with the camera">Scan</button>' : ''}</div>` : ''}
    <div class="chips" role="group" aria-label="Categories" ${items.length ? '' : 'hidden'}>
      <button class="chip" data-cat="all" aria-pressed="${S.category === 'all'}">All</button>
      ${categories.map((c) => `<button class="chip" data-cat="${esc(c.id)}" aria-pressed="${S.category === c.id}">${esc(c.name)}</button>`).join('')}
    </div>
    <div class="grid dishes">
      ${shown.map((i) => `<button class="dish${qtyOf(i.id) ? ' in' : ''}" data-add="${esc(i.id)}" ${i.sellOffline && !i.soldOut ? '' : 'disabled'}>
          <b><span class="veg ${i.isVeg ? '' : 'nv'}"></span>${esc(i.name)}</b>
          <span>${inr(i.price)}${i.halfPrice != null ? ` <small>/ half ${inr(i.halfPrice)}</small>` : ''}</span>${qtyOf(i.id) ? `<strong class="cnt"><span class="sr">In cart: </span>&times;${qtyOf(i.id)}</strong>` : ''}
          ${i.soldOut ? '<small>Sold out</small>' : i.sellOffline ? (i.stock != null && i.stock <= 5 ? `<small>${i.stock} left</small>` : needsChoice(i) ? '<small>Choose options</small>' : '') : '<small>Combo: use the full app</small>'}
        </button>`).join('') || (S.snap.local && !S.snap.items.length ? '<div class="empty"><b>Your menu is empty</b><p class="mute">Add your first dish to start selling.</p><button class="btn" data-setup="menu">Add a dish</button></div>' : '<p class="mute center mt empty">Nothing matches.</p>')}
    </div>`;
  bindSetup();
  if ($('q')) {
    $('q').oninput = (e) => {
      S.q = e.target.value;
      viewSell();
      $('q').focus();
      $('q').setSelectionRange(S.q.length, S.q.length);
    };
    // Enter: an exact barcode/SKU (what a USB or Bluetooth scanner types), else the only dish that matches.
    $('q').onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const hit = findByCode(S.snap.items, S.q) || (shown.length === 1 ? shown[0] : null);
      if (!hit) return toast(S.q.trim() ? `Nothing on the menu has the code or name "${S.q.trim()}".` : 'Type a dish name or a barcode.');
      S.q = '';
      tapDish(hit);
    };
  }
  if ($('scan')) $('scan').onclick = scanBarcode;
  document.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => ((S.category = b.dataset.cat), viewSell())));
  document.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => tapDish(S.snap.items.find((i) => i.id === b.dataset.add))));
  renderBar();
}

/** A dish was tapped (or scanned): straight into the cart, or the options sheet first. */
function tapDish(item) {
  if (!item) return;
  if (!item.sellOffline) return toast(`${item.name} is a combo: sell it from the full app.`);
  if (item.soldOut) return toast(`${item.name} is sold out.`);
  if (needsChoice(item)) return optionsSheet(item);
  addLine(item, buildChoice(item, {}).line);
}

function addLine(item, line, qty = 1) {
  if (item.stock != null && qtyOf(item.id) + qty > item.stock) return toast(`Only ${item.stock} left in stock`);
  const cur = S.cart.get(line.key) || { ...line, baseName: item.name, qty: 0 };
  cur.qty += qty;
  S.cart.set(line.key, cur);
  if (S.view === 'sell' && $('sheet').hidden) viewSell();
  renderBar();
  navigator.vibrate && navigator.vibrate(10);
}

/** Half or full, and the add-ons, for one dish. */
function optionsSheet(item, picks = defaultPicks(item), errors = {}, qty = 1) {
  const choice = buildChoice(item, picks);
  const price = choice.ok ? choice.line.item.price : null;
  openSheet(
    `<header><h2>${esc(item.name)}</h2><button class="x" data-close aria-label="Close">&times;</button></header>
     <div class="body">
       ${item.halfPrice != null ? `<fieldset class="opt"><legend>Portion</legend><div class="seg" role="group" aria-label="Portion">
         <button type="button" data-portion="FULL" aria-pressed="${picks.portion !== 'HALF'}">Full &middot; ${inr(item.price)}</button>
         <button type="button" data-portion="HALF" aria-pressed="${picks.portion === 'HALF'}">Half &middot; ${inr(item.halfPrice)}</button></div></fieldset>` : ''}
       ${(item.options || [])
         .map((g) => {
           const single = g.max === 1;
           const hint = g.min > 0 ? (single ? 'Choose one' : `Choose ${g.min}${g.max > g.min ? ` to ${g.max}` : ''}`) : `Optional${g.max < g.choices.length ? `, up to ${g.max}` : ''}`;
           return `<fieldset class="opt" aria-describedby="h-${esc(g.id)}"><legend>${esc(g.name)} <small id="h-${esc(g.id)}" class="mute">${hint}</small></legend>
             ${errors[g.id] ? `<p class="note bad" role="alert">${esc(errors[g.id])}</p>` : ''}
             ${g.choices
               .map((c) => `<label class="chk optrow"><input type="${single ? 'radio' : 'checkbox'}" name="g-${esc(g.id)}" data-g="${esc(g.id)}" value="${esc(c.id)}" ${(picks.chosen[g.id] || []).includes(c.id) ? 'checked' : ''}> <span class="grow">${esc(c.name)}</span>${c.price ? `<small>+${inr(c.price)}</small>` : ''}</label>`)
               .join('')}</fieldset>`;
         })
         .join('')}
       <div class="row mt"><span class="grow">Quantity</span><div class="qty"><button type="button" id="oqdown" aria-label="One less">&minus;</button><b>${qty}</b><button type="button" id="oqup" aria-label="One more">+</button></div></div>
     </div>
     <footer><button class="btn block" id="oadd">${price != null ? `Add ${qty > 1 ? `${qty} &middot; ` : ''}${inr(price * qty)}` : 'Add'}</button></footer>`,
    (p) => {
      const read = () => {
        const chosen = {};
        for (const g of item.options || []) chosen[g.id] = [...p.querySelectorAll(`[data-g="${CSS.escape(g.id)}"]:checked`)].map((x) => x.value);
        return { ...picks, chosen };
      };
      p.querySelectorAll('[data-portion]').forEach((b) => (b.onclick = () => optionsSheet(item, { ...read(), portion: b.dataset.portion }, {}, qty)));
      p.querySelectorAll('[data-g]').forEach((x) => (x.onchange = () => optionsSheet(item, read(), {}, qty)));
      p.querySelector('#oqdown').onclick = () => optionsSheet(item, read(), {}, Math.max(1, qty - 1));
      p.querySelector('#oqup').onclick = () => optionsSheet(item, read(), {}, Math.min(99, qty + 1));
      p.querySelector('#oadd').onclick = () => {
        const r = buildChoice(item, read());
        if (!r.ok) return optionsSheet(item, read(), r.errors, qty);
        closeSheet();
        addLine(item, r.line, qty);
        if (S.view === 'sell') viewSell();
      };
    },
  );
}

/** Camera barcode scan (the app's ML Kit scanner): the dish with that barcode or SKU goes into the cart. */
async function scanBarcode() {
  const sc = plugins().BarcodeScanner;
  if (!sc) return;
  try {
    const perm = await sc.requestPermissions();
    if (perm.camera !== 'granted' && perm.camera !== 'limited') return toast('The camera is needed to scan. You can type the code in the search box instead.', 4000);
    const r = await sc.scan({});
    const code = r.barcodes && r.barcodes[0] && r.barcodes[0].rawValue;
    if (!code) return;
    const hit = findByCode(S.snap.items, code);
    if (!hit) return toast(`No dish has the barcode ${code}. Add it to the dish first.`, 4000);
    tapDish(hit);
  } catch (e) {
    if (!/cancel/i.test(String(e && e.message))) toast('Could not scan. Type the code in the search box instead.');
  }
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
            <div class="qty"><button data-dec="${esc(l.key)}" aria-label="One less ${esc(l.item.name)}">&minus;</button><b>${l.qty}</b><button data-inc="${esc(l.key)}" aria-label="One more ${esc(l.item.name)}">+</button></div>
            <b style="min-width:5.5rem;text-align:right">${inr(l.item.price * l.qty)}</b></div>
            <div style="padding:.2rem 0 .5rem;border-bottom:1px solid var(--line)">${S.noteOpen === l.key ? `<input data-note="${esc(l.key)}" maxlength="80" value="${esc(l.note || '')}" placeholder="e.g. no onion, less spicy" aria-label="Note for ${esc(l.item.name)}">` : `<button class="chip sm" data-opennote="${esc(l.key)}">${l.note ? `Note: ${esc(l.note)}` : '+ Note'}</button>`}${l.sent ? ` <small class="mute">${l.sent} on a KOT</small>` : ''}</div>`,
          )
          .join('')}</div>
        <label for="dp">Discount %</label><input id="dp" type="number" inputmode="decimal" min="0" max="${esc(S.snap.restaurant.maxManualDiscountPercent)}" value="${S.discountPercent || ''}" placeholder="0">
        ${S.discountPercent > 0 ? `<label for="dr">Reason for the discount${S.snap.restaurant.requireDiscountReason ? '' : ' (optional)'}</label><input id="dr" maxlength="200" value="${esc(S.discountReason)}" ${S.snap.restaurant.requireDiscountReason ? 'required' : ''} autocomplete="off" enterkeyhint="done">` : ''}
        ${S.scPct > 0 && can('offlineOptions') ? `<label class="chk mt"><input type="checkbox" id="sc" ${S.serviceCharge ? 'checked' : ''}> Service charge ${esc(S.scPct)}% <small class="mute">(only if the guest agrees)</small></label>` : ''}
        <div class="mt">
          <div class="tot"><span>Subtotal</span><span>${inr(bill.subtotal)}</span></div>
          ${bill.discountAmount > 0 ? `<div class="tot"><span>Discount</span><span>-${inr(bill.discountAmount)}</span></div>` : ''}
          ${bill.serviceCharge > 0 ? `<div class="tot"><span>Service charge (optional)</span><span>${inr(bill.serviceCharge)}</span></div>` : ''}
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
    root.querySelectorAll('[data-inc]').forEach(
      (b) =>
        (b.onclick = () => {
          const l = S.cart.get(b.dataset.inc);
          const item = S.snap.items.find((i) => i.id === l.item.id);
          if (item && item.stock != null && qtyOf(item.id) >= item.stock) return toast(`Only ${item.stock} left in stock`);
          l.qty++;
          draw();
        }),
    );
    root.querySelectorAll('[data-dec]').forEach(
      (b) =>
        (b.onclick = async () => {
          const l = S.cart.get(b.dataset.dec);
          // Taking off a dish the kitchen already has is a cancellation: a manager says yes on a shared phone.
          if (l.sent && l.qty <= l.sent && !(await managerOK(`Cancel 1 × ${l.item.name}: the kitchen already has it.`))) return;
          l.qty--;
          draw();
        }),
    );
    const sc = root.querySelector('#sc');
    if (sc) sc.onchange = () => ((S.serviceCharge = sc.checked), draw());
    root.querySelector('#dp').onchange = async (e) => {
      const max = Number(S.snap.restaurant.maxManualDiscountPercent) || 100;
      const want = Math.min(Math.max(Number(e.target.value) || 0, 0), max);
      if (want > (S.discountPercent || 0) && !(await managerOK(`Give a ${want}% discount.`))) {
        e.target.value = S.discountPercent || '';
        return;
      }
      S.discountPercent = want;
      draw();
    };
    const dr = root.querySelector('#dr');
    if (dr) dr.oninput = (e) => { S.discountReason = e.target.value; persistSoon(); };
    bindPrint(root, saleFrom('Bill', bill, [], 0), true);
    root.querySelector('#charge').onclick = () => {
      if (S.discountPercent > 0 && S.snap.restaurant.requireDiscountReason && !S.discountReason.trim()) {
        toast('Add a reason for the discount first.', 3500);
        if (dr) dr.focus();
        return;
      }
      openPay();
    };
  };
  openSheet('', draw);
  draw();
  $('sheet').onclick = (e) => {
    // Block body on purpose: an onclick that returns false cancels the click (it stopped checkboxes in the cart working).
    if (e.target === $('sheet')) (closeSheet(), renderBar(), viewSell());
  };
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
        <details class="mt" ${S.customer.phone || S.customer.name || !st.fullyPaid ? 'open' : ''}><summary>Customer ${S.customer.name || S.customer.phone ? `&middot; ${esc(S.customer.name || S.customer.phone)}` : '<span class="mute">(optional)</span>'}</summary>
          <label for="cn">Name</label><input id="cn" autocomplete="off" maxlength="100" value="${esc(S.customer.name)}" list="custs">
          <label for="cph">Phone</label><input id="cph" type="tel" inputmode="tel" autocomplete="off" maxlength="20" value="${esc(S.customer.phone)}" list="custph">
          <datalist id="custs">${knownCustomers.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist>
          <datalist id="custph">${knownCustomers.map((c) => `<option value="${esc(c.phone)}">${esc(c.name)}</option>`).join('')}</datalist>
        </details>
        <div class="mt">
          ${st.change > 0 ? `<div class="tot big" style="color:var(--ok)"><span>Change to give</span><span>${inr(st.change)}</span></div>` : ''}
          ${!st.fullyPaid ? `<div class="tot big" style="color:var(--bad)"><span>Still to pay</span><span>${inr(st.balance)}</span></div>` : ''}
        </div>
      </div>
      <footer>${!st.fullyPaid && can('offlineOptions') ? `<button class="btn line" id="later" ${phoneOk(S.customer.phone) ? '' : 'aria-disabled="true"'}>Pay later (${inr(st.balance)} due)</button>` : ''}<button class="btn ${st.fullyPaid ? 'block' : ''}" id="done" ${st.fullyPaid ? '' : 'disabled'}>Complete sale</button></footer>`;
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
    const keepCust = () => {
      S.customer = { name: root.querySelector('#cn').value, phone: root.querySelector('#cph').value };
      persistSoon();
    };
    root.querySelector('#cn').oninput = keepCust;
    root.querySelector('#cph').oninput = () => {
      keepCust();
      const known = knownCustomers.find((c) => c.phone === S.customer.phone.trim());
      if (known && !S.customer.name.trim()) root.querySelector('#cn').value = S.customer.name = known.name;
      const later = root.querySelector('#later');
      if (later) later.setAttribute('aria-disabled', String(!phoneOk(S.customer.phone)));
    };
    const later = root.querySelector('#later');
    if (later)
      later.onclick = async () => {
        keepCust();
        if (!phoneOk(S.customer.phone)) {
          toast('Enter the customer\'s phone number to let them pay later.', 3500);
          return root.querySelector('#cph').focus();
        }
        if (!(await managerOK(`Let ${S.customer.name || S.customer.phone} pay ${inr(st.balance)} later.`))) return;
        complete(st, tenders, { payLater: true });
      };
  };
  const phoneOk = (v) => String(v || '').replace(/\D/g, '').length >= 10;
  let knownCustomers = [];
  sales.all().then((all) => {
    const m = new Map();
    for (const x of all) if (x.customer && x.customer.phone && !m.has(x.customer.phone)) m.set(x.customer.phone, { name: x.customer.name || '', phone: x.customer.phone });
    knownCustomers = [...m.values()].slice(0, 200);
  });
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
  async function complete(st, tenders, { payLater = false } = {}) {
    if (!st.fullyPaid && !payLater) return;
    if (payLater && !phoneOk(S.customer.phone)) return;
    await flushPersist();
    const number = await nextLocalNumber();
    const sale = saleFrom(number, bill, st.rows.map((r) => ({ ...r })), st.change);
    if (payLater) sale.payLater = true;
    sale.note = saleNote(sale.items);
    await sales.put(sale);
    if (S.snap.local) S.snap = await useStock(S.snap, sale.items);
    const o = S.orderId ? await orders.get(S.orderId) : null;
    if (o) await orders.put({ ...o, status: 'PAID', saleId: sale.id, paidAt: new Date().toISOString() }); // frees the table
    resetCart();
    toast(payLater ? `Saved. ${inr(dueOf(sale))} to collect later.` : 'Sale saved');
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
       ${dueOf(sale) > 0 ? `<div class="note warn"><b>${inr(dueOf(sale))} to collect later</b> from ${esc(sale.customer.name || sale.customer.phone)}. Find it under Sales &rsaquo; Money owed.</div>` : ''}
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
  const owed = dueSales(all);
  const owedTotal = owed.reduce((n, x) => n + dueOf(x), 0);
  $('view').innerHTML = `
    ${reportCard}
    ${owed.length ? `<button class="card mt owed" id="owed" style="width:100%;text-align:left"><b>Money owed</b> <span class="badge">${owed.length}</span><div class="tot big"><span>${owed.length} bill${owed.length === 1 ? '' : 's'} to collect</span><span>${inr(owedTotal)}</span></div></button>` : ''}
    <button class="btn line block mt" id="books">Books &amp; backup: expenses, close the day, reports</button>
    ${S.pending ? `<div class="note warn" role="status">${S.pending} sale${S.pending > 1 ? 's' : ''} saved on this phone, not on the server yet.</div>` : ''}
    ${nAttention ? `<div class="note bad" role="status">${nAttention} sale${nAttention > 1 ? 's were' : ' was'} refused by the server and still need${nAttention > 1 ? '' : 's'} a decision. Open ${nAttention > 1 ? 'each' : 'it'} to retry or set aside.</div>` : ''}
    ${nReview ? `<div class="note warn" role="status">${nReview} sale${nReview > 1 ? 's were' : ' was'} recorded at a price that differs from the server's menu. Open to see which.</div>` : ''}
    <div class="mt">${
      all
        .map(
          (s) => `<button class="row" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line);text-align:left" data-sale="${esc(s.id)}">
            <div class="grow"><b>${esc(s.localNumber)}</b>${s.serverOrderNumber ? ` <small>#${esc(s.serverOrderNumber)}</small>` : ''}${refundedTotal(s, rfs) ? ' <small style="color:var(--bad)">Refunded</small>' : ''}${dueOf(s) > 0 ? ` <small style="color:var(--warn)">Owes ${inr(dueOf(s))}</small>` : ''}<br><small>${esc(new Date(s.soldAt).toLocaleString())} &middot; ${s.items.reduce((n, i) => n + i.quantity, 0)} items${s.customer ? ` &middot; ${esc(s.customer.name || s.customer.phone)}` : ''}${s.staffName ? ` &middot; ${esc(s.staffName)}` : ''}</small></div>
            <div style="text-align:right"><b>${inr(s.bill.total)}</b><br><span class="status ${s.status}">${label[s.status]}</span></div></button>`,
        )
        .join('') || '<p class="mute center mt">No sales on this phone yet.</p>'
    }</div>`;
  $('books').onclick = booksMenu;
  if ($('owed')) $('owed').onclick = duesSheet;
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
             ${s.customer ? `<p class="mute">For ${esc([s.customer.name, s.customer.phone].filter(Boolean).join(' · '))}</p>` : ''}${s.staffName ? `<p class="mute">Taken by ${esc(s.staffName)}</p>` : ''}
             ${s.items.map((i) => `<div class="tot"><span>${i.quantity} &times; ${esc(i.name)}</span><span>${inr(i.price * i.quantity)}</span></div>`).join('')}
             ${s.bill.serviceCharge ? `<div class="tot"><span>Service charge (optional)</span><span>${inr(s.bill.serviceCharge)}</span></div>` : ''}
             <div class="tot big mt"><span>Total</span><span>${inr(s.bill.total)}</span></div>
             ${(s.collections || []).map((c) => `<div class="tot mute"><span>Collected ${esc(new Date(c.at).toLocaleDateString())} (${esc(METHOD_LABEL[c.method] || c.method)})</span><span>${inr(c.amount)}</span></div>`).join('')}
             ${dueOf(s) > 0 ? `<div class="tot big" style="color:var(--warn)"><span>Still owed</span><span>${inr(dueOf(s))}</span></div><button class="btn block mt" id="collect">Collect payment</button>` : ''}
             ${refundedTotal(s, rfs) ? `<div class="tot" style="color:var(--bad)"><span>Refunded</span><span>&minus;${inr(refundedTotal(s, rfs))}</span></div>${rfs.filter((r) => r.saleId === s.id).map((r) => `<small class="mute">${esc(new Date(r.at).toLocaleString())} &middot; ${esc(METHOD_LABEL[r.method] || r.method)} &middot; ${r.lines.map((l) => `${l.qty} &times; ${esc(l.name)}`).join(', ')}${r.reason ? ` &middot; ${esc(r.reason)}` : ''}</small>`).join('<br>')}` : ''}
             ${dueOf(s) === 0 && s.status !== 'refused' && s.status !== 'dismissed' && refundableLines(s, rfs).some((l) => l.left > 0) ? '<button class="btn line block mt" id="refund">Refund…</button>' : ''}
             <div class="mt">${printActions()}</div>
           </div>`,
          (p) => {
            bindPrint(p, s, false);
            if (p.querySelector('#refund')) p.querySelector('#refund').onclick = () => refundSheet(s.id);
            if (p.querySelector('#collect')) p.querySelector('#collect').onclick = () => collectSheet(s.id);
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

// -------------------------------------------------------------- money owed ---
async function duesSheet() {
  const owed = dueSales(await sales.all());
  // One customer, one line: the same phone number may owe on several bills.
  const byCust = new Map();
  for (const x of owed) {
    const k = (x.customer && x.customer.phone) || x.id;
    const g = byCust.get(k) || { name: (x.customer && x.customer.name) || '', phone: (x.customer && x.customer.phone) || '', bills: [] };
    g.bills.push(x);
    byCust.set(k, g);
  }
  openSheet(
    `${head('Money owed')}
     <div class="body">
       ${[...byCust.values()]
         .map(
           (g) => `<h3 style="margin:1rem 0 .2rem">${esc(g.name || g.phone)} <small class="mute">${esc(g.name ? g.phone : '')}</small> <span style="float:right">${inr(g.bills.reduce((n, b) => n + dueOf(b), 0))}</span></h3>
           ${g.bills.map((b) => `<button class="row" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line);text-align:left" data-c="${esc(b.id)}"><div class="grow"><b>${esc(b.localNumber)}</b><br><small>${esc(new Date(b.soldAt).toLocaleDateString())} &middot; bill ${inr(b.bill.total)}</small></div><b>${inr(dueOf(b))}</b></button>`).join('')}`,
         )
         .join('') || '<p class="mute center">Nobody owes anything.</p>'}
     </div>`,
    (p) => p.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => collectSheet(b.dataset.c))),
  );
}

async function collectSheet(saleId, message, draft = {}) {
  const sale = await sales.get(saleId);
  const due = dueOf(sale);
  const method = draft.method || 'CASH';
  openSheet(
    `${head(`Collect on ${sale.localNumber}`)}
     <div class="body">
       ${message ? `<div class="note bad" role="alert">${esc(message)}</div>` : ''}
       <p>${esc([sale.customer && sale.customer.name, sale.customer && sale.customer.phone].filter(Boolean).join(' · '))}</p>
       <div class="tot big"><span>Owed</span><span>${inr(due)}</span></div>
       <label>Paid by</label><div class="seg" role="group" aria-label="Paid by">${Object.entries(METHOD_LABEL).map(([m, l]) => `<button type="button" data-m="${m}" aria-pressed="${method === m}">${l}</button>`).join('')}</div>
       <label for="ca">Amount received (₹)</label><input id="ca" type="number" inputmode="decimal" min="0" step="0.01" value="${esc(draft.amount ?? due)}">
       <label for="cr">Reference <span class="mute">(optional)</span></label><input id="cr" value="${esc(draft.reference || '')}" placeholder="UPI or card transaction id">
     </div>
     <footer><button class="btn block" id="go">Record payment</button></footer>`,
    (p) => {
      let m = method;
      p.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => ((m = b.dataset.m), p.querySelectorAll('[data-m]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))))));
      p.querySelector('#go').onclick = async () => {
        const keep = { method: m, amount: $('ca').value, reference: $('cr').value };
        try {
          const fresh = await sales.get(saleId); // never collect twice on a stale copy
          const c = buildCollection({ id: newId(), sale: fresh, method: m, amount: $('ca').value, reference: $('cr').value });
          if (!S.snap.local && fresh.status === 'synced') {
            // The server already has the bill: this payment is sent on its own (safe to resend).
            const ev = await queueEvent('collect', { saleId: fresh.id, payments: [{ method: c.method, amount: c.amount, ...(c.tendered ? { tendered: c.tendered } : {}), ...(c.reference ? { reference: c.reference } : {}) }] }, { userId: S.snap.user.id, deviceId: await kv.get('deviceId') });
            c.eventId = ev.id;
          }
          if (S.who) c.by = S.who.name;
          fresh.collections = [...(fresh.collections || []), c];
          await sales.put(fresh);
          booksDirty = true;
          toast(`${inr(c.amount)} received${c.change ? `, give change ${inr(c.change)}` : ''}.${dueOf(fresh) > 0 ? ` Still owed ${inr(dueOf(fresh))}.` : ' Bill fully paid.'}`, 4500);
          closeSheet();
          render();
          if (!S.snap.local) syncNow({ refreshMenu: false }).then(afterSync);
        } catch (e) {
          collectSheet(saleId, e.message, keep);
        }
      };
    },
  );
}

// ------------------------------------------------------------------- books ---
// Refunds, expenses, closing the day, reports, export and backup. On a phone
// account it all stays on the phone; on a server-linked phone refunds,
// expenses, money collected later and the day's cash count are also sent to
// the server (lib/journal.js, each safe to resend).
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
       <p class="mute mt">${S.snap.local ? 'Refunds, expenses and cash counts are kept on this phone. It saves a backup by itself once a day (see Sync); copy those files off the phone now and then.' : 'Refunds, expenses, money collected later and the day\'s cash count are sent to the server as well.'}</p>
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
          if (!(await managerOK('Restore a backup (replaces everything on this phone).'))) return;
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
          const e = buildExpense({ id: newId(), ...grab() });
          if (S.who) e.by = S.who.name;
          if (!S.snap.local) {
            const ev = await queueEvent('expense', { spentOn: today(), note: e.note, category: e.category || undefined, amount: e.amount, paidFromCash: e.method === 'CASH' }, { userId: S.snap.user.id, deviceId: await kv.get('deviceId') });
            e.eventId = ev.id;
          }
          await expenses.put(e);
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
            const e = list.find((x) => x.id === b.dataset.del);
            const ev = e && e.eventId ? await events.get(e.eventId) : null;
            if (ev && ev.status === 'synced') return toast('This expense is already on the server. Ask the owner to delete it there (Accounting).', 5000);
            if (!confirm('Delete this expense? It leaves the books.')) return;
            if (!(await managerOK('Delete an expense.'))) return;
            if (ev) await events.del(ev.id); // never sent: drop it from the queue too
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
         ${books.collected ? line('<small>of which collected on owed bills</small>', `<small>${inr(books.collected)}</small>`) : ''}
         ${books.dueToday ? line('Still owed on today\'s bills', inr(books.dueToday)) : ''}
         ${books.serviceCharge ? line('Service charge (optional)', inr(books.serviceCharge)) : ''}
         ${books.expenseTotal ? line('Expenses', `&minus;${inr(books.expenseTotal)}`) : ''}
         ${line('Left after expenses', `<b>${inr(books.profit)}</b>`)}
       </dl>
       <div class="tot big mt"><span>Cash that should be there</span><span>${inr(books.expectedCash)}</span></div>
       <p class="mute" style="margin:.2rem 0 0">Opening cash + cash taken (sales and money collected) &minus; cash refunds &minus; cash expenses.</p>
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
          const bk = dayBooks({ ...b, float: Number($('fl').value) || 0, day });
          const rec = closeDay({ books: bk, counted: $('cc').value });
          if (!(await managerOK('Close the day (count the cash).'))) return;
          rec.by = S.who ? S.who.name : S.snap.user.name;
          if (!S.snap.local) {
            // This phone's own drawer, kept on the server per phone and day (a later count replaces it).
            await queueEvent('tillclose', { deviceId: await kv.get('deviceId'), deviceName: (await kv.get('deviceName')) || 'Phone', businessDate: day, openingFloat: Number($('fl').value) || 0, cashSales: bk.cashIn, cashRefunds: bk.refundCash, cashExpenses: bk.expenseCash, expectedCash: bk.expectedCash, countedCash: rec.countedCash, netSales: bk.net, closedByName: rec.by, closedAt: rec.closedAt }, { userId: S.snap.user.id, deviceId: await kv.get('deviceId') });
          }
          await shifts.put(rec);
          booksDirty = true;
          const word = rec.difference === 0 ? 'The cash matches.' : rec.difference < 0 ? `Cash is short by ${inr(-rec.difference)}.` : `Cash is over by ${inr(rec.difference)}.`;
          toast(`Day closed. ${word}`, 5000);
          autoBackup(true);
          if (!S.snap.local) syncNow({ refreshMenu: false }).then(afterSync);
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
       <p class="mute">Recorded in this phone's books and taken off the day's sales.${S.snap.local ? ' Dishes are not put back into stock.' : ' It goes to the server too (money only; stock is not put back).'}</p>
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
          if (!(await managerOK(`Refund ${inr(r.amount)} on ${sale.localNumber}.`))) return;
          if (S.who) r.by = S.who.name;
          if (!S.snap.local) {
            // Sent to the server as a money-only refund once the server has the sale (see sync.js).
            const ev = await queueEvent('refund', { saleId: sale.id, amount: r.amount, method: r.method, reason: r.reason || undefined }, { userId: S.snap.user.id, deviceId: await kv.get('deviceId') });
            r.eventId = ev.id;
          }
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
  DISCOUNT_NOT_ALLOWED: 'This account may not give that discount',
  SALE_TOO_OLD: 'This sale is too old to add automatically',
  OTHER: 'The server did not accept this sale',
};
const REFUSAL_HELP = {
  ITEM_UNAVAILABLE: 'Ask the owner to switch the dish back on, then try again.',
  ALREADY_STARTED: 'Ask the owner to check Orders for this sale, then try again or set it aside.',
  PRICE_CONFLICT: 'Set it aside and enter it again from the full app.',
  PAYMENT_REJECTED: 'Ask the owner to check the discount limit or payment, then try again.',
  DISCOUNT_NOT_ALLOWED: 'Ask a manager to enter this sale, or sign in with an account that may give discounts.',
  SALE_TOO_OLD: 'Check this phone\'s date and time, then ask the owner to enter the sale by hand.',
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

// ------------------------------------------------------------ shop settings ---
const BOOK_KIND = { refund: 'Refund', expense: 'Expense', collect: 'Money collected', tillclose: 'Day cash count' };

/** The Settings card on the Sync tab: staff and PINs, the voluntary service charge, and the automatic backup. */
async function settingsCard() {
  const info = await kv.get('autoBackupInfo');
  const np = plugins().NativePrinter;
  const auto = np && np.saveBackup;
  const refused = (await events.all()).filter((e) => BOOK_KIND[e.kind] && e.status === 'failed');
  return `${refused.length ? `<div class="card mt"><h2 style="font-size:1.05rem">Refused by the server</h2>${refused
      .map((e) => `<div class="row"><div class="grow"><b>${BOOK_KIND[e.kind]}</b>${e.payload.amount ? ` ${inr(e.payload.amount || e.payload.countedCash || 0)}` : ''}<br><small class="mute">${esc(new Date(e.createdAt).toLocaleString())}</small><div class="note bad">${esc(e.error || 'Refused')}</div></div><div><button class="btn ghost" data-evretry="${esc(e.id)}">Try again</button><button class="btn line mt" data-evaside="${esc(e.id)}">Set aside</button></div></div>`)
      .join('')}</div>` : ''}
    ${!S.snap.local && !can('offlineOptions') ? `<div class="note warn mt" role="status">Your server${S.caps.version && S.caps.version !== 'unknown' ? ` (version ${esc(S.caps.version)})` : ''} is older than this app. Pay later, the service charge, half portions and add-ons, and sending refunds, expenses and cash counts need OrderRestro server 1.38 or newer. Refunds and expenses stay on this phone and are sent once the server is updated.</div>` : ''}
    <div class="card mt">
      <h2 style="font-size:1.05rem">Shop settings</h2>
      <button class="btn line block" id="st-staff">Staff &amp; PINs${S.staff.length ? ` (${S.staff.filter((p) => p.active !== false).length})` : ''}</button>
      <label for="st-sc" class="mt">Service charge offered (%)</label>
      <input id="st-sc" type="number" inputmode="decimal" min="0" max="25" step="0.5" value="${S.scPct || ''}" placeholder="0 = off">
      <small class="mute">Never added by itself: the cashier ticks it only when the guest agrees (it cannot be compulsory). It reaches the server as a tip.</small>
      <h3 style="margin:1rem 0 .2rem;font-size:.95rem">Automatic backup</h3>
      <p class="mute" style="margin:0">${auto ? (info ? `Last saved ${esc(new Date(info.at).toLocaleString())} to <b>${esc(info.location)}</b>${info.survivesUninstall ? '' : ' (removed if the app is uninstalled: copy it off the phone)'}.` : 'Saves everything once a day to Download/OrderRestro on this phone (the last 7 days are kept).') : 'Works in the OrderRestro app.'}</p>
      ${auto ? '<button class="btn ghost block mt" id="st-bk">Back up now</button>' : ''}
    </div>`;
}
function bindSettings(redraw) {
  if ($('st-staff')) $('st-staff').onclick = () => staffSheet();
  const sc = $('st-sc');
  if (sc)
    sc.onchange = async () => {
      const v = Math.min(Math.max(Number(sc.value) || 0, 0), 25);
      if (v !== S.scPct && !(await managerOK('Change the service charge.'))) return (sc.value = S.scPct || '');
      S.scPct = v;
      await kv.set('serviceChargePct', v);
      toast(v ? `Service charge ${v}% will be offered at the till.` : 'Service charge switched off.');
    };
  if ($('st-bk')) $('st-bk').onclick = async () => ((await autoBackup(true)) ? toast('Backup saved') : null, redraw());
  document.querySelectorAll('[data-evretry]').forEach((b) => (b.onclick = async () => (await retryEvent(b.dataset.evretry), syncNow({ refreshMenu: false }).then(afterSync), redraw())));
  document.querySelectorAll('[data-evaside]').forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm('Set this record aside? It stays on this phone but is not sent to the server.')) return;
        await dismissEvent(b.dataset.evaside);
        redraw();
      }),
  );
}

/**
 * Once a day (and after closing the day) the whole phone is saved as a JSON file to Download/OrderRestro, so a lost
 * or cleared phone is not the only copy. Never contains the password or the staff PINs.
 */
async function autoBackup(force = false) {
  const np = plugins().NativePrinter;
  if (!np || !np.saveBackup || !S.snap) return false;
  const day = today();
  if (!force && (await kv.get('autoBackupDay')) === day) return false;
  try {
    const data = await readEverything();
    if (!force && !data.sales.length && !data.orders.length) return false; // nothing worth saving yet
    const r = await np.saveBackup({ name: `orderrestro-auto-${slug()}-${day}.json`, prefix: 'orderrestro-auto-', text: backupJson(data), keep: 7 });
    await kv.set('autoBackupDay', day);
    await kv.set('autoBackupInfo', { at: Date.now(), location: r.location, survivesUninstall: !!r.survivesUninstall });
    await kv.set('lastBackupAt', Date.now());
    return true;
  } catch (e) {
    if (force) toast(e.message || 'Could not save the backup', 5000);
    return false;
  }
}
setInterval(() => autoBackup(), 60 * 60000);

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
    ${await settingsCard()}
    <div class="card mt"><button class="btn line block" id="lock">Lock</button><button class="btn line block mt" id="chpw">Change password</button></div>`;
  bindSettings(viewSync);
  $('chpw').onclick = () => passwordSheet();
  $('conn').onclick = () => connectSheet();
  $('pick').onclick = async () => (await choosePrinter(), viewSync());
  $('lock').onclick = async () => (await flushPersist(), (S.unlocked = false), (S.ownerUnlock = false), (S.who = null), (S.cart = new Map()), (S.orderId = null), (S.restored = false), render());
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
        <dt>Waiting to send</dt><dd>${esc(waitingText())}</dd>
        <dt>Last sync</dt><dd>${last ? esc(new Date(last).toLocaleString()) : 'Never'}</dd>
        <dt>Menu saved</dt><dd>${snapAt ? esc(new Date(snapAt).toLocaleString()) : 'Never'} (${S.snap.items.length} dishes)${snapAt && Date.now() - snapAt > 86400000 ? '<br><b>Older than a day. Connect and tap Sync now so prices are current.</b>' : ''}</dd>
        <dt>Signed in as</dt><dd>${esc(S.snap.user.name)}</dd>
        <dt>This phone</dt><dd>${esc(device)}</dd>
      </dl>
      <button class="btn block mt" id="syncnow" ${S.syncing ? 'disabled' : ''}>${S.syncing ? 'Syncing…' : 'Sync now'}</button>
      <p class="mute center">Sync sends your sales, kitchen records and bookings, and refreshes the menu and prices.</p>
    </div>
    ${servers}
    ${await settingsCard()}
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
  bindSettings(viewSync);
  $('pick').onclick = async () => (await choosePrinter(), viewSync());
  $('full').onclick = async () => {
    const link = plugins().ServerLink;
    if (link && link.setMode) await link.setMode({ mode: 'app' });
    else location.href = '../index.html?stay=1';
  };
  $('out').onclick = async () => {
    await refreshPending();
    const waiting = S.pending + S.pendingEvents + S.failedEvents + S.pendingBookings + (S.pendingBooks || 0) + (S.failedBooks || 0);
    if (waiting && !confirm(`Not on the server yet: ${waitingText()}${S.failedEvents ? `, and ${S.failedEvents} refused kitchen record${S.failedEvents === 1 ? '' : 's'}` : ''}. Signing out keeps them on this phone, but they cannot be sent until you sign in again. Sign out anyway?`)) return;
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
  if (r.revoked) S.note = { kind: 'bad', text: 'The owner removed this phone from the restaurant. Sales and kitchen records stay on this phone but cannot be sent until the owner allows it again.' };
  else if (r.authExpired) S.note = { kind: 'warn', text: 'Your sign-in has expired. Selling still works. Sign out and sign in again to send the sales.' };
  else if (r.error) S.note = { kind: 'bad', text: r.error };
  else if (r.online) {
    S.note = r.done ? { text: `${r.done} sale${r.done > 1 ? 's' : ''} sent to the server.` } : null;
    if (r.reviewed) S.note = { kind: 'warn', text: `${r.reviewed} sale${r.reviewed > 1 ? 's were' : ' was'} recorded at a price that differs from the server menu. Open Sales to check.` };
    if (r.eventsFailed) S.note = { kind: 'bad', text: `${r.eventsFailed} record${r.eventsFailed > 1 ? 's were' : ' was'} refused by the server (kitchen, refunds, expenses or cash). Open Sync to read why and try again.` };
    if (r.refused) S.note = { kind: 'bad', text: `${r.refused} sale${r.refused > 1 ? 's were' : ' was'} refused by the server. Open Sales to retry or set aside.` };
  } else S.note = null;
  kv.get('snapshot').then(async (snap) => {
    S.caps = (await kv.get('serverCaps')) || {};
    if (snap) {
      S.snap = snap;
      await syncStaffFromServer();
    }
  });
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

// ----------------------------------------------------------------- kitchen ---
// Production and waste are written on the phone first and sent when there is a connection. Nothing here
// waits for the network, and an event is never sent twice (its id is the server's idempotency key).
const kitchenOn = () => !!(S.snap && !S.snap.local && Array.isArray(S.snap.stockItems));
const KIT_REASONS = [['SPOILED', 'Spoiled'], ['EXPIRED', 'Expired'], ['OVER_PRODUCTION', 'Over-prepared'], ['DAMAGED', 'Dropped / damaged'], ['RETURNED_PLATE', 'Returned / plate waste'], ['PREP_TRIM', 'Preparation trim'], ['STORAGE_TEMPERATURE', 'Temperature / storage'], ['OTHER', 'Other']];
const EV_LABEL = { pending: 'Waiting to send', synced: 'Sent', failed: 'Needs attention', dismissed: 'Set aside' };
const unitOpts = (it, sel) => (it ? it.units : []).map((u) => `<option ${u === sel ? 'selected' : ''}>${u}</option>`).join('');
const itemOpts = (list) => `<option value="">Choose…</option>${list.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}`;

async function viewKitchen() {
  const evs = (await events.all()).filter((e) => e.kind !== 'attendance' && !BOOK_KIND[e.kind]).slice(0, 40);
  const nameOf = (id) => (S.snap.stockItems.find((i) => i.id === id) || {}).name || 'Item';
  const placeOf = (id) => ((S.snap.stockPlaces || []).find((p) => p.id === id) || {}).name || 'another place';
  const describe = (e) =>
    e.kind === 'production'
      ? `Made ${e.payload.outputs.map((o) => `${o.quantity} ${o.unit} ${nameOf(o.ingredientId)}`).join(', ')}`
      : e.kind === 'receipt'
        ? `Received ${e.payload.quantity} ${e.payload.unit} ${nameOf(e.payload.ingredientId)}`
        : e.kind === 'transfer'
          ? `Moved ${e.payload.lines.map((l) => `${l.quantity} ${l.unit} ${nameOf(l.ingredientId)}`).join(', ')} to ${placeOf(e.payload.lines[0].toLocationId)}`
          : e.kind === 'correction'
            ? `Correction: ${e.payload.lines.map((l) => `${l.direction === 'IN' ? '+' : '-'}${l.quantity} ${l.unit} ${nameOf(l.ingredientId)}`).join(', ')}`
        : `Waste: ${e.payload.quantity} ${e.payload.unit} ${nameOf(e.payload.ingredientId)} (${(KIT_REASONS.find((r) => r[0] === e.payload.reason) || [, e.payload.reason])[1]})`;
  $('view').innerHTML = `
    ${S.note ? `<div class="note ${S.note.kind || ''}" role="status">${esc(S.note.text)}</div>` : ''}
    <div class="card mt"><button class="btn block" id="k-prod">Stock journal: record production</button><button class="btn line block mt" id="k-drafts">Drafts and posted vouchers</button><button class="btn line block mt" id="k-waste">Record food waste</button>${S.snap.canReceive ? '<button class="btn line block mt" id="k-recv">Receive stock</button>' : ''}${S.snap.canReceive && (S.snap.stockPlaces || []).length > 1 ? '<button class="btn line block mt" id="k-move">Move stock</button>' : ''}${S.snap.canReceive ? '<button class="btn line block mt" id="k-fix">Correct stock</button>' : ''}
      <p class="mute center">Works without a connection. It is sent when the phone is online.</p></div>
    <h2 class="mt">Recent</h2>
    ${evs.length ? evs.map((e) => `<div class="card mt" data-ev="${esc(e.id)}"><b>${esc(describe(e))}</b><div class="mute">${esc(new Date(e.createdAt).toLocaleString())} &middot; ${EV_LABEL[e.status]}</div>${e.status === 'failed' ? `<div class="note bad mt">${esc(e.error || 'Refused')}</div><div class="row mt"><button class="btn ghost" data-retry="${esc(e.id)}">Try again</button><button class="btn line" data-dismiss="${esc(e.id)}">Set aside</button></div>` : ''}</div>`).join('') : '<p class="mute center mt">Nothing recorded on this phone yet.</p>'}`;
  $('k-prod').onclick = () => openStockJournal();
  $('k-drafts').onclick = openSjList;
  $('k-waste').onclick = openWaste;
  if ($('k-recv')) $('k-recv').onclick = openReceive;
  if ($('k-move')) $('k-move').onclick = openMove;
  if ($('k-fix')) $('k-fix').onclick = openCorrect;
  document.querySelectorAll('[data-retry]').forEach((b) => (b.onclick = async () => (await retryEvent(b.dataset.retry), syncNow({ refreshMenu: false }).then(afterSync), viewKitchen())));
  document.querySelectorAll('[data-dismiss]').forEach((b) => (b.onclick = async () => { if (!confirm('Set this record aside? It stays on the phone for reference but will not be sent to the server.')) return; await dismissEvent(b.dataset.dismiss); await refreshPending(); viewKitchen(); }));
}

// ------------------------------------------------------------ stock journal ---
// The production voucher on the phone. Same server routes, rules and permissions as the web voucher: the phone shows
// what the account may do, checks that input is not empty or unreadable, and the server decides everything about stock
// (lib/stockjournal.js). A new voucher is written on the phone before it is sent, so it is never lost and never posted
// twice; drafts, recipes and new items need a connection because the server is where they live.
const SJ_UNITS = ['KG', 'G', 'L', 'ML', 'PIECE', 'DOZEN', 'PACK', 'BOX'];
const SJ_SHIFTS = ['Morning', 'Afternoon', 'Evening', 'Night'];
let sjTimer = null;
const sjBranch = () => (S.snap && S.snap.branch && S.snap.branch.id) || '';
async function sjSend(method, path, body) {
  if (!SJ) return { status: 0, data: null };
  try {
    if (!SJ.base) SJ.base = await pickServer(await kv.get('serverBase'));
    if (!SJ.base) return { status: 0, data: null };
    return await request(SJ.base, method, path, body);
  } catch {
    SJ.base = null;
    return { status: 0, data: null };
  }
}
// What was typed is kept on the phone as it is typed, so a closed sheet, a call, a dead battery or the app being
// swiped away does not lose it. It is cleared when the voucher is saved or posted, or with "Clear".
const sjPersist = () => {
  clearTimeout(sjTimer);
  sjTimer = setTimeout(() => SJ && !SJ.F.draftId && kv.set('sjForm', SJ.F).catch(() => {}), 250);
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden && SJ && !SJ.F.draftId) kv.set('sjForm', SJ.F).catch(() => {});
});
const sjNum = (v) => (v === undefined || v === null || v === '' ? '' : String(Number(v)));
const sjItemLabel = (i) => `${esc(i.name)}${i.currentStock !== undefined ? ` — ${sjNum(i.currentStock)} ${esc(i.unit)}` : ''}`;
const sjErr = (text) => {
  const b = $('sj-err');
  if (!b) return;
  b.textContent = text || '';
  b.hidden = !text;
  if (text) b.scrollIntoView({ block: 'nearest' });
};
const sjBusy = (on) => {
  if (SJ) SJ.busy = on;
  document.querySelectorAll('#sj-foot button, #sj-body [data-act]').forEach((b) => (b.disabled = on || b.dataset.off === '1'));
};

function sjKeepVisible(el) {
  const box = $('sj-body');
  if (!el.isConnected || !box) return;
  const a = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  if (a.top < b.top || a.bottom > b.bottom) el.scrollIntoView({ block: 'center' });
}

function openStockJournal(draftForm) {
  const caps = capsFrom(S.snap);
  if (!caps.record) return;
  SJ = { F: draftForm || null, items: S.snap.stockItems.map((i) => ({ ...i })), recipes: { state: 'choose-product', recipes: [] }, sub: null, busy: false, base: null, restored: false, activeRow: 0, rtok: 0, caps, review: null, cats: null, costing: false };
  openSheet(
    `<header><h2 id="sj-title">Stock journal</h2><button class="btn line" data-close aria-label="Close" style="min-height:44px;width:44px;padding:0">×</button></header>
     <div class="body" id="sj-body"></div><footer class="sjfoot" id="sj-foot"></footer>`,
    async () => {
      if (!SJ.F) {
        const saved = await kv.get('sjForm').catch(() => null);
        SJ.F = saved && Array.isArray(saved.rows) ? { ...emptyForm(), ...saved } : emptyForm();
        SJ.restored = !!(saved && (saved.productId || saved.rows.some((r) => r.ingredientId)));
      }
      sjRender();
      // Is costed production on? Asked when online, remembered for when the phone is not.
      kv.get('sjCosting').then((c) => { if (SJ && c !== undefined) SJ.costing = !!c; });
      loadCosting(sjSend, sjBranch()).then((c) => { if (c !== null) { if (SJ) SJ.costing = c; kv.set('sjCosting', c).catch(() => {}); } });
      loadStockItems(sjSend, sjBranch()).then((live) => {
        if (live && SJ) {
          SJ.items = live;
          sjRender();
        }
      });
      if (SJ.F.productId) sjLoadRecipes();
    },
  );
  const body = $('sj-body');
  body.addEventListener('input', sjOnInput);
  body.addEventListener('change', sjOnChange);
  body.addEventListener('click', sjOnClick);
  $('sj-foot').addEventListener('click', sjOnClick);
  body.addEventListener('focusin', (e) => {
    const r = e.target.closest && e.target.closest('[data-row]');
    if (r && SJ) SJ.activeRow = Number(r.dataset.row);
    // Keep a field that is under the keyboard in view. Only when it really is hidden: moving the page under a finger
    // that is about to tap something else would swallow that tap.
    const f = e.target;
    if (f.tagName === 'INPUT') setTimeout(() => sjKeepVisible(f), 350);
  });
}

async function sjLoadRecipes() {
  if (!SJ || !SJ.F.productId) return;
  const tok = ++SJ.rtok;
  SJ.recipes = { state: 'loading', recipes: [] };
  sjRender();
  const r = await loadRecipes(sjSend, sjBranch(), SJ.F.productId);
  if (!SJ || tok !== SJ.rtok) return; // a newer product was chosen meanwhile
  SJ.recipes = r;
  sjRender();
}

function sjRender() {
  const body = $('sj-body');
  const foot = $('sj-foot');
  if (!body || !SJ) return;
  if (SJ.sub) return sjRenderSub(body, foot);
  const { F, items, caps, recipes } = SJ;
  const by = new Map(items.map((i) => [i.id, i]));
  const made = items.filter((i) => i.kind === 'PREPARED');
  const raw = items.filter((i) => i.kind === 'PURCHASED');
  const opts = (list, sel) => `<option value="">Choose…</option>${list.map((i) => `<option value="${esc(i.id)}" ${i.id === sel ? 'selected' : ''}>${sjItemLabel(i)}</option>`).join('')}`;
  const prod = by.get(F.productId);
  $('sj-title').textContent = F.draftNo ? `Draft ${F.draftNo}` : 'Stock journal';
  const rs = recipes.state;
  const recipeHtml =
    rs === 'choose-product' ? '<p class="mute">Choose the product first; its saved recipes will appear here.</p>'
    : rs === 'loading' ? '<p class="mute" role="status">Loading recipes…</p>'
    : rs === 'error' ? `<div class="note bad" role="alert">Could not load recipes for this product. ${esc(recipes.error || '')}<button class="btn ghost" data-act="retry-recipes">Try again</button></div>`
    : rs === 'offline' ? '<p class="mute" role="status">Recipes need a connection. You can still type the ingredients.</p>'
    : rs === 'empty' ? `<p role="status"><b>${esc(NO_RECIPES_FOR_PRODUCT)}</b></p>`
    : `<label for="sj-recipe">Recipe</label><select id="sj-recipe" data-f="recipeKey"><option value="">No recipe (type it by hand)</option>${recipes.recipes.map((r) => `<option value="${esc(r.kind)}:${esc(r.id)}" ${F.recipeKey === `${r.kind}:${r.id}` ? 'selected' : ''}>${esc(r.name)} · base ${esc(sjNum(r.baseOutputQty))} ${esc(String(r.outputUnit).toLowerCase())}</option>`).join('')}</select>
       <button class="btn ghost block" data-act="fill" ${F.recipeKey ? '' : 'disabled data-off="1"'}>Fill from recipe</button>`;
  const rowsHtml = F.rows.map((r, i) => {
    const it = by.get(r.ingredientId);
    return `<div class="sjrow" data-row="${i}">
      <select data-r="${i}" data-k="ingredientId" aria-label="Ingredient used, row ${i + 1}">${opts(raw, r.ingredientId)}</select>
      <div class="sjq"><input data-r="${i}" data-k="quantity" inputmode="decimal" placeholder="Quantity" aria-label="Quantity used, row ${i + 1}" value="${esc(r.quantity)}">
        <select data-r="${i}" data-k="unit" aria-label="Unit, row ${i + 1}" ${it ? '' : 'disabled'}>${it ? unitOpts(it, r.unit || it.unit) : '<option>Unit</option>'}</select>
        <button class="btn line sjx" data-act="rm" data-i="${i}" aria-label="Remove ingredient row ${i + 1}" ${F.rows.length === 1 ? 'disabled data-off="1"' : ''}>×</button></div>
      <small class="mute" data-hint="${i}">${sjHint(r, it)}</small></div>`;
  }).join('');
  body.innerHTML = `
    <div id="sj-err" class="note bad" role="alert" hidden></div>
    ${SJ.restored ? '<div class="note warn" role="status">Your unsaved entries were restored. <button class="btn ghost" data-act="clear">Clear</button></div>' : ''}
    <p class="mute">Nothing changes in stock until you post. Saving a draft or a recipe never moves stock.</p>
    <label for="sj-prod">Product made</label>
    <select id="sj-prod" data-f="productId">${opts(made, F.productId)}</select>
    ${caps.menuItems ? '<button class="btn line block" data-act="add-menu">+ Add menu item</button>' : ''}
    <div class="sjrecipe">${recipeHtml}</div>
    <p class="mute sjexplain">A recipe is a reusable list of ingredients and quantities for making one product.</p>
    <label for="sj-mq">Good quantity made</label>
    <div class="sjq2"><input id="sj-mq" data-f="madeQty" inputmode="decimal" placeholder="Quantity" value="${esc(F.madeQty)}"><select data-f="madeUnit" aria-label="Unit made" ${prod ? '' : 'disabled'}>${prod ? unitOpts(prod, F.madeUnit || prod.unit) : '<option>Unit</option>'}</select></div>
    <label for="sj-rej">Rejected (optional, not stocked)</label>
    <input id="sj-rej" data-f="rejected" inputmode="decimal" placeholder="0" value="${esc(F.rejected)}">
    <h3 class="sec">Source / Consumption</h3>
    ${rowsHtml}
    <button class="btn ghost block" data-act="add-row">+ Add ingredient row</button>
    ${caps.inventoryItems ? '<button class="btn line block" data-act="add-inv">+ Add inventory item</button>' : ''}
    <label for="sj-shift">Shift</label>
    <select id="sj-shift" data-f="shift"><option value="">None</option>${SJ_SHIFTS.map((s) => `<option ${F.shift === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <label for="sj-batch">Batch / reference no. (optional)</label>
    <input id="sj-batch" data-f="batchRef" maxlength="80" value="${esc(F.batchRef)}">
    <label for="sj-notes">Narration (optional)</label>
    <input id="sj-notes" data-f="notes" maxlength="1000" value="${esc(F.notes)}">`;
  foot.innerHTML = `
    ${caps.post ? `<button class="btn block" data-act="review">${F.draftId ? 'Review and post draft' : 'Review and post'}</button>` : '<p class="mute center">Your account can save drafts. Someone with permission to post must post them.</p>'}
    <div class="sjfoot2"><button class="btn line" data-act="draft" title="Saves the voucher on the server. Stock does not change.">Save draft</button>${caps.recipes ? '<button class="btn line" data-act="recipe">Save as recipe</button>' : ''}</div>`;
}

function sjHint(r, it) {
  if (!it) return '';
  const bits = [];
  if (it.currentStock !== undefined) bits.push(`Available: ${sjNum(it.currentStock)} ${esc(it.unit)}`);
  else bits.push('Stock shown when online');
  if (r.expected) bits.push(`Recipe expects ${esc(sjNum(r.expected))} ${esc(r.unit || it.unit)}`);
  const short = shortRows({ rows: [r] }, [it]).length;
  return `${bits.join(' · ')}${short ? ' · <b class="bad">more than is in stock</b>' : ''}`;
}

function sjOnInput(e) {
  const t = e.target;
  if (!SJ) return;
  if (t.dataset.r !== undefined && t.dataset.k === 'quantity') {
    const i = Number(t.dataset.r);
    SJ.F.rows[i].quantity = t.value;
    const h = document.querySelector(`[data-hint="${i}"]`);
    if (h) h.innerHTML = sjHint(SJ.F.rows[i], SJ.items.find((x) => x.id === SJ.F.rows[i].ingredientId));
  } else if (t.dataset.f && t.tagName === 'INPUT') SJ.F[t.dataset.f] = t.value;
  sjPersist();
}
function sjOnChange(e) {
  const t = e.target;
  // Typed fields are kept by sjOnInput. Re-drawing on their blur would replace the button the person is tapping
  // and lose that tap, so only dropdowns come through here.
  if (!SJ || t.tagName !== 'SELECT') return;
  const it = (id) => SJ.items.find((x) => x.id === id);
  if (t.dataset.r !== undefined) {
    const row = SJ.F.rows[Number(t.dataset.r)];
    row[t.dataset.k] = t.value;
    if (t.dataset.k === 'ingredientId') {
      row.unit = (it(t.value) || {}).unit || '';
      row.expected = '';
    }
    sjRender();
  } else if (t.dataset.f === 'productId') {
    SJ.F.productId = t.value;
    SJ.F.madeUnit = (it(t.value) || {}).unit || '';
    SJ.F.recipeKey = '';
    SJ.recipes = { state: t.value ? 'loading' : 'choose-product', recipes: [] };
    if (t.value) sjLoadRecipes();
    else sjRender();
  } else if (t.dataset.f) {
    SJ.F[t.dataset.f] = t.value;
    if (t.dataset.f === 'recipeKey') sjRender();
  }
  sjPersist();
}

async function sjOnClick(e) {
  const b = e.target.closest && e.target.closest('[data-act]');
  if (!b || !SJ || SJ.busy || b.disabled) return;
  const act = b.dataset.act;
  const { F } = SJ;
  const branch = sjBranch();
  if (act === 'add-row') { F.rows.push({ ingredientId: '', quantity: '', unit: '', expected: '' }); SJ.activeRow = F.rows.length - 1; sjRender(); sjPersist(); }
  else if (act === 'rm') { F.rows.splice(Number(b.dataset.i), 1); sjRender(); sjPersist(); }
  else if (act === 'clear') { SJ.F = emptyForm(); SJ.restored = false; SJ.recipes = { state: 'choose-product', recipes: [] }; await kv.del('sjForm').catch(() => {}); sjRender(); }
  else if (act === 'retry-recipes') sjLoadRecipes();
  else if (act === 'fill') {
    sjBusy(true);
    const r = await fillFromRecipe(sjSend, branch, F);
    sjBusy(false);
    if (!r.ok) return sjErr(r.error);
    F.rows = r.rows.length ? r.rows : F.rows;
    sjErr('');
    sjRender();
    sjPersist();
    const n = $('sj-err');
    if (n) { n.className = 'note'; n.textContent = `Filled from ${r.name} v${r.version}. Type what was really used; you can change every quantity.`; n.hidden = false; }
  }
  else if (act === 'add-inv') { SJ.sub = { kind: 'inv', error: null }; sjRender(); }
  else if (act === 'add-menu') { SJ.sub = { kind: 'menu', error: null }; sjRender(); if (!SJ.cats) sjLoadCats(); }
  else if (act === 'recipe') {
    const p = recipeProblem(F, SJ.items, 'x');
    if (p) return sjErr(p);
    SJ.sub = { kind: 'recipe', error: null };
    sjRender();
  }
  else if (act === 'draft') {
    const p = formProblem(F, SJ.items);
    if (p) return sjErr(p);
    sjBusy(true);
    const r = await saveDraft(sjSend, branch, F, SJ.items, { costing: SJ.costing });
    sjBusy(false);
    if (!r.ok) return sjErr(r.error);
    await kv.del('sjForm').catch(() => {});
    closeSheet();
    S.note = { text: `Draft ${r.entryNo} saved. Stock has not changed; post it from Drafts and posted.` };
    viewKitchen();
  }
  else if (act === 'review') sjReview();
  else if (act === 'post') sjPost();
  else if (act === 'back') { SJ.sub = null; SJ.review = null; sjRender(); }
}

async function sjLoadCats() {
  const r = await sjSend('GET', `/api/v1/menu/categories?branchId=${encodeURIComponent(sjBranch())}`);
  if (SJ && r.status === 200 && Array.isArray(r.data)) {
    SJ.cats = r.data;
    if (SJ.sub && SJ.sub.kind === 'menu') sjRender();
  } else if (SJ && SJ.sub) {
    SJ.sub.error = friendlyError(r);
    sjRender();
  }
}

function sjRenderSub(body, foot) {
  const sub = SJ.sub;
  const err = `<div id="sj-err" class="note bad" role="alert" ${sub.error ? '' : 'hidden'}>${esc(sub.error || '')}</div>`;
  const unitSel = (id, def) => `<select id="${id}">${SJ_UNITS.map((u) => `<option ${u === def ? 'selected' : ''}>${u}</option>`).join('')}</select>`;
  if (sub.kind === 'inv') {
    body.innerHTML = `${err}<h3 class="sec">Add inventory item</h3><p class="mute">Creates a raw material for this voucher. It is not added to the menu. Stock starts at zero.</p>
      <label for="sx-name">Name</label><input id="sx-name" autocomplete="off" value="${esc(sub.name || '')}"><label for="sx-unit">Stock unit</label>${unitSel('sx-unit', sub.unit || 'KG')}`;
    foot.innerHTML = '<button class="btn block" id="sx-go">Add inventory item</button><button class="btn line block" data-act="back">Cancel</button>';
    $('sx-go').onclick = () => sjCreate('inv');
  } else if (sub.kind === 'menu') {
    body.innerHTML = `${err}<h3 class="sec">Add menu item</h3><p class="mute">Creates a finished product and puts it on the POS menu. Stock starts at zero. Type the price and tax: nothing is filled in for you.</p>
      <label for="sx-name">Name</label><input id="sx-name" autocomplete="off" value="${esc(sub.name || '')}"><label for="sx-unit">Stock unit</label>${unitSel('sx-unit', sub.unit || 'PIECE')}
      <label for="sx-cat">Menu category</label><select id="sx-cat"><option value="">${SJ.cats ? 'Choose a category' : 'Loading…'}</option>${(SJ.cats || []).map((c) => `<option value="${esc(c.id)}" ${c.id === sub.categoryId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <label for="sx-price">Selling price (tax included)</label><input id="sx-price" inputmode="decimal" value="${esc(sub.price || '')}"><label for="sx-tax">Tax rate %</label><input id="sx-tax" inputmode="decimal" placeholder="e.g. 5" value="${esc(sub.tax || '')}">`;
    foot.innerHTML = '<button class="btn block" id="sx-go">Add menu item</button><button class="btn line block" data-act="back">Cancel</button>';
    $('sx-go').onclick = () => sjCreate('menu');
  } else if (sub.kind === 'recipe') {
    const prod = SJ.items.find((i) => i.id === SJ.F.productId);
    body.innerHTML = `${err}<h3 class="sec">Save as recipe</h3><p class="mute">Saves these ingredients and quantities as a reusable recipe for ${esc(prod ? prod.name : 'this product')}, making ${esc(SJ.F.madeQty)} ${esc((SJ.F.madeUnit || '').toLowerCase())}. This does not change stock and does not save or post the voucher. Your entries stay here.</p>
      <label for="sx-name">Recipe name</label><input id="sx-name" autocomplete="off" value="${esc(sub.name ?? (prod ? prod.name : ''))}">`;
    foot.innerHTML = '<button class="btn block" id="sx-go">Save recipe</button><button class="btn line block" data-act="back">Cancel</button>';
    $('sx-go').onclick = () => sjCreate('recipe');
  } else if (sub.kind === 'review') {
    const v = sub.preview;
    const by = new Map(SJ.items.map((i) => [i.id, i]));
    const usedHtml = (v ? v.inputs.map((l) => `<div class="row"><span class="grow">${esc(l.name)}</span><b class="bad">−${esc(sjNum(l.quantity))} ${esc(l.unit)}</b></div>`)
      : SJ.F.rows.filter((r) => r.ingredientId).map((r) => `<div class="row"><span class="grow">${esc((by.get(r.ingredientId) || {}).name || '')}</span><b class="bad">−${esc(r.quantity)} ${esc(r.unit)}</b></div>`)).join('');
    const madeHtml = (v ? v.outputs.map((o) => `<div class="row"><span class="grow">${esc(o.name)}</span><b class="ok">+${esc(sjNum(o.good))} ${esc(o.unit)}</b></div>`)
      : [`<div class="row"><span class="grow">${esc((by.get(SJ.F.productId) || {}).name || '')}</span><b class="ok">+${esc(SJ.F.madeQty)} ${esc(SJ.F.madeUnit)}</b></div>`]).join('');
    const short = v && v.shortages && v.shortages.length ? `<div class="note bad" role="alert">Not enough stock: ${esc(v.shortages.join('; '))}. Stock is never allowed to go below zero. Change the quantity or fix the count first.</div>` : '';
    const cost = v && v.costError ? `<div class="note bad" role="alert">${esc(friendlyError({ status: 400, data: { message: v.costError } }))}</div>` : '';
    body.innerHTML = `${err}<h3 class="sec">Check the voucher</h3>
      <p class="mute">${sub.offline ? 'No connection, so this is shown as you entered it. The server checks it when it is sent.' : 'Stock changes only when you press Post.'}</p>
      ${short}${cost}<h4>Used (out of stock)</h4>${usedHtml}<h4>Made (into stock)</h4>${madeHtml}
      ${v && v.costed && v.totalCost ? `<div class="row"><span class="grow">Total batch cost</span><b>${esc(inr(v.totalCost))}</b></div>${v.outputs.length === 1 && v.outputs[0].unitCost ? `<div class="row"><span class="grow">Cost per good unit</span><b>${esc(inr(v.outputs[0].unitCost))}</b></div>` : ''}` : ''}`;
    const blocked = v && (v.canPost === false || (v.shortages && v.shortages.length));
    foot.innerHTML = `<button class="btn block" data-act="post" ${blocked ? 'disabled data-off="1"' : ''}>${SJ.F.draftId ? 'Post draft' : 'Post'}</button><button class="btn line block" data-act="back">Back to edit</button>`;
  }
}

async function sjReview() {
  const p = formProblem(SJ.F, SJ.items);
  if (p) return sjErr(p);
  sjErr('');
  sjBusy(true);
  const b = voucherBody(SJ.F, SJ.items, {});
  const r = await sjSend('POST', `/api/v1/inventory/production/voucher-preview?branchId=${encodeURIComponent(sjBranch())}`, { inputs: b.inputs, outputs: b.outputs, ...(SJ.costing ? { costing: { enabled: true, costs: [] } } : {}) });
  sjBusy(false);
  if (r.status === 0) SJ.sub = { kind: 'review', preview: null, offline: true };
  else if (r.status === 200 || r.status === 201) SJ.sub = { kind: 'review', preview: r.data };
  else return sjErr(friendlyError(r));
  sjRender();
}

async function sjPost() {
  const { F } = SJ;
  sjBusy(true);
  let r;
  if (F.draftId) r = await postDraft(sjSend, sjBranch(), F, SJ.items, { costing: SJ.costing });
  else r = await postNew({ queueEvent, syncNow, getEvent: (id) => events.get(id), dismissEvent }, F, SJ.items, { userId: S.snap.user.id, deviceId: await kv.get('deviceId'), costing: SJ.costing });
  sjBusy(false);
  if (!r.ok) {
    SJ.sub = null; // back to the form with everything still typed in, and the reason on top
    sjRender();
    return sjErr(r.error);
  }
  await kv.del('sjForm').catch(() => {});
  closeSheet();
  S.note = { text: r.posted === false ? 'Saved on this phone. It will be posted when there is a connection.' : `${F.draftNo || 'Voucher'} posted. Stock is updated.` };
  if (r.waiting) syncNow({ refreshMenu: false }).then(afterSync);
  await refreshPending();
  viewKitchen();
}

async function sjCreate(kind) {
  const val = (id) => ($(id) ? $(id).value : '');
  const sub = SJ.sub;
  const branch = sjBranch();
  sjBusy(true);
  let r;
  if (kind === 'inv') r = await createInventoryItem(sjSend, branch, { name: val('sx-name'), unit: val('sx-unit') });
  else if (kind === 'menu') r = await createMenuItem(sjSend, branch, { name: val('sx-name'), unit: val('sx-unit'), categoryId: val('sx-cat'), price: val('sx-price'), tax: val('sx-tax') });
  else r = await saveRecipe(sjSend, branch, SJ.F, SJ.items, val('sx-name'));
  sjBusy(false);
  if (!r.ok) {
    Object.assign(sub, { error: r.error, name: val('sx-name'), unit: val('sx-unit'), categoryId: val('sx-cat'), price: val('sx-price'), tax: val('sx-tax') });
    return sjRender();
  }
  SJ.sub = null;
  if (kind === 'recipe') {
    SJ.F.recipeKey = `${r.recipe.kind || 'RECIPE'}:${r.recipe.id}`;
    await sjLoadRecipes();
    sjPersist();
    const n = $('sj-err');
    if (n) { n.className = 'note'; n.textContent = 'Recipe saved. Stock was not changed.'; n.hidden = false; }
    return;
  }
  // The new item is picked in the row being worked on (menu items: in Product made); the rest of the form is untouched.
  const live = await loadStockItems(sjSend, branch);
  if (live) SJ.items = live;
  else SJ.items.push({ id: r.id, name: val('sx-name') || '', unit: val('sx-unit'), kind: kind === 'inv' ? 'PURCHASED' : 'PREPARED', units: [val('sx-unit')] });
  const item = SJ.items.find((i) => i.id === r.id);
  if (kind === 'inv') {
    const idx = SJ.F.rows[SJ.activeRow] && !SJ.F.rows[SJ.activeRow].ingredientId ? SJ.activeRow : SJ.F.rows.findIndex((x) => !x.ingredientId);
    const row = { ingredientId: r.id, quantity: '', unit: item ? item.unit : '', expected: '' };
    if (idx >= 0) Object.assign(SJ.F.rows[idx], row);
    else SJ.F.rows.push(row);
  } else {
    SJ.F.productId = r.id;
    SJ.F.madeUnit = item ? item.unit : '';
    SJ.F.recipeKey = '';
    SJ.recipes = { state: 'loading', recipes: [] };
    syncNow().then(afterSync); // the new dish reaches this phone's POS menu
  }
  sjRender();
  sjPersist();
  if (kind === 'menu') sjLoadRecipes();
  if (r.menuMissing) sjErr(`${val('sx-name')} was added to stock, but not to the menu: ${r.menuMissing} Add it under Menu.`);
}

// Drafts waiting on the server and vouchers already posted (read-only), for anyone who may record production.
async function openSjList() {
  SJ = { F: emptyForm(), items: S.snap.stockItems, base: null, sub: null, busy: false, caps: capsFrom(S.snap), recipes: { state: 'choose-product', recipes: [] }, rtok: 0 };
  openSheet(`<header><h2>Drafts and posted</h2><button class="btn line" data-close aria-label="Close" style="min-height:44px;width:44px;padding:0">×</button></header><div class="body" id="sjl-body"><p class="mute">Loading…</p></div>`, async () => {
    const q = (s) => sjSend('GET', `/api/v1/inventory/production?branchId=${encodeURIComponent(sjBranch())}&status=${s}`);
    const [d, p] = await Promise.all([q('DRAFT'), q('POSTED')]);
    const body = $('sjl-body');
    if (!body) return;
    if (d.status === 0 && p.status === 0) { body.innerHTML = '<div class="note warn" role="status">Drafts and posted vouchers live on the server and need a connection. Vouchers waiting to be sent are under Recent.</div>'; return; }
    if (d.status !== 200 || p.status !== 200) { body.innerHTML = `<div class="note bad" role="alert">${esc(friendlyError(d.status !== 200 ? d : p))}</div>`; return; }
    const nameOf = (e, role) => e.lines.filter((l) => l.role === role).map((l) => `${esc(sjNum(role === 'OUTPUT' ? l.quantity : l.enteredQuantity))} ${esc(role === 'OUTPUT' ? l.ingredient.unit : l.enteredUnit)} ${esc(l.ingredient.name)}`).join(', ');
    const card = (e, draft) => `<div class="card mt"><b>${esc(e.entryNo)}</b> <span class="status ${draft ? 'PREPARING' : 'READY'}">${draft ? 'Draft: stock not changed' : 'Posted'}</span>
      <div class="mute">${esc(new Date(e.producedAt).toLocaleString())}${e.batchRef ? ` · ${esc(e.batchRef)}` : ''}</div>
      <div>Made ${nameOf(e, 'OUTPUT') || '–'}</div><div class="mute">Used ${nameOf(e, 'INPUT') || '–'}</div>
      ${draft ? `<div class="row"><button class="btn ghost" data-open="${esc(e.id)}">Open</button>${capsFrom(S.snap).record ? `<button class="btn line" data-del="${esc(e.id)}">Delete</button>` : ''}</div>` : ''}</div>`;
    body.innerHTML = `<h3 class="sec">Drafts (${d.data.length})</h3>${d.data.map((e) => card(e, true)).join('') || '<p class="mute">No drafts.</p>'}
      <h3 class="sec">Posted (latest ${p.data.length})</h3>${p.data.map((e) => card(e, false)).join('') || '<p class="mute">Nothing posted yet.</p>'}`;
    body.onclick = async (ev) => {
      const o = ev.target.closest('[data-open]');
      const x = ev.target.closest('[data-del]');
      if (o) {
        o.disabled = true;
        const r = await sjSend('GET', `/api/v1/inventory/production/${encodeURIComponent(o.dataset.open)}?branchId=${encodeURIComponent(sjBranch())}`);
        if (r.status !== 200) { o.disabled = false; return void (body.insertAdjacentHTML('afterbegin', `<div class="note bad" role="alert">${esc(friendlyError(r))}</div>`)); }
        closeSheet();
        openStockJournal(formFromDraft(r.data));
      } else if (x) {
        if (!confirm('Delete this draft? It never changed stock.')) return;
        x.disabled = true;
        const r = await deleteDraft(sjSend, sjBranch(), x.dataset.del);
        if (!r.ok) { x.disabled = false; return void (body.insertAdjacentHTML('afterbegin', `<div class="note bad" role="alert">${esc(r.error)}</div>`)); }
        x.closest('.card').remove();
      }
    };
  });
}

function openWaste() {
  const list = S.snap.stockItems;
  openSheet(
    `<h2>Record food waste</h2>
     <label>Item<select id="w-i">${itemOpts(list)}</select></label>
     <div class="row"><input id="w-q" inputmode="decimal" placeholder="Quantity" aria-label="Quantity"><select id="w-u" aria-label="Unit"></select></div>
     <label>Reason<select id="w-r">${KIT_REASONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
     <input id="w-n" placeholder="Note (required for Other)" aria-label="Note">
     <div id="w-err" class="note bad" hidden></div>
     <button class="btn block mt" id="w-save">Save</button><button class="btn line block mt" data-close>Cancel</button>`,
    (p) => {
      const it = p.querySelector('#w-i');
      it.onchange = () => { const x = list.find((i) => i.id === it.value); p.querySelector('#w-u').innerHTML = unitOpts(x, x && x.unit); };
      p.querySelector('#w-save').onclick = async () => {
        const err = p.querySelector('#w-err');
        const reason = p.querySelector('#w-r').value;
        const note = p.querySelector('#w-n').value.trim();
        const qty = p.querySelector('#w-q').value.trim();
        if (!it.value || !(Number(qty) > 0)) { err.textContent = 'Choose the item and type a quantity.'; err.hidden = false; return; }
        if (reason === 'OTHER' && note.length < 3) { err.textContent = 'Say what happened.'; err.hidden = false; return; }
        if (!(await saveKitchenEvent(p.querySelector('#w-save'), p.querySelector('#w-err'), 'waste', { ingredientId: it.value, quantity: qty, unit: p.querySelector('#w-u').value, reason, note: note || undefined, occurredAt: new Date().toISOString() }))) return;
        closeSheet();
        S.note = { text: 'Saved on this phone. It will be sent when there is a connection.' };
        syncNow({ refreshMenu: false }).then(afterSync);
        viewKitchen();
      };
    },
  );
}

function openReceive() {
  const list = S.snap.stockItems.filter((i) => i.kind !== 'PREPARED');
  openSheet(
    `<h2>Receive stock</h2>
     <label>Item<select id="rc-i">${itemOpts(list)}</select></label>
     <div class="row"><input id="rc-q" inputmode="decimal" placeholder="Quantity" aria-label="Quantity"><select id="rc-u" aria-label="Unit"></select></div>
     <input id="rc-r" placeholder="Supplier / invoice (optional)" aria-label="Reference">
     <label>Use by (optional)<input id="rc-x" type="date"></label>
     <div id="rc-err" class="note bad" hidden></div>
     <button class="btn block mt" id="rc-save">Save</button><button class="btn line block mt" data-close>Cancel</button>`,
    (p) => {
      const it = p.querySelector('#rc-i');
      it.onchange = () => { const x = list.find((i) => i.id === it.value); p.querySelector('#rc-u').innerHTML = unitOpts(x, x && x.unit); };
      p.querySelector('#rc-save').onclick = async () => {
        const err = p.querySelector('#rc-err');
        const qty = p.querySelector('#rc-q').value.trim();
        if (!it.value || !(Number(qty) > 0)) { err.textContent = 'Choose the item and type a quantity.'; err.hidden = false; return; }
        const x = p.querySelector('#rc-x').value;
        if (!(await saveKitchenEvent(p.querySelector('#rc-save'), p.querySelector('#rc-err'), 'receipt', { ingredientId: it.value, quantity: qty, unit: p.querySelector('#rc-u').value, reference: p.querySelector('#rc-r').value.trim() || undefined, expiryDate: x ? new Date(`${x}T00:00:00`).toISOString() : undefined, receivedAt: new Date().toISOString() }))) return;
        closeSheet();
        S.note = { text: 'Saved on this phone. It will be sent when there is a connection.' };
        syncNow({ refreshMenu: false }).then(afterSync);
        viewKitchen();
      };
    },
  );
}


/**
 * Save one kitchen record on the phone. The button is locked while it saves so a double tap cannot queue the
 * same stock movement twice, and a full or blocked phone store shows a message instead of failing silently.
 */
async function saveKitchenEvent(btn, errBox, kind, payload) {
  if (btn.disabled) return false;
  btn.disabled = true;
  try {
    await queueEvent(kind, payload, { userId: S.snap.user.id, deviceId: await kv.get('deviceId') });
    return true;
  } catch {
    btn.disabled = false;
    errBox.textContent = 'This phone could not save it (its storage may be full). Nothing was recorded. Free some space and try again.';
    errBox.hidden = false;
    return false;
  }
}
const placeOpts = (sel, empty) => `<option value="">${empty}</option>${(S.snap.stockPlaces || []).map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
const savedNote = () => { S.note = { text: 'Saved on this phone. It will be sent when there is a connection.' }; };

// Moving stock between places. The server checks the quantity against what the place holds when it receives
// the entry; a refusal comes back as a card with the reason and a Try again button.
function openMove() {
  const list = S.snap.stockItems;
  openSheet(
    `<h2>Move stock</h2><p class="mute">The total does not change; only where it is kept.</p>
     <label>Item<select id="mv-i">${itemOpts(list)}</select></label>
     <div class="row"><input id="mv-q" inputmode="decimal" placeholder="Quantity" aria-label="Quantity"><select id="mv-u" aria-label="Unit"></select></div>
     <label>From<select id="mv-f">${placeOpts('', 'Not yet placed anywhere')}</select></label>
     <label>To<select id="mv-t">${placeOpts('', 'Choose a place…')}</select></label>
     <div id="mv-err" class="note bad" hidden></div>
     <button class="btn block mt" id="mv-save">Save</button><button class="btn line block mt" data-close>Cancel</button>`,
    (p) => {
      const it = p.querySelector('#mv-i');
      it.onchange = () => { const x = list.find((i) => i.id === it.value); p.querySelector('#mv-u').innerHTML = unitOpts(x, x && x.unit); };
      p.querySelector('#mv-save').onclick = async () => {
        const err = p.querySelector('#mv-err');
        const qty = p.querySelector('#mv-q').value.trim().replace(',', '.');
        const from = p.querySelector('#mv-f').value;
        const to = p.querySelector('#mv-t').value;
        if (!it.value || !(Number(qty) > 0)) { err.textContent = 'Choose the item and type a quantity.'; err.hidden = false; return; }
        if (!to) { err.textContent = 'Choose where the stock goes.'; err.hidden = false; return; }
        if (from === to) { err.textContent = 'From and To must be different places.'; err.hidden = false; return; }
        if (!(await saveKitchenEvent(p.querySelector('#mv-save'), p.querySelector('#mv-err'), 'transfer', { occurredAt: new Date().toISOString(), lines: [{ ingredientId: it.value, quantity: qty, unit: p.querySelector('#mv-u').value, direction: 'OUT', ...(from ? { fromLocationId: from } : {}), toLocationId: to }] }))) return;
        closeSheet();
        savedNote();
        syncNow({ refreshMenu: false }).then(afterSync);
        viewKitchen();
      };
    },
  );
}

// Correcting a count: remove or add the difference, with a reason.
function openCorrect() {
  const list = S.snap.stockItems;
  openSheet(
    `<h2>Correct stock</h2><p class="mute">Use when the shelf and the system disagree.</p>
     <label>Item<select id="cr-i">${itemOpts(list)}</select></label>
     <label>What is wrong<select id="cr-d"><option value="OUT">There is less than the system says (remove)</option><option value="IN">There is more than the system says (add)</option></select></label>
     <div class="row"><input id="cr-q" inputmode="decimal" placeholder="Difference" aria-label="Difference"><select id="cr-u" aria-label="Unit"></select></div>
     <input id="cr-r" placeholder="Why (required)" aria-label="Reason">
     <div id="cr-err" class="note bad" hidden></div>
     <button class="btn block mt" id="cr-save">Save</button><button class="btn line block mt" data-close>Cancel</button>`,
    (p) => {
      const it = p.querySelector('#cr-i');
      it.onchange = () => { const x = list.find((i) => i.id === it.value); p.querySelector('#cr-u').innerHTML = unitOpts(x, x && x.unit); };
      p.querySelector('#cr-save').onclick = async () => {
        const err = p.querySelector('#cr-err');
        const qty = p.querySelector('#cr-q').value.trim().replace(',', '.');
        const why = p.querySelector('#cr-r').value.trim();
        if (!it.value || !(Number(qty) > 0)) { err.textContent = 'Choose the item and type the difference.'; err.hidden = false; return; }
        if (why.length < 3) { err.textContent = 'Say why the stock was wrong.'; err.hidden = false; return; }
        if (!(await saveKitchenEvent(p.querySelector('#cr-save'), p.querySelector('#cr-err'), 'correction', { occurredAt: new Date().toISOString(), reason: why, lines: [{ ingredientId: it.value, quantity: qty, unit: p.querySelector('#cr-u').value, direction: p.querySelector('#cr-d').value }] }))) return;
        closeSheet();
        savedNote();
        syncNow({ refreshMenu: false }).then(afterSync);
        viewKitchen();
      };
    },
  );
}

// ------------------------------------------------------------------ shift ---
// Clock in and out work with no connection: the phone records the real time and sends it later. If the
// server disagrees (already clocked in somewhere else, a payroll already approved) the record stays here
// with the server's reason so the person, or a manager, can sort it out.
async function viewShift() {
  const all = (await events.all()).filter((e) => e.kind === 'attendance');
  const st = shiftState(all);
  const fmt = (iso) => new Date(iso).toLocaleString();
  $('view').innerHTML = `
    ${S.note ? `<div class="note ${S.note.kind || ''}" role="status">${esc(S.note.text)}</div>` : ''}
    <div class="card mt center">
      <h2>${st.on ? 'On shift' : 'Off shift'}</h2>
      <p class="mute">${st.on ? `Since ${esc(fmt(st.since))}` : 'Tap when you start work.'}</p>
      <button class="btn block mt" id="sh-btn">${st.on ? 'Clock out' : 'Clock in'}</button>
      <p class="mute">Works without a connection. The time is the time you tapped.</p>
    </div>
    <h2 class="mt">Recent</h2>
    ${all.length ? all.slice(0, 20).map((e) => `<div class="card mt"><b>${e.payload.type === 'IN' ? 'Clocked in' : 'Clocked out'}</b> ${esc(fmt(e.payload.at || e.createdAt))}<div class="mute">${EV_LABEL[e.status]}${e.payload.breakMinutes ? ` &middot; ${e.payload.breakMinutes} min break` : ''}</div>${e.status === 'failed' ? `<div class="note bad mt">${esc(e.error || 'Refused')}</div><button class="btn ghost mt" data-retry="${esc(e.id)}">Try again</button>` : ''}</div>`).join('') : '<p class="mute center mt">Nothing recorded on this phone yet.</p>'}`;
  document.querySelectorAll('[data-retry]').forEach((b) => (b.onclick = async () => (await retryEvent(b.dataset.retry), syncNow({ refreshMenu: false }).then(afterSync), viewShift())));
  $('sh-btn').onclick = () => {
    const record = async (extra = {}) => {
      await queueEvent('attendance', { type: st.on ? 'OUT' : 'IN', at: new Date().toISOString(), ...extra }, { userId: S.snap.user.id, deviceId: await kv.get('deviceId') });
      closeSheet();
      syncNow({ refreshMenu: false }).then(afterSync);
      viewShift();
    };
    if (!st.on) return record();
    openSheet(`<h2>Clock out</h2><label>Unpaid break taken (minutes)<input id="sh-br" inputmode="numeric" placeholder="0" value="0"></label><button class="btn block mt" id="sh-ok">Clock out now</button><button class="btn line block mt" data-close>Cancel</button>`, (pn) => {
      pn.querySelector('#sh-ok').onclick = () => record({ breakMinutes: Math.max(0, Math.min(480, Number(pn.querySelector('#sh-br').value) || 0)) });
    });
  };
}

// ------------------------------------------------------------------- start ---
async function start() {
  let did = await kv.get('deviceId');
  if (!did) { did = `phone-${newId()}`; await kv.set('deviceId', did); }
  setDeviceId(did);
  await loadStaff();
  S.snap = await kv.get('snapshot');
  S.setupDismissed = !!(await kv.get('setupDismissed'));
  if (!S.snap) return renderLogin();
  if (S.snap.local) {
    setTimeout(() => autoBackup(), 5000);
    return render();
  }
  S.online = !!(await pickServer(await kv.get('serverBase')));
  await syncStaffFromServer();
  render();
  if (S.online) syncNow().then(afterSync);
  setTimeout(() => autoBackup(), 5000);
}

// Ask the phone not to clear this app's saved sales and records when it runs low on space. Unsent sales are real money;
// without this, a browser-based phone may evict them. Harmless where it is already granted or unsupported.
try {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
} catch {
  /* unsupported */
}

// Quietly try again when the phone is back online or the app is reopened.
window.addEventListener('online', () => syncNow().then(afterSync));
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && S.snap && syncNow().then(afterSync));
setInterval(() => S.snap && document.visibilityState === 'visible' && $('sheet').hidden && syncNow({ refreshMenu: false }).then(afterSync), 60000);


start().catch((e) => {
  $('app').innerHTML = `<div class="login"><div class="note bad">Could not start: ${esc(e.message)}</div></div>`;
});
