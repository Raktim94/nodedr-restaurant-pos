import { z } from "zod";

export const orderTypeSchema = z.enum([
  "DINE_IN",
  "TAKEAWAY",
  "DELIVERY",
  "DRIVE_THRU",
  "QR_ORDER",
  "KIOSK",
  "PHONE",
]);
export type OrderTypeDto = z.infer<typeof orderTypeSchema>;

export const kotStatusSchema = z.enum([
  "NEW",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "SERVED",
  "CANCELLED",
]);
export type KotStatusDto = z.infer<typeof kotStatusSchema>;

export const paymentMethodSchema = z.enum([
  "CASH",
  "CARD",
  "UPI",
  "WALLET",
  "BANK_TRANSFER",
  "GIFT_CARD",
  "STORE_CREDIT",
]);
export type PaymentMethodDto = z.infer<typeof paymentMethodSchema>;

export const cartItemModifierSchema = z.object({
  modifierId: z.string(),
});

export const cartItemSchema = z.object({
  menuItemId: z.string(),
  quantity: z.number().int().positive(),
  kitchenNote: z.string().optional(),
  modifierIds: z.array(z.string()).default([]),
});
export type CartItemDto = z.infer<typeof cartItemSchema>;

export const createOrderSchema = z.object({
  type: orderTypeSchema.default("DINE_IN"),
  tableId: z.string().optional(),
  guestCount: z.number().int().positive().optional(),
  customerId: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(cartItemSchema).min(1),
});
export type CreateOrderDto = z.infer<typeof createOrderSchema>;

export const checkoutSchema = z.object({
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  discountFlat: z.coerce.number().min(0).optional(),
  payments: z
    .array(
      z.object({
        method: paymentMethodSchema,
        amount: z.coerce.number().positive(),
        reference: z.string().optional(),
      }),
    )
    .min(1),
});
export type CheckoutDto = z.infer<typeof checkoutSchema>;

export const kotItemStatusUpdateSchema = z.object({
  status: kotStatusSchema,
});
export type KotItemStatusUpdateDto = z.infer<typeof kotItemStatusUpdateSchema>;
