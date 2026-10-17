import type { Metadata, Viewport } from "next";

// Public self-service kiosk shell. Everything here is deliberately
// independent of the staff dashboard: no sidebar, no auth, no staff links.
// The token only ever appears in the URL the restaurant gave this device.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "Autopedido",
    description: "Pide aquí",
    // Per-token manifest so "Add to Home screen" opens THIS kiosk, not "/".
    manifest: `/kiosk/${encodeURIComponent(token)}/manifest.webmanifest`,
    robots: { index: false, follow: false },
    appleWebApp: { capable: true, title: "Autopedido", statusBarStyle: "black-translucent" },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // A public touchscreen: stray pinch-zoom would break the layout for the
  // next customer. (Browsers with an OS-level "force zoom" accessibility
  // setting still override this, which is the right outcome.)
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // When the on-screen keyboard opens, shrink the layout (so the search box
  // stays visible) instead of panning the page under it.
  interactiveWidget: "resizes-content",
  themeColor: "#9f1239",
};

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Scale rem-based sizes with the available screen so one build serves
          a 23.8" panel, a phone and any Android DPI: no fixed pixel
          resolution is assumed. Only rendered on kiosk routes. */}
      <style>{`
        html { font-size: clamp(14px, min(1.15vw, 2vh), 24px); }
        html, body { overscroll-behavior: none; }
      `}</style>
      <div className="kiosk-root fixed inset-0 overflow-hidden bg-background text-foreground">
        {children}
      </div>
    </>
  );
}
