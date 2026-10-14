"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface NavItem {
  id: string;
  label: string;
  /** Secondary text: an item count, "3 free", … */
  hint?: ReactNode;
}

// One navigation control, two presentations. Desktop (lg and up) keeps the
// classic tab strip exactly as it always was. Phones get a dropdown: a single
// full-width button showing the current choice, which opens a bottom list with
// large rows, counts and a check on the active one — one tap to open, one to
// pick, no sideways swiping through a long row.
export function ResponsiveTabs({
  label,
  items,
  value,
  onChange,
  desktopListClassName,
  mobileOnly = false,
  className,
}: {
  /** Names the control ("Floor", "Category") — button caption and sheet title. */
  label: string;
  items: NavItem[];
  value: string;
  onChange: (id: string) => void;
  desktopListClassName?: string;
  /** Only render the phone dropdown (the page has its own desktop navigation). */
  mobileOnly?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const activeRef = useRef<HTMLButtonElement>(null);
  const current = items.find((i) => i.id === value) ?? items[0];

  // Open the list already scrolled to the current choice.
  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: "center" });
  }, [open]);

  return (
    <div className={className}>
      {!mobileOnly && (
      <div className="hidden lg:block">
        <Tabs value={value} onValueChange={onChange}>
          <TabsList className={desktopListClassName}>
            {items.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      )}

      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-card px-4 text-left shadow-sm transition-colors active:bg-secondary lg:hidden"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className="truncate text-sm font-semibold text-foreground">{current?.label}</span>
        </span>
        {current?.hint !== undefined && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{current.hint}</span>
        )}
        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[80dvh] rounded-t-2xl p-0 lg:hidden">
          <SheetHeader className="px-4 pt-4">
            <SheetTitle>{label}</SheetTitle>
          </SheetHeader>
          <div role="listbox" aria-label={label} className="flex flex-col overflow-y-auto px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {items.map((item) => {
              const active = item.id === value;
              return (
                <button
                  key={item.id}
                  ref={active ? activeRef : undefined}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors active:bg-secondary",
                    active ? "bg-accent font-semibold text-accent-foreground" : "font-medium text-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1 break-words">{item.label}</span>
                  {item.hint !== undefined && (
                    <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">{item.hint}</span>
                  )}
                  <Check className={cn("h-4 w-4 shrink-0 text-primary", !active && "invisible")} />
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
