"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PermissionChecklist } from "@/components/settings/permission-checklist";
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
import { useCreateRole } from "@/hooks/use-roles";
import { ApiError } from "@/lib/api";

// Mounted only while the "Create role" dialog is open (see RolesPage) —
// conditional mount, not an open-prop + reset-effect, so every open starts
// with clean state for free.
export function CreateRoleDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [permissionKeys, setPermissionKeys] = useState<string[]>([]);
  const createRole = useCreateRole();

  const togglePermission = (key: string) =>
    setPermissionKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createRole.mutate(
      { name: name.trim(), label: label.trim(), permissionKeys },
      {
        onSuccess: () => {
          toast.success(`${label.trim()} role created`);
          onClose();
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? err.message : "Could not create role"),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create custom role</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-name">Name</Label>
              <Input
                id="r-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="DISPLAY"
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="r-label">Display label</Label>
              <Input
                id="r-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Display"
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Permissions</Label>
            <PermissionChecklist selected={permissionKeys} onToggle={togglePermission} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={createRole.isPending}>
              {createRole.isPending ? "Creating…" : "Create role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
