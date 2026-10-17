"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { KioskMenuItem } from "@/lib/kiosk-api";
import { cn } from "@/lib/utils";
import { KButton, TOUCH } from "./kiosk-ui";

export interface ModifierChoice {
  modifierIds: string[];
  label: string;
  /** sum of priceAdjustment, for the preview total only */
  extra: number;
}

/** Full-screen-ish option picker. Remounted per item (keyed by the parent). */
export function ModifierSheet({
  item,
  priceText,
  onCancel,
  onConfirm,
}: {
  item: KioskMenuItem;
  priceText: (amount: number) => string;
  onCancel: () => void;
  onConfirm: (choice: ModifierChoice) => void;
}) {
  const { t } = useI18n();
  const groups = item.modifierGroups.map((g) => g.modifierGroup);
  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      groups
        .map((g) => [g.id, g.modifiers.filter((m) => m.isDefault).map((m) => m.id)] as const)
        .filter(([, ids]) => ids.length > 0),
    ),
  );
  const [problem, setProblem] = useState<string | null>(null);

  const toggle = (groupId: string, modifierId: string, max: number) => {
    setProblem(null);
    setSelected((prev) => {
      const current = prev[groupId] ?? [];
      if (current.includes(modifierId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== modifierId) };
      }
      // A single-choice group swaps; a multi-choice group stops at its max.
      if (max === 1) return { ...prev, [groupId]: [modifierId] };
      if (current.length >= max) return prev;
      return { ...prev, [groupId]: [...current, modifierId] };
    });
  };

  const confirm = () => {
    for (const g of groups) {
      const need = Math.max(g.minSelect, g.isRequired ? 1 : 0);
      if ((selected[g.id]?.length ?? 0) < need) {
        setProblem(t("kiosk.modifiers.pickMin", { min: need, group: g.name }));
        return;
      }
    }
    const chosen = groups.flatMap((g) => g.modifiers.filter((m) => selected[g.id]?.includes(m.id)));
    onConfirm({
      modifierIds: chosen.map((m) => m.id),
      label: chosen.map((m) => m.name).join(", "),
      extra: chosen.reduce((sum, m) => sum + Number(m.priceAdjustment), 0),
    });
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
    >
      <div className="flex max-h-full w-full max-w-[44rem] flex-col overflow-hidden rounded-3xl bg-card shadow-2xl">
        <div className="border-b border-border p-6">
          <h2 className="text-[1.75rem] font-bold leading-tight">{item.name}</h2>
          <p className="text-[1.1rem] text-muted-foreground">{t("kiosk.modifiers.choose")}</p>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {groups.map((g) => {
            const required = g.isRequired || g.minSelect > 0;
            return (
              <fieldset key={g.id}>
                <legend className="mb-3 flex items-baseline gap-3 text-[1.25rem] font-semibold">
                  {g.name}
                  <span className="text-[1rem] font-normal text-muted-foreground">
                    {required
                      ? t("kiosk.modifiers.required")
                      : g.maxSelect > 1
                        ? t("kiosk.modifiers.upTo", { max: g.maxSelect })
                        : ""}
                  </span>
                </legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {g.modifiers.map((m) => {
                    const on = selected[g.id]?.includes(m.id) ?? false;
                    const adj = Number(m.priceAdjustment);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role={g.maxSelect === 1 ? "radio" : "checkbox"}
                        aria-checked={on}
                        onClick={() => toggle(g.id, m.id, g.maxSelect)}
                        className={cn(
                          "flex touch-manipulation select-none items-center justify-between gap-3 rounded-2xl border-2 px-4 text-left text-[1.1rem] font-medium",
                          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
                          TOUCH,
                          "py-3",
                          on ? "border-primary bg-accent" : "border-border bg-card hover:bg-secondary",
                        )}
                      >
                        <span className="flex items-center gap-3">
                          <span
                            aria-hidden
                            className={cn(
                              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
                              on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                            )}
                          >
                            {on && <Check className="h-4 w-4" />}
                          </span>
                          {m.name}
                        </span>
                        {adj !== 0 && (
                          <span className="tabular-nums text-muted-foreground">
                            {adj > 0 ? "+" : ""}
                            {priceText(adj)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
          {problem && (
            <p role="alert" className="text-[1.1rem] font-semibold text-destructive">
              {problem}
            </p>
          )}
        </div>
        <div className="flex gap-3 border-t border-border p-4">
          <KButton variant="secondary" large onClick={onCancel} className="flex-1">
            {t("kiosk.cancel")}
          </KButton>
          <KButton large onClick={confirm} className="flex-[2]">
            {t("kiosk.modifiers.add")}
          </KButton>
        </div>
      </div>
    </div>
  );
}
