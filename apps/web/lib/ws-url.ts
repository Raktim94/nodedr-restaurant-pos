// NEXT_PUBLIC_* vars are inlined at build time, so a literal default here
// would bake in whatever host built the bundle (e.g. "localhost") — every
// OTHER device on the LAN (another till, a tablet) would then try to reach
// its OWN localhost instead of the actual server, silently breaking
// realtime push on every device but the one that ran `next build`. Falling
// back to the browser's own current hostname at connect time instead means
// this works correctly from any device that loaded the page from the real
// server address, with no per-deployment env var required. Shared by every
// socket.io-client consumer (use-realtime.ts, notification-bell.tsx,
// use-kds-sound.ts) so the fallback logic only lives in one place.
export function resolveWsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:4001`;
  }
  return "http://localhost:4001";
}
