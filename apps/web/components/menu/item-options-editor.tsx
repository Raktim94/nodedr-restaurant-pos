"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type MenuItem, type ModifierGroup, useModifierGroups } from "@/hooks/use-menu";
import { api } from "@/lib/api";

// Options of one menu item: "Size: Regular / Large (+100)", "Extras: Extra cheese (+40)", "Large Coca-Cola".
// A group says HOW customers choose (one required, one optional, or several) and lists the options with their extra price.
// Customers see them in the POS, on the table QR page and on the kiosk; the extra price is added to the line.

export type Choose = "ONE_REQUIRED" | "ONE_OPTIONAL" | "MANY";

export interface OptionDraft {
  key: string;
  id?: string;
  name: string;
  price: string; // extra price, typed
  isDefault: boolean;
}
export interface GroupDraft {
  key: string;
  id?: string;
  name: string;
  choose: Choose;
  maxSelect: number; // only for MANY
  options: OptionDraft[];
  /** Other menu items already using this group (changes here change them too). */
  sharedWith: number;
  dirty: boolean;
}

let n = 0;
const key = () => `k${++n}`;
const blankOption = (name = "", isDefault = false): OptionDraft => ({ key: key(), name, price: "", isDefault });

export function chooseOf(g: Pick<ModifierGroup, "isRequired" | "maxSelect">): Choose {
  if (g.maxSelect > 1) return "MANY";
  return g.isRequired ? "ONE_REQUIRED" : "ONE_OPTIONAL";
}

export function draftFromGroup(g: ModifierGroup, thisItemId?: string, sharedCountIncludesThisItem = true): GroupDraft {
  const used = g._count?.menuItems ?? 1;
  return {
    key: key(),
    id: g.id,
    name: g.name,
    choose: chooseOf(g),
    maxSelect: Math.max(2, g.maxSelect),
    options: [...g.modifiers]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((m) => ({ key: key(), id: m.id, name: m.name, price: Number(m.priceAdjustment) ? String(Number(m.priceAdjustment)) : "", isDefault: m.isDefault })),
    sharedWith: Math.max(0, used - (thisItemId && sharedCountIncludesThisItem ? 1 : 0)),
    dirty: false,
  };
}
export const draftsFromItem = (item: MenuItem): GroupDraft[] => item.modifierGroups.map((l) => draftFromGroup(l.modifierGroup, item.id));

export function problemWithDrafts(drafts: GroupDraft[]): string | null {
  for (const g of drafts) {
    const label = g.name.trim() ? `"${g.name.trim()}"` : "An option group";
    if (!g.name.trim()) return "Give every option group a name, for example Size or Extras.";
    const opts = g.options.filter((o) => o.name.trim());
    if (opts.length === 0) return `${label} needs at least one option.`;
    if (g.options.some((o) => !o.name.trim())) return `${label} has an empty option. Fill it in or remove it.`;
    for (const o of g.options) if (o.price.trim() !== "" && (!Number.isFinite(Number(o.price)) || Number(o.price) < 0)) return `${label}: the extra price of "${o.name}" must be 0 or more.`;
    if (g.choose === "ONE_REQUIRED" && opts.filter((o) => o.isDefault).length > 1) return `${label}: only one option can be pre-selected.`;
    if (g.choose === "MANY" && g.maxSelect < 2) return `${label}: "pick up to" must be at least 2.`;
  }
  return null;
}

/** Writes new and changed groups, in the order shown, and returns their ids for the item. Unchanged shared groups are not touched. */
export async function saveOptionDrafts(branchId: string | null, drafts: GroupDraft[]): Promise<string[]> {
  const ids: string[] = [];
  for (const g of drafts) {
    const body = {
      name: g.name.trim(),
      isRequired: g.choose === "ONE_REQUIRED",
      minSelect: g.choose === "ONE_REQUIRED" ? 1 : 0,
      maxSelect: g.choose === "MANY" ? Math.max(2, g.maxSelect) : 1,
      modifiers: g.options.map((o, i) => ({ ...(o.id ? { id: o.id } : {}), name: o.name.trim(), priceAdjustment: o.price.trim() === "" ? 0 : Number(o.price), isDefault: g.choose !== "MANY" ? o.isDefault : o.isDefault, sortOrder: i })),
    };
    if (!g.id) ids.push((await api.post<ModifierGroup>(`/menu/modifier-groups?branchId=${branchId}`, body)).id);
    else {
      if (g.dirty) await api.patch(`/menu/modifier-groups/${g.id}?branchId=${branchId}`, body);
      ids.push(g.id);
    }
  }
  return ids;
}

const CHOOSE_LABEL: Record<Choose, string> = {
  ONE_REQUIRED: "Pick one (must choose)",
  ONE_OPTIONAL: "Pick one (optional)",
  MANY: "Pick several (extras)",
};

