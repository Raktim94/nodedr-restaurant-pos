// SSRF protection for webhook targets. A restaurant admin chooses the URL, so
// without this a malicious or compromised admin could make the server call
// internal services (cloud metadata, the database host, other containers).

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, p) => acc * 256 + Number(p), 0);
}

const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

/** Expands an IPv6 literal (including `::` and a trailing dotted quad) to eight 16-bit groups, or null if malformed. */
function ipv6ToHextets(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]; // drop any zone id
  const dotted = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const o = dotted.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    s =
      s.slice(0, dotted.index) +
      ((o[0] << 8) | o[1]).toString(16) +
      ':' +
      ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) =>
    part === ''
      ? []
      : part
          .split(':')
          .map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const out = [
    ...head,
    ...Array<number>(halves.length === 2 ? fill : 0).fill(0),
    ...tail,
  ];
  return out.length === 8 && out.every((n) => Number.isInteger(n)) ? out : null;
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKED.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (n & mask) >>> 0 === (ipv4ToInt(base) & mask) >>> 0;
    });
  }
  if (kind === 6) {
    const h = ipv6ToHextets(ip);
    if (!h) return true; // cannot be read unambiguously: refuse
    const v4 = (a: number, b: number) =>
      `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
    // Forms that carry an IPv4 address take the IPv4 rules. `new URL()` writes ::ffff:1.2.3.4 as ::ffff:102:304,
    // so these must be recognised from the hextets, not from the dotted text.
    const top5 = h.slice(0, 5).every((x) => x === 0);
    if (top5 && h[5] === 0xffff) return isPrivateAddress(v4(h[6], h[7])); // ::ffff:0:0/96 mapped
    if (top5 && h[5] === 0 && !(h[6] === 0 && h[7] <= 1))
      return isPrivateAddress(v4(h[6], h[7])); // ::/96 compatible
    if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0))
      return isPrivateAddress(v4(h[6], h[7])); // NAT64
    if (h[0] === 0x2002) return isPrivateAddress(v4(h[1], h[2])); // 6to4
    // Everything else is public only if it is global unicast (2000::/3). That excludes ::, ::1, fc00::/7, fe80::/10,
    // multicast, ::ffff:0:0 style translation prefixes and other special ranges in one rule.
    if ((h[0] & 0xe000) !== 0x2000) return true;
    if (h[0] === 0x2001 && h[1] === 0) return true; // Teredo: embeds an obfuscated IPv4 client address
    if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
    return false;
  }
  return true; // not an IP at all: refuse
}

export interface WebhookNetOptions {
  allowPrivate: boolean;
  allowInsecure: boolean;
}

export function netOptionsFromEnv(env = process.env): WebhookNetOptions {
  return {
    allowPrivate: env.WEBHOOKS_ALLOW_PRIVATE === 'true',
    allowInsecure: env.WEBHOOKS_ALLOW_INSECURE === 'true',
  };
}

export interface ResolvedTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

/**
 * Parses and resolves a webhook URL, refusing non-HTTPS (unless allowed) and
 * any host that resolves to a private address. The returned address is what
 * the request must connect to, so DNS cannot change between this check and
 * the connection (DNS rebinding).
 */
export async function resolveWebhookTarget(
  raw: string,
  opts: WebhookNetOptions,
  resolve: (host: string) => Promise<{ address: string; family: number }[]> = (
    h,
  ) => lookup(h, { all: true }),
): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('That is not a valid URL');
  }
  if (
    url.protocol !== 'https:' &&
    !(opts.allowInsecure && url.protocol === 'http:')
  )
    throw new Error('Webhook URLs must use https');
  if (url.username || url.password)
    throw new Error('Put credentials in the signature secret, not the URL');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await resolve(host).catch(() => {
        throw new Error('Could not resolve that host');
      });
  if (addresses.length === 0) throw new Error('Could not resolve that host');
  if (!opts.allowPrivate && addresses.some((a) => isPrivateAddress(a.address)))
    throw new Error('That address points to a private or internal network');

  const first = addresses[0];
  return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
}
