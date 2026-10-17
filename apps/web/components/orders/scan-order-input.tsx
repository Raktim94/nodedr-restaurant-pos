"use client";

import { ScanLine } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { openEntity } from "@/lib/entity-events";
import { normalizeScan } from "@/lib/scan";

const TABS = ["pending", "active", "history"] as const;

// Find an order by scanning the QR on a kiosk ticket (or typing its number).
// A USB "keyboard wedge" scanner just types the code then presses Enter, so a
// plain focused text field is the whole integration: no scanner SDK, no
// camera API. Typing the number by hand works identically, which is the
// manual fallback. This only OPENS the order; it never changes it or marks it
// paid - payment stays a separate, deliberate action in the order window.
export function ScanOrderInput({ branchId }: { branchId: string | null }) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = async () => {
    const scan = normalizeScan(value);
    if (scan.kind === "invalid" && scan.reason === "empty") return;
    if (scan.kind === "table") {
      setMessage("That is a table QR code, not an order ticket.");
      return;
    }
    if (scan.kind !== "order") {
      setMessage("Not a recognised order code. Scan the ticket QR or type the order number.");
      return;
    }
    if (!branchId) return;
    setBusy(true);
    setMessage(null);
    try {
      const lists = await Promise.all(
        TABS.map((tab) =>
          api.get<{ id: string; orderNumber: string }[]>(
            `/orders/manage?branchId=${encodeURIComponent(branchId)}&tab=${tab}`,
          ),
        ),
      );
      const hit = lists.flat().find((o) => o.orderNumber.toUpperCase() === scan.orderNumber);
      if (hit) {
        openEntity("Order", hit.id);
        setValue("");
      } else {
        setMessage(`No recent order ${scan.orderNumber} found in this branch.`);
      }
    } catch {
      setMessage("Could not look that order up. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex max-w-md flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void lookup();
      }}
    >
      <label htmlFor="scan-order" className="sr-only">
        Scan or type an order number
      </label>
      <div className="relative">
        <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          id="scan-order"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setMessage(null);
          }}
          disabled={busy}
          placeholder="Scan ticket QR or type order number, then Enter"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="pl-9"
        />
      </div>
      <p className="min-h-4 text-xs text-muted-foreground" role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
