import { z } from "zod";

export const customerSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  birthday: z.coerce.date().optional(),
  anniversary: z.coerce.date().optional(),
  allergies: z.string().optional(),
  notes: z.string().optional(),
});
export type CustomerDto = z.infer<typeof customerSchema>;
