// The contract every payment gateway implements. Each adapter owns its
// provider's request shapes, status vocabulary and webhook signature scheme;
// nothing outside this folder knows how any one gateway works.
//
// Security rule for adapters: a webhook only PROVES the sender and names the
// payment. It never decides the outcome. The outcome always comes from
// `fetchStatus`, a server-to-server call made with the merchant's secret.

export type GatewayModeKey = 'TEST' | 'LIVE';

export interface GatewayField {
  key: string;
  label: string;
  /** Secret fields are encrypted at rest, write-only in the UI, never returned. */
  secret: boolean;
  required: boolean;
  help?: string;
  /** Shape check run before saving, e.g. key prefix per mode. */
  validate?: (value: string, mode: GatewayModeKey) => string | null;
}

export interface GatewayContext {
  mode: GatewayModeKey;
  credentials: Record<string, string>;
}

export interface CreatePaymentInput {
  amountMinor: number;
  currency: string;
  /** Our GatewayPayment id; the provider echoes it back. */
  reference: string;
  description: string;
  returnUrl: string;
  /** Server-to-server notification URL, for providers that take one per request. */
  notifyUrl: string;
  customer?: { name?: string; phone?: string; email?: string };
}

export interface CreatePaymentResult {
  providerRef: string;
  checkoutUrl: string;
}

export interface RemoteStatus {
  state: 'PAID' | 'PENDING' | 'FAILED' | 'EXPIRED';
  /** What the provider says was actually paid (minor units). */
  paidMinor: number;
  /** What the provider says was requested (minor units). */
  requestedMinor: number;
  currency: string;
  /** Our reference as the provider stored it, when it echoes one. */
  reference?: string | null;
  providerPaymentId?: string | null;
}

export interface VerifiedWebhook {
  /** Unique per provider event, for duplicate suppression. */
  eventId: string;
  /** The hosted checkout this event is about, or null if it is not about one. */
  providerRef: string | null;
}

export interface TestOutcome {
  ok: boolean;
  message: string;
}

export interface PaymentGatewayAdapter {
  readonly key: string;
  readonly name: string;
  readonly docsUrl: string;
  readonly integration: string;
  /** Which fields are needed. Webhook secret is required to accept webhooks. */
  readonly fields: GatewayField[];
  /** Cashfree-style providers insist on a payer phone. */
  readonly requiresCustomerPhone?: boolean;
  /** Honest list of what is not implemented. */
  readonly limitations: string[];

  testConnection(ctx: GatewayContext): Promise<TestOutcome>;
  createPayment(
    ctx: GatewayContext,
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult>;
  fetchStatus(ctx: GatewayContext, providerRef: string): Promise<RemoteStatus>;
  /** Throws if the signature is missing, wrong or too old. */
  verifyWebhook(
    ctx: GatewayContext,
    headers: Record<string, string | undefined>,
    rawBody: string,
  ): VerifiedWebhook;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
