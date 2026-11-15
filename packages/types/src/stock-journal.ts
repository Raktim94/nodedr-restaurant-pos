import { z } from "zod";
import { ingredientUnitSchema, wasteReasonSchema } from "./inventory";

// Stock journal: daily production (actual quantities used / produced) and food waste.
// Quantities travel as strings or numbers and are parsed as exact decimals on the server.
const qty = z.union([z.string().trim().min(1), z.number()]).transform(String);

export const productionLineSchema = z.object({
  ingredientId: z.string().min(1),
  quantity: qty,
  unit: ingredientUnitSchema,
  // Costing only: the cost rate per STOCK unit of the item for this batch. Omitted = the item's current average cost.
  rate: z.union([z.string().trim().min(1), z.number()]).transform(String).optional(),
  // ---- manufacturing journal v2 (all optional) ----
  /** Place the quantity is taken from (inputs) or put into (outputs). Omitted = unassigned, as before. */
  locationId: z.string().min(1).optional(),
  /** Outputs: pieces made but not saleable. Recorded, never added to stock, cost stays with the good units. */
  rejectedQuantity: qty.optional(),
  lotNumber: z.string().trim().max(60).optional(),
  /** Inputs: what the recipe expected for this batch, in the line's unit (kept for the variance report). */
  expectedQuantity: qty.optional(),
  /** Inputs: tie this material wholly to one finished product on the voucher (its ingredient id). */
  directToIngredientId: z.string().min(1).optional(),
  /** Outputs: share of the shared cost, used when the split method is MANUAL. */
  allocationPercent: z.union([z.string().trim().min(1), z.number()]).transform(String).optional(),
});

export const extraCostSchema = z.object({
  category: z.string().trim().min(1, "Choose or type a category").max(60),
  description: z.string().trim().max(120).optional(),
  amount: z.union([z.string().trim().min(1), z.number()]).transform(String),
  // true = counted in the finished product's cost; false = only recorded.
  included: z.boolean().default(true),
});

export const menuPriceProposalSchema = z.object({
  menuItemId: z.string().min(1),
  newPrice: z.union([z.string().trim().min(1), z.number()]).transform(String),
  // The price the form was showing. If the menu price has changed since, posting is refused so it can be reviewed.
  expectedCurrentPrice: z.union([z.string().trim().min(1), z.number()]).transform(String),
});

export const costingSchema = z.object({
  enabled: z.boolean().default(true),
  costs: z.array(extraCostSchema).max(30).default([]),
  menuPrice: menuPriceProposalSchema.optional(),
});
export type CostingDto = z.infer<typeof costingSchema>;
export type ProductionLineDto = z.infer<typeof productionLineSchema>;

// Optional quality inspection of a posted batch. A failed inspection must say what failed.
export const productionQualitySchema = z.object({
  result: z.enum(["PASS", "FAIL", "NEEDS_REVIEW"]),
  grade: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(500).optional(),
});
export type ProductionQualityDto = z.infer<typeof productionQualitySchema>;

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
  manufacturedOn: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
  costing: costingSchema.optional(),
  /** Recipe the expected quantities came from. The server copies it into the voucher. Omit = no recipe baseline. */
  recipe: z.object({ kind: z.enum(["RECIPE", "MENU"]), id: z.string().min(1) }).optional(),
  /** Purchase order this run started from (recorded for reference only; it never receives stock). */
  sourcePoId: z.string().min(1).optional(),
  /** How shared cost is split when the voucher makes more than one product. */
  allocationMethod: z.enum(["QUANTITY", "MANUAL"]).optional(),
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
    photoUrl: z.string().regex(/^\/api\/uploads\/[A-Za-z0-9._-]+$/, "Not an uploaded photo").max(200).optional(),
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
  // Cost per STOCK unit of this delivery. Keeps the item's average cost, which batch costing starts from.
  unitCost: z.union([z.string().trim().min(1), z.number()]).transform(String).optional(),
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

// A shelf count. `counted` may be 0. Items left out of the sheet are not touched.
export const stockTakeSchema = z.object({
  area: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
  takenAt: z.coerce.date().optional(),
  lines: z
    .array(z.object({ ingredientId: z.string().min(1), counted: qty, unit: ingredientUnitSchema }))
    .min(1, "Count at least one item")
    .max(500),
  idempotencyKey: z.string().trim().min(8).max(120).optional(),
  deviceId: z.string().trim().max(120).optional(),
});
export type StockTakeDto = z.infer<typeof stockTakeSchema>;

export const stockLocationSchema = z.object({
  name: z.string().trim().min(1).max(60),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
});
export type StockLocationDto = z.infer<typeof stockLocationSchema>;

