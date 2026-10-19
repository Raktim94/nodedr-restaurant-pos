"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";

// A deliberate "are you sure, and why" step for refusing something. Used for
// declining an incoming order and for the kitchen rejecting a ticket. It is a
// real dialog (not window.confirm, which kiosk/PWA tablets suppress), the
// buttons are tablet-sized, and nothing happens until a reason is entered.
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  warning,
  reasons,
  confirmLabel,
  keepLabel = "Keep it",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Extra emphasis, e.g. "food is already being prepared". */
  warning?: string;
  reasons: string[];
  confirmLabel: string;
  keepLabel?: string;
  onSubmit: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const close = (next: boolean) => {
    if (pending) return;
    if (!next) {
      setError(null);
      setReason("");
    }
    onOpenChange(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending || !reason.trim()) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
      setReason("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {warning && (
            <p role="alert" className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
              {warning}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="reason-input">Reason</Label>
            <Input
              id="reason-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={200}
              required
              autoFocus
              className="h-11"
              placeholder="Why?"
            />
            <div className="flex flex-wrap gap-2">
              {reasons.map((r) => (
                <Button key={r} type="button" variant="outline" className="h-10 px-3" onClick={() => setReason(r)}>
                  {r}
                </Button>
              ))}
            </div>
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={() => close(false)}>
              {keepLabel}
            </Button>
            <Button type="submit" variant="destructive" className="h-11" disabled={pending || !reason.trim()}>
              {pending ? "Working…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
