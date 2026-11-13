import { z } from "zod";
import { ingredientUnitSchema, wasteReasonSchema } from "./inventory";

// Stock journal: daily production (actual quantities used / produced) and food waste.
// Quantities travel as strings or numbers and are parsed as exact decimals on the server.
const qty = z.union([z.string().trim().min(1), z.number()]).transform(String);

export const productionLineSchema = z.object({
  ingredientId: z.string().min(1),
  quantity: qty,
  unit: ingredientUnitSchema,
});
export type ProductionLineDto = z.infer<typeof productionLineSchema>;

export const productionEntrySchema = z.object({
  producedAt: z.coerce.date().optional(),
  shift: z.string().trim().max(40).optional(),
  location: z.string().trim().max(80).optional(),
  batchRef: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(1000).optional(),
  responsibleId: z.string().optional(),
  inputs: z.array(productionLineSchema).min(1, "Add at least one ingredient used"),
  outputs: z.array(productionLineSchema).min(1, "Add the finished quantity produced"),
  /** Stable key made on the device so a retried upload cannot post twice. */
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  deviceId: z.string().trim().max(120).optional(),
  /** true = post straight away, false/omitted = save as a draft. */
  post: z.boolean().default(false),
});
export type ProductionEntryDto = z.infer<typeof productionEntrySchema>;

export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const correctProductionSchema = productionEntrySchema
  .omit({ post: true })
  .extend({ reason: z.string().trim().min(3).max(500) });
export type CorrectProductionDto = z.infer<typeof correctProductionSchema>;

export const wasteEntrySchema = z
  .object({
    ingredientId: z.string().min(1),
    quantity: qty,
    unit: ingredientUnitSchema,
    reason: wasteReasonSchema,
    shift: z.string().trim().max(40).optional(),
    location: z.string().trim().max(80).optional(),
    note: z.string().trim().max(1000).optional(),
    occurredAt: z.coerce.date().optional(),
    /** Already counted in a production entry's output shortfall: record, do not deduct again. */
    includedInProduction: z.boolean().default(false),
    productionEntryId: z.string().optional(),
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
    deviceId: z.string().trim().max(120).optional(),
  })
  .refine((v) => v.reason !== "OTHER" || (v.note && v.note.length >= 3), {
    message: "Say what happened when the reason is Other",
    path: ["note"],
  })
  .refine((v) => !v.includedInProduction || !!v.productionEntryId, {
    message: "Pick the production entry this loss belongs to",
    path: ["productionEntryId"],
  });
export type WasteEntryDto = z.infer<typeof wasteEntrySchema>;

export const decisionSchema = z.object({ note: z.string().trim().max(500).optional() });

// Quick receipt of raw material without a purchase order (a market run, a cash purchase).
export const stockReceiptSchema = z.object({
  ingredientId: z.string().min(1),
  quantity: qty,
  unit: ingredientUnitSchema,
  receivedAt: z.coerce.date().optional(),
  supplierId: z.string().optional(),
  reference: z.string().trim().max(120).optional(),
  expiryDate: z.coerce.date().optional(),
  location: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  deviceId: z.string().trim().max(120).optional(),
});
export type StockReceiptDto = z.infer<typeof stockReceiptSchema>;

// A signed correction with a mandatory reason (a count that did not match).
export const journalAdjustmentSchema = z.object({
  ingredientId: z.string().min(1),
  direction: z.enum(["ADD", "REMOVE"]),
  quantity: qty,
  unit: ingredientUnitSchema,
  reason: z.string().trim().min(3).max(500),
  deviceId: z.string().trim().max(120).optional(),
});
export type JournalAdjustmentDto = z.infer<typeof journalAdjustmentSchema>;
