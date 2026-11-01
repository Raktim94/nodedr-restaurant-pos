import type { NextConfig } from "next";

// Browser only ever talks to ONE origin (this Next.js server) — API calls
// are proxied server-side to the backend. Same reasoning as nodedr-pos:
// this keeps the session cookie first-party, avoiding the cross-origin
// cookie fragility that broke that app's very first version. NOTE: Next
// bakes the rewrite destination at build time, so in Docker this must come
// from a build ARG, not a runtime env var (see nodedr-pos memory).
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:4001";

// Baseline response headers for every page. A Content-Security-Policy is
// intentionally NOT set here: a strict script-src without a per-request nonce
// silently stops Next.js hydrating in production, so CSP needs a nonce
// middleware of its own. camera=(self) is kept for the order-ticket QR scanner.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    // The backend's upload folder (proxied through /api) plus the app's own
    // static images. Deliberately not "/**": that would let the optimizer fetch
    // internal API routes. Nothing external is allowed.
    localPatterns: [
      { pathname: "/api/uploads/**" },
      { pathname: "/logo.png" },
      { pathname: "/brand-lockup.png" },
      { pathname: "/screenshots/**" },
      { pathname: "/icons/**" },
    ],
    // WebP only: AVIF is smaller but slow to encode on a small restaurant PC.
    formats: ["image/webp"],
    // Uploaded files have random names and are never overwritten.
    minimumCacheTTL: 60 * 60 * 24 * 365,
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // socket.io's endpoint is literally "/socket.io/" — the backend 404s on the
  // slash-less form, so Next must not redirect it.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` },
      // Realtime push (socket.io) goes through the same origin too: in
      // production only this web server is reachable, never the backend's
      // own port. socket.io starts with long-polling, which proxies fine.
      // Literal first: an empty :path* would drop the trailing slash.
      { source: "/socket.io/", destination: `${BACKEND_URL}/socket.io/` },
      { source: "/socket.io/:path+", destination: `${BACKEND_URL}/socket.io/:path+` },
    ];
  },
};

export default nextConfig;
