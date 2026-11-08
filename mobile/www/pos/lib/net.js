// Talking to the restaurant server from the phone. Inside the app requests go
// through the native HTTP client, which works for a plain-http computer on the
// WiFi as well as for an https address, and keeps the sign-in cookie.
const cap = () => window.Capacitor;
const plugins = () => (cap() && cap().Plugins) || {};

export const native = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());

export async function request(base, method, path, body, { timeout = 15000 } = {}) {
  const url = base + path;
  const http = plugins().CapacitorHttp;
  if (http) {
    const r = await http.request({
      url,
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      data: body === undefined ? undefined : body,
      connectTimeout: timeout,
      readTimeout: timeout,
    });
    return { status: r.status, data: r.data };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    let data = null;
    try {
      data = await r.json();
    } catch {
      /* no body */
    }
    return { status: r.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** Is an OrderRestro server answering at this address? */
export async function reachable(base, timeout = 3500) {
  try {
    const r = await request(base, 'GET', '/api/v1/auth/setup-status', undefined, { timeout });
    return r.status === 200 && r.data && typeof r.data.isSetup === 'boolean';
  } catch {
    return false;
  }
}

/** The saved server addresses (local first), from the native link plugin. */
export async function savedServers() {
  const link = plugins().ServerLink;
  if (!link) return [];
  try {
    const c = await link.current();
    return [c.localUrl, c.externalUrl, c.url].filter(Boolean).filter((u, i, a) => a.indexOf(u) === i);
  } catch {
    return [];
  }
}

/** First address that answers right now (the one signed in to, then the saved ones), or null (we are offline). */
export async function pickServer(preferred) {
  const list = [preferred, ...(await savedServers())].filter(Boolean).filter((u, i, a) => a.indexOf(u) === i);
  for (const base of list) {
    if (await reachable(base)) return base;
  }
  return null;
}

/**
 * What the server says about itself: product, version, API level, capabilities.
 * Returns null when nothing OrderRestro answers. `ms` is the round-trip time.
 */
export async function serverInfo(base, timeout = 4000) {
  const t0 = Date.now();
  try {
    const r = await request(base, 'GET', '/api/v1/mobile/server-info', undefined, { timeout });
    if (r.status === 200 && r.data && r.data.product === 'orderrestro') return { ...r.data, ms: Date.now() - t0, legacy: false };
    // Servers older than this feature only have setup-status: still an OrderRestro server, but no capabilities.
    if (await reachable(base, timeout)) return { product: 'orderrestro', version: 'unknown', apiVersion: 1, capabilities: {}, ms: Date.now() - t0, legacy: true };
  } catch {
    /* fall through */
  }
  return null;
}

/** Check every saved address and report each one, so the user can see local and online separately. */
export async function checkAll() {
  const link = plugins().ServerLink;
  let cur = {};
  try {
    cur = link ? await link.current() : {};
  } catch {
    /* no native link */
  }
  const rows = [
    { kind: 'Local', url: cur.localUrl },
    { kind: 'Online', url: cur.externalUrl },
  ].filter((r) => r.url);
  if (!rows.length) {
    const base = await pickServer();
    if (base) rows.push({ kind: /^https:/.test(base) ? 'Online' : 'Local', url: base });
  }
  const out = await Promise.all(rows.map(async (r) => ({ ...r, info: await serverInfo(r.url) })));
  return { rows: out, using: cur.mode || '' };
}
