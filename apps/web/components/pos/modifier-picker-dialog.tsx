"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MenuItem } from "@/hooks/use-menu";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

function defaultSelection(item: MenuItem): Record<string, Set<string>> {
  const defaults: Record<string, Set<string>> = {};
  for (const { modifierGroup } of item.modifierGroups) {
    const defaultIds = modifierGroup.modifiers.filter((m) => m.isDefault).map((m) => m.id);
    if (defaultIds.length > 0) defaults[modifierGroup.id] = new Set(defaultIds);
  }
  return defaults;
}

// Keyed by item.id from the parent so switching items mounts a fresh
// instance — that lets `selected`'s initial state be derived straight from
// `item` via useState's lazy initializer (a pure, one-time computation from
// props) instead of a useEffect + setState, which React's compiler-era
// lint rules flag as an avoidable derived-state effect.
function ModifierPickerBody({
  item,
  onConfirm,
}: {
  item: MenuItem;
  onConfirm: (modifierIds: string[], modifierLabel: string) => void;
}) {
  const [selected, setSelected] = useState<Record<string, Set<string>>>(() => defaultSelection(item));

  const groups = item.modifierGroups.map((g) => g.modifierGroup);

  const toggle = (groupId: string, modifierId: string, maxSelect: number) => {
    setSelected((prev) => {
      const current = new Set(prev[groupId] ?? []);
      if (current.has(modifierId)) {
        current.delete(modifierId);
      } else {
        if (maxSelect === 1) current.clear();
        else if (current.size >= maxSelect) return prev;
        current.add(modifierId);
      }
      return { ...prev, [groupId]: current };
    });
  };

  const handleConfirm = () => {
    for (const group of groups) {
      const count = selected[group.id]?.size ?? 0;
      if (count < group.minSelect) {
        toast.error(`Choose at least ${group.minSelect} option(s) for ${group.name}`);
        return;
      }
    }
    const allSelected = groups.flatMap((g) => [...(selected[g.id] ?? [])]);
    const label = groups
      .flatMap((g) => [...(selected[g.id] ?? [])].map((id) => g.modifiers.find((m) => m.id === id)?.name))
      .filter(Boolean)
      .join(", ");
    onConfirm(allSelected, label);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item.name}</DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-5 py-2">
        {groups.map((group) => (
          <div key={group.id} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">{group.name}</h3>
              <span className="text-xs text-muted-foreground">
                {group.maxSelect === 1 ? "Choose 1" : `Choose up to ${group.maxSelect}`}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {group.modifiers.map((mod) => {
                const isSelected = selected[group.id]?.has(mod.id) ?? false;
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => toggle(group.id, mod.id, group.maxSelect)}
                    className={cn(
                      "flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors",
                      isSelected
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border hover:bg-secondary",
                    )}
                  >
                    <span>{mod.name}</span>
                    {Number(mod.priceAdjustment) > 0 && (
                      <span className="text-xs text-muted-foreground">
                        +{formatCurrency(mod.priceAdjustment)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <DialogFooter>
        <Button onClick={handleConfirm}>Add to cart</Button>
      </DialogFooter>
    </>
  );
}

export function ModifierPickerDialog({
  item,
  open,
  onOpenChange,
  onConfirm,
}: {
  item: MenuItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (modifierIds: string[], modifierLabel: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {item && (
          <ModifierPickerBody
            key={item.id}
            item={item}
            onConfirm={(modifierIds, label) => {
              onConfirm(modifierIds, label);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
