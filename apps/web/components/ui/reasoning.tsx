"use client";

import * as React from "react";
import { ChevronDown, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReasoningProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  defaultOpen?: boolean;
  durationMs?: number;
}

export function Reasoning({
  children,
  defaultOpen = false,
  durationMs,
  className,
  ...props
}: ReasoningProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);

  return (
    <div
      data-slot="ai-reasoning"
      className={cn(
        "rounded-xl border border-border/60 bg-muted/30 text-xs text-muted-foreground transition-all overflow-hidden",
        className
      )}
      {...props}
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-3 py-2 font-medium hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-1.5 text-foreground/80">
          <Brain className="h-3.5 w-3.5 text-primary" />
          <span>Thought process</span>
          {durationMs !== undefined && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              ({(durationMs / 1000).toFixed(1)}s)
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <div className="border-t border-border/40 px-3.5 py-2.5 leading-relaxed text-foreground/90 whitespace-pre-wrap">
          {children}
        </div>
      )}
    </div>
  );
}

