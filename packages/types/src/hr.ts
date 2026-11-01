import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const shiftSchema = z
  .object({
    userId: z.string().min(1),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    note: z.string().max(200).optional(),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: "A shift must end after it starts",
    path: ["endsAt"],
  });
export type ShiftDto = z.infer<typeof shiftSchema>;

export const leaveTypeSchema = z.enum(["ANNUAL", "SICK", "UNPAID", "OTHER"]);
export const leaveRequestSchema = z
  .object({
    branchId: z.string().min(1),
    type: leaveTypeSchema.default("ANNUAL"),
    startDate: isoDate,
    endDate: isoDate,
    reason: z.string().max(300).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "End date cannot be before start date",
    path: ["endDate"],
  });
export type LeaveRequestDto = z.infer<typeof leaveRequestSchema>;

export const leaveDecisionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

export const staffPaySchema = z.object({
  payType: z.enum(["MONTHLY", "HOURLY"]),
  rate: z.coerce.number().min(0),
});
export type StaffPayDto = z.infer<typeof staffPaySchema>;

export const payrollRunSchema = z
  .object({ periodStart: isoDate, periodEnd: isoDate })
  .refine((v) => v.periodEnd >= v.periodStart, {
    message: "Period end cannot be before start",
    path: ["periodEnd"],
  });
export type PayrollRunDto = z.infer<typeof payrollRunSchema>;

const money = z.coerce.number().min(0).max(10_000_000);
export const payrollLineAdjustSchema = z
  .object({
    allowances: money.optional(),
    bonus: money.optional(),
    advanceRecovery: money.optional(),
    otherDeductions: money.optional(),
    adjustmentNote: z.string().trim().max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type PayrollLineAdjustDto = z.infer<typeof payrollLineAdjustSchema>;

export const payrollPaySchema = z.object({
  method: z.enum(["CASH", "BANK_TRANSFER", "UPI", "OTHER"]),
  reference: z.string().trim().max(100).optional(),
});
export type PayrollPayDto = z.infer<typeof payrollPaySchema>;
