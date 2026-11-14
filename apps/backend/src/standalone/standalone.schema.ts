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
  // Why the discount was given (the phone asks for it when the restaurant requires one).
  discountReason: z.string().trim().max(200).optional(),
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
  | 'DISCOUNT_NOT_ALLOWED' // a price below the menu or a discount the signed-in account may not give
  | 'SALE_TOO_OLD' // the phone's sale time is older than the books can take automatically
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

// ---------------------------------------------------------------- bookings ---

const reservationStatus = z.enum([
  'RESERVED',
  'CONFIRMED',
  'ARRIVED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);

/**
 * A booking as the phone holds it. The id is made on the phone and must start
 * with "ph_": that prefix is how the server knows the phone may edit the
 * details. Bookings made on the server can only have their status changed.
 */
export const phoneReservationSchema = z
  .object({
    id: z
      .string()
      .regex(/^ph_[A-Za-z0-9-]{8,60}$/, 'Booking id must look like ph_<uuid>')
      .optional(),
    serverId: z.string().min(8).max(64).optional(),
    customerName: z.string().trim().min(1).max(100),
    phone: z.string().trim().max(30).optional(),
    guestCount: z.number().int().min(1).max(500),
    reservedAt: z.string().datetime(),
    durationMinutes: z.number().int().min(15).max(600).default(90),
    tableId: z.string().max(64).optional(),
    specialRequests: z.string().trim().max(300).optional(),
    status: reservationStatus,
    /** When the phone last changed this booking: the newer side wins. */
    updatedAt: z.string().datetime(),
  })
  .strict()
  .refine((r) => !!r.id !== !!r.serverId, {
    message:
      'Send either id (made on the phone) or serverId (made on the server)',
  });

export const reservationSyncSchema = z
  .object({
    deviceName: z.string().max(60).optional(),
    reservations: z.array(phoneReservationSchema).min(1).max(100),
  })
  .strict();

export type PhoneReservationDto = z.infer<typeof phoneReservationSchema>;
export type ReservationSyncDto = z.infer<typeof reservationSyncSchema>;

export type ReservationSyncResult = {
  key: string; // the id or serverId the phone sent
  status: 'saved' | 'server_newer' | 'refused';
  reason?: string;
  reservation?: PhoneReservationView;
};

export type PhoneReservationView = {
  id: string;
  mine: boolean; // made on a phone (the phone may edit its details)
  customerName: string;
  phone: string | null;
  guestCount: number;
  reservedAt: string;
  durationMinutes: number;
  tableId: string | null;
  specialRequests: string | null;
  status: z.infer<typeof reservationStatus>;
  updatedAt: string;
};
