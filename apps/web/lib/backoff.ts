// Retry timing and rules for updates queued on a phone (lib/outbox.ts). Pure, so it is unit tested.

/** 2s, 4s, 8s ... capped at 60s, each spread +-30% so many phones coming back at once do not retry in step. */
export function retryDelay(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.7 + rand() * 0.6));
}

/**
 * Should a failed send be kept and tried again? `status` is the HTTP status, or null when no answer came back
 * (no network, server off, timed out). 401 is kept for after sign-in. Other 4xx answers are final.
 */
export function shouldRetry(status: number | null): boolean {
  if (status === null) return true;
  return status === 401 || status === 408 || status === 429 || status >= 500;
}
