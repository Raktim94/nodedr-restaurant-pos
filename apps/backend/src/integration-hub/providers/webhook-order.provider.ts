import {
  NO_CAPABILITIES,
  type CredentialField,
  type IntegrationProvider,
  type ProviderCapabilities,
  type TestResult,
} from './provider';

/**
 * Food-delivery platforms that deliver orders to a restaurant's own endpoint:
 * either the platform's merchant webhook (where the restaurant has one) or an
 * aggregator / channel manager the restaurant already pays for (UrbanPiper,
 * Petpooja, Dotpe ...) that forwards Zomato and Swiggy orders.
 *
 * OrderRestro publishes one signed, documented inbound endpoint (see
 * docs/INTEGRATIONS.md). This adapter has no outbound client: it never calls
 * the platform, so it can never claim a connection it has not seen. The hub
 * marks it CONNECTED only after a correctly signed delivery really arrived.
 */
export class WebhookOrderProvider implements IntegrationProvider {
  readonly category = 'FOOD_DELIVERY' as const;
  readonly capabilities: ProviderCapabilities = {
    ...NO_CAPABILITIES,
    receiveOrders: true,
    webhooks: true,
  };
  readonly accountIdOptional = true;
  readonly credentialFields: CredentialField[] = [
    {
      key: 'webhookSecret',
      label: 'Webhook signing secret',
      secret: true,
      required: true,
      help: 'Any long random string (16+ characters). Paste the same value into the aggregator / merchant webhook settings; it signs every order.',
    },
  ];

  constructor(
    readonly key: string,
    readonly name: string,
    readonly description: string,
    readonly requirements: string,
    /** Stored on each order as externalSource. */
    readonly source: string,
    readonly accountIdLabel?: string,
  ) {}

  testConnection(): Promise<TestResult> {
    return Promise.resolve({
      ok: false,
      status: 'PENDING_CONFIGURATION',
      message: `Secret saved. Waiting for the first signed delivery from ${this.name}: send a test order or a "ping" event from the aggregator, and this turns Connected when it arrives.`,
    });
  }
}
