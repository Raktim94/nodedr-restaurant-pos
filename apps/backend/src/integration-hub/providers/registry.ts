import { WebhookOrderProvider } from './webhook-order.provider';
import type { IntegrationProvider } from './provider';

const NOTE =
  'Zomato and Swiggy do not offer a public order API. They deliver orders through the merchant webhook / an aggregator (UrbanPiper, Petpooja, Dotpe and similar) that your restaurant has an account with. Point it at the webhook URL below and sign requests with the secret.';

const PROVIDERS: IntegrationProvider[] = [
  new WebhookOrderProvider(
    'zomato',
    'Zomato',
    'Receive Zomato orders as online orders needing acceptance - via your merchant webhook or an aggregator.',
    NOTE,
    'zomato',
    'Zomato restaurant ID (optional)',
  ),
  new WebhookOrderProvider(
    'swiggy',
    'Swiggy',
    'Receive Swiggy orders as online orders needing acceptance - via your merchant webhook or an aggregator.',
    NOTE,
    'swiggy',
    'Swiggy outlet ID (optional)',
  ),
  new WebhookOrderProvider(
    'aggregator',
    'Aggregator (UrbanPiper, Petpooja, other)',
    'One webhook for any aggregator or channel manager that forwards Zomato, Swiggy and other delivery orders.',
    NOTE,
    'aggregator',
  ),
];

const BY_KEY = new Map(PROVIDERS.map((p) => [p.key, p]));

export const listProviders = () => PROVIDERS;
export const getProvider = (key: string) => BY_KEY.get(key);

/** The externalSource written on orders that arrive through a provider. */
export const sourceOf = (provider: IntegrationProvider): string =>
  provider instanceof WebhookOrderProvider ? provider.source : provider.key;

/** True when the provider declared support for an optional operation. */
export function supports(
  provider: IntegrationProvider,
  op: keyof IntegrationProvider['capabilities'],
): boolean {
  return provider.capabilities[op] === true;
}
