"use client";

import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SearchOption {
  value: string;
  label: string;
  /** Small grey text after the label (category, unit...). Also searched. */
  hint?: string;
  /** Right-aligned text, e.g. stock on hand. Not searched. */
  aside?: string;
  /** Show the aside in red (e.g. out of stock). */
  warn?: boolean;
  /** Section heading the option is listed under. */
  group?: string;
  disabled?: boolean;
}

interface Group { value: string; items: SearchOption[] }

const norm = (s: string) => s.toLocaleLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Every word typed must appear in the label or hint ("chi bre" finds "Chicken breast"). */
function matches(o: SearchOption, query: string) {
  const q = norm(query.trim());
  if (!q) return true;
  const hay = norm(`${o.label} ${o.hint ?? ""}`);
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/**
 * Drop-in replacement for a native <select>: click opens the full list, typing narrows it as you type
 * (every word must match the name or hint), Up/Down + Enter pick, Escape closes. Value is a string; "" means none.
 * Built on Base UI Combobox, so it works inside dialogs and scrolling tables and is announced as a combobox.
 */
export function SearchSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Search…",
  className,
  invalid,
  disabled,
  autoFocus,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
  emptyText = "Nothing matches",
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  /** Classes for the wrapper (width, margin). The input always fills it. */
  className?: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
  emptyText?: string;
}) {
  const selected = React.useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);
  const grouped = options.some((o) => o.group);
  const items = React.useMemo<SearchOption[] | Group[]>(() => {
    if (!grouped) return options;
    const map = new Map<string, SearchOption[]>();
    for (const o of options) {
      const g = o.group ?? "";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(o);
    }
    return [...map].map(([g, list]) => ({ value: g, items: list }));
  }, [options, grouped]);

  const renderItem = (o: SearchOption) => (
    <Combobox.Item
      key={o.value || "__none"}
      value={o}
      disabled={o.disabled}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted"
    >
      <span className="flex size-4 shrink-0 items-center">
        <Combobox.ItemIndicator><CheckIcon className="size-4" /></Combobox.ItemIndicator>
      </span>
      <span className="min-w-0 flex-1 truncate">
        {o.label}
        {o.hint ? <span className="ml-1.5 text-xs text-muted-foreground">{o.hint}</span> : null}
      </span>
      {o.aside ? <span className={cn("shrink-0 text-xs tabular-nums", o.warn ? "text-destructive" : "text-muted-foreground")}>{o.aside}</span> : null}
    </Combobox.Item>
  );

  return (
    <Combobox.Root
      items={items}
      value={selected}
      onValueChange={(v) => { if (v !== undefined) onChange((v as SearchOption | null)?.value ?? ""); }}
      itemToStringLabel={(o: SearchOption) => o.label}
      itemToStringValue={(o: SearchOption) => o.value}
      isItemEqualToValue={(a: SearchOption, b: SearchOption) => a?.value === b?.value}
      filter={(o: SearchOption, q: string) => matches(o, q)}
      autoHighlight
      disabled={disabled}
    >
      <Combobox.InputGroup className={cn("relative w-full", className)}>
        <Combobox.Input
          id={id}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          autoFocus={autoFocus}
          placeholder={placeholder}
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(
            "h-9 w-full min-w-0 truncate rounded-lg border border-input bg-background pl-2.5 pr-8 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 any-pointer-coarse:text-base dark:bg-input/30",
            invalid && "border-destructive ring-3 ring-destructive/20",
          )}
        />
        <Combobox.Trigger
          aria-label="Show all options"
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground disabled:opacity-50"
        >
          <ChevronsUpDownIcon className="size-4" />
        </Combobox.Trigger>
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="isolate z-50 outline-none">
          <Combobox.Popup className="w-(--anchor-width) min-w-[14rem] max-w-(--available-width) origin-(--transform-origin) rounded-lg border border-border bg-popover text-popover-foreground shadow-lg transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Combobox.Empty>
              <div className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</div>
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(18rem,var(--available-height))] scroll-py-1 overflow-y-auto overscroll-contain p-1 outline-0 data-empty:p-0">
              {grouped
                ? (g: Group) => (
                    <Combobox.Group key={g.value} items={g.items}>
                      {g.value && <Combobox.GroupLabel className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.value}</Combobox.GroupLabel>}
                      <Combobox.Collection>{(o: SearchOption) => renderItem(o)}</Combobox.Collection>
                    </Combobox.Group>
                  )
                : (o: SearchOption) => renderItem(o)}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
