"use client";

import { PERMISSIONS } from "@nodedr-restaurant/types";
import { ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/hooks/use-auth";
import { useRoles } from "@/hooks/use-roles";
import { useSetPermissionOverrides, type StaffMember } from "@/hooks/use-staff";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Choice = "DEFAULT" | "GRANT" | "DENY";

const CHOICES: { value: Choice; label: string }[] = [
  { value: "DEFAULT", label: "Role" },
  { value: "GRANT", label: "Allow" },
  { value: "DENY", label: "Block" },
];

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

/**
 * Per-person exceptions on top of their role: allow one extra thing, or block
 * one thing, optionally until a date. Everything else stays "Role" (inherit).
 */
export function StaffAccessDialog({ member }: { member: StaffMember }) {
  const [open, setOpen] = useState(false);
  const { data: me } = useCurrentUser();
  const { data: roles } = useRoles();
  const save = useSetPermissionOverrides();

  const initial = useMemo(() => {
    const m: Record<string, Choice> = {};
    for (const o of member.permissionOverrides) m[o.permission.key] = o.effect;
    return m;
  }, [member.permissionOverrides]);

  const [choices, setChoices] = useState<Record<string, Choice>>(initial);
  const [until, setUntil] = useState(() => member.permissionOverrides.find((o) => o.expiresAt)?.expiresAt?.slice(0, 10) ?? "");
  const [reason, setReason] = useState(() => member.permissionOverrides.find((o) => o.reason)?.reason ?? "");

  const roleKeys = useMemo(
    () => new Set(roles?.find((r) => r.id === member.roleId)?.permissions.map((p) => p.permission.key) ?? []),
    [roles, member.roleId],
  );
  const myKeys = useMemo(() => new Set(me?.user.permissions ?? []), [me]);

  const groups = useMemo(() => {
    const map = new Map<string, (typeof PERMISSIONS)[number][]>();
    for (const p of PERMISSIONS) map.set(p.category, [...(map.get(p.category) ?? []), p]);
    return [...map.entries()];
  }, []);

  const changed = Object.entries(choices).filter(([, v]) => v !== "DEFAULT");
  const isOwner = member.role.name === "OWNER";

  const onOpenChange = (next: boolean) => {
    if (next) setChoices(initial);
    setOpen(next);
  };

  const onSave = () => {
    const expiresAt = until ? new Date(`${until}T23:59:59`).toISOString() : undefined;
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      toast.error("Pick an end date in the future");
      return;
    }
    save.mutate(
      {
        id: member.id,
        overrides: changed.map(([permissionKey, effect]) => ({
          permissionKey,
          effect: effect as "GRANT" | "DENY",
          reason: reason.trim() || undefined,
          expiresAt,
        })),
      },
      {
        onSuccess: () => {
          toast.success(`${member.name}'s access updated`);
          setOpen(false);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save"),
      },
    );
  };

  const count = member.permissionOverrides.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" aria-label={`Access exceptions for ${member.name}`}>
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Access</span>
            {count > 0 && <span className="tabular-nums">{count}</span>}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Access for {member.name}</DialogTitle>
          <DialogDescription>
            Starts from the <strong>{member.role.label}</strong> role. Allow or block single permissions for this person only.
            Block always wins.
          </DialogDescription>
        </DialogHeader>

        {isOwner ? (
          <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            The owner always has full access, so exceptions are not available.
          </p>
        ) : (
          <>
            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
              {groups.map(([category, perms]) => (
                <section key={category} aria-label={category}>
                  <h3 className="sticky top-0 z-10 border-b border-border bg-card px-3 py-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    {category}
                  </h3>
                  {perms.map((p) => {
                    const value = choices[p.key] ?? "DEFAULT";
                    const inRole = roleKeys.has(p.key);
                    const cannotGrant = !myKeys.has(p.key);
                    return (
                      <div key={p.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2 last:border-b-0">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-foreground">{p.label}</p>
                          <p className="text-xs text-muted-foreground">{inRole ? "Included in role" : "Not in role"}</p>
                        </div>
                        <div role="radiogroup" aria-label={p.label} className="inline-flex rounded-lg border border-border p-0.5">
                          {CHOICES.map((c) => {
                            const disabled = c.value === "GRANT" && cannotGrant;
                            const active = value === c.value;
                            return (
                              <button
                                key={c.value}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                disabled={disabled}
                                title={disabled ? "You can only allow permissions you have yourself" : undefined}
                                onClick={() => setChoices((prev) => ({ ...prev, [p.key]: c.value }))}
                                className={cn(
                                  "min-h-8 min-w-14 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40",
                                  active && c.value === "DEFAULT" && "bg-muted text-foreground",
                                  active && c.value === "GRANT" && "bg-success/15 text-success",
                                  active && c.value === "DENY" && "bg-destructive/15 text-destructive",
                                  !active && "text-muted-foreground hover:text-foreground",
                                )}
                              >
                                {c.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="ov-until">Exceptions end on (optional)</Label>
                <Input id="ov-until" type="date" min={tomorrow()} value={until} onChange={(e) => setUntil(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="ov-reason">Reason (optional)</Label>
                <Input id="ov-reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. covering for the manager" />
              </div>
            </div>

            <DialogFooter className="items-center sm:justify-between">
              <Badge variant="secondary" className="font-normal">
                {changed.length === 0 ? "No exceptions" : `${changed.length} exception${changed.length === 1 ? "" : "s"}`}
              </Badge>
              <Button onClick={onSave} disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save access"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
