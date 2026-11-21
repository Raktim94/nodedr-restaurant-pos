"use client";

import * as React from "react";
import { Check, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ConfirmationProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  variant?: "default" | "destructive" | "warning";
}

export function Confirmation({
  title,
  description,
  confirmLabel = "Approve & Send",
  cancelLabel = "Dismiss",
  onConfirm,
  onCancel,
  isLoading = false,
  variant = "default",
  className,
  ...props
}: ConfirmationProps) {
  return (
    <div
      data-slot="ai-confirmation-card"
      className={cn(
        "flex flex-col rounded-xl border border-border/80 bg-background/95 shadow-xs overflow-hidden transition-all text-xs",
        variant === "destructive" && "border-rose-500/40 bg-rose-500/5",
        variant === "warning" && "border-amber-500/40 bg-amber-500/5",
        className
      )}
      {...props}
    >
      <div className="flex items-start gap-2.5 p-3">
        {variant !== "default" && (
          <AlertTriangle
            className={cn(
              "h-4 w-4 mt-0.5 shrink-0",
              variant === "destructive" ? "text-rose-500" : "text-amber-500"
            )}
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground tracking-tight text-xs sm:text-sm">{title}</p>
          {description && (
            <p className="mt-1 text-[11px] sm:text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {description}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border/50 bg-muted/20">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={isLoading}
          className="h-7 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground active:scale-95 transition-transform"
        >
          <X className="h-3 w-3 mr-1" />
          {cancelLabel}
        </Button>

        <Button
          type="button"
          size="sm"
          variant={variant === "destructive" ? "destructive" : "default"}
          onClick={onConfirm}
          disabled={isLoading}
          className={cn(
            "h-7 rounded-lg px-3 text-xs font-semibold active:scale-95 transition-transform shadow-xs",
            variant === "warning" && "bg-amber-600 hover:bg-amber-700 text-white"
          )}
        >
          <Check className="h-3.5 w-3.5 mr-1 stroke-[2.5]" />
          {isLoading ? "Executing…" : confirmLabel}
        </Button>
      </div>
    </div>
  );
}

