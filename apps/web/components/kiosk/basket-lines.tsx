"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import type { BasketLine } from "@/lib/kiosk-basket";
import { IconButton } from "./kiosk-ui";

/** Basket rows with quantity steppers; `locked` freezes edits (submit in flight / outcome unknown). */
export function BasketLines({
  lines,
  fmt,
  locked,
  onChange,
}: {
  lines: BasketLine[];
  fmt: (n: number) => string;
  locked: boolean;
  onChange: (key: string, delta: number) => void;
}) {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col divide-y divide-border">
      {lines.map((l) => (
        <li key={l.key} className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[1.15rem] font-semibold leading-snug">{l.name}</p>
            {l.modifierLabel && (
              <p className="text-[0.95rem] leading-snug text-muted-foreground">{l.modifierLabel}</p>
            )}
            <p className="text-[1rem] tabular-nums text-muted-foreground">{fmt(l.unitPrice)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <IconButton
              label={l.quantity === 1 ? t("kiosk.basket.remove", { name: l.name }) : t("kiosk.basket.less", { name: l.name })}
              disabled={locked}
              onClick={() => onChange(l.key, -1)}
            >
              {l.quantity === 1 ? <Trash2 className="h-5 w-5" aria-hidden /> : <Minus className="h-5 w-5" aria-hidden />}
            </IconButton>
            <span className="w-8 text-center text-[1.35rem] font-bold tabular-nums" aria-live="polite">
              {l.quantity}
            </span>
            <IconButton label={t("kiosk.basket.more", { name: l.name })} disabled={locked} onClick={() => onChange(l.key, 1)}>
              <Plus className="h-5 w-5" aria-hidden />
            </IconButton>
          </div>
          <p className="w-[5.5rem] shrink-0 text-right text-[1.15rem] font-bold tabular-nums">
            {fmt(Math.round(l.unitPrice * l.quantity * 100) / 100)}
          </p>
        </li>
      ))}
    </ul>
  );
}
