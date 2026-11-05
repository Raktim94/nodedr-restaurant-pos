// Country -> gateway catalog (built-in rows). Data only: payment behaviour
// comes from the adapter named in `adapter`, never from this file, so a
// provider can be added, retired or re-pointed here without touching payment
// logic. At start-up these rows are written to payment_gateway_catalog; an
// administrator can switch them off or add their own "custom" rows there.
//
// RESEARCH RECORD - 2026-11-05. Selection criteria: (1) offers a hosted
// checkout or payment-link API usable without handling card data; (2) is an
// established acquirer/aggregator that serves merchants in that country
// according to its own documentation or its regulator; (3) breadth of
// documented developer APIs. The order is NOT a ranking. Vendor documents
// were read for Razorpay, Stripe and Cashfree (the three with adapters);
// the others were checked only for country availability from the sources
// below and have no adapter, so they are listed for reference and are not
// presented as working integrations.
export interface CatalogSeed {
  key: string;
  name: string;
  countries: string[];
  integration: string;
  docsUrl: string;
  adapter: string | null;
  notes?: string;
  sources: string[];
  active?: boolean;
}

export const RESEARCHED_AT = '2026-11-05';

const S = {
  razorpay:
    'https://razorpay.com/docs/api/payments/payment-links/create-standard',
  razorpayWh: 'https://razorpay.com/docs/webhooks/validate-test/',
  stripeCheckout: 'https://docs.stripe.com/api/checkout/sessions/create',
  stripeWh: 'https://docs.stripe.com/webhooks',
  cashfree:
    'https://www.cashfree.com/docs/api-reference/payments/latest/payment-links/create-payment-link',
  rbi: 'https://www.business-standard.com/finance/news/payu-secures-final-rbi-approval-as-online-payment-aggregator-125051301470_1.html',
  ccavenue:
    'https://www.ccavenue.com/pr/infibeam-avenues-receives-rbis-final-authorisation-for-payment-aggregator-licence',
  phonepe: 'https://developer.phonepe.com/payment-gateway',
  braintree:
    'https://support.wix.com/en/article/setting-up-braintree-as-a-payment-gateway',
  paycomet: 'https://paycomet.com/en/payment-methods/spain',
  redsys: 'https://docs.monei.com/onboarding/connect-redsys-tpv-virtual/',
};

const NO_ADAPTER = 'No OrderRestro integration yet: listed for reference only.';

