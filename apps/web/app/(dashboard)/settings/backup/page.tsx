"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RestoreBackupDialog } from "@/components/settings/restore-backup-dialog";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  backupDownloadUrl,
  useBackups,
  useBackupStatus,
  useClearBackupConfig,
  useSetBackupConfig,
  useTriggerBackup,
  type BackupEntry,
  type BackupStatusValue,
} from "@/hooks/use-backups";
import { ApiError } from "@/lib/api";

const STATUS_VARIANT: Record<BackupStatusValue, "outline" | "secondary" | "destructive"> = {
  PENDING: "outline",
  VERIFIED: "secondary",
  FAILED: "destructive",
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ConfigFormState {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  intervalDays: string;
  retainCount: string;
}

const EMPTY_CONFIG_FORM: ConfigFormState = {
  endpoint: "",
  bucket: "",
  accessKeyId: "",
  secretAccessKey: "",
  region: "auto",
  intervalDays: "3",
  retainCount: "2",
};

export default function BackupPage() {
  const { data: status, isLoading: statusLoading } = useBackupStatus();
  const { data: backups, isLoading: backupsLoading } = useBackups();
  const setConfig = useSetBackupConfig();
  const clearConfig = useClearBackupConfig();
  const triggerBackup = useTriggerBackup();

  const [showConfigForm, setShowConfigForm] = useState(false);
  const [configForm, setConfigForm] = useState<ConfigFormState>(EMPTY_CONFIG_FORM);
  const [restoreTarget, setRestoreTarget] = useState<BackupEntry | null>(null);

  const openConfigForm = () => {
    setConfigForm(
      status
        ? {
            endpoint: status.endpoint ?? "",
            bucket: status.bucket ?? "",
            accessKeyId: "",
            secretAccessKey: "",
            region: status.region ?? "auto",
            intervalDays: String(status.intervalDays),
            retainCount: String(status.retainCount),
          }
        : EMPTY_CONFIG_FORM,
    );
    setShowConfigForm(true);
  };

  const onSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    setConfig.mutate(
      {
        endpoint: configForm.endpoint.trim(),
        bucket: configForm.bucket.trim(),
        accessKeyId: configForm.accessKeyId.trim(),
        secretAccessKey: configForm.secretAccessKey.trim(),
        region: configForm.region.trim() || undefined,
        intervalDays: Number(configForm.intervalDays) || undefined,
        retainCount: Number(configForm.retainCount) || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Backup connection saved");
          setShowConfigForm(false);
        },
        onError: (err) =>
          toast.error(
            err instanceof ApiError ? err.message : "Could not connect to that bucket",
          ),
      },
    );
  };

  const onDisconnect = () => {
    if (!confirm("Disconnect S3 backups? Scheduled backups will stop until reconnected.")) {
      return;
    }
    clearConfig.mutate(undefined, {
      onSuccess: () => toast.success("Backup connection removed"),
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : "Could not disconnect"),
    });
  };

  const onTrigger = () => {
    triggerBackup.mutate(undefined, {
      onSuccess: () => toast.success("Backup started"),
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : "Could not start backup"),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Restaurant, branch, and staff configuration</p>
      </div>

      <SettingsTabs />

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-medium text-foreground">Backup &amp; restore</h2>
            <p className="text-sm text-muted-foreground">
              Full database and uploaded-file backups to any S3-compatible bucket. This is
              instance-wide — it covers every restaurant hosted on this server, not just yours.
            </p>
          </div>
          {status ? (
            <Badge variant={status.configured ? "secondary" : "outline"}>
              {status.configured ? "Configured" : "Not configured"}
            </Badge>
          ) : null}
        </div>

        {statusLoading ? (
          <Skeleton className="h-32 rounded-lg" />
        ) : !status?.configured || showConfigForm ? (
          <form onSubmit={onSaveConfig} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Connect any S3-compatible bucket (AWS S3, MinIO, RustFS, R2, …) to enable
              automatic backups. Runs on its own schedule from here on.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-endpoint">Endpoint URL</Label>
                <Input
                  id="b-endpoint"
                  placeholder="https://s3.example.com"
                  value={configForm.endpoint}
                  onChange={(e) => setConfigForm((f) => ({ ...f, endpoint: e.target.value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-bucket">Bucket</Label>
                <Input
                  id="b-bucket"
                  value={configForm.bucket}
                  onChange={(e) => setConfigForm((f) => ({ ...f, bucket: e.target.value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-key">Access key ID</Label>
                <Input
                  id="b-key"
                  value={configForm.accessKeyId}
                  onChange={(e) => setConfigForm((f) => ({ ...f, accessKeyId: e.target.value }))}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-secret">Secret access key</Label>
                <Input
                  id="b-secret"
                  type="password"
                  value={configForm.secretAccessKey}
                  onChange={(e) =>
                    setConfigForm((f) => ({ ...f, secretAccessKey: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="b-region">Region</Label>
                <Input
                  id="b-region"
                  placeholder="auto"
                  value={configForm.region}
                  onChange={(e) => setConfigForm((f) => ({ ...f, region: e.target.value }))}
                />
              </div>
              <div className="flex gap-4">
                <div className="flex flex-1 flex-col gap-2">
                  <Label htmlFor="b-interval">Backup every (days)</Label>
                  <Input
                    id="b-interval"
                    type="number"
                    min={1}
                    max={30}
                    value={configForm.intervalDays}
                    onChange={(e) =>
                      setConfigForm((f) => ({ ...f, intervalDays: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  <Label htmlFor="b-retain">Keep last (backups)</Label>
                  <Input
                    id="b-retain"
                    type="number"
                    min={1}
                    max={10}
                    value={configForm.retainCount}
                    onChange={(e) =>
                      setConfigForm((f) => ({ ...f, retainCount: e.target.value }))
                    }
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={setConfig.isPending}>
                {setConfig.isPending ? "Testing connection…" : "Connect & save"}
              </Button>
              {status?.configured ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowConfigForm(false)}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
              <div>
                <p className="text-foreground">
                  {status.bucket}{" "}
                  <span className="text-muted-foreground">at {status.endpoint}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Key {status.accessKeyIdMasked} ·{" "}
                  {status.source === "environment"
                    ? "configured via environment variables"
                    : "configured here"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={openConfigForm}>
                  Change
                </Button>
                {status.source === "database" ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={clearConfig.isPending}
                    onClick={onDisconnect}
                  >
                    Disconnect
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat label="Runs every" value={`${status.intervalDays} days`} />
              <Stat label="Keeps" value={`${status.retainCount} backups`} />
              <Stat
                label="Last backup"
                value={
                  status.lastBackup
                    ? new Date(status.lastBackup.createdAt).toLocaleString()
                    : "Never"
                }
              />
              <Stat
                label="Next scheduled"
                value={
                  status.nextScheduledAt
                    ? new Date(status.nextScheduledAt).toLocaleString()
                    : "—"
                }
              />
            </div>

            <div>
              <Button onClick={onTrigger} disabled={triggerBackup.isPending}>
                {triggerBackup.isPending ? "Starting…" : "Back up now"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-[18px] font-medium text-foreground">History</h2>

        {backupsLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : backups && backups.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Size</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium text-foreground">
                    {new Date(b.createdAt).toLocaleString()}
                    <div className="text-xs font-normal text-muted-foreground">
                      {b.triggeredById ? "Manual" : "Scheduled"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[b.status]}>{b.status}</Badge>
                    {b.status === "FAILED" && b.failureReason ? (
                      <div className="mt-1 max-w-xs truncate text-xs text-destructive" title={b.failureReason}>
                        {b.failureReason}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatBytes(b.sizeBytes)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {b.status === "VERIFIED" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          render={<a href={backupDownloadUrl(b.id)} />}
                        >
                          Download
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" disabled>
                          Download
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={b.status !== "VERIFIED"}
                        onClick={() => setRestoreTarget(b)}
                      >
                        Restore
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm font-medium text-foreground">No backups yet</p>
            <p className="text-sm text-muted-foreground">
              Connect a bucket above and back up now to get started.
            </p>
          </div>
        )}
      </Card>

      {restoreTarget ? (
        <RestoreBackupDialog
          key={restoreTarget.id}
          backup={restoreTarget}
          onClose={() => setRestoreTarget(null)}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
