// Service worker for the kiosk, served from /kiosk/sw.js so its default scope
// is /kiosk/ (it can never see /api or the staff dashboard).
//
// What it caches — and nothing else:
//   - hashed, immutable build assets (/_next/static/*) and the app icons
//   - the kiosk page shell for offline start-up. The shell is public HTML/JS
//     that contains no menu, no prices and no order data; those come from
//     /api, which is never intercepted.
// Orders are NEVER queued or answered from cache: submitting needs the live
// restaurant server, and a cached screen is never evidence an order exists.

const SW = `
const CACHE = "kiosk-shell-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
const isStatic = (url) =>
  url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) return;
  if (isStatic(url)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }
  if (req.mode === "navigate" && url.pathname.startsWith("/kiosk/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error()))
    );
  }
});
`;

export async function GET() {
  return new Response(SW, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/kiosk/",
    },
  });
}
