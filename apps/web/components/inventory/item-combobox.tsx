"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { StockItem } from "@/hooks/use-stock-journal";
import { cn } from "@/lib/utils";

const KIND_LABEL = { PURCHASED: "Raw materials", PREPARED: "Finished products" } as const;

/**
 * Searchable stock-item picker (WAI-ARIA combobox with a listbox popup). Type to filter by name or category;
 * Up/Down move, Enter picks, Escape closes. Shows what is in stock beside each name so the cook picks the right one.
 */
export function ItemCombobox({
  items,
  value,
  onChange,
  label,
  invalid,
  describedBy,
  autoFocus,
}: {
  items: StockItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const chosen = items.find((i) => i.id === value);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const t = text.trim().toLowerCase();
    const hit = t ? items.filter((i) => i.name.toLowerCase().includes(t) || (i.category ?? "").toLowerCase().includes(t)) : items;
    // Raw materials first, then finished products; names that start with the text first.
    return [...hit].sort((a, b) => (a.kind === b.kind ? (t ? Number(!a.name.toLowerCase().startsWith(t)) - Number(!b.name.toLowerCase().startsWith(t)) : 0) || a.name.localeCompare(b.name) : a.kind === "PURCHASED" ? -1 : 1)).slice(0, 80);
  }, [items, text]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (i: StockItem) => {
    onChange(i.id);
    setText("");
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(a + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open) { e.preventDefault(); const m = matches[active]; if (m) pick(m); }
    else if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false); setText(""); }
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={input}
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${id}-opt-${active}` : undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder={chosen ? chosen.name : "Search items…"}
          value={open ? text : chosen?.name ?? ""}
          onChange={(e) => { setText(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => { setOpen(true); setActive(Math.max(0, matches.findIndex((m) => m.id === value))); }}
          onBlur={() => { setOpen(false); setText(""); }}
          onKeyDown={onKey}
          className={cn(
            "h-10 w-full rounded-lg border border-input bg-background pl-3 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            invalid && "border-destructive ring-3 ring-destructive/20",
            !open && chosen && "font-medium",
          )}
        />
        <ChevronsUpDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-50 mt-1 max-h-72 w-full min-w-[16rem] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm shadow-lg"
          // Keep focus in the input while clicking an option.
          onMouseDown={(e) => e.preventDefault()}
        >
          {matches.length === 0 && <li className="px-3 py-2 text-muted-foreground">No item matches &ldquo;{text}&rdquo;</li>}
          {matches.map((m, i) => {
            const head = i === 0 || matches[i - 1].kind !== m.kind;
            return (
              <li key={m.id} role="presentation">
                {head && <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{KIND_LABEL[m.kind]}</div>}
                <div
                  id={`${id}-opt-${i}`}
                  role="option"
                  data-index={i}
                  aria-selected={m.id === value}
                  onClick={() => pick(m)}
                  onMouseMove={() => setActive(i)}
                  className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-2", i === active && "bg-muted")}
                >
                  <Check aria-hidden className={cn("size-4 shrink-0", m.id === value ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">{m.name}{m.category ? <span className="ml-1.5 text-xs text-muted-foreground">{m.category}</span> : null}</span>
                  <span className={cn("shrink-0 text-xs tabular-nums", Number(m.currentStock) <= 0 ? "text-destructive" : "text-muted-foreground")}>{m.currentStock} {m.unit.toLowerCase()}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