export const locationTransferSchema = z
  .object({
    ingredientId: z.string().min(1),
    fromLocationId: z.string().min(1).nullable().optional(), // null / omitted = the unassigned part
    toLocationId: z.string().min(1),
    quantity: qty,
    unit: ingredientUnitSchema,
    note: z.string().trim().max(300).optional(),
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
  })
  .refine((v) => (v.fromLocationId ?? null) !== v.toLocationId, { message: "Choose two different places", path: ["toLocationId"] });
export type LocationTransferDto = z.infer<typeof locationTransferSchema>;

// A saved bill of materials (BOM): what `baseOutputQty` of a finished product takes.
export const productRecipeSchema = z.object({
  outputIngredientId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  baseOutputQty: z.union([z.string().trim().min(1), z.number()]).transform(String),
  notes: z.string().trim().max(500).optional(),
  lines: z
    .array(z.object({ ingredientId: z.string().min(1), quantity: qty, unit: ingredientUnitSchema }))
    .min(1, "Add at least one ingredient"),
});
export type ProductRecipeDto = z.infer<typeof productRecipeSchema>;

// ---- Stock journal entries: transfer, waste/spoilage, correction ------------------------------------------------
// Production has its own voucher (productionEntrySchema). These three share one shape: a header and item rows.
export const stockJournalTypeSchema = z.enum(["TRANSFER", "WASTE", "CORRECTION"]);
export type StockJournalType = z.infer<typeof stockJournalTypeSchema>;

export const stockJournalLineSchema = z.object({
  ingredientId: z.string().min(1, "Choose an item"),
  quantity: qty,
  unit: ingredientUnitSchema,
  /** OUT = leaves stock (or leaves the "from" place); IN = enters stock. Only a correction may use IN. */
  direction: z.enum(["OUT", "IN"]).default("OUT"),
  /** Transfer: where it is now (null / omitted = not yet placed anywhere). Waste/correction: place it leaves or enters. */
  fromLocationId: z.string().min(1).nullable().optional(),
  /** Transfer only: where it goes. Required for a transfer. Correction IN may use it as the place stock enters. */
  toLocationId: z.string().min(1).nullable().optional(),
  wasteReason: wasteReasonSchema.optional(),
  note: z.string().trim().max(300).optional(),
});
export type StockJournalLineDto = z.infer<typeof stockJournalLineSchema>;

const stockJournalBase = z.object({
  type: stockJournalTypeSchema,
  occurredAt: z.coerce.date().optional(),
  /** Why this entry exists. Required for a correction. */
  reason: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
  lines: z.array(stockJournalLineSchema).min(1, "Add at least one item").max(100, "Split this into entries of up to 100 items"),
});

const checkJournal = (v: z.infer<typeof stockJournalBase>, ctx: z.RefinementCtx) => {
  v.lines.forEach((l, i) => {
    const at = (field: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["lines", i, field] });
    if (!(Number(l.quantity) > 0)) at("quantity", "Quantity must be more than zero");
    if (v.type !== "CORRECTION" && l.direction !== "OUT") at("direction", "Only a stock correction can add stock");
    if (v.type === "TRANSFER") {
      if (!l.toLocationId) at("toLocationId", "Choose where the stock goes");
      else if ((l.fromLocationId ?? null) === l.toLocationId) at("toLocationId", "From and To must be different places");
    }
    if (v.type === "WASTE") {
      if (!l.wasteReason) at("wasteReason", "Choose why it was thrown away");
      else if (l.wasteReason === "OTHER" && !(l.note && l.note.length >= 3)) at("note", "Say what happened when the reason is Other");
    }
  });
  if (v.type === "CORRECTION" && !(v.reason && v.reason.length >= 3)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Say why the stock was wrong (at least 3 characters)", path: ["reason"] });
  }
};

export const stockJournalEntrySchema = stockJournalBase
  .extend({
    /** Stable key made by the client so a retried save/post cannot create a second entry. */
    idempotencyKey: z.string().trim().min(8).max(120).optional(),
    /** true = post straight away (stock changes now), false/omitted = save as a draft (nothing changes). */
    post: z.boolean().default(false),
  })
  .superRefine(checkJournal);
export type StockJournalEntryDto = z.infer<typeof stockJournalEntrySchema>;

/** Editing a draft: same fields, no post flag, the type cannot change. */
export const stockJournalDraftSchema = stockJournalBase.superRefine(checkJournal);
export type StockJournalDraftDto = z.infer<typeof stockJournalDraftSchema>;
