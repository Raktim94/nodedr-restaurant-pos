"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CreateIntegrationKeyDialog } from "@/components/settings/create-integration-key-dialog";
import { CreateStaffKeyDialog } from "@/components/settings/create-staff-key-dialog";
import { NewApiKeyDialog } from "@/components/settings/new-api-key-dialog";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import {
  useIntegrationApiKeys,
  useRevokeIntegrationApiKey,
  useRevokeStaffApiKey,
  useStaffApiKeys,
  type IntegrationApiKey,
  type StaffApiKey,
} from "@/hooks/use-api-keys";
import { ApiError } from "@/lib/api";

export default function ApiKeysPage() {
  const { data } = useCurrentUser();
  const user = data?.user;
  const canManageIntegrations = hasPermission(user, "settings.manage");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Restaurant, branch, and staff configuration</p>
      </div>

      <SettingsTabs />

      <StaffApiKeysCard />
      {canManageIntegrations ? <IntegrationApiKeysCard /> : null}
    </div>
  );
}

function StaffApiKeysCard() {
  const { data: keys, isLoading } = useStaffApiKeys();
  const revokeKey = useRevokeStaffApiKey();
  const [showCreate, setShowCreate] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  const onRevoke = (key: StaffApiKey) => {
    if (!confirm(`Revoke "${key.name}"? Anything using this key stops working immediately.`)) return;
    revokeKey.mutate(key.id, {
      onSuccess: () => toast.success("Key revoked"),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not revoke key"),
    });
  };

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-medium text-foreground">Personal API keys &amp; MCP</h2>
          <p className="text-sm text-muted-foreground">
            Personal access tokens that act as you, with your exact permissions. Use one to connect an MCP client
            (Claude Desktop, etc.) or any script.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          New key
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">MCP server URL</p>
        <code className="mt-1 block overflow-x-auto rounded bg-background/60 p-2 font-mono text-xs">
          {typeof window !== "undefined" ? window.location.origin : ""}/api/v1/mcp
        </code>
        <p className="mt-2">
          Point your MCP client at that URL with header <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>.
          See <a href="/docs/api" className="underline">API docs</a> for the full tool list.
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 rounded-lg" />
      ) : keys && keys.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-medium text-foreground">{key.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">…{key.lastFour}</TableCell>
                <TableCell className="text-muted-foreground">
                  {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}
                </TableCell>
                <TableCell className="text-right">
                  {key.revokedAt ? (
                    <Badge variant="outline">Revoked</Badge>
                  ) : (
                    <Button size="sm" variant="destructive" onClick={() => onRevoke(key)}>
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">No personal API keys yet.</p>
      )}

      {showCreate ? (
        <CreateStaffKeyDialog
          onClose={() => setShowCreate(false)}
          onCreated={(token) => {
            setShowCreate(false);
            setNewToken(token);
          }}
        />
      ) : null}
      {newToken ? <NewApiKeyDialog token={newToken} onClose={() => setNewToken(null)} /> : null}
    </Card>
  );
}

function IntegrationApiKeysCard() {
  const { data: keys, isLoading } = useIntegrationApiKeys();
  const revokeKey = useRevokeIntegrationApiKey();
  const [showCreate, setShowCreate] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  const onRevoke = (key: IntegrationApiKey) => {
    if (!confirm(`Revoke "${key.name}"? Any external website using this key stops working immediately.`)) return;
    revokeKey.mutate(key.id, {
      onSuccess: () => toast.success("Key revoked"),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not revoke key"),
    });
  };

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-medium text-foreground">Integration API keys</h2>
          <p className="text-sm text-muted-foreground">
            Credentials for an external website or system to use OrderRestro as a backend — browse the menu, place
            orders, and book tables for a location. Not tied to any staff account.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          New key
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 rounded-lg" />
      ) : keys && keys.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Permissions</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-medium text-foreground">{key.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">…{key.lastFour}</TableCell>
                <TableCell className="text-muted-foreground">{key.branch?.name ?? "All locations"}</TableCell>
                <TableCell className="text-muted-foreground">
                  <div className="flex flex-wrap gap-1">
                    {key.scopes.map((s) => (
                      <Badge key={s} variant="outline" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {key.revokedAt ? (
                    <Badge variant="outline">Revoked</Badge>
                  ) : (
                    <Button size="sm" variant="destructive" onClick={() => onRevoke(key)}>
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">No integration API keys yet.</p>
      )}

      {showCreate ? (
        <CreateIntegrationKeyDialog
          onClose={() => setShowCreate(false)}
          onCreated={(token) => {
            setShowCreate(false);
            setNewToken(token);
          }}
        />
      ) : null}
      {newToken ? <NewApiKeyDialog token={newToken} onClose={() => setNewToken(null)} /> : null}
    </Card>
  );
}
