import { z } from "zod";

export const restaurantSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().optional(),
  currency: z.string().optional(),
  timezone: z.string().optional(),
});
export type RestaurantSettingsDto = z.infer<typeof restaurantSettingsSchema>;

export const branchSettingsSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  gstNumber: z.string().optional(),
});
export type BranchSettingsDto = z.infer<typeof branchSettingsSchema>;