export const BUILTIN_CATALOG: CatalogSeed[] = [
  {
    key: 'razorpay',
    name: 'Razorpay',
    countries: ['IN'],
    integration: 'Hosted Payment Link',
    docsUrl: S.razorpay,
    adapter: 'razorpay',
    sources: [S.razorpay, S.razorpayWh],
  },
  {
    key: 'cashfree',
    name: 'Cashfree Payments',
    countries: ['IN'],
    integration: 'Hosted Payment Link',
    docsUrl: S.cashfree,
    adapter: 'cashfree',
    notes: 'Needs the payer phone number for each link.',
    sources: [S.cashfree],
  },
  {
    key: 'payu',
    name: 'PayU',
    countries: ['IN'],
    integration: 'Hosted checkout',
    docsUrl: 'https://docs.payu.in/',
    adapter: null,
    notes: NO_ADAPTER,
    sources: [S.rbi],
  },
  {
    key: 'ccavenue',
    name: 'CCAvenue',
    countries: ['IN'],
    integration: 'Hosted checkout',
    docsUrl: 'https://www.ccavenue.com/',
    adapter: null,
    notes: NO_ADAPTER,
    sources: [S.ccavenue],
  },
  {
    key: 'billdesk',
    name: 'BillDesk',
    countries: ['IN'],
    integration: 'Hosted checkout',
    docsUrl: 'https://www.billdesk.com/',
    adapter: null,
    notes:
      NO_ADAPTER +
      ' RBI authorisation date was not confirmed from a primary source.',
    sources: [
      'https://www.medianama.com/2023/02/223-full-list-who-is-and-isnt-allowed-to-operate-as-a-payment-aggregator-in-india/',
    ],
  },
  {
    key: 'phonepe',
    name: 'PhonePe Payment Gateway',
    countries: ['IN'],
    integration: 'Hosted checkout / payment links',
    docsUrl: S.phonepe,
    adapter: null,
    notes:
      NO_ADAPTER +
      ' Off by default: onboarding requirements were not confirmed.',
    sources: [S.phonepe],
    active: false,
  },
  {
    key: 'stripe',
    name: 'Stripe',
    countries: ['US', 'GB', 'ES'],
    integration: 'Hosted Checkout page',
    docsUrl: 'https://docs.stripe.com/payments/checkout',
    adapter: 'stripe',
    notes:
      'Not listed for India: Stripe availability there was limited/invite-only in the sources checked.',
    sources: [
      S.stripeCheckout,
      S.stripeWh,
      'https://wise.com/us/blog/stripe-international',
    ],
  },
  {
    key: 'paypal-braintree',
    name: 'PayPal / Braintree',
    countries: ['US', 'GB'],
    integration: 'Hosted checkout / Drop-in',
    docsUrl: 'https://developer.paypal.com/braintree/docs',
    adapter: null,
    notes: NO_ADAPTER,
    sources: [S.braintree],
  },
  {
    key: 'paypal',
    name: 'PayPal',
    countries: ['ES'],
    integration: 'Hosted checkout',
    docsUrl: 'https://developer.paypal.com/docs/checkout/',
    adapter: null,
    notes: NO_ADAPTER,
    sources: [
      'https://developer.paypal.com/docs/checkout/advanced/eligibility',
    ],
  },
  {
    key: 'square',
    name: 'Square',
    countries: ['US'],
    integration: 'Hosted payment links',
    docsUrl: 'https://developer.squareup.com/docs',
    adapter: null,
    notes:
      NO_ADAPTER + ' Country availability was not re-verified in this pass.',
    sources: [],
  },
  {
    key: 'adyen',
    name: 'Adyen',
    countries: ['US', 'GB', 'ES'],
    integration: 'Pay by Link / hosted checkout',
    docsUrl: 'https://docs.adyen.com/',
    adapter: null,
    notes:
      NO_ADAPTER + ' Country availability was not re-verified in this pass.',
    sources: [],
  },
  {
    key: 'worldpay',
    name: 'Worldpay',
    countries: ['US', 'GB'],
    integration: 'Hosted payment pages',
    docsUrl: 'https://developer.worldpay.com/',
    adapter: null,
    notes:
      NO_ADAPTER + ' Country availability was not re-verified in this pass.',
    sources: [],
  },
  {
    key: 'checkout-com',
    name: 'Checkout.com',
    countries: ['GB'],
    integration: 'Hosted payment links',
    docsUrl: 'https://www.checkout.com/docs',
    adapter: null,
    notes:
      NO_ADAPTER + ' UK headquartered; no merchant-country list was found.',
    sources: [],
  },
  {
    key: 'redsys',
    name: 'Redsys',
    countries: ['ES'],
    integration: 'TPV Virtual (redirect)',
    docsUrl: 'https://pagosonline.redsys.es/',
    adapter: null,
    notes: NO_ADAPTER + ' Needs a contract with a Spanish acquiring bank.',
    sources: [S.redsys],
  },
  {
    key: 'paycomet',
    name: 'PAYCOMET',
    countries: ['ES'],
    integration: 'Hosted payment page',
    docsUrl: 'https://docs.paycomet.com/',
    adapter: null,
    notes: NO_ADAPTER + ' Authorised by the Bank of Spain per its own site.',
    sources: [S.paycomet],
  },
];

/** Countries the built-in catalog covers, plus names for the picker. */
export const COUNTRY_NAMES: Record<string, string> = {
  IN: 'India',
  US: 'United States',
  GB: 'United Kingdom',
  ES: 'Spain',
};
