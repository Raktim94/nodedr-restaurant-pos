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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateTable, useUpdateTable, type RestaurantTable } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";

export function TableEditorDialog({
  branchId,
  floorId,
  table,
  open,
  onOpenChange,
}: {
  branchId: string | null;
  floorId: string;
  table: RestaurantTable | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = !!table;
  const [number, setNumber] = useState(table?.number ?? "");
  const [name, setName] = useState(table?.name ?? "");
  const [capacity, setCapacity] = useState(String(table?.capacity ?? 4));
  const [shape, setShape] = useState<"square" | "round" | "rect">(table?.shape ?? "square");
  const createTable = useCreateTable(branchId);
  const updateTable = useUpdateTable(branchId);
  const isPending = createTable.isPending || updateTable.isPending;

  const reset = () => {
    setNumber(table?.number ?? "");
    setName(table?.name ?? "");
    setCapacity(String(table?.capacity ?? 4));
    setShape(table?.shape ?? "square");
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const dto = {
      number,
      name: name || undefined,
      capacity: Number(capacity) || 1,
      shape,
    };

    if (isEdit) {
      updateTable.mutate(
        { id: table.id, dto },
        {
          onSuccess: () => {
            toast.success("Table updated");
            onOpenChange(false);
          },
          onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update table"),
        },
      );
      return;
    }

    createTable.mutate(
      { floorId, ...dto, posX: 20, posY: 20, width: 80, height: 80, rotation: 0 },
      {
        onSuccess: () => {
          toast.success(`Table ${number} added`);
          onOpenChange(false);
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not add table"),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) reset();
      }}
    >
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit table" : "New table"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="table-number">Number</Label>
                <Input
                  id="table-number"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="e.g. 9"
                  required
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="table-capacity">Capacity</Label>
                <Input
                  id="table-capacity"
                  type="number"
                  min="1"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="table-name">Label (optional)</Label>
              <Input
                id="table-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Window booth"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Shape</Label>
              <Select value={shape} onValueChange={(v) => setShape(v as typeof shape)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="square">Square</SelectItem>
                  <SelectItem value="round">Round</SelectItem>
                  <SelectItem value="rect">Rectangle</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : isEdit ? "Save changes" : "Add table"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
