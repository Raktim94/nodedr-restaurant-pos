"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDisableSync,
  useEnableSync,
  useSyncNow,
  useSyncStatus,
  useTestSync,
} from "@/hooks/use-sync";
import { ApiError } from "@/lib/api";

const errMsg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export default function SyncSettingsPage() {
  const { data, isLoading } = useSyncStatus();
  const test = useTestSync();
  const enable = useEnableSync();
  const syncNow = useSyncNow();
  const disable = useDisableSync();
  const [serverUrl, setServerUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [mode, setMode] = useState<"adopt" | "merge">("adopt");

  const conn = { serverUrl: serverUrl.trim(), apiKey: apiKey.trim() };

  const connect = () => {
    if (
      mode === "adopt" &&
      !window.confirm(
        "This PC's current data will be replaced by the server's data, and you will be signed out. Sign in again with an account from the server. Continue?",
      )
    )
      return;
    enable.mutate(
      { ...conn, mode },
      {
        onSuccess: () => {
          toast.success("Connected — syncing. Sign in again if you are asked to.");
          setApiKey("");
        },
        onError: (e) => toast.error(errMsg(e, "Could not connect")),
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsTabs />

      <Card className="flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-base font-medium">Server sync</h2>
          <p className="text-sm text-muted-foreground">
            Keep this PC and your central server in step, both ways. Work continues offline and
            catches up when the connection returns. Newest edit wins.
          </p>
        </div>

        {isLoading || !data ? (
          <Skeleton className="h-24 w-full" />
        ) : data.role === "server" ? (
          <p className="text-sm text-muted-foreground">
            This installation is the sync server. Other PCs connect to it with the sync key set in
            its <code>SYNC_API_KEY</code> setting.
          </p>
        ) : data.enabled ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={data.lastError ? "destructive" : "secondary"}>
                {data.lastError ? "Not connected" : "Connected"}
              </Badge>
              <span className="text-muted-foreground">{data.serverUrl}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Last synced: {data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString() : "never"}
              {" · "}waiting to upload: {data.pendingChanges}
            </p>
            {data.lastError && <p className="text-sm text-destructive">{data.lastError}</p>}
            {data.conflicts.length > 0 && (
              <details className="text-sm">
                <summary>{data.conflicts.length} change(s) could not be applied</summary>
                <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                  {data.conflicts.slice(0, 10).map((c, i) => (
                    <li key={i}>
                      {c.tbl}: {c.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={syncNow.isPending}
                onClick={() =>
                  syncNow.mutate(undefined, {
                    onSuccess: (r) => toast.success(`Synced: ${r.pulled} down, ${r.pushed} up`),
                    onError: (e) => toast.error(errMsg(e, "Sync failed")),
                  })
                }
              >
                {syncNow.isPending ? "Syncing…" : "Sync now"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={disable.isPending}
                onClick={() => disable.mutate(undefined, { onSuccess: () => toast.success("Sync turned off") })}
              >
                Turn off
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex max-w-xl flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sync-url">Server address</Label>
              <Input
                id="sync-url"
                placeholder="https://orders.example.com"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sync-key">Sync key</Label>
              <Input
                id="sync-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="mb-1 font-medium">First sync</legend>
              <label className="flex items-start gap-2">
                <input type="radio" checked={mode === "adopt"} onChange={() => setMode("adopt")} />
                <span>
                  Use the server&apos;s data
                  <span className="block text-muted-foreground">
                    Replaces this PC&apos;s data. Pick this for a new PC.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} />
                <span>
                  Merge both
                  <span className="block text-muted-foreground">
                    Keeps this PC&apos;s data and adds it to the server.
                  </span>
                </span>
              </label>
            </fieldset>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!conn.serverUrl || !conn.apiKey || test.isPending}
                onClick={() =>
                  test.mutate(conn, {
                    onSuccess: () => toast.success("Server reachable, key accepted"),
                    onError: (e) => toast.error(errMsg(e, "Could not reach the server")),
                  })
                }
              >
                {test.isPending ? "Testing…" : "Test connection"}
              </Button>
              <Button
                size="sm"
                disabled={!conn.serverUrl || !conn.apiKey || enable.isPending}
                onClick={connect}
              >
                {enable.isPending ? "Connecting…" : "Connect & sync"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
