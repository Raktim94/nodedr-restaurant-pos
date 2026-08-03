import { z } from "zod";

export const setPrioritySchema = z.object({
  isPriority: z.boolean(),
});
export type SetPriorityDto = z.infer<typeof setPrioritySchema>;
