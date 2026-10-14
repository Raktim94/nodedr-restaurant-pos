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
import { Switch } from "@/components/ui/switch";
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
  const [showOnWebsite, setShowOnWebsite] = useState(category.showOnWebsite);
  const updateCategory = useUpdateCategory(branchId);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateCategory.mutate(
      { id: category.id, dto: { name, showOnWebsite } },
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
          <label className="mb-4 flex min-h-12 items-center justify-between gap-4 rounded-lg border border-border px-3 py-2">
            <span className="flex flex-col">
              <span className="text-sm font-medium text-foreground">Show on website</span>
              <span className="text-xs text-muted-foreground">
                Off hides this category from your website and online/QR ordering. It stays on the POS.
              </span>
            </span>
            <Switch checked={showOnWebsite} onCheckedChange={setShowOnWebsite} aria-label="Show on website" />
          </label>
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
