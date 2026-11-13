"use client";

import { useState } from "react";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeviceAction, usePosDevices } from "@/hooks/use-pos-devices";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
};

export default function DevicesPage() {
  const { data, isLoading, isError } = usePosDevices();
  const act = useDeviceAction();
  const [confirm, setConfirm] = useState<string | null>(null);
  const run = (id: string, action: "revoke" | "restore") =>
    act.mutate({ id, action }, {
      onSuccess: () => { toast.success(action === "revoke" ? "Phone removed" : "Phone allowed again"); setConfirm(null); },
      onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not update"),
    });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Phones that take orders for this restaurant</p>
      </div>
      <SettingsTabs />
      <p className="text-sm text-muted-foreground">
        A phone appears here the first time it syncs. Removing a phone stops it at once, even if the person is still signed in; the same person can keep working on another phone or the web.
      </p>
      {isLoading ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : isError ? (
        <Card className="p-6 text-sm text-destructive">Could not load the phones.</Card>
      ) : data && data.length > 0 ? (
        <div className="flex flex-col gap-3">
          {data.map((d) => (
            <Card key={d.id} className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{d.name}</span>
                {d.revokedAt ? <Badge variant="outline">Removed</Badge> : <Badge>Active</Badge>}
                <span className="text-sm text-muted-foreground">{d.user.name} · {d.platform ?? "phone"} {d.appVersion ?? ""}</span>
              </div>
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">Last seen</dt><dd>{ago(d.lastSeenAt)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Last synced</dt><dd>{ago(d.lastSyncAt)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Waiting to send</dt><dd className="tabular-nums">{d.pendingCount}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Needs attention</dt><dd className={`tabular-nums ${d.failedCount ? "font-semibold text-destructive" : ""}`}>{d.failedCount}</dd></div>
              </dl>
              {d.lastError && <p className="text-sm text-destructive">Last problem: {d.lastError}</p>}
              <div className="flex gap-2">
                {d.revokedAt ? (
                  <Button size="sm" variant="outline" onClick={() => run(d.id, "restore")}>Allow again</Button>
                ) : confirm === d.id ? (
                  <><span className="self-center text-sm">Stop this phone now?</span><Button size="sm" variant="destructive" onClick={() => run(d.id, "revoke")}>Yes, remove</Button><Button size="sm" variant="outline" onClick={() => setConfirm(null)}>No</Button></>
                ) : (
                  <Button size="sm" variant="destructive" onClick={() => setConfirm(d.id)}>Remove this phone</Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="py-14 text-center text-sm text-muted-foreground">No phones yet. They appear after the app syncs once.</Card>
      )}
    </div>
  );
}
