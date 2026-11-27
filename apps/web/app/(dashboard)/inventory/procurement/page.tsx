"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import { useI18n } from "@/lib/i18n/context";
import { MoreHorizontal } from "lucide-react";
import { CreateInvoiceDialog } from "@/components/inventory/create-invoice-dialog";
import { CreatePurchaseRequestDialog } from "@/components/inventory/create-purchase-request-dialog";
import { CreateQuotationDialog } from "@/components/inventory/create-quotation-dialog";
import { InventoryTabs } from "@/components/inventory/inventory-tabs";
import { RecordPaymentDialog } from "@/components/inventory/record-payment-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBranch } from "@/hooks/use-branch";
import {
  usePurchaseRequests,
  useQuotations,
  useSupplierInvoices,
  useUpdatePurchaseRequestStatus,
  useUpdateQuotationStatus,
  type PurchaseRequest,
  type SupplierInvoice,
  type SupplierQuotation,
} from "@/hooks/use-inventory";

const REQUEST_NEXT: Record<PurchaseRequest["status"], PurchaseRequest["status"][]> = {
  DRAFT: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: [],
  REJECTED: [],
  CONVERTED: [],
};

const QUOTATION_NEXT: Record<SupplierQuotation["status"], SupplierQuotation["status"][]> = {
  DRAFT: ["RECEIVED"],
  RECEIVED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: [],
  REJECTED: [],
};

const INVOICE_BADGE: Record<SupplierInvoice["status"], "default" | "secondary" | "outline" | "destructive"> = {
  UNPAID: "outline",
  PARTIALLY_PAID: "secondary",
  PAID: "default",
  CANCELLED: "destructive",
};

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function PurchaseRequestsSection({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data: requests, isLoading } = usePurchaseRequests(branchId);
  const updateStatus = useUpdatePurchaseRequestStatus(branchId);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("Purchase requests")}</h2>
          <p className="text-xs text-muted-foreground">{t("Staff-raised requests, awaiting approval before a PO is cut")}</p>
        </div>
        <CreatePurchaseRequestDialog branchId={branchId} />
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : requests && requests.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Request #")}</TableHead>
              <TableHead>{t("Requested by")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead className="text-right">{t("Items")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((r) => {
              const next = REQUEST_NEXT[r.status];
              return (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-foreground">{r.requestNumber}</TableCell>
                  <TableCell className="text-muted-foreground">{r.requestedBy.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{fmt.code(r.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.items.length}</TableCell>
                  <TableCell className="w-10">
                    {next.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon" aria-label={t("More options")}>\n                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          {next.map((status) => (
                            <DropdownMenuItem
                              key={status}
                              onClick={() => updateStatus.mutate({ id: r.id, status })}
                            >{t("Move to {code}", { code: fmt.code(status) })}</DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          title={t("No purchase requests yet")}
          description={t("Staff can raise a request here before a purchase order is cut.")}
        />
      )}
    </Card>
  );
}

function QuotationsSection({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data: quotations, isLoading } = useQuotations(branchId);
  const updateStatus = useUpdateQuotationStatus(branchId);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("Supplier quotations")}</h2>
          <p className="text-xs text-muted-foreground">{t("Compare prices across suppliers before ordering")}</p>
        </div>
        <CreateQuotationDialog branchId={branchId} />
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : quotations && quotations.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Quote #")}</TableHead>
              <TableHead>{t("Supplier")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead className="text-right">{t("Items")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotations.map((q) => {
              const next = QUOTATION_NEXT[q.status];
              return (
                <TableRow key={q.id}>
                  <TableCell className="font-medium text-foreground">{q.quotationNumber}</TableCell>
                  <TableCell className="text-muted-foreground">{q.supplier.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{fmt.code(q.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{q.items.length}</TableCell>
                  <TableCell className="w-10">
                    {next.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon" aria-label={t("More options")}>\n                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          {next.map((status) => (
                            <DropdownMenuItem
                              key={status}
                              onClick={() => updateStatus.mutate({ id: q.id, status })}
                            >{t("Mark {code}", { code: fmt.code(status) })}</DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          title={t("No quotations recorded yet")}
          description={t("Log a supplier's quoted price to compare it against others for the same ingredient.")}
        />
      )}
    </Card>
  );
}

function SupplierInvoicesSection({ branchId }: { branchId: string | null }) {
  const fmt = useStaffFormat();
  const { t } = useI18n();
  const { data: invoices, isLoading } = useSupplierInvoices(branchId);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border p-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("Vendor invoices")}</h2>
          <p className="text-xs text-muted-foreground">{t("Track what suppliers have billed and what's been paid")}</p>
        </div>
        <CreateInvoiceDialog branchId={branchId} />
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : invoices && invoices.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Invoice #")}</TableHead>
              <TableHead>{t("Supplier")}</TableHead>
              <TableHead>{t("Status")}</TableHead>
              <TableHead className="text-right">{t("Total")}</TableHead>
              <TableHead className="text-right">{t("Paid")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell className="font-medium text-foreground">{inv.invoiceNumber}</TableCell>
                <TableCell className="text-muted-foreground">{inv.supplier.name}</TableCell>
                <TableCell>
                  <Badge variant={INVOICE_BADGE[inv.status]}>{fmt.code(inv.status)}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmt.currency(Number(inv.totalAmount))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmt.currency(Number(inv.amountPaid))}
                </TableCell>
                <TableCell className="w-32">
                  {(inv.status === "UNPAID" || inv.status === "PARTIALLY_PAID") && (
                    <RecordPaymentDialog branchId={branchId} invoice={inv} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          title={t("No vendor invoices yet")}
          description={t("Add an invoice a supplier has billed you to start tracking payments against it.")}
        />
      )}
    </Card>
  );
}

export default function ProcurementPage() {
  const { t } = useI18n();
  const { branchId } = useBranch();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">{t("Inventory")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Stock, daily production, purchasing, and food waste")}
        </p>
      </div>

      <InventoryTabs />

      <div className="flex flex-col gap-6">
        <PurchaseRequestsSection branchId={branchId} />
        <QuotationsSection branchId={branchId} />
        <SupplierInvoicesSection branchId={branchId} />
      </div>
    </div>
  );
}


