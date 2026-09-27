import { z } from "zod";

export const restaurantSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
  loyaltyPointValue: z.coerce.number().min(0).optional(),
  loyaltyEarnPerCurrency: z.coerce.number().int().positive().optional(),
});
export type RestaurantSettingsDto = z.infer<typeof restaurantSettingsSchema>;

import { TAX_MODES, TAX_REGIMES } from "./tax";

export const branchSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  gstNumber: z.string().optional(),
  // Multi-region tax config — see tax.ts for the regime presets this
  // pairs with (label, default mode, CGST/SGST split).
  country: z.string().length(2).optional(),
  taxRegime: z.enum(TAX_REGIMES).optional(),
  taxMode: z.enum(TAX_MODES).optional(),
  taxLabel: z.string().max(30).optional().nullable(),
  taxId: z.string().max(50).optional().nullable(),
});
export type BranchSettingsDto = z.infer<typeof branchSettingsSchema>;
