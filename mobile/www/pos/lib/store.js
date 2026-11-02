// Everything the standalone POS keeps on the phone, in IndexedDB:
//   kv    small values: the menu snapshot, who is signed in, settings, counters
//   sales every sale taken, with whether the server has it yet
const DB = 'orderrestro-pos';
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('kv');
        const s = db.createObjectStore('sales', { keyPath: 'id' });
        s.createIndex('status', 'status');
        s.createIndex('soldAt', 'soldAt');
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
