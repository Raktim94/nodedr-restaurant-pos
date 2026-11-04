"use client";

import { Receipt, ReceiptText } from "lucide-react";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { buildUpiUri } from "@/lib/upi";

interface PublicBillResponse {
  restaurantName: string;
  currency: string;
  branch: { name: string; address: string | null; phone: string | null };
  order: {
    orderNumber: string;
    type: string;
    createdAt: string;
    table: { label: string } | null;
    customer: { name: string } | null;
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    tipAmount: number;
    loyaltyDiscountAmount: number;
    totalAmount: number;
    isProvisional: boolean;
    amountPaid: number;
    balanceDue: number;
    items: {
      nameSnapshot: string;
      quantity: number;
      unitPriceSnapshot: number;
      lineTotal: number;
      modifiers: { nameSnapshot: string; priceAdjSnapshot: number }[];
    }[];
    payments: { method: string; amount: number }[];
  };
  upi: { vpa: string; payeeName: string } | null;
}

// Guest-facing page behind the bill QR. No login: the signed token in the URL
// is the only credential and resolves to one order (see PublicBillService).
export default function PublicBillPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-bill", token],
    queryFn: () => api.get<PublicBillResponse>(`/public/bill/${encodeURIComponent(token)}`),
    retry: false,
  });

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <ReceiptText className="h-10 w-10 text-muted-foreground" />
        <p className="text-lg font-medium text-foreground">This bill link is not available</p>
        <p className="text-sm text-muted-foreground">
          {error instanceof ApiError
            ? error.message
            : "Ask the restaurant staff to share the bill again."}
        </p>
      </div>
    );
  }

  const order = data?.order;
  const currency = data?.currency ?? "INR";
  const upiUri =
    data?.upi && order && order.balanceDue > 0
      ? buildUpiUri({
          vpa: data.upi.vpa,
          name: data.upi.payeeName,
          amount: order.balanceDue,
          note: `Order ${order.orderNumber}`,
        })
      : null;

  return (
    <div className="min-h-screen bg-background pb-10 print:bg-white">
      <header className="border-b border-border px-5 py-6 text-center print:border-none">
        {isLoading ? (
          <Skeleton className="mx-auto h-7 w-40" />
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {data?.restaurantName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data?.branch.name}
              {data?.branch.address ? ` · ${data.branch.address}` : ""}
            </p>
          </>
        )}
      </header>

      <main className="mx-auto max-w-lg px-5 py-6">
        {isLoading || !order ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between rounded-2xl border border-border p-4">
              <div>
                <p className="text-sm font-medium text-foreground">Order #{order.orderNumber}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(order.createdAt).toLocaleString()}
                  {order.table ? ` · ${order.table.label}` : ""}
                </p>
              </div>
              <span
                className={
                  order.isProvisional
                    ? "rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground"
                    : "rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success"
                }
              >
                {order.isProvisional ? "Payment pending" : "Paid"}
              </span>
            </div>

            <div className="rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                    <th className="px-4 py-2 text-left">Item</th>
                    <th className="px-4 py-2 text-right">Qty</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item, i) => (
                    <tr key={i} className="border-b border-border last:border-none">
                      <td className="px-4 py-2 text-foreground">
                        {item.nameSnapshot}
                        {item.modifiers.map((m, j) => (
                          <div key={j} className="text-xs text-muted-foreground">
                            + {m.nameSnapshot}
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {item.quantity}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-foreground">
                        {formatCurrency(item.lineTotal, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-1.5 rounded-2xl border border-border p-4 text-sm">
              <Row label="Subtotal" value={formatCurrency(order.subtotal, currency)} />
              {order.discountAmount > 0 && (
                <Row label="Discount" value={`- ${formatCurrency(order.discountAmount, currency)}`} />
              )}
              {order.loyaltyDiscountAmount > 0 && (
                <Row
                  label="Loyalty"
                  value={`- ${formatCurrency(order.loyaltyDiscountAmount, currency)}`}
                />
              )}
              {order.taxAmount > 0 && (
                <Row label="Tax" value={formatCurrency(order.taxAmount, currency)} />
              )}
              {order.tipAmount > 0 && (
                <Row label="Tip" value={formatCurrency(order.tipAmount, currency)} />
              )}
              <div className="my-1 border-t border-border" />
              <Row
                label={order.isProvisional ? "Total due" : "Grand total"}
                value={formatCurrency(order.totalAmount, currency)}
                strong
              />
              {order.amountPaid > 0 && (
                <>
                  <Row label="Paid" value={formatCurrency(order.amountPaid, currency)} />
                  <Row
                    label="Balance due"
                    value={formatCurrency(order.balanceDue, currency)}
                    strong
                  />
                </>
              )}
            </div>

            {upiUri && (
              <a
                href={upiUri}
                className="flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground print:hidden"
              >
                <Receipt className="h-4 w-4" />
                Pay {formatCurrency(order.balanceDue, currency)} via UPI
              </a>
            )}

            <Button variant="outline" className="h-11 print:hidden" onClick={() => window.print()}>
              Print / Save as PDF
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={
        strong
          ? "flex items-center justify-between text-base font-semibold text-foreground"
          : "flex items-center justify-between text-muted-foreground"
      }
    >
      <span>{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}
