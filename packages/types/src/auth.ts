import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  restaurantName: z.string().min(1),
  branchName: z.string().min(1).default("Main Branch"),
  ownerName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});
export type RegisterDto = z.infer<typeof registerSchema>;

export const pinLoginSchema = z.object({
  userId: z.string(),
  pin: z.string().min(4).max(8),
});
export type PinLoginDto = z.infer<typeof pinLoginSchema>;

export const sessionUserSchema = z.object({
  id: z.string(),
  restaurantId: z.string(),
  name: z.string(),
  roleId: z.string(),
  roleName: z.string(),
  permissions: z.array(z.string()),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;
