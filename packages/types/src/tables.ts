import { z } from "zod";

export const tableStatusSchema = z.enum([
  "AVAILABLE",
  "OCCUPIED",
  "RESERVED",
  "CLEANING",
  "OUT_OF_SERVICE",
]);
export type TableStatusDto = z.infer<typeof tableStatusSchema>;

export const floorSchema = z.object({
  name: z.string().min(1),
  sortOrder: z.number().int().default(0),
});
export type FloorDto = z.infer<typeof floorSchema>;

export const floorUpdateSchema = floorSchema.partial();
export type FloorUpdateDto = z.infer<typeof floorUpdateSchema>;

export const TABLE_SHAPES = ["square", "round", "rect", "booth", "counter", "other"] as const;
export const tableShapeSchema = z.enum(TABLE_SHAPES);
export type TableShape = z.infer<typeof tableShapeSchema>;

/**
 * Table numbers for the "create several tables" form: prefix + a counter, e.g. T1..T12 or R-01..R-08.
 * `pad` zero-pads the counter. Used for the preview and sent to the server as the final list.
 */
export function generateTableNumbers(prefix: string, start: number, count: number, pad = 0): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${String(start + i).padStart(pad, "0")}`);
}

export const tableSchema = z.object({
  floorId: z.string(),
  number: z.string().min(1),
  name: z.string().optional(),
  capacity: z.number().int().positive().default(2),
  posX: z.number().default(0),
  posY: z.number().default(0),
  width: z.number().positive().default(80),
  height: z.number().positive().default(80),
  rotation: z.number().default(0),
  shape: tableShapeSchema.default("square"),
  color: z.string().optional(),
  notes: z.string().optional(),
});
export type TableDto = z.infer<typeof tableSchema>;

export const tableUpdateSchema = tableSchema.omit({ floorId: true }).partial();
export type TableUpdateDto = z.infer<typeof tableUpdateSchema>;

export const bulkTableCreateSchema = z.object({
  floorId: z.string(),
  numbers: z.array(z.string().min(1)).min(1).max(100),
  capacity: z.number().int().positive().default(2),
  shape: tableShapeSchema.default("square"),
  color: z.string().optional(),
  width: z.number().positive().max(2000).optional(),
  height: z.number().positive().max(2000).optional(),
  /** Tables per row when arranged automatically. */
  columns: z.number().int().min(1).max(20).default(5),
});
export type BulkTableCreateDto = z.infer<typeof bulkTableCreateSchema>;

export const tableLayoutUpdateSchema = z.object({
  id: z.string(),
  posX: z.number(),
  posY: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
});
export type TableLayoutUpdateDto = z.infer<typeof tableLayoutUpdateSchema>;

export const bulkTableUpdateSchema = z
  .object({
    ids: z.array(z.string()).min(1).max(200),
    capacity: z.number().int().positive().optional(),
    shape: tableShapeSchema.optional(),
    color: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((v) => v.capacity !== undefined || v.shape !== undefined || v.color !== undefined || v.notes !== undefined, {
    message: "Choose something to change",
  });
export type BulkTableUpdateDto = z.infer<typeof bulkTableUpdateSchema>;

export const bulkTableDeleteSchema = z.object({ ids: z.array(z.string()).min(1).max(200) });
export type BulkTableDeleteDto = z.infer<typeof bulkTableDeleteSchema>;
