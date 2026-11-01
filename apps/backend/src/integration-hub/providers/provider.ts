// The contract every integration adapter implements. A provider declares what
// it can do (`capabilities`) and implements only that; the hub checks
// `capabilities` before calling an optional method, so an unsupported
// operation is reported plainly instead of failing obscurely or being faked.
//
// Writing a new adapter: implement IntegrationProvider, then add it to
// providers/registry.ts. Nothing in POS, KDS or order management changes.

export type IntegrationCategory =
  | 'FOOD_DELIVERY'
  | 'PAYMENT'
  | 'ACCOUNTING'
  | 'MARKETING'
  | 'MESSAGING'
  | 'AUTOMATION';

export interface ProviderCapabilities {
  /** The platform can push or serve new orders to us. */
  receiveOrders: boolean;
  /** We can tell the platform an order was accepted / rejected / is ready. */
  updateOrderStatus: boolean;
  /** We can pass on a cancellation. */
  cancelOrders: boolean;
  /** The platform sends us webhooks. */
  webhooks: boolean;
  /** The platform can be linked with OAuth instead of pasted keys. */
  oauth: boolean;
}

export interface CredentialField {
  key: string;
  label: string;
  /** Secret fields are encrypted at rest, masked in the UI and never returned. */
  secret: boolean;
  required: boolean;
  help?: string;
}

export interface ProviderContext {
  restaurantId: string;
  externalAccountId: string | null;
  /** Decrypted only for the duration of one call. */
  credentials: Record<string, string>;
}

export interface TestResult {
  ok: boolean;
  /** Hub status this result maps to. */
  status: 'CONNECTED' | 'PENDING_CONFIGURATION' | 'AUTH_EXPIRED' | 'SYNC_ERROR';
  message: string;
}

export interface IntegrationProvider {
  readonly key: string;
  readonly name: string;
  readonly category: IntegrationCategory;
  readonly description: string;
  readonly capabilities: ProviderCapabilities;
  readonly credentialFields: CredentialField[];
  /** Label for the account id on the other platform, e.g. "Merchant ID". */
  readonly accountIdLabel?: string;
  /** When true the account id may be left blank. */
  readonly accountIdOptional?: boolean;
  /** Honest note about what must exist outside OrderRestro before this works. */
  readonly requirements?: string;

  /** Check the saved credentials against the platform. Must never claim success it did not observe. */
  testConnection(ctx: ProviderContext): Promise<TestResult>;

  // Optional: only called when the matching capability is true.
  updateOrderStatus?(
    ctx: ProviderContext,
    externalOrderId: string,
    status: 'ACCEPTED' | 'REJECTED' | 'READY' | 'CANCELLED',
    reason?: string,
  ): Promise<void>;
  processWebhook?(
    ctx: ProviderContext,
    headers: Record<string, string>,
    rawBody: string,
  ): Promise<{ externalOrderId?: string }>;
  refreshCredentials?(ctx: ProviderContext): Promise<Record<string, string>>;
}

export const NO_CAPABILITIES: ProviderCapabilities = {
  receiveOrders: false,
  updateOrderStatus: false,
  cancelOrders: false,
  webhooks: false,
  oauth: false,
};
