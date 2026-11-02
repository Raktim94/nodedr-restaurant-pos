"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { api, ApiError } from "@/lib/api";
import { savePushToken } from "@/lib/native";
import { clearOfflineCache } from "@/lib/offline-cache";

/** Delete my own account. Required by the app stores; reachable from the user menu. */
export function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.delete("/auth/me", { password });
      savePushToken(null);
      qc.clear();
      clearOfflineCache();
      onOpenChange(false);
      router.push("/login");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete the account. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setPassword("");
          setError(null);
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete my account</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            Your name, phone number, email and login are erased and you are signed out everywhere. Orders and bills you
            handled stay in the restaurant&apos;s records, without your name. This cannot be undone.
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="del-pass">Enter your password to confirm</Label>
            <PasswordInput id="del-pass" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!password || busy} onClick={submit}>
            Delete my account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
