import { z } from "zod";

// What the staff screen tells the customer screen. Same shapes the in-browser display already used, now
// validated so a terminal can send them to the server.
export const displayStateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("idle") }),
  z.object({
    kind: z.literal("cart"),
    lines: z
      .array(z.object({ name: z.string().max(120), quantity: z.number().min(0).max(100000), total: z.number().min(-1e9).max(1e9) }))
      .max(200),
    subtotal: z.number().min(-1e9).max(1e9),
  }),
  z.object({ kind: z.literal("upi"), total: z.number().min(0).max(1e9), uri: z.string().max(1000), payee: z.string().max(120) }),
  z.object({ kind: z.literal("paid"), total: z.number().min(0).max(1e9), method: z.string().max(40).optional() }),
]);
export type DisplayStateDto = z.infer<typeof displayStateSchema>;

export const terminalSchema = z.object({
  name: z.string().trim().min(1).max(60),
  idleSeconds: z.coerce.number().int().min(10).max(3600).default(45),
  thankYouSeconds: z.coerce.number().int().min(2).max(60).default(8),
  adSlideSeconds: z.coerce.number().int().min(3).max(120).default(10),
  adFit: z.enum(["contain", "cover"]).default("contain"),
  isActive: z.boolean().default(true),
});
export type TerminalDto = z.infer<typeof terminalSchema>;

export const adSchema = z.object({
  terminalId: z.string().nullable().optional(),
  kind: z.enum(["IMAGE", "VIDEO"]),
  url: z.string().regex(/^\/api\/uploads\/[A-Za-z0-9._-]+$/, "Not an uploaded file").max(200),
  title: z.string().trim().max(80).optional(),
  durationSec: z.coerce.number().int().min(3).max(120).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
  startsOn: z.coerce.date().nullable().optional(),
  endsOn: z.coerce.date().nullable().optional(),
});
export type AdDto = z.infer<typeof adSchema>;

export type ScreenKind = "ads" | "order" | "pay" | "thanks";

export interface ScreenConfig {
  idleSeconds: number;
  thankYouSeconds: number;
}

/**
 * Which screen the customer sees, decided from the last state the staff screen sent and how old it is.
 * An order in progress always wins over adverts the moment it exists (there is no delay and no fade the
 * order has to wait for). An order that was left alone returns to adverts after idleSeconds; a payment QR is
 * given longer (never less than three minutes); "thank you" lasts thankYouSeconds. Anything missing or
 * unreadable shows adverts, never a half-drawn order.
 */
export function screenFor(state: DisplayStateDto | null | undefined, stateAtMs: number | null | undefined, nowMs: number, cfg: ScreenConfig): ScreenKind {
  if (!state || stateAtMs == null || !Number.isFinite(stateAtMs)) return "ads";
  const age = Math.max(0, nowMs - stateAtMs) / 1000;
  switch (state.kind) {
    case "cart":
      return state.lines.length > 0 && age <= cfg.idleSeconds ? "order" : "ads";
    case "upi":
      return age <= Math.max(cfg.idleSeconds, 180) ? "pay" : "ads";
    case "paid":
      return age <= cfg.thankYouSeconds ? "thanks" : "ads";
    default:
      return "ads";
  }
}

export interface AdItem {
  id: string;
  kind: "IMAGE" | "VIDEO";
  url: string;
  title?: string | null;
  durationSec?: number | null;
  terminalId?: string | null;
  isActive: boolean;
  startsOn?: string | Date | null;
  endsOn?: string | Date | null;
  sortOrder: number;
}

/** Ads that may be shown now on this terminal, in order. */
export function playableAds(ads: AdItem[], terminalId: string, now: Date): AdItem[] {
  return ads
    .filter((a) => a.isActive && (!a.terminalId || a.terminalId === terminalId))
    .filter((a) => (!a.startsOn || new Date(a.startsOn) <= now) && (!a.endsOn || new Date(a.endsOn) >= now))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
