"use client";

import { useState } from "react";
import { toast } from "sonner";
import { NavDot } from "@/components/layout/nav-dot";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useApplyUpdate, useUpdateCheck } from "@/hooks/use-updates";
import { ApiError } from "@/lib/api";

// After "Update now" the updater sidecar pulls the new images (the app keeps
// running meanwhile) and then restarts the backend. Each tick asks the
// backend what the updater is doing: a reported error stops the wait with a
// real message, "done" reloads, and if the backend has gone away (restart in
// progress) the unauthenticated health route decides when it is back.
function pollUntilBackUp(onFailed: () => void) {
  const start = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  let wentDown = false;
  const interval = setInterval(async () => {
    if (Date.now() - start > timeoutMs) {
      clearInterval(interval);
      onFailed();
      toast.error("Still not back after 10 minutes — check the server directly.");
      return;
    }
    try {
      const res = await fetch("/api/v1/system/update/progress", {
        cache: "no-store",
        credentials: "include",
      });
      if (res.ok) {
        const p = (await res.json()) as { state: string; error?: string | null };
        if (p.state === "error") {
          clearInterval(interval);
          onFailed();
          toast.error(`Update failed: ${p.error ?? "unknown error"}. The old version is still running.`);
          return;
        }
        if (p.state === "done") {
          clearInterval(interval);
          toast.success("Update finished — reloading.");
          window.location.reload();
          return;
        }
        return; // pulling / restarting: keep waiting
      }
    } catch {
      // backend is restarting
    }
    wentDown = true;
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok && wentDown) {
        clearInterval(interval);
        toast.success("Update finished — reloading.");
        window.location.reload();
      }
    } catch {
      // still down
    }
  }, 3000);
}

export default function UpdatesPage() {
  const { data, isLoading, refetch, isFetching } = useUpdateCheck();
  const applyUpdate = useApplyUpdate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const handleUpdate = () => {
    setConfirmOpen(false);
    setApplying(true);
    applyUpdate.mutate(undefined, {
      onSuccess: (result) => {
        toast.info(result.message);
        pollUntilBackUp(() => setApplying(false));
      },
      onError: (err) => {
        setApplying(false);
        toast.error(err instanceof ApiError ? err.message : "Could not start the update");
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsTabs />

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-medium">Application Updates</h2>
            <p className="text-sm text-muted-foreground">
              Check the current version against the latest release on GitHub.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? "Checking…" : "Check for update"}
          </Button>
        </div>

        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : data ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Running:</span>
              <Badge variant="outline">{data.currentVersion}</Badge>
              {data.latestVersion && (
                <>
                  <span className="text-muted-foreground">Latest:</span>
                  <Badge variant={data.updateAvailable || data.building ? "secondary" : "outline"}>
                    {data.latestVersion}
                  </Badge>
                </>
              )}
              {data.updateAvailable ? (
                <Badge className="gap-2">
                  <NavDot className="ml-0 h-2 w-2" label="Update available" />
                  Update available
                </Badge>
              ) : data.building ? (
                <Badge variant="outline">New release building</Badge>
              ) : (
                <Badge variant="outline">Up to date</Badge>
              )}
            </div>

            {data.currentVersion === "dev" && (
              <p className="text-sm text-muted-foreground">
                Running a dev build — version comparison isn&apos;t meaningful here.
              </p>
            )}

            {data.building && (
              <p className="text-sm text-muted-foreground">
                {data.latestVersion} is published but its images are still being built. Check again in a few minutes.
              </p>
            )}

            {data.releaseUrl && (
              <a
                href={data.releaseUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-muted-foreground underline underline-offset-3 hover:text-foreground"
              >
                View release notes
              </a>
            )}

            {data.updateAvailable && (
              <Button
                className="self-start"
                disabled={applying}
                onClick={() => setConfirmOpen(true)}
              >
                {applying ? "Updating…" : "Update now"}
              </Button>
            )}
          </div>
        ) : null}
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update and restart the application?</DialogTitle>
            <DialogDescription>
              This pulls the latest release and rebuilds/restarts every service. The
              app will be briefly unreachable while it restarts — this page will
              reload automatically once it&apos;s back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={handleUpdate}>Update now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
