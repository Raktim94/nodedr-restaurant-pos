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
import { useUpdateCategory, type MenuCategory } from "@/hooks/use-menu";
import { ApiError } from "@/lib/api";

// Mounted only while a specific category is being edited (see MenuPage),
// keyed by category.id — same pattern as EditRoleDialog.
export function EditCategoryDialog({
  branchId,
  category,
  onClose,
}: {
  branchId: string | null;
  category: MenuCategory;
  onClose: () => void;
}) {
  const [name, setName] = useState(category.name);
  const updateCategory = useUpdateCategory(branchId);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateCategory.mutate(
      { id: category.id, dto: { name } },
      {
        onSuccess: () => {
          toast.success(`"${name}" updated`);
          onClose();
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Could not update category"),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Edit category</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-4">
            <Label htmlFor="category-edit-name">Name</Label>
            <Input
              id="category-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Starters"
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={updateCategory.isPending}>
              {updateCategory.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
