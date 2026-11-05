import { GatewayError } from './adapter';

export interface HttpOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

/**
 * One place for outbound calls: bounded time, no redirects followed (a
 * redirect would resend credentials elsewhere) and error text that never
 * echoes a request header or body, so a secret cannot reach logs or the UI.
 */
export async function gatewayFetch<T>(
  url: string,
  opts: HttpOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body,
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch {
    throw new GatewayError('The payment provider could not be reached');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new GatewayError(
      providerMessage(json) ?? `The provider answered HTTP ${res.status}`,
      res.status,
    );
  }
  return json as T;
}

interface ProviderErrorShape {
  error?: { description?: unknown; message?: unknown };
  message?: unknown;
}

function providerMessage(json: unknown): string | null {
  const j = (json ?? {}) as ProviderErrorShape;
  const m =
    j.error?.description ?? // Razorpay
    j.error?.message ?? // Stripe
    j.message; // Cashfree
  return typeof m === 'string' ? m.slice(0, 200) : null;
}

export function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}
