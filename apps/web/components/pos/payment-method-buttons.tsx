"use client";

import {
  Banknote,
  Building2,
  CreditCard,
  Gift,
  QrCode,
  Undo2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const META: Record<string, { label: string; Icon: LucideIcon }> = {
  CASH: { label: "Cash", Icon: Banknote },
  CARD: { label: "Card", Icon: CreditCard },
  UPI: { label: "UPI", Icon: QrCode },
  WALLET: { label: "Wallet", Icon: Wallet },
  BANK_TRANSFER: { label: "Bank", Icon: Building2 },
  GIFT_CARD: { label: "Gift card", Icon: Gift },
  STORE_CREDIT: { label: "Store credit", Icon: Undo2 },
  OTHER: { label: "Other", Icon: Wallet },
};

// One-tap payment method picker (replaces the dropdowns): big icon buttons
// that are quick to hit on a touch screen and show every choice at once.
export function PaymentMethodButtons<T extends string>({
  methods,
  value,
  onChange,
  label = "Payment method",
}: {
  methods: readonly T[];
  value: T;
  onChange: (m: T) => void;
  label?: string;
}) {
  return (
    <div
      className="grid grid-cols-4 gap-2"
      role="radiogroup"
      aria-label={label}
    >
      {methods.map((m) => {
        const { label: text, Icon } = META[m] ?? { label: m, Icon: Wallet };
        const active = value === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(m)}
            className={cn(
              "flex flex-col items-center justify-center gap-1.5 rounded-2xl border py-2.5 px-1.5 text-center transition-all duration-150 active:scale-96 min-h-[52px]",
              active
                ? "border-primary bg-primary/10 text-primary font-bold shadow-xs ring-2 ring-primary/40"
                : "border-border/80 bg-card text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
            )}
          >
            <Icon className="h-4.5 w-4.5" />
            <span className="text-[11px] font-semibold leading-none">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
