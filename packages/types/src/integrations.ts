import { z } from "zod";
import { deliveryInfoSchema } from "./orders";

// Scopes an IntegrationApiKey (see schema.prisma) can hold — what an
// external website's own backend is allowed to do once authenticated with
// that key. Deliberately separate from the staff PermissionKey list
// (permissions.ts): these are not tied to any staff member or role, they
// describe what an external system integration is allowed to do.
export const INTEGRATION_SCOPES = [
  { key: "locations:read", label: "View locations", description: "List active branches and their basic info." },
  { key: "menu:read", label: "View menu", description: "Read a location's menu, categories, and prices." },
  { key: "orders:write", label: "Create orders", description: "Place a new takeaway/delivery order for a location." },
  {
    key: "orders:read",
    label: "View order status",
    description: "Look up the status, items and totals of orders this key placed. Never includes customer details.",
  },
  {
    key: "orders:read_customer",
    label: "View order customer & delivery details",
    description:
      "Also read the customer's name, mobile number, email and delivery address on orders this key placed. Grant only to a backend that needs it to fulfil orders.",
  },
  {
    key: "reservations:write",
    label: "Book tables",
    description: "Create a new table reservation for a location.",
  },
  {
    key: "reservations:read",
    label: "View reservation status",
    description: "Look up a reservation's current status.",
  },
] as const;

export const integrationScopeSchema = z.enum(
  INTEGRATION_SCOPES.map((s) => s.key) as [string, ...string[]],
);
export type IntegrationScope = z.infer<typeof integrationScopeSchema>;

export const createIntegrationApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  branchId: z.string().optional(),
  scopes: z.array(integrationScopeSchema).min(1),
  // Optional: the key stops working at this time (ISO 8601, in the future).
  expiresAt: z
    .string()
    .datetime()
    .refine((v) => new Date(v).getTime() > Date.now(), "expiresAt must be in the future")
    .optional(),
});
export type CreateIntegrationApiKeyDto = z.infer<typeof createIntegrationApiKeySchema>;

export const createStaffApiKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateStaffApiKeyDto = z.infer<typeof createStaffApiKeySchema>;

// Public REST API request/response shapes (docs/integrations-api.md is the
// human-readable version of these).

export const integrationOrderItemSchema = z.object({
  menuItemId: z.string().trim().min(1).max(64),
  quantity: z.number().int().min(1).max(99),
  modifierIds: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  kitchenNote: z.string().trim().max(200).optional(),
});

export const integrationOrderTypeSchema = z.enum(["TAKEAWAY", "DELIVERY"]);

// Digits with the usual separators, optional leading "+". Stricter than the
// staff-side delivery schema because this one is fed by an anonymous public
// form, and the value ends up on a kitchen/driver screen.
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{5,19}$/, "Enter a valid mobile number");

export const integrationDeliverySchema = z.object({
  address: z.string().trim().min(5).max(300),
  pincode: z.string().trim().min(3).max(12),
  // Defaults to customerPhone when omitted.
  phone: phoneSchema.optional(),
});

export const createIntegrationOrderSchema = z
  .object({
    type: integrationOrderTypeSchema.default("TAKEAWAY"),
    customerName: z.string().trim().min(1).max(80),
    customerPhone: phoneSchema,
    customerEmail: z.string().trim().toLowerCase().email().max(120).optional(),
    notes: z.string().trim().max(500).optional(),
    // Required for DELIVERY.
    delivery: integrationDeliverySchema.optional(),
    // Requested time (pre-order / click & collect): ISO time at least 10
    // minutes ahead.
    scheduledFor: z.string().datetime().optional(),
    items: z.array(integrationOrderItemSchema).min(1).max(50),
  })
  .refine((o) => o.type !== "DELIVERY" || !!o.delivery, {
    path: ["delivery"],
    message: "delivery (address and pincode) is required for DELIVERY orders",
  });
export type CreateIntegrationOrderDto = z.infer<typeof createIntegrationOrderSchema>;

// Caller-chosen key that makes a retried POST return the original order.
export const integrationIdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, "Idempotency-Key must be 8-64 characters of A-Z a-z 0-9 _ -");

export const createIntegrationReservationSchema = z.object({
  customerName: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(1).max(30),
  email: z.string().email().optional(),
  guestCount: z.number().int().positive(),
  reservedAt: z.coerce.date(),
  durationMinutes: z.number().int().positive().default(90),
  specialRequests: z.string().optional(),
});
export type CreateIntegrationReservationDto = z.infer<typeof createIntegrationReservationSchema>;
