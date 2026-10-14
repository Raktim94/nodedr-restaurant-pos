"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ChipItem {
  id: string;
  label: string;
  /** Small secondary text next to the label (a count, "3 free", …). */
  hint?: ReactNode;
}

// Touch-first replacement for tab strips with many entries: big pill buttons
// in one swipeable row. The active pill scrolls itself into view, a fade on
// the right edge hints that there is more, and from lg up the row simply
// wraps. `fill` stretches a few pills across the full width as a segmented
// control (floors: Dining / Drinking / Cafe).
export function ChipBar({
  items,
  value,
  onChange,
  fill = false,
  ariaLabel,
  className,
}: {
  items: ChipItem[];
  value: string;
  onChange: (id: string) => void;
  fill?: boolean;
  ariaLabel: string;
  className?: string;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const active = rowRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [value]);

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        fill
          ? "lg:flex-wrap"
          : "pr-8 [mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)] lg:flex-wrap lg:pr-0 lg:[mask-image:none]",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.id)}
            className={cn(
              "flex min-h-11 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors active:scale-[0.97]",
              fill && "flex-1",
              active
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-border bg-card text-foreground hover:bg-secondary active:bg-secondary",
            )}
          >
            {item.label}
            {item.hint !== undefined && (
              <span
                className={cn(
                  "text-xs font-normal tabular-nums",
                  active ? "text-primary-foreground/80" : "text-muted-foreground",
                )}
              >
                {item.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
