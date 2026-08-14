import { z } from "zod";
import { paymentMethodSchema } from "./orders";

export const ingredientUnitSchema = z.enum([
  "KG",
  "G",
  "L",
  "ML",
  "PIECE",
  "DOZEN",
  "PACK",
  "BOX",
]);
export type IngredientUnit = z.infer<typeof ingredientUnitSchema>;

export const ingredientSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  unit: ingredientUnitSchema,
  reorderLevel: z.coerce.number().nonnegative().default(0),
  isActive: z.boolean().default(true),
});
export type IngredientDto = z.infer<typeof ingredientSchema>;

export const stockAdjustmentSchema = z.object({
  quantity: z.coerce.number(), // signed: positive to add, negative to remove
  note: z.string().min(1),
});
export type StockAdjustmentDto = z.infer<typeof stockAdjustmentSchema>;

export const recipeLineSchema = z.object({
  ingredientId: z.string(),
  quantity: z.coerce.number().positive(),
});
export type RecipeLineDto = z.infer<typeof recipeLineSchema>;

export const setRecipeSchema = z.object({
  lines: z.array(recipeLineSchema),
});
export type SetRecipeDto = z.infer<typeof setRecipeSchema>;

export const supplierSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  gstNumber: z.string().optional(),
  notes: z.string().optional(),
  isActive: z.boolean().default(true),
});
export type SupplierDto = z.infer<typeof supplierSchema>;

export const purchaseOrderItemSchema = z.object({
  ingredientId: z.string(),
  quantityOrdered: z.coerce.number().positive(),
  unitCost: z.coerce.number().nonnegative(),
});
export type PurchaseOrderItemDto = z.infer<typeof purchaseOrderItemSchema>;

export const purchaseOrderSchema = z.object({
  supplierId: z.string(),
  expectedDate: z.coerce.date().optional(),
  notes: z.string().optional(),
  items: z.array(purchaseOrderItemSchema).min(1),
});
export type PurchaseOrderDto = z.infer<typeof purchaseOrderSchema>;

export const purchaseOrderStatusSchema = z.enum([
  "DRAFT",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
]);
export type PurchaseOrderStatus = z.infer<typeof purchaseOrderStatusSchema>;

export const goodsReceiptItemSchema = z.object({
  ingredientId: z.string(),
  purchaseOrderItemId: z.string().optional(),
  quantity: z.coerce.number().positive(),
  unitCost: z.coerce.number().nonnegative(),
  batchNumber: z.string().optional(), // auto-generated server-side if omitted
  expiryDate: z.coerce.date().optional(),
});
export type GoodsReceiptItemDto = z.infer<typeof goodsReceiptItemSchema>;

export const goodsReceiptSchema = z.object({
  supplierId: z.string(),
  purchaseOrderId: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(goodsReceiptItemSchema).min(1),
});
export type GoodsReceiptDto = z.infer<typeof goodsReceiptSchema>;

export const wasteReasonSchema = z.enum([
  "EXPIRED",
  "SPOILED",
  "DAMAGED",
  "PREP_ERROR",
  "OVER_PRODUCTION",
  "OTHER",
]);
export type WasteReason = z.infer<typeof wasteReasonSchema>;

export const wasteLogSchema = z.object({
  ingredientId: z.string(),
  quantity: z.coerce.number().positive(),
  reason: wasteReasonSchema,
  notes: z.string().optional(),
});
export type WasteLogDto = z.infer<typeof wasteLogSchema>;

// ---------------------------------------------------------------------------
// Procurement depth — purchase requests, supplier quotations, vendor invoices
// ---------------------------------------------------------------------------

export const purchaseRequestStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "CONVERTED",
]);
export type PurchaseRequestStatus = z.infer<typeof purchaseRequestStatusSchema>;

export const purchaseRequestItemSchema = z.object({
  ingredientId: z.string(),
  quantityRequested: z.coerce.number().positive(),
  notes: z.string().optional(),
});
export type PurchaseRequestItemDto = z.infer<typeof purchaseRequestItemSchema>;

export const purchaseRequestSchema = z.object({
  notes: z.string().optional(),
  items: z.array(purchaseRequestItemSchema).min(1),
});
export type PurchaseRequestDto = z.infer<typeof purchaseRequestSchema>;

export const quotationStatusSchema = z.enum([
  "DRAFT",
  "RECEIVED",
  "ACCEPTED",
  "REJECTED",
]);
export type QuotationStatus = z.infer<typeof quotationStatusSchema>;

export const supplierQuotationItemSchema = z.object({
  ingredientId: z.string(),
  quantityQuoted: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative(),
});
export type SupplierQuotationItemDto = z.infer<typeof supplierQuotationItemSchema>;

export const supplierQuotationSchema = z.object({
  supplierId: z.string(),
  validUntil: z.coerce.date().optional(),
  notes: z.string().optional(),
  items: z.array(supplierQuotationItemSchema).min(1),
});
export type SupplierQuotationDto = z.infer<typeof supplierQuotationSchema>;

export const supplierInvoiceStatusSchema = z.enum([
  "UNPAID",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
]);
export type SupplierInvoiceStatus = z.infer<typeof supplierInvoiceStatusSchema>;

export const supplierInvoiceSchema = z.object({
  supplierId: z.string(),
  purchaseOrderId: z.string().optional(),
  goodsReceiptId: z.string().optional(),
  invoiceNumber: z.string().min(1),
  invoiceDate: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
  totalAmount: z.coerce.number().positive(),
  notes: z.string().optional(),
});
export type SupplierInvoiceDto = z.infer<typeof supplierInvoiceSchema>;

export const supplierPaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  paymentMethod: paymentMethodSchema,
  reference: z.string().optional(),
});
export type SupplierPaymentDto = z.infer<typeof supplierPaymentSchema>;
