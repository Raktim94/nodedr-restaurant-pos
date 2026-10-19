"use client";

import { RefreshCw } from "lucide-react";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Plain-language reason a request failed, naming a permission problem as one. */
export function describeLoadError(error: unknown, what: string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return `Your session has ended. Sign in again to load ${what}.`;
    if (error.status === 403) return `Your role is not allowed to see ${what}. Ask an administrator to grant access.`;
    if (error.status >= 500) return `The server had a problem loading ${what}. Try again in a moment.`;
    return error.message || `Could not load ${what}.`;
  }
  return `Could not reach the server to load ${what}. Check the connection and try again.`;
}

// Shown in place of a list/grid whose request failed, so a failure is never
// mistaken for "nothing here yet". Always offers a retry.
export function QueryError({
  error,
  what,
  onRetry,
  retrying = false,
  className,
}: {
  error: unknown;
  what: string;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-8 text-center",
        className,
      )}
    >
      <p className="max-w-sm text-sm text-foreground">{describeLoadError(error, what)}</p>
      <Button type="button" variant="outline" className="h-11 px-4" disabled={retrying} onClick={onRetry}>
        <RefreshCw className={cn("h-4 w-4", retrying && "animate-spin")} aria-hidden />
        {retrying ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}
