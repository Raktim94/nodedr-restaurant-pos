// OrderRestro standalone POS. Opens with no connection, sells from the menu
// saved on this phone, prints, and sends the sales to the restaurant server
// whenever it can. Plain DOM + modules: nothing here needs a build step.
import { computeBill, round2, settle, upiLink } from './lib/bill.js';
import { escposReceipt, htmlReceipt, toBase64 } from './lib/receipt.js';
import { kv, newId, nextLocalNumber, sales } from './lib/store.js';
import { native, pickServer, reachable, savedServers } from './lib/net.js';
import { login, pullSnapshot, syncNow } from './lib/sync.js';
import { changeLocalPassword, checkLocalPassword, createLocalAccount, eraseLocalAccount, hasLocalAccount, remapSalesToServer, removeDish, upsertDish } from './lib/local.js';

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
};

const ICON = {
  sell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.1a2 2 0 0 0 2-1.5L21 8H6"/></svg>',
  sales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6"/></svg>',
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
    items: cartLines().map((l) => ({ menuItemId: l.item.id, name: l.item.name, price: l.item.price, taxRate: l.item.taxRate, quantity: l.qty })),
    discountPercent: S.discountPercent || 0,
    bill: { subtotal: bill.subtotal, discountAmount: bill.discountAmount, tax: bill.tax, total: bill.total },
    payments,
    change,
    status: 'pending',
  };
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
function go(v) {
  S.view = v;
  render();
}
async function refreshPending() {
  S.pending = (await sales.pending()).length;
}
async function render() {
  if (!S.snap) return renderLogin();
  if (S.snap.local && !S.unlocked) return renderUnlock();
  await refreshPending();
  shell();
  ({ sell: viewSell, menu: viewMenu, sales: viewSales, sync: viewSync })[S.view]();
}

// -------------------------------------------------------------------- sell ---
function viewSell() {
  const { categories, items } = S.snap;
  const q = S.q.trim().toLowerCase();
  const shown = items.filter((i) => (S.category === 'all' || i.categoryId === S.category) && (!q || i.name.toLowerCase().includes(q)));
  $('view').innerHTML = `
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
  const n = cartCount();
  $('barwrap').innerHTML = n
    ? `<div class="bar"><button class="btn" id="cartbtn"><span>View cart &middot; ${n} item${n > 1 ? 's' : ''}</span><span>${inr(billOf().total)}</span></button></div>`
    : '';
  $('cartbtn') && ($('cartbtn').onclick = openCart);
}

function openCart() {
  const draw = () => {
    const lines = cartLines();
    if (!lines.length) return closeSheet(), render();
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
            <b style="min-width:5.5rem;text-align:right">${inr(l.item.price * l.qty)}</b></div>`,
          )
          .join('')}</div>
        <label for="dp">Discount %</label><input id="dp" type="number" inputmode="decimal" min="0" max="${esc(S.snap.restaurant.maxManualDiscountPercent)}" value="${S.discountPercent || ''}" placeholder="0">
        <div class="mt">
          <div class="tot"><span>Subtotal</span><span>${inr(bill.subtotal)}</span></div>
          ${bill.discountAmount > 0 ? `<div class="tot"><span>Discount</span><span>-${inr(bill.discountAmount)}</span></div>` : ''}
          ${bill.tax > 0 ? `<div class="tot mute"><span>${esc(S.snap.branch.taxLabel || 'Tax')} (included)</span><span>${inr(bill.tax)}</span></div>` : ''}
          <div class="tot big"><span>Total</span><span>${inr(bill.total)}</span></div>
        </div>
        <div class="mt">${printActions()}</div>
      </div>
      <footer><button class="btn block" id="charge">Charge ${inr(bill.total)}</button></footer>`;
    const root = $('sheet').firstElementChild;
    root.querySelector('[data-close]').onclick = closeSheet;
    root.querySelectorAll('[data-type]').forEach((b) => (b.onclick = () => ((S.type = b.dataset.type), draw())));
    root.querySelector('#tb') && (root.querySelector('#tb').onchange = (e) => (S.table = e.target.value));
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
    const number = await nextLocalNumber();
    const sale = saleFrom(number, bill, st.rows.map((r) => ({ ...r })), st.change);
    await sales.put(sale);
    S.cart.clear();
    S.discountPercent = 0;
    S.table = '';
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

// ------------------------------------------------------------------- sales ---
async function viewSales() {
  const all = await sales.all();
  const label = { pending: 'Waiting to sync', synced: 'Synced', refused: 'Needs attention' };
  $('view').innerHTML = `
    ${S.pending ? `<div class="note warn" role="status">${S.pending} sale${S.pending > 1 ? 's' : ''} saved on this phone, not on the server yet.</div>` : ''}
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
             ${s.status === 'refused' ? `<div class="note bad">${esc(s.refusedReason)}<br><small>The sale is kept here. Ask the owner to enter it from the full app.</small></div>` : ''}
             ${s.items.map((i) => `<div class="tot"><span>${i.quantity} &times; ${esc(i.name)}</span><span>${inr(i.price * i.quantity)}</span></div>`).join('')}
             <div class="tot big mt"><span>Total</span><span>${inr(s.bill.total)}</span></div>
             <div class="mt">${printActions()}</div>
           </div>`,
          (p) => bindPrint(p, s, false),
        );
      }),
  );
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
  $('lock').onclick = () => ((S.unlocked = false), (S.cart = new Map()), render());
}

async function viewSync() {
  if (S.snap.local) return viewSyncLocal();
  S.hasPhoneAccount = !!(await kv.get('localAccount')) && !!(await kv.get('localMenuBackup'));
  const snapAt = await kv.get('snapshotAt');
  const last = await kv.get('lastSync');
  const printer = savedPrinter();
  const device = (await kv.get('deviceName')) || 'Phone';
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
    if (r.refused) S.note = { kind: 'bad', text: `${r.refused} sale${r.refused > 1 ? 's were' : ' was'} refused by the server. Open Sales to see why.` };
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

start().catch((e) => {
  $('app').innerHTML = `<div class="login"><div class="note bad">Could not start: ${esc(e.message)}</div></div>`;
});
