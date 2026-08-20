"use client";

import { useState } from "react";
import { toast } from "sonner";
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

// After "Update now" restarts the backend container, this page polls the
// unauthenticated health route directly (bypassing the versioned /api/v1
// client — the app may be mid-restart with a stale session) until it
// answers again, then reloads so the user lands back on a fresh session
// instead of staring at a dead page.
function pollUntilBackUp() {
  const start = Date.now();
  const timeoutMs = 3 * 60 * 1000;
  const interval = setInterval(async () => {
    if (Date.now() - start > timeoutMs) {
      clearInterval(interval);
      toast.error("Still not back after 3 minutes — check the server directly.");
      return;
    }
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) {
        clearInterval(interval);
        toast.success("Update finished — reloading.");
        window.location.reload();
      }
    } catch {
      // expected while the container is restarting
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
        pollUntilBackUp();
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
                  <Badge variant={data.updateAvailable ? "secondary" : "outline"}>
                    {data.latestVersion}
                  </Badge>
                </>
              )}
              {data.updateAvailable ? (
                <Badge>Update available</Badge>
              ) : (
                <Badge variant="outline">Up to date</Badge>
              )}
            </div>

            {data.currentVersion === "dev" && (
              <p className="text-sm text-muted-foreground">
                Running a dev build — version comparison isn&apos;t meaningful here.
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
