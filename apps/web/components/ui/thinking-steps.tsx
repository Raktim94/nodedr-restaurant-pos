"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ThinkingStepsDisplayProps {
  text: string;
  running?: boolean;
  className?: string;
}

export function ThinkingStepsDisplay({
  text,
  running = false,
  className,
}: ThinkingStepsDisplayProps) {
  const [open, setOpen] = React.useState(false);

  // Split into distinct reasoning lines if bulleted or numbered
  const steps = React.useMemo(() => {
    if (!text) return [];
    return text
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }, [text]);

  const stepCount = steps.length || 1;

  return (
    <div className={cn("flex flex-col select-none text-left my-1", className)}>
      {/* Header Button */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-1.5 rounded-md w-fit"
      >
        <div
          className={cn(
            "transition-transform duration-150 text-muted-foreground/70 group-hover:text-foreground",
            open ? "rotate-90" : "rotate-0"
          )}
        >
          <ChevronRight className="h-3 w-3" />
        </div>

        <div className="flex items-center gap-1.5 font-medium">
          <span className={cn(running && "animate-pulse text-foreground font-semibold")}>
            {running ? "Thinking…" : "Thought"}
          </span>
          <span className="text-[11px] text-muted-foreground/70">
            ({stepCount} {stepCount === 1 ? "step" : "steps"})
          </span>
        </div>
      </button>

      {/* Expanded Step List */}
      {open && (
        <div className="mt-1 ml-5 pl-2.5 border-l border-border/60 flex flex-col gap-1 text-xs text-muted-foreground leading-relaxed animate-in fade-in-50 duration-150">
          {steps.map((step, idx) => (
            <div key={idx} className="flex items-start gap-1.5">
              <span className="h-1 w-1 rounded-full bg-primary/70 mt-1.5 shrink-0" />
              <span>{step.replace(/^[-*•\d.]+\s*/, "")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
