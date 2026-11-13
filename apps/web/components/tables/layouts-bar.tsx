"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Floor, useLayoutActions } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

/** Saved arrangements of one floor (lunch, dinner, event). Switching hides the tables a layout leaves out. */
export function LayoutsBar({ branchId, floor }: { branchId: string | null; floor: Floor }) {
  const { save, activate, overwrite, remove } = useLayoutActions(branchId);
  const [name, setName] = useState("");
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Could not do that");
  const layouts = floor.layouts ?? [];
  return (
    <section aria-label={`Layouts for ${floor.name}`} className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <p className="text-sm font-medium">Layouts</p>
      {layouts.length === 0 && <p className="text-xs text-muted-foreground">Arrange the tables, then save the arrangement under a name such as Lunch or Event.</p>}
      <ul className="flex flex-wrap gap-2">
        {layouts.map((l) => (
          <li key={l.id} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm">
            <span className={l.isActive ? "font-semibold" : ""}>{l.name}{l.isActive ? " (in use)" : ""}</span>
            {!l.isActive && <Button size="xs" onClick={() => activate.mutate(l.id, { onSuccess: () => toast.success(`${l.name} is now in use`), onError: fail })}>Use</Button>}
            {l.isActive && <Button size="xs" variant="outline" onClick={() => overwrite.mutate(l.id, { onSuccess: () => toast.success("Layout updated"), onError: fail })}>Save changes</Button>}
            {!l.isActive && <Button size="xs" variant="ghost" aria-label={`Delete layout ${l.name}`} onClick={() => remove.mutate(l.id, { onError: fail })}>×</Button>}
          </li>
        ))}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate({ floorId: floor.id, name: name.trim() }, { onSuccess: () => { setName(""); toast.success("Layout saved"); }, onError: fail }); }}>
        <Input aria-label="New layout name" className="max-w-48" placeholder="Save this as…" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" size="sm" variant="outline" disabled={!name.trim() || save.isPending}>Save layout</Button>
      </form>
    </section>
  );
}
