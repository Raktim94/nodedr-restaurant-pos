"use client";

import { Check, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useDepartmentActions, useDepartments } from "@/hooks/use-staff";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");

export function DepartmentsCard() {
  const { data: departments, isLoading } = useDepartments();
  const { create, rename, remove } = useDepartmentActions();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    create.mutate(n, {
      onSuccess: () => {
        setName("");
        toast.success(`${n} added`);
      },
      onError: (err) => toast.error(msg(err)),
    });
  };

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-[18px] font-medium text-foreground">Departments</h2>
        <p className="text-sm text-muted-foreground">
          Group staff by team (Kitchen, Front of house, Accounts). Departments are labels only; what someone can do comes from their role.
        </p>
      </div>

      <form onSubmit={add} className="flex gap-2">
        <Input
          aria-label="New department name"
          placeholder="New department"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={!name.trim() || create.isPending}>
          Add
        </Button>
      </form>

      {isLoading ? null : departments && departments.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {departments.map((d) => (
            <li key={d.id} className="flex items-center gap-1 rounded-lg border border-border bg-background py-1 pr-1 pl-3 text-sm">
              {editing?.id === d.id ? (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename.mutate(
                      { id: d.id, name: editing.name.trim() },
                      { onSuccess: () => setEditing(null), onError: (err) => toast.error(msg(err)) },
                    );
                  }}
                >
                  <Input
                    aria-label={`Rename ${d.name}`}
                    autoFocus
                    className="h-7 w-36"
                    value={editing.name}
                    maxLength={60}
                    onChange={(e) => setEditing({ id: d.id, name: e.target.value })}
                  />
                  <Button type="submit" variant="ghost" size="icon" className="h-8 w-8" aria-label="Save name">
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Cancel" onClick={() => setEditing(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </form>
              ) : (
                <>
                  <span className="font-medium text-foreground">{d.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{d._count.users}</span>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={`Rename ${d.name}`} onClick={() => setEditing({ id: d.id, name: d.name })}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${d.name}`}
                    onClick={() => {
                      if (!confirm(`Delete the ${d.name} department? Its ${d._count.users} staff will be kept, just unassigned.`)) return;
                      remove.mutate(d.id, { onError: (err) => toast.error(msg(err)) });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No departments yet. Add your first one above.</p>
      )}
    </Card>
  );
}
