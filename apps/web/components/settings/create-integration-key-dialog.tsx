"use client";

import { useState } from "react";
import { toast } from "sonner";
import { INTEGRATION_SCOPES, type IntegrationScope } from "@nodedr-restaurant/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBranch } from "@/hooks/use-branch";
import { useCreateIntegrationApiKey } from "@/hooks/use-api-keys";
import { ApiError } from "@/lib/api";

const ALL_LOCATIONS = "__all__";

// Conditional mount, not open-prop + reset-effect — same pattern as
// RestoreBackupDialog/CreateRoleDialog, so form state always starts fresh.
export function CreateIntegrationKeyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (token: string) => void;
}) {
  const { branches } = useBranch();
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState<string>(ALL_LOCATIONS);
  const [scopes, setScopes] = useState<IntegrationScope[]>([]);
  const createKey = useCreateIntegrationApiKey();

  const toggleScope = (key: IntegrationScope) => {
    setScopes((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (scopes.length === 0) {
      toast.error("Select at least one permission this key should have");
      return;
    }
    createKey.mutate(
      { name: name.trim(), branchId: branchId === ALL_LOCATIONS ? undefined : branchId, scopes },
      {
        onSuccess: (created) => onCreated(created.token),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not create API key"),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New integration API key</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ik-name">Name</Label>
            <Input
              id="ik-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Our website ordering widget"
              required
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ik-branch">Location</Label>
            <Select value={branchId} onValueChange={(v) => setBranchId(v ?? ALL_LOCATIONS)}>
              <SelectTrigger id="ik-branch">
                <SelectValue placeholder="All locations">
                  {(value: string | null) =>
                    !value || value === ALL_LOCATIONS
                      ? "All locations"
                      : (branches.find((b) => b.id === value)?.name ?? "All locations")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_LOCATIONS}>All locations</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Scope this key to one location, or leave it as all locations for a key a central booking widget can use
              across every branch.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Permissions</Label>
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              {INTEGRATION_SCOPES.map((scope) => (
                <label key={scope.key} className="flex items-start gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={scopes.includes(scope.key)}
                    onCheckedChange={() => toggleScope(scope.key)}
                    className="mt-0.5"
                  />
                  <span>
                    {scope.label}
                    <span className="block text-xs font-normal text-muted-foreground">{scope.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={createKey.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createKey.isPending}>
              {createKey.isPending ? "Creating…" : "Create key"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
