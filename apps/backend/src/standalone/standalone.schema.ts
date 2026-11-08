import { z } from 'zod';

const money = z.coerce.number().min(0).max(10_000_000);

export const offlineSaleSchema = z.object({
  /** The phone's own id for this sale: the key that makes a re-send harmless. */
  id: z.string().min(8).max(64),
  /** Number printed on the phone's receipt, kept in the order notes. */
  localNumber: z.string().max(40),
  soldAt: z.string().datetime(),
  type: z.enum(['DINE_IN', 'TAKEAWAY']).default('TAKEAWAY'),
  tableLabel: z.string().max(40).optional(),
  note: z.string().max(300).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(999),
        /** Price the customer was charged, in the menu's own terms. */
        unitPrice: money,
      }),
    )
    .min(1)
    .max(100),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  discountFlat: money.optional(),
  payments: z
    .array(
      z.object({
        method: z.enum(['CASH', 'CARD', 'UPI', 'OTHER']),
        amount: z.coerce.number().positive(),
        tendered: z.coerce.number().positive().optional(),
        reference: z.string().max(100).optional(),
      }),
    )
    .min(1)
    .max(6),
});

export const offlineSalesSchema = z.object({
  /** Which phone sent these (for the audit trail). */
  deviceName: z.string().max(60).optional(),
  sales: z.array(offlineSaleSchema).min(1).max(50),
});

export type OfflineSaleDto = z.infer<typeof offlineSaleSchema>;
export type OfflineSalesDto = z.infer<typeof offlineSalesSchema>;

/**
 * Something the owner should look at, even though the sale was recorded: the
 * customer paid what the phone showed, which no longer matches the server.
 */
export type SaleReviewFlag = {
  type: 'PRICE_CHANGED';
  menuItemId: string;
  name: string;
  phonePrice: number;
  serverPrice: number;
};

/** Why a sale was not recorded. The phone keeps it and offers the right next step. */
export type RefusalCode =
  | 'ITEM_UNAVAILABLE' // a dish was removed or switched off on the server
  | 'ALREADY_STARTED' // an earlier attempt left an unfinished order
  | 'PRICE_CONFLICT' // the same dish at two prices inside one sale
  | 'PAYMENT_REJECTED' // the server's checkout rules refused the payment or discount
  | 'OTHER';

export type OfflineSaleResult =
  | {
      id: string;
      status: 'created' | 'duplicate';
      orderId: string;
      orderNumber: string;
      review?: SaleReviewFlag[];
    }
  | { id: string; status: 'refused'; code: RefusalCode; reason: string };
