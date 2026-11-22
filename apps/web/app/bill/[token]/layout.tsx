import type { Metadata } from "next";
import type { ReactNode } from "react";

// The token that opens a guest's bill is in the URL: keep the page out of search indexes and never leak the URL
// to other sites through the Referer header.
export const metadata: Metadata = {
  title: "Your bill",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function BillLayout({ children }: { children: ReactNode }) {
  return children;
}
