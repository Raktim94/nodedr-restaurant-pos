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
      className={cn("grid gap-2", methods.length > 4 ? "grid-cols-3" : "grid-cols-4")}
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
              "flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-medium transition-colors",
              active
                ? "border-primary bg-primary/10 text-foreground shadow-sm"
                : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <Icon className="h-[18px] w-[18px]" />
            {text}
          </button>
        );
      })}
    </div>
  );
}
