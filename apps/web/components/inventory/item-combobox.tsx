"use client";

import { useMemo } from "react";
import { type SearchOption, SearchSelect } from "@/components/ui/search-select";
import type { StockItem } from "@/hooks/use-stock-journal";

const KIND_LABEL = { PURCHASED: "Raw materials", PREPARED: "Finished products" } as const;

/** Stock items as searchable picker options: raw materials first, then finished products, with stock on hand beside each name. */
export function stockItemOptions(items: StockItem[]): SearchOption[] {
  return [...items]
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "PURCHASED" ? -1 : 1))
    .map((i) => ({
      value: i.id,
      label: i.name,
      hint: i.category ?? undefined,
      aside: `${i.currentStock} ${i.unit.toLowerCase()}`,
      warn: Number(i.currentStock) <= 0,
      group: KIND_LABEL[i.kind],
    }));
}

/**
 * Searchable stock-item picker. Click shows every item; type to narrow by name or category.
 * Shows what is in stock beside each name so the cook picks the right one.
 */
export function ItemCombobox({
  items,
  value,
  onChange,
  label,
  invalid,
  describedBy,
  autoFocus,
  id,
  placeholder = "Search items…",
}: {
  items: StockItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  id?: string;
  placeholder?: string;
}) {
  const options = useMemo(() => stockItemOptions(items), [items]);
  return (
    <SearchSelect
      id={id}
      options={options}
      value={value}
      onChange={onChange}
      aria-label={label}
      aria-describedby={describedBy}
      invalid={invalid}
      autoFocus={autoFocus}
      placeholder={placeholder}
      emptyText="No item matches"
    />
  );
}
