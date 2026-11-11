import { z } from "zod";

// --- Validation schemas shared by server routes -----------------------------------

export const costUnitSchema = z.enum(["KG", "G", "L", "ML", "PIECE", "DOZEN", "PACK", "BOX"]);
export const costMethodSchema = z.enum(["AVERAGE", "MANUAL", "RECIPE"]);

export const unitConversionSchema = z.object({
  unit: costUnitSchema,
  per: z.coerce.number().positive().max(1_000_000),
});

export const ingredientCostingSchema = z.object({
  costMethod: costMethodSchema.optional(),
  purchaseQuantity: z.coerce.number().positive().max(1_000_000).nullable().optional(),
  purchaseUnit: costUnitSchema.nullable().optional(),
  purchasePrice: z.coerce.number().nonnegative().max(100_000_000).nullable().optional(),
  yieldPercent: z.coerce.number().gt(0).max(100).optional(),
  conversions: z.array(unitConversionSchema).max(6).optional(),
});

export const overheadSchema = z.object({
  kind: z.enum(["PACKAGING", "LABOUR", "ENERGY", "OTHER"]),
  label: z.string().max(60).optional(),
  amount: z.coerce.number().nonnegative().max(100_000_000),
  basis: z.enum(["PER_BATCH", "PER_PORTION"]),
});

export const costLineSchema = z.object({
  ingredientId: z.string().min(1),
  quantity: z.coerce.number().positive().max(1_000_000),
  unit: costUnitSchema.nullable().optional(),
});

export const menuItemCostingSchema = z.object({
  lines: z.array(costLineSchema).max(100),
  batchOutputQty: z.coerce.number().positive().max(100_000),
  overheads: z.array(overheadSchema).max(12).default([]),
  halfPortionRatio: z.coerce.number().gt(0).lte(1).default(0.5),
  targetMarginPercent: z.coerce.number().min(0).lt(100).nullable().optional(),
  targetMarkupPercent: z.coerce.number().min(0).max(10_000).nullable().optional(),
  alertDropPoints: z.coerce.number().min(0).max(100).default(5),
  /** Optimistic-lock token: the version this edit was based on (0/omitted = new). */
  baseVersion: z.coerce.number().int().min(0).optional(),
});
export type MenuItemCostingDto = z.infer<typeof menuItemCostingSchema>;

export const modifierCostingSchema = z.object({
  lines: z
    .array(
      z.object({
        ingredientId: z.string().min(1),
        /** Signed: positive adds the ingredient, negative removes it ("no onion"). */
        quantity: z.coerce.number().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, "Quantity cannot be zero"),
        unit: costUnitSchema.nullable().optional(),
      }),
    )
    .max(30),
});
export type ModifierCostingDto = z.infer<typeof modifierCostingSchema>;

export const preparationSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Unit the finished preparation is stocked and used in. */
  unit: costUnitSchema,
  batchOutputQty: z.coerce.number().positive().max(100_000),
  lines: z.array(costLineSchema).min(1).max(100),
  overheads: z.array(overheadSchema).max(12).default([]),
  baseVersion: z.coerce.number().int().min(0).optional(),
});
export type PreparationDto = z.infer<typeof preparationSchema>;

export const productionRunSchema = z.object({
  /** Client-generated; sending the same key twice never produces two runs. */
  idempotencyKey: z.string().min(8).max(80),
  batches: z.coerce.number().positive().max(10_000),
  note: z.string().max(200).optional(),
});
export type ProductionRunDto = z.infer<typeof productionRunSchema>;

export const applyPriceSchema = z.object({
  /** Which price to change: the full-portion price or the half-portion price. */
  target: z.enum(["FULL", "HALF"]).default("FULL"),
  price: z.coerce.number().positive().max(10_000_000),
  /** The price the user was looking at; the change is refused if it moved meanwhile. */
  expectedCurrentPrice: z.coerce.number().nonnegative(),
});
export type ApplyPriceDto = z.infer<typeof applyPriceSchema>;
