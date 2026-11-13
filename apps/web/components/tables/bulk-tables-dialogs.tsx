"use client";

import { generateTableNumbers, TABLE_SHAPES, type TableShape } from "@nodedr-restaurant/types";
import { useState } from "react";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type RestaurantTable, useBulkCreateTables, useBulkDeleteTables, useBulkUpdateTables } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

export const SHAPE_LABEL: Record<TableShape, string> = {
  square: "Square", round: "Round", rect: "Rectangle", booth: "Booth", counter: "Counter / bar seat", other: "Other",
};

const SIZE: Record<TableShape, [number, number]> = {
  square: [80, 80], round: [80, 80], rect: [120, 70], booth: [140, 70], counter: [60, 40], other: [80, 80],
};

/** Create several tables at once: numbering pattern, seats, shape, size, a grid, and a preview before saving. */
export function CreateTablesDialog({ branchId, floorId, floorName, existing }: { branchId: string | null; floorId: string; floorName: string; existing: string[] }) {
  const [open, setOpen] = useState(false);
  const [prefix, setPrefix] = useState("T");
  const [start, setStart] = useState("1");
  const [count, setCount] = useState("6");
  const [pad, setPad] = useState("0");
  const [seats, setSeats] = useState("4");
  const [shape, setShape] = useState<TableShape>("square");
  const [cols, setCols] = useState("5");
  const [error, setError] = useState<string | null>(null);
  const create = useBulkCreateTables(branchId);

  const n = Math.min(100, Math.max(0, Number(count) || 0));
  const numbers = n > 0 ? generateTableNumbers(prefix, Number(start) || 0, n, Number(pad) || 0) : [];
  const clashes = numbers.filter((x) => existing.includes(x));
  const [w, h] = SIZE[shape];

  const save = () => {
    setError(null);
    create.mutate(
      { floorId, numbers, capacity: Number(seats) || 2, shape, width: w, height: h, columns: Number(cols) || 5 },
      {
        onSuccess: () => { toast.success(`${numbers.length} tables added to ${floorName}`); setOpen(false); },
        onError: (e) => setError(e instanceof ApiError ? e.message : "Could not create the tables"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm">Create several tables</Button>} />
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create several tables</DialogTitle>
          <DialogDescription>Added to {floorName}. Check the preview, then save.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5"><Label htmlFor="bt-prefix">Name starts with</Label><Input id="bt-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="bt-start">First number</Label><Input id="bt-start" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="bt-count">How many</Label><Input id="bt-count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="bt-pad">Digits (01 = 2)</Label><Input id="bt-pad" inputMode="numeric" value={pad} onChange={(e) => setPad(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="bt-seats">Seats each</Label><Input id="bt-seats" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="bt-cols">Tables per row</Label><Input id="bt-cols" inputMode="numeric" value={cols} onChange={(e) => setCols(e.target.value)} /></div>
          <div className="col-span-2 flex flex-col gap-1.5"><Label htmlFor="bt-shape">Shape</Label>
            <select id="bt-shape" className={selectClass} value={shape} onChange={(e) => setShape(e.target.value as TableShape)}>
              {TABLE_SHAPES.map((s) => (<option key={s} value={s}>{SHAPE_LABEL[s]}</option>))}
            </select></div>
        </div>
        <div aria-label="Preview">
          <p className="mb-1 text-xs font-medium text-muted-foreground">Preview ({numbers.length})</p>
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
            {numbers.map((x) => (<span key={x} className={`rounded-md border px-2 py-1 text-xs ${existing.includes(x) ? "border-destructive text-destructive" : "border-border"}`}>{x}{existing.includes(x) ? " (exists)" : ""}</span>))}
          </div>
          {clashes.length > 0 && <p role="alert" className="mt-2 text-sm text-destructive">{clashes.join(", ")} already exist on this floor. Change the first number or the name.</p>}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button disabled={numbers.length === 0 || clashes.length > 0 || create.isPending} onClick={save}>{create.isPending ? "Creating…" : `Create ${numbers.length} tables`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A plain list with checkboxes: the reliable way to change many tables on a small screen. */
export function ManageTablesDialog({ branchId, tables, floorName }: { branchId: string | null; tables: RestaurantTable[]; floorName: string }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [seats, setSeats] = useState("");
  const [shape, setShape] = useState<"" | TableShape>("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = useBulkUpdateTables(branchId);
  const del = useBulkDeleteTables(branchId);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : "Could not save");

  const apply = () => {
    setError(null);
    update.mutate({ ids: picked, capacity: seats ? Number(seats) : undefined, shape: shape || undefined }, { onSuccess: () => { toast.success("Tables updated"); setSeats(""); setShape(""); }, onError: fail });
  };
  const remove = () => {
    setError(null);
    del.mutate(picked, { onSuccess: () => { toast.success("Tables deleted"); setPicked([]); setConfirmDelete(false); }, onError: (e) => { fail(e); setConfirmDelete(false); } });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm">Edit several tables</Button>} />
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Edit several tables</DialogTitle><DialogDescription>{floorName}. Tick the tables to change.</DialogDescription></DialogHeader>
        <div className="flex items-center justify-between text-sm">
          <button type="button" className="underline" onClick={() => setPicked(picked.length === tables.length ? [] : tables.map((t) => t.id))}>{picked.length === tables.length ? "Clear selection" : "Select all"}</button>
          <span className="text-muted-foreground">{picked.length} selected</span>
        </div>
        <ul className="grid max-h-60 grid-cols-2 gap-2 overflow-y-auto">
          {tables.map((t) => (
            <li key={t.id}>
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm">
                <input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />
                <span className="font-medium">{t.number}</span>
                <span className="text-muted-foreground">{t.capacity} seats · {SHAPE_LABEL[(t.shape as TableShape) ?? "square"] ?? t.shape}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5"><Label htmlFor="mt-seats">Seats</Label><Input id="mt-seats" inputMode="numeric" placeholder="Leave as is" value={seats} onChange={(e) => setSeats(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="mt-shape">Shape</Label>
            <select id="mt-shape" className={selectClass} value={shape} onChange={(e) => setShape(e.target.value as "" | TableShape)}><option value="">Leave as is</option>{TABLE_SHAPES.map((s) => (<option key={s} value={s}>{SHAPE_LABEL[s]}</option>))}</select></div>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2 sm:justify-between">
          {confirmDelete ? (
            <div className="flex items-center gap-2"><span className="text-sm">Delete {picked.length} tables?</span><Button variant="destructive" size="sm" onClick={remove} disabled={del.isPending}>Yes, delete</Button><Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>No</Button></div>
          ) : (
            <Button variant="destructive" disabled={picked.length === 0} onClick={() => setConfirmDelete(true)}>Delete selected</Button>
          )}
          <Button disabled={picked.length === 0 || (!seats && !shape) || update.isPending} onClick={apply}>Apply changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
