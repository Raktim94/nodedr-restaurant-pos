// Everything the standalone POS keeps on the phone, in IndexedDB:
//   kv    small values: the menu snapshot, who is signed in, settings, counters
//   sales every sale taken, with whether the server has it yet
const DB = 'orderrestro-pos';
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 3);
      req.onupgradeneeded = () => {
        // Only add what is missing: a phone upgrading from v1 keeps its sales and settings untouched.
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('sales')) {
          const s = db.createObjectStore('sales', { keyPath: 'id' });
          s.createIndex('status', 'status');
          s.createIndex('soldAt', 'soldAt');
        }
        if (!db.objectStoreNames.contains('orders')) db.createObjectStore('orders', { keyPath: 'id' }); // open tabs, held orders, voids
        if (!db.objectStoreNames.contains('kots')) db.createObjectStore('kots', { keyPath: 'id' }); // kitchen tickets
        if (!db.objectStoreNames.contains('refunds')) db.createObjectStore('refunds', { keyPath: 'id' }); // money paid back on a sale
        if (!db.objectStoreNames.contains('expenses')) db.createObjectStore('expenses', { keyPath: 'id' }); // money paid out
        if (!db.objectStoreNames.contains('shifts')) db.createObjectStore('shifts', { keyPath: 'day' }); // closed days (cash counted)
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const kv = {
  get: (k) => tx('kv', 'readonly', (s) => s.get(k)),
  set: (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k)),
  del: (k) => tx('kv', 'readwrite', (s) => s.delete(k)),
};

export const sales = {
  put: (sale) => tx('sales', 'readwrite', (s) => s.put(sale)),
  get: (id) => tx('sales', 'readonly', (s) => s.get(id)),
  all: () => tx('sales', 'readonly', (s) => s.getAll()).then((a) => a.sort((x, y) => (x.soldAt < y.soldAt ? 1 : -1))),
  clear: () => tx('sales', 'readwrite', (s) => s.clear()),
  pending: () => sales.all().then((a) => a.filter((s) => s.status === 'pending')),
};

export const orders = {
  put: (o) => tx('orders', 'readwrite', (s) => s.put(o)),
  get: (id) => tx('orders', 'readonly', (s) => s.get(id)),
  del: (id) => tx('orders', 'readwrite', (s) => s.delete(id)),
  all: () => tx('orders', 'readonly', (s) => s.getAll()),
  clear: () => tx('orders', 'readwrite', (s) => s.clear()),
};

export const kots = {
  put: (k) => tx('kots', 'readwrite', (s) => s.put(k)),
  get: (id) => tx('kots', 'readonly', (s) => s.get(id)),
  all: () => tx('kots', 'readonly', (s) => s.getAll()),
  clear: () => tx('kots', 'readwrite', (s) => s.clear()),
};

const plain = (name) => ({
  put: (v) => tx(name, 'readwrite', (s) => s.put(v)),
  get: (k) => tx(name, 'readonly', (s) => s.get(k)),
  del: (k) => tx(name, 'readwrite', (s) => s.delete(k)),
  all: () => tx(name, 'readonly', (s) => s.getAll()),
  clear: () => tx(name, 'readwrite', (s) => s.clear()),
});
export const refunds = plain('refunds');
export const expenses = plain('expenses');
export const shifts = plain('shifts');

const BACKUP_STORES = ['sales', 'orders', 'kots', 'refunds', 'expenses', 'shifts'];

/** Everything on the phone except the account password, read in one consistent transaction. */
export async function readEverything() {
  const db = await open();
  const out = {};
  await new Promise((resolve, reject) => {
    const t = db.transaction([...BACKUP_STORES, 'kv'], 'readonly');
    for (const n of BACKUP_STORES) {
      const r = t.objectStore(n).getAll();
      r.onsuccess = () => (out[n] = r.result);
    }
    const k = t.objectStore('kv').get('snapshot');
    k.onsuccess = () => (out.snapshot = k.result);
    t.oncomplete = resolve;
    t.onerror = t.onabort = () => reject(t.error);
  });
  return out;
}

/**
 * Replace everything on the phone with a backup, all or nothing: one
 * transaction, so a failure half way leaves the phone exactly as it was.
 */
export async function replaceEverything(b) {
  const db = await open();
  await new Promise((resolve, reject) => {
    const t = db.transaction([...BACKUP_STORES, 'kv'], 'readwrite');
    for (const n of BACKUP_STORES) {
      const st = t.objectStore(n);
      st.clear();
      for (const row of b[n] || []) st.put(row);
    }
    t.objectStore('kv').put(b.snapshot, 'snapshot');
    t.objectStore('kv').put(Date.now(), 'snapshotAt');
    t.objectStore('kv').delete('currentOrderId');
    t.oncomplete = resolve;
    t.onerror = t.onabort = () => reject(t.error);
  });
}

/**
 * Save a kitchen ticket and the order that now counts it as sent in ONE
 * transaction: a crash can never leave a ticket without the order knowing
 * (which would print the same dishes twice) or the reverse (the kitchen never told).
 */
export function saveKotWithOrder(kot, order) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(['kots', 'orders'], 'readwrite');
        t.objectStore('kots').put(kot);
        t.objectStore('orders').put(order);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

/** ORD-YYMMDD-NNN, the name of an order while it is open or held. */
export async function nextOrderNumber(now = new Date()) {
  const d = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const key = `ordseq:${d}`;
  const n = ((await kv.get(key)) || 0) + 1;
  await kv.set(key, n);
  return `ORD-${d}-${String(n).padStart(3, '0')}`;
}

/** Kitchen ticket number: 1, 2, 3 ... counting up through the day on this phone. */
export async function nextKotNumber(now = new Date()) {
  const d = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const key = `kotseq:${d}`;
  const n = ((await kv.get(key)) || 0) + 1;
  await kv.set(key, n);
  return n;
}

/** OFF-YYMMDD-NNN, counting up through the day on this phone. */
export async function nextLocalNumber(now = new Date()) {
  const d = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const key = `seq:${d}`;
  const n = ((await kv.get(key)) || 0) + 1;
  await kv.set(key, n);
  return `OFF-${d}-${String(n).padStart(3, '0')}`;
}

export const newId = () =>
  (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`);
