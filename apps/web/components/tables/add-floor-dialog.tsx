"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateFloor } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";

export function AddFloorDialog({ branchId }: { branchId: string | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const createFloor = useCreateFloor(branchId);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createFloor.mutate(name, {
      onSuccess: () => {
        toast.success(`"${name}" floor added`);
        setOpen(false);
        setName("");
      },
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not add floor"),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Plus className="h-4 w-4" />
            Add floor
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>New floor</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-4">
            <Label htmlFor="floor-name">Name</Label>
            <Input
              id="floor-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rooftop"
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={createFloor.isPending}>
              {createFloor.isPending ? "Adding…" : "Add floor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
