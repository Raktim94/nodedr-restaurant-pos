"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { useEffect, useState } from "react";
import { persistOfflineCache, restoreOfflineCache } from "@/lib/offline-cache";
import { I18nProvider } from "@/lib/i18n/context";

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 10_000, retry: 1 },
        },
      }),
  );

  // After the first render (so the server and browser HTML match), bring back
  // what the screens last showed and keep saving it.
  useEffect(() => {
    restoreOfflineCache(queryClient);
    return persistOfflineCache(queryClient);
  }, [queryClient]);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </I18nProvider>
      <Toaster position="top-center" closeButton />
    </ThemeProvider>
  );
}
