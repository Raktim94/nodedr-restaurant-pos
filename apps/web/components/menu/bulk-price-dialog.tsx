"use client";

import { Percent } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useBulkPrice, type BulkPriceResult, type MenuCategory } from "@/hooks/use-menu";

/** Change every dish price by a percentage in one go: positive raises, negative lowers. */
export function BulkPriceDialog({ branchId, categories }: { branchId: string | null; categories: MenuCategory[] }) {
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [roundToWhole, setRoundToWhole] = useState(true);
  const [preview, setPreview] = useState<BulkPriceResult | null>(null);
  const { note, clear, toast } = useNoteToast();
  const bulk = useBulkPrice(branchId);

  const value = Number(percent);
  const valid = percent.trim() !== "" && Number.isFinite(value) && value >= -90 && value <= 500 && value !== 0;
  const dto = (previewOnly: boolean) => ({
    percent: value,
    roundToWhole,
    preview: previewOnly,
    ...(categoryId ? { categoryId } : {}),
  });
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Something went wrong");
  const reset = () => {
    setPreview(null);
    clear();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setPercent("");
          setCategoryId("");
          reset();
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Percent className="h-3.5 w-3.5" />
        Change all prices
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change all prices</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Enter a percentage. A positive number raises prices, a negative number lowers them (for example 10 for
            10% more, −5 for 5% less). Bills already open or paid keep the price they were rung up at.
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bp-percent">Percentage change</Label>
            <Input
              id="bp-percent"
              type="number"
              inputMode="decimal"
              step="0.5"
              min={-90}
              max={500}
              value={percent}
              onChange={(e) => {
                setPercent(e.target.value);
                reset();
              }}
              placeholder="e.g. 10 or -5"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bp-cat">Which dishes</Label>
            <select
              id="bp-cat"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                reset();
              }}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">All dishes</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} only
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={roundToWhole}
              onChange={(e) => {
                setRoundToWhole(e.target.checked);
                reset();
              }}
              className="h-4 w-4"
            />
            Round to whole rupees
          </label>
          {preview && (
            <div className="rounded-lg bg-secondary/40 px-3 py-2 text-sm">
              <p className="font-medium text-foreground">
                {preview.count} of {preview.total} dishes will change.
              </p>
              <ul className="mt-1 text-xs text-muted-foreground">
                {preview.sample.map((s) => (
                  <li key={s.name}>
                    {s.name}: {formatCurrency(s.before)} → {formatCurrency(s.after)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <StatusNote note={note} onClear={clear} />
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            disabled={!valid || bulk.isPending}
            onClick={() => bulk.mutate(dto(true), { onSuccess: setPreview, onError: fail })}
          >
            Preview
          </Button>
          <Button
            disabled={!valid || !preview || preview.count === 0 || bulk.isPending}
            onClick={() =>
              bulk.mutate(dto(false), {
                onSuccess: (r) => {
                  toast.success(`Updated ${r.count} dishes`);
                  setOpen(false);
                },
                onError: fail,
              })
            }
          >
            Apply to {preview?.count ?? 0} dishes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
