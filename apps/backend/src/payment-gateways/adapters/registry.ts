import type { PaymentGatewayAdapter } from './adapter';
import { cashfreeAdapter } from './cashfree.adapter';
import { razorpayAdapter } from './razorpay.adapter';
import { stripeAdapter } from './stripe.adapter';

// Add an adapter here and name it in catalog-data.ts. Nothing else changes.
const ADAPTERS: PaymentGatewayAdapter[] = [
  razorpayAdapter,
  stripeAdapter,
  cashfreeAdapter,
];
const BY_KEY = new Map(ADAPTERS.map((a) => [a.key, a]));

export const getAdapter = (key: string | null | undefined) =>
  key ? (BY_KEY.get(key) ?? null) : null;
export const listAdapters = () => ADAPTERS;
