"use client";

import * as React from "react";
import { Check, X, Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ProposalItem {
  name: string;
  price?: number;
  category?: string;
  isVeg?: boolean;
  portionYield?: number;
}

export interface ProposalIngredient {
  ingredientName: string;
  quantity: number;
  unit: string;
}

export interface ProposalData {
  title: string;
  summary: string;
  toolName?: string;
  category?: string;
  items?: ProposalItem[];
  bomLines?: ProposalIngredient[];
  deleteItems?: string[];
  parameters?: Record<string, unknown>;
}

export interface ApprovalReviewDeckProps {
  proposal: ProposalData;
  onApprove: () => void;
  onReject: () => void;
  isExecuting?: boolean;
  isCompleted?: boolean;
  isRejected?: boolean;
  className?: string;
}

export function ApprovalReviewDeck({
  proposal,
  onApprove,
  onReject,
  isExecuting = false,
  isCompleted = false,
  isRejected = false,
  className,
}: ApprovalReviewDeckProps) {
  const items = proposal.items || [];
  const bomLines = proposal.bomLines || [];
  const toolName = (proposal.toolName || "").toLowerCase();
  // Model-proposed free-form JSON: its shape is not known ahead of time.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rawParams = (proposal.parameters || {}) as Record<string, any>;
  const actions = (proposal as any).actions as Array<{ toolName: string; parameters: Record<string, any> }> | undefined;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Determine what type of proposal this is
  const isStaffProposal = toolName === "create_staff_member" || "role" in rawParams || "pin" in rawParams;
  const isTableProposal = toolName === "create_tables_bulk" || toolName === "create_floor" || "floorName" in rawParams || "numbers" in rawParams;
  const isStorageProposal = toolName === "assign_storage_areas";
  const isMultiAction = Array.isArray(actions) && actions.length > 0;
  const isMenuProposal = items.length > 0 || bomLines.length > 0 || (!isStaffProposal && !isTableProposal && !isStorageProposal && !isMultiAction);

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card shadow-xs overflow-hidden flex flex-col text-left max-w-2xl w-full my-2 animate-in fade-in-50 duration-150",
        isCompleted && "border-emerald-500/40 bg-emerald-500/5",
        isRejected && "border-destructive/40 bg-destructive/5 opacity-80",
        className
      )}
    >
      {/* Header Container */}
      <div className="flex flex-col gap-0.5 px-4 pt-3.5 pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium tracking-wide uppercase text-muted-foreground truncate">
            {proposal.toolName || "Action Proposal"}
          </span>
          <Badge
            variant={isCompleted ? "default" : isRejected ? "destructive" : "secondary"}
            className={cn(
              "text-[10px] px-2 py-0.5 font-medium shrink-0 rounded-full",
              isCompleted && "bg-emerald-600 hover:bg-emerald-600 text-white"
            )}
          >
            {isCompleted ? "Approved & Recorded" : isRejected ? "Cancelled" : "Review Required"}
          </Badge>
        </div>
        <p className="text-sm sm:text-base font-semibold text-foreground leading-snug">
          {proposal.title}
        </p>
      </div>

      {/* Summary */}
      {proposal.summary && (
        <div className="px-4 pb-3">
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            {proposal.summary}
          </p>
        </div>
      )}

      {/* Dynamic Detail Card Based on Proposal Type */}
      <div className="px-4 pb-3">
        {/* Case A: Staff Member Proposal */}
        {isStaffProposal && (
          <div className="rounded-lg border border-border/80 overflow-hidden bg-background/50 divide-y divide-border/40 text-xs">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/40 font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">
              <span>Staff Profile</span>
              <span>Account Configuration</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-muted-foreground font-medium">Full Name</span>
              <span className="font-semibold text-foreground">{rawParams.name || proposal.title.replace(/^Register Staff Member\s*/i, "")}</span>
            </div>
            {rawParams.email && (
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-muted-foreground font-medium">Email / Login ID</span>
                <span className="font-mono text-primary">{rawParams.email}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-muted-foreground font-medium">Assigned Role</span>
              <span className="font-medium px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 text-[11px]">
                {rawParams.role || "KITCHEN_STAFF"}
              </span>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-muted-foreground font-medium">POS / KDS Quick PIN</span>
              <span className="font-mono font-semibold text-foreground tracking-wider">
                {rawParams.pin || "None (set in profile)"}
              </span>
            </div>
          </div>
        )}

        {/* Case B: Dining Tables / Floor Proposal */}
        {isTableProposal && (
          <div className="rounded-lg border border-border/80 overflow-hidden bg-background/50 divide-y divide-border/40 text-xs">
            <div className="flex items-center justify-between px-3 py-2 bg-muted/40 font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">
              <span>Section / Floor</span>
              <span>Table Plan</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-muted-foreground font-medium">Floor Section</span>
              <span className="font-semibold text-foreground">{rawParams.floorName || "Main Dining"}</span>
            </div>
            {rawParams.numbers && (
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-muted-foreground font-medium">Generated Table Numbers</span>
                <div className="flex flex-wrap gap-1 justify-end">
                  {(rawParams.numbers as string[]).map((num: string, idx: number) => (
                    <span key={idx} className="font-mono font-semibold px-1.5 py-0.5 rounded bg-muted text-[11px]">
                      {num}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {rawParams.capacity && (
              <div className="flex items-center justify-between px-3 py-2.5">
                <span className="text-muted-foreground font-medium">Seats Per Table</span>
                <span className="font-semibold text-foreground">{rawParams.capacity} guests</span>
              </div>
            )}
          </div>
        )}

        {/* Case C: Multi-Action Pipeline Preview */}
        {isMultiAction && (
          <div className="rounded-lg border border-border/80 overflow-hidden bg-background/50 divide-y divide-border/40 text-xs">
            <div className="px-3 py-2 bg-muted/40 font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">
              Pipeline Execution Plan ({actions?.length} Steps)
            </div>
            {actions?.map((act, idx) => (
              <div key={idx} className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-[10px]">
                    {idx + 1}
                  </span>
                  <span className="font-mono text-[11px] text-foreground font-medium">{act.toolName}</span>
                </div>
                <span className="text-muted-foreground text-[11px] truncate max-w-[200px]">
                  {JSON.stringify(act.parameters)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Case D: Standard Menu Items & Recipe BOM Proposal */}
        {isMenuProposal && (
          <div className="rounded-lg border border-border/80 overflow-hidden bg-background/50">
            {items.length > 0 && (
              <>
                <div className="grid grid-cols-[1.5fr_1fr_1fr] items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border/80 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <span>Dish / Menu Item</span>
                  <span>Category</span>
                  <span className="text-right">Price</span>
                </div>

                {items.map((item, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[1.5fr_1fr_1fr] items-center gap-2 px-3 py-2.5 border-b border-border/40 text-xs text-foreground hover:bg-muted/20 transition-colors"
                  >
                    <div className="font-semibold flex items-center gap-2 truncate">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      <span className="truncate">{item.name}</span>
                    </div>
                    <div className="text-muted-foreground truncate text-[11px]">
                      {item.category || proposal.category || "Menu Item"}
                    </div>
                    <div className="text-right font-medium text-primary tabular-nums">
                      {item.price ? `₹${item.price.toFixed(2)}` : "Standard"}
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* BOM Ingredients */}
            {bomLines.length > 0 && (
              <div className="p-3 bg-muted/15 border-t border-border/40">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block mb-2">
                  Recipe Bill of Materials (Automatic Stock Deduction):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {bomLines.map((line, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-background border border-border text-xs font-medium text-foreground shadow-2xs"
                    >
                      <Package className="h-3 w-3 text-muted-foreground" />
                      <span>{line.ingredientName}:</span>
                      <span className="text-primary font-semibold">{line.quantity} {line.unit}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Footer */}
      {!isCompleted && !isRejected && (
        <div className="flex items-center justify-end gap-2 px-4 py-2.5 bg-muted/20 border-t border-border/70">
          <Button
            size="sm"
            variant="ghost"
            disabled={isExecuting}
            onClick={onReject}
            className="h-8 px-3 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            <span>Reject</span>
          </Button>
          <Button
            size="sm"
            disabled={isExecuting}
            onClick={onApprove}
            className="h-8 px-4 text-xs gap-1.5 bg-primary text-primary-foreground font-semibold shadow-xs hover:bg-primary-hover active:scale-[0.98] transition-all"
          >
            {isExecuting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Saving to Database…</span>
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5 stroke-[3]" />
                <span>Approve</span>
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
