// Everything the standalone POS keeps on the phone, in IndexedDB:
//   kv    small values: the menu snapshot, who is signed in, settings, counters
//   sales every sale taken, with whether the server has it yet
const DB = 'orderrestro-pos';
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 5);
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
        if (!db.objectStoreNames.contains('reservations')) db.createObjectStore('reservations', { keyPath: 'id' }); // table bookings
        if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'id' }); // kitchen events waiting for the server
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
  /** Several keys in ONE transaction: all land or none do. */
  setMany: (entries) =>
    tx('kv', 'readwrite', (s) => {
      for (const [k, v] of entries) s.put(v, k);
    }),
};

export const sales = {
  put: (sale) => tx('sales', 'readwrite', (s) => s.put(sale)),
  get: (id) => tx('sales', 'readonly', (s) => s.get(id)),
  // Read, merge and write in ONE readwrite transaction. A separate get/put
  // pair lets a concurrent collection update be overwritten by a sync result.
  merge: (id, merge) =>
    open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction('sales', 'readwrite');
          const store = t.objectStore('sales');
          const req = store.get(id);
          let result;
          req.onsuccess = () => {
            if (!req.result) {
              result = null;
              return;
            }
            result = merge(req.result);
            if (result) store.put(result);
          };
          t.oncomplete = () => resolve(result);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        }),
    ),
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
export const reservations = plain('reservations');

// `events` is the outbox of unsent money/kitchen records (expenses, refunds, collections, till closes). A backup
// without it restores local rows whose server-side record was never sent.
const BACKUP_STORES = ['sales', 'orders', 'kots', 'refunds', 'expenses', 'shifts', 'reservations', 'events'];

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
    // Numbering counters live in kv, not in a store. Back them up too, or a
    // restored phone reissues receipt/bill/KOT numbers from 001.
    out.counters = {};
    const keys = t.objectStore('kv').getAllKeys();
    keys.onsuccess = () => {
      for (const key of keys.result || []) {
        if (!/^(seq|ordseq|kotseq):/.test(key)) continue;
        const req = t.objectStore('kv').get(key);
        req.onsuccess = () => { out.counters[key] = req.result; };
      }
    };
    t.oncomplete = resolve;
    t.onerror = t.onabort = () => reject(t.error);
  });
  return out;
}

/** Highest number already used per counter in a set of rows, read from the numbers themselves. */
export function counterFloors(b) {
  const floors = {};
  const raise = (key, n) => {
    if (Number.isFinite(n) && n > (floors[key] || 0)) floors[key] = n;
  };
  const dayOf = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  };
  for (const s of b.sales || []) {
    const m = /^OFF-(\d{6})-(\d+)$/.exec(String(s.localNumber || s.number || ''));
    if (m) raise(`seq:${m[1]}`, Number(m[2]));
  }
  for (const o of b.orders || []) {
    const m = /^ORD-(\d{6})-(\d+)$/.exec(String(o.number || ''));
    if (m) raise(`ordseq:${m[1]}`, Number(m[2]));
  }
  for (const k of b.kots || []) {
    const day = dayOf(k.at || k.createdAt);
    if (day && Number.isInteger(Number(k.number))) raise(`kotseq:${day}`, Number(k.number));
  }
  return floors;
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
      // A backup made before the outbox was included has no events: keep this phone's queue rather than wiping it.
      if (n === 'events' && !Array.isArray(b.events)) continue;
      const st = t.objectStore(n);
      st.clear();
      for (const row of b[n] || []) st.put(row);
    }
    t.objectStore('kv').put(b.snapshot, 'snapshot');
    const kvs = t.objectStore('kv');
    if (b.counters) {
      for (const [key, value] of Object.entries(b.counters)) {
        if (!/^(seq|ordseq|kotseq):/.test(key)) continue;
        // Restore counters exactly to the backup value. The backup includes
        // all sales up to that point, so restoring the counter rewinds numbering
        // to where the backup left off. Keeping a higher counter (from sales
        // taken after the backup) would reissue duplicate bill numbers.
        const g = kvs.get(key);
        g.onsuccess = () => kvs.put(Number(value) || 0, key);
      }
    } else {
      // A backup made before counters were included: never reissue a number that is in the restored data.
      for (const [key, floor] of Object.entries(counterFloors(b))) {
        const g = kvs.get(key);
        g.onsuccess = () => kvs.put(Math.max(Number(g.result) || 0, floor), key);
      }
    }
    t.objectStore('kv').put(Date.now(), 'snapshotAt');
    t.objectStore('kv').delete('currentOrderId');
    t.oncomplete = resolve;
    t.onerror = t.onabort = () => reject(t.error);
  });
}

/**
 * Finalise a checkout: mark the linked order PAID and consume the resume
 * marker in ONE transaction. Killing the app between those two writes used to
 * leave a stale marker whose signature matched the next identical purchase —
 * the already-paid sale was reused and the new sale never recorded.
 */
export function completeCheckout(orderId, saleId, paidAt) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const stores = orderId ? ['orders', 'kv'] : ['kv'];
        const t = db.transaction(stores, 'readwrite');
        if (orderId) {
          const os = t.objectStore('orders');
          const req = os.get(orderId);
          req.onsuccess = () => {
            const current = req.result;
            if (current) {
              os.put({ ...current, status: 'PAID', saleId, paidAt });
            }
          };
        }
        t.objectStore('kv').delete('pendingSale');
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
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

/**
 * Add one to a counter and return the new value, atomically. Reading and writing in two separate
 * transactions let two quick taps read the same value and hand out the same number twice; a single
 * readwrite transaction on the store is serialized by IndexedDB, so every caller gets its own.
 */
function bump(key) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction('kv', 'readwrite');
        const st = t.objectStore('kv');
        let n = 0;
        const g = st.get(key);
        g.onsuccess = () => {
          n = (Number(g.result) || 0) + 1;
          st.put(n, key);
        };
        t.oncomplete = () => resolve(n);
        t.onerror = t.onabort = () => reject(t.error);
      }),
  );
}

/** ORD-YYMMDD-NNN, the name of an order while it is open or held. */
export async function nextOrderNumber(now = new Date()) {
  const d = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const key = `ordseq:${d}`;
  const n = await bump(key);
  return `ORD-${d}-${String(n).padStart(3, '0')}`;
}

/** Kitchen ticket number: 1, 2, 3 ... counting up through the day on this phone. */
export async function nextKotNumber(now = new Date()) {
  const d = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const key = `kotseq:${d}`;
  const n = await bump(key);
  return n;
}

/** OFF-YYMMDD-NNN, counting up through the day on this phone. */
export async function nextLocalNumber(now = new Date()) {
  const d = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const key = `seq:${d}`;
  const n = await bump(key);
  return `OFF-${d}-${String(n).padStart(3, '0')}`;
}

export const newId = () =>
  (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`);

export const events = {
  put: (e) => tx('events', 'readwrite', (s) => s.put(e)),
  get: (id) => tx('events', 'readonly', (s) => s.get(id)),
  del: (id) => tx('events', 'readwrite', (s) => s.delete(id)),
  all: () => tx('events', 'readonly', (s) => s.getAll()).then((a) => a.sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))),
};
