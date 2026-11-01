import { PartnerApiProvider } from './partner-api.provider';
import type { IntegrationProvider } from './provider';

const PARTNER_NOTE =
  'Live order sync needs partner API access issued to your restaurant by the platform, plus a sandbox to test against.';

const PROVIDERS: IntegrationProvider[] = [
  new PartnerApiProvider(
    'zomato',
    'Zomato',
    'Receive Zomato orders in OrderRestro and send accept / reject back.',
    'Merchant / restaurant ID',
    [
      { key: 'apiKey', label: 'API key', secret: true, required: true },
      {
        key: 'webhookSecret',
        label: 'Webhook secret',
        secret: true,
        required: false,
      },
    ],
    PARTNER_NOTE,
  ),
  new PartnerApiProvider(
    'swiggy',
    'Swiggy',
    'Receive Swiggy orders in OrderRestro and send accept / reject back.',
    'Restaurant / outlet ID',
    [
      { key: 'clientId', label: 'Client ID', secret: false, required: true },
      {
        key: 'clientSecret',
        label: 'Client secret',
        secret: true,
        required: true,
      },
    ],
    PARTNER_NOTE,
  ),
];

const BY_KEY = new Map(PROVIDERS.map((p) => [p.key, p]));

export const listProviders = () => PROVIDERS;
export const getProvider = (key: string) => BY_KEY.get(key);

/** True when the provider declared support for an optional operation. */
export function supports(
  provider: IntegrationProvider,
  op: keyof IntegrationProvider['capabilities'],
): boolean {
  return provider.capabilities[op] === true;
}
