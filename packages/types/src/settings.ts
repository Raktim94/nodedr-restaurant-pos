import { z } from "zod";

// The restaurant's brand name renders in the app shell's top-of-sidebar
// header (fixed-width column, next to the logo) — a name much past this
// starts wrapping/truncating there, so the settings form enforces the same
// limit the layout was built around rather than letting it overflow.
export const RESTAURANT_NAME_MAX_LENGTH = 40;

export const restaurantSettingsSchema = z.object({
  name: z.string().min(1).max(RESTAURANT_NAME_MAX_LENGTH).optional(),
  legalName: z.string().optional(),
  // Shown in place of the product logo in the app shell header and on the
  // login screen once set. Square, ~256x256px+ PNG/SVG with a transparent
  // background reads best in that slot — see the settings page hint text.
  logoUrl: z.string().max(2048).optional().nullable(),
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
