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

// --- Delivery (Phase 5) ---------------------------------------------------

export const deliveryStatusSchema = z.enum([
  "UNASSIGNED",
  "ASSIGNED",
  "PICKED_UP",
  "DELIVERED",
  "FAILED",
]);
export type DeliveryStatusDto = z.infer<typeof deliveryStatusSchema>;

export const deliveryInfoSchema = z.object({
  address: z.string().trim().min(5).max(300),
  pincode: z.string().trim().min(3).max(12),
  phone: z.string().trim().min(6).max(20),
});
export type DeliveryInfoDto = z.infer<typeof deliveryInfoSchema>;

export const deliveryZoneSchema = z.object({
  name: z.string().trim().min(1).max(60),
  fee: z.coerce.number().min(0).default(0),
  minOrderAmount: z.coerce.number().min(0).default(0),
  etaMinutes: z.coerce.number().int().min(5).max(240).default(45),
  pincodes: z.array(z.string().trim().min(3).max(12)).min(1),
  isActive: z.boolean().default(true),
});
export type DeliveryZoneDto = z.infer<typeof deliveryZoneSchema>;
export const deliveryZoneUpdateSchema = deliveryZoneSchema.partial();
export type DeliveryZoneUpdateDto = z.infer<typeof deliveryZoneUpdateSchema>;

export const assignDriverSchema = z.object({ driverId: z.string().min(1) });
export const deliveryStatusUpdateSchema = z.object({
  status: deliveryStatusSchema,
});

export const createOrderSchema = z.object({
  type: orderTypeSchema.default("DINE_IN"),
  tableId: z.string().optional(),
  guestCount: z.number().int().positive().optional(),
  customerId: z.string().optional(),
  guestName: z.string().trim().min(1).max(60).optional(),
  notes: z.string().optional(),
  // Required when type is DELIVERY (validated against the branch's zones).
  delivery: deliveryInfoSchema.optional(),
  // Scheduled order: ISO time in the future; the kitchen starts then.
  scheduledFor: z.string().datetime().optional(),
  items: z.array(cartItemSchema).min(1),
});
export type CreateOrderDto = z.infer<typeof createOrderSchema>;

export const addOrderItemsSchema = z.object({
  items: z.array(cartItemSchema).min(1),
});
export type AddOrderItemsDto = z.infer<typeof addOrderItemsSchema>;

// Guest self-order from a table's QR code — no account, so a name is the
// only way staff can tell whose order this is (shown on KDS/order lists).
export const publicOrderSchema = z.object({
  guestName: z.string().trim().min(1, "Please enter your name").max(60),
  items: z.array(cartItemSchema).min(1),
});
export type PublicOrderDto = z.infer<typeof publicOrderSchema>;

export const checkoutSchema = z.object({
  customerId: z.string().optional(),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  discountFlat: z.coerce.number().min(0).optional(),
  tipAmount: z.coerce.number().min(0).optional(),
  loyaltyPointsToRedeem: z.number().int().min(0).optional(),
  giftCardCode: z.string().optional(),
  payments: z
    .array(
      z.object({
        method: paymentMethodSchema,
        amount: z.coerce.number().positive(),
        reference: z.string().optional(),
      }),
    )
    .default([]),
});
export type CheckoutDto = z.infer<typeof checkoutSchema>;

export const refundSchema = z.object({
  amount: z.coerce.number().positive(),
  reason: z.string().optional(),
  method: paymentMethodSchema,
});
export type RefundDto = z.infer<typeof refundSchema>;

export const mergeOrdersSchema = z.object({
  sourceOrderId: z.string(),
});
export type MergeOrdersDto = z.infer<typeof mergeOrdersSchema>;

export const kotItemStatusUpdateSchema = z.object({
  status: kotStatusSchema,
});
export type KotItemStatusUpdateDto = z.infer<typeof kotItemStatusUpdateSchema>;


export const publicRequestSchema = z.object({ type: z.enum(["WAITER", "BILL"]) });
export type PublicRequestDto = z.infer<typeof publicRequestSchema>;