export function ItemOptionsEditor({ branchId, drafts, setDrafts }: { branchId: string | null; drafts: GroupDraft[]; setDrafts: (d: GroupDraft[]) => void }) {
  const { data: allGroups } = useModifierGroups(branchId);
  const attached = new Set(drafts.flatMap((d) => (d.id ? [d.id] : [])));
  const reusable = (allGroups ?? []).filter((g) => !attached.has(g.id));

  const patch = (k: string, fn: (g: GroupDraft) => GroupDraft) => setDrafts(drafts.map((g) => (g.key === k ? { ...fn(g), dirty: true } : g)));
  const addPreset = (kind: "size" | "extras" | "blank") =>
    setDrafts([
      ...drafts,
      kind === "size"
        ? { key: key(), name: "Size", choose: "ONE_REQUIRED", maxSelect: 2, options: [blankOption("Regular", true), blankOption("Large")], sharedWith: 0, dirty: true }
        : kind === "extras"
          ? { key: key(), name: "Extras", choose: "MANY", maxSelect: 3, options: [blankOption("Extra cheese")], sharedWith: 0, dirty: true }
          : { key: key(), name: "", choose: "ONE_OPTIONAL", maxSelect: 2, options: [blankOption()], sharedWith: 0, dirty: true },
    ]);

  return (
    <section aria-label="Options" className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Options</h3>
        <p className="text-xs text-muted-foreground">Sizes and extras customers can choose for this item, each with an extra price. Example: Size (Regular, Large +100), Extras (Extra cheese +40).</p>
      </div>

      {drafts.map((g, gi) => (
        <fieldset key={g.key} className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <legend className="px-1 text-xs text-muted-foreground">Group {gi + 1}</legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`og-name-${g.key}`}>Group name</Label>
            <Input id={`og-name-${g.key}`} className="h-11" value={g.name} maxLength={80} placeholder="Size, Extras, Cheese…" onChange={(e) => patch(g.key, (x) => ({ ...x, name: e.target.value }))} />
          </div>
          <div className={`grid items-end gap-2 ${g.choose === "MANY" ? "grid-cols-[1fr_5rem]" : "grid-cols-1"}`}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`og-choose-${g.key}`}>How customers choose</Label>
              <select id={`og-choose-${g.key}`} className="h-11 w-full rounded-lg border border-input bg-background px-2 text-sm" value={g.choose} onChange={(e) => patch(g.key, (x) => ({ ...x, choose: e.target.value as Choose }))}>
                {(Object.keys(CHOOSE_LABEL) as Choose[]).map((c) => <option key={c} value={c}>{CHOOSE_LABEL[c]}</option>)}
              </select>
            </div>
            {g.choose === "MANY" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`og-max-${g.key}`}>Up to</Label>
                <Input id={`og-max-${g.key}`} className="h-11" inputMode="numeric" value={String(g.maxSelect)} onChange={(e) => patch(g.key, (x) => ({ ...x, maxSelect: Math.min(20, Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0)) }))} />
              </div>
            )}
          </div>

          <ul className="flex flex-col gap-2">
            {g.options.map((o) => (
              <li key={o.key} className="grid grid-cols-[1fr_4.75rem_2.5rem] items-end gap-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`oo-name-${o.key}`} className="text-xs">Option</Label>
                  <Input id={`oo-name-${o.key}`} className="h-11" value={o.name} maxLength={80} placeholder="Large" onChange={(e) => patch(g.key, (x) => ({ ...x, options: x.options.map((y) => (y.key === o.key ? { ...y, name: e.target.value } : y)) }))} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`oo-price-${o.key}`} className="text-xs">Extra price</Label>
                  <Input id={`oo-price-${o.key}`} className="h-11" inputMode="decimal" value={o.price} placeholder="0" onChange={(e) => patch(g.key, (x) => ({ ...x, options: x.options.map((y) => (y.key === o.key ? { ...y, price: e.target.value } : y)) }))} />
                </div>
                <Button type="button" variant="ghost" className="h-11 w-10 p-0" aria-label={`Remove option ${o.name || ""}`} disabled={g.options.length <= 1} onClick={() => patch(g.key, (x) => ({ ...x, options: x.options.filter((y) => y.key !== o.key) }))}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
                <label className="col-span-3 -mt-1 flex min-h-8 items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" className="size-4" checked={o.isDefault} onChange={(e) => patch(g.key, (x) => ({ ...x, options: x.options.map((y) => (y.key === o.key ? { ...y, isDefault: e.target.checked } : g.choose === "MANY" ? y : { ...y, isDefault: false })) }))} />
                  Pre-selected
                </label>
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" className="h-11" onClick={() => patch(g.key, (x) => ({ ...x, options: [...x.options, blankOption()] }))}>
            <Plus className="size-4" aria-hidden /> Add an option
          </Button>

          {g.sharedWith > 0 && <p role="note" className="text-xs text-amber-700 dark:text-amber-400">Shared with {g.sharedWith} other item{g.sharedWith === 1 ? "" : "s"}: changing these options changes them too.</p>}
          <div className="flex justify-end">
            <Button type="button" variant="ghost" className="h-10 text-destructive" onClick={() => setDrafts(drafts.filter((x) => x.key !== g.key))}>Remove this group from the item</Button>
          </div>
        </fieldset>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="h-11" onClick={() => addPreset("size")}>+ Size</Button>
        <Button type="button" variant="outline" className="h-11" onClick={() => addPreset("extras")}>+ Extras</Button>
        <Button type="button" variant="outline" className="h-11" onClick={() => addPreset("blank")}>+ Other group</Button>
      </div>
      {reusable.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="og-reuse">Use a group from another item</Label>
          <select id="og-reuse" className="h-11 w-full rounded-lg border border-input bg-background px-2 text-sm" value="" onChange={(e) => { const g = reusable.find((x) => x.id === e.target.value); if (g) setDrafts([...drafts, draftFromGroup(g, undefined)]); }}>
            <option value="">Choose a group…</option>
            {reusable.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.modifiers.length} option{g.modifiers.length === 1 ? "" : "s"}, {g._count?.menuItems ?? 0} item{(g._count?.menuItems ?? 0) === 1 ? "" : "s"})</option>)}
          </select>
        </div>
      )}
    </section>
  );
}
