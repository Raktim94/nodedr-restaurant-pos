import {
  NO_CAPABILITIES,
  type CredentialField,
  type IntegrationProvider,
  type ProviderCapabilities,
  type TestResult,
} from './provider';

/**
 * Food-delivery platforms that only integrate with restaurants through a
 * partner programme. The restaurant stores the credentials the platform issued
 * to it; OrderRestro keeps them encrypted.
 *
 * What this adapter does NOT do, on purpose: it has no verified client for the
 * platform's order API, so it cannot receive orders, change an order's status
 * or confirm the credentials work. `testConnection` therefore never reports
 * CONNECTED - it reports PENDING_CONFIGURATION with the reason. Replace this
 * class with a real adapter once API access and a sandbox are available.
 */
export class PartnerApiProvider implements IntegrationProvider {
  readonly category = 'FOOD_DELIVERY' as const;
  readonly capabilities: ProviderCapabilities = { ...NO_CAPABILITIES };

  constructor(
    readonly key: string,
    readonly name: string,
    readonly description: string,
    readonly accountIdLabel: string,
    readonly credentialFields: CredentialField[],
    readonly requirements: string,
  ) {}

  testConnection(): Promise<TestResult> {
    return Promise.resolve({
      ok: false,
      status: 'PENDING_CONFIGURATION',
      message: `Credentials are saved, but ${this.name} order sync is not active: OrderRestro has no verified connection to the ${this.name} partner API yet. ${this.requirements}`,
    });
  }
}
