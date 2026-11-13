"use client";

import { useState } from "react";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBranch } from "@/hooks/use-branch";
import { useBuzzerActions, useBuzzers } from "@/hooks/use-paging";
import { useFloors } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Could not do that");

export default function BuzzersPage() {
  const { branchId } = useBranch();
  const { data: buzzers, isLoading } = useBuzzers(branchId);
  const { data: floors } = useFloors(branchId, true);
  const act = useBuzzerActions(branchId);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [tableId, setTableId] = useState("");
  const [driver, setDriver] = useState<"SIMULATED" | "WEBHOOK">("SIMULATED");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const tables = (floors ?? []).flatMap((f) => f.tables.map((t) => ({ id: t.id, label: `${f.name} · ${t.number}` })));
  const free = tables.filter((t) => !buzzers?.some((b) => b.tableId === t.id));

  const add = () => {
    setErr(null);
    act.create.mutate({ name: name.trim(), number: number.trim() || null, tableId: tableId || null, driver, webhookUrl: driver === "WEBHOOK" ? url.trim() : null, webhookSecret: driver === "WEBHOOK" && secret ? secret : null }, {
      onSuccess: () => { setName(""); setNumber(""); setTableId(""); setUrl(""); setSecret(""); toast.success("Buzzer added"); },
      onError: (e) => setErr(e instanceof ApiError ? e.message : "Could not add it"),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Paging buzzers: one per table, called from the kitchen when the order is ready</p>
      </div>
      <SettingsTabs />
      <Card className="flex flex-col gap-3 p-4 text-sm text-muted-foreground">
        <p><b className="text-foreground">Which hardware?</b> Not decided yet. Two ways to connect a buzzer are built so the real devices can be wired in once they are tested:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b className="text-foreground">Simulated / polling device:</b> the buzzer (or the Simulator page) asks the server &ldquo;is there a page for me?&rdquo; with its own token every second or two and acknowledges it. Needs a device that can make HTTP requests.</li>
          <li><b className="text-foreground">Webhook base station:</b> the server POSTs a JSON call to an address you give it, signed with a secret (HMAC-SHA256 in the <code>X-OrderRestro-Signature</code> header). For a base station or small gateway that then drives the buzzers by radio.</li>
        </ul>
        <p>Nothing here claims to work with a particular buzzer product until it has been tested on the real devices.</p>
      </Card>

      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Input aria-label="Name" placeholder="Name, e.g. Buzzer 7" value={name} onChange={(e) => setName(e.target.value)} />
        <Input aria-label="Printed number" placeholder="Number printed on it (optional)" value={number} onChange={(e) => setNumber(e.target.value)} />
        <select aria-label="Table" className={selectClass} value={tableId} onChange={(e) => setTableId(e.target.value)}><option value="">Table: choose later</option>{free.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}</select>
        <select aria-label="How it connects" className={selectClass} value={driver} onChange={(e) => setDriver(e.target.value as "SIMULATED" | "WEBHOOK")}><option value="SIMULATED">Polling device / simulator</option><option value="WEBHOOK">Webhook to a base station</option></select>
        {driver === "WEBHOOK" && (<><Input aria-label="Base station URL" placeholder="http://192.168.1.50/page" value={url} onChange={(e) => setUrl(e.target.value)} /><Input aria-label="Signing secret" placeholder="Secret (optional)" value={secret} onChange={(e) => setSecret(e.target.value)} /></>)}
        <div><Button disabled={!name.trim() || act.create.isPending} onClick={add}>Add buzzer</Button></div>
        {err && <p role="alert" className="text-sm text-destructive sm:col-span-3">{err}</p>}
      </Card>

      {isLoading ? <Skeleton className="h-32 rounded-xl" /> : buzzers && buzzers.length > 0 ? (
        <div className="flex flex-col gap-3">
          {buzzers.map((b) => (
            <Card key={b.id} className="flex flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{b.name}{b.number ? ` · #${b.number}` : ""}</span>
                <Badge variant="outline">{b.driver === "WEBHOOK" ? "Webhook" : "Polling"}</Badge>
                {b.driver === "SIMULATED" && (b.online ? <Badge>Online</Badge> : <Badge variant="destructive">Offline</Badge>)}
                {b.activeCall && <Badge variant="outline">Paging now</Badge>}
                {!b.isActive && <Badge variant="outline">Switched off</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <select aria-label={`Table for ${b.name}`} className={`${selectClass} max-w-56`} value={b.tableId ?? ""} onChange={(e) => act.update.mutate({ id: b.id, data: { tableId: e.target.value || null } }, { onError: fail })}>
                  <option value="">No table</option>
                  {tables.filter((t) => t.id === b.tableId || !buzzers.some((o) => o.tableId === t.id)).map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
                </select>
                <Button size="sm" variant="outline" onClick={() => act.test.mutate(b.id, { onSuccess: (r) => toast.success(r.call.state === "FAILED" ? `Could not reach it: ${r.call.error}` : r.deviceOnline === false ? "Call queued, but the device is offline" : "Test call sent"), onError: fail })}>Test call</Button>
                <Button size="sm" variant="outline" onClick={() => act.update.mutate({ id: b.id, data: { isActive: !b.isActive } }, { onError: fail })}>{b.isActive ? "Switch off" : "Switch on"}</Button>
                <Button size="sm" variant="destructive" onClick={() => window.confirm(`Delete ${b.name}?`) && act.remove.mutate(b.id, { onError: fail })}>Delete</Button>
              </div>
              {b.driver === "SIMULATED" && <p className="text-xs text-muted-foreground">Device token (keep private): <code className="select-all">{b.deviceToken}</code></p>}
              {b.driver === "WEBHOOK" && <p className="truncate text-xs text-muted-foreground">Calls go to {b.webhookUrl}{b.hasSecret ? " (signed)" : " (not signed)"}</p>}
            </Card>
          ))}
        </div>
      ) : <Card className="py-10 text-center text-sm text-muted-foreground">No buzzers yet.</Card>}
    </div>
  );
}
