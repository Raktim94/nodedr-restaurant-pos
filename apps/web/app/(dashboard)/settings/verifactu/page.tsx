"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useBranch } from "@/hooks/use-branch";
import { useSettings } from "@/hooks/use-settings";
import {
  useVerifactuActions,
  useVerifactuRecords,
  useVerifactuSettings,
  type VerifactuEnvironment,
  type VerifactuRecordRow,
  type VerifactuSettings,
} from "@/hooks/use-verifactu";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");
const euro = (cents: number) => `${(cents / 100).toFixed(2)} €`;

const STATUS_LABEL: Record<VerifactuRecordRow["status"], string> = {
  PENDING: "Waiting to send",
  ACCEPTED: "Accepted",
  ACCEPTED_WITH_ERRORS: "Accepted with errors",
  REJECTED: "Rejected",
  ERROR: "Will retry",
};

function SettingsForm({ branchId, s }: { branchId: string; s: VerifactuSettings }) {
  const { save, certificate } = useVerifactuActions(branchId);
  const [enabled, setEnabled] = useState(s.enabled);
  const [environment, setEnvironment] = useState<VerifactuEnvironment>(s.environment);
  const [series, setSeries] = useState(s.seriesPrefix);
  const [password, setPassword] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const hasRecords = Object.values(s.counts).some((n) => n > 0);

  return (
    <Card className="flex max-w-3xl flex-col gap-5 p-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Spain VERI*FACTU</h2>
        <p className="text-sm text-muted-foreground">
          Every paid sale becomes a simplified invoice in a tamper-evident chain with a QR code on the receipt, and is reported to the
          Spanish tax agency (AEAT).
        </p>
      </div>

      <div role="note" className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
        <strong>Implemented, not certified.</strong> OrderRestro has not been run against the live AEAT portal and NODEDR has not issued
        its Declaración Responsable. Test with AEAT&rsquo;s pre-production portal and ask your gestor before relying on it.
      </div>

      {s.problems.length > 0 && (
        <ul className="list-disc rounded-xl border border-destructive/30 bg-destructive/5 p-4 pl-8 text-sm text-destructive">
          {s.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-4">
        <div>
          <Label htmlFor="vf-enabled">Issue VERI*FACTU invoices at this branch</Label>
          <p className="text-xs text-muted-foreground">Once on, a sale cannot be paid without its record.</p>
        </div>
        <Switch id="vf-enabled" checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vf-env">Environment</Label>
          <select
            id="vf-env"
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as VerifactuEnvironment)}
          >
            <option value="TEST">Test (AEAT pre-production)</option>
            <option value="PRODUCTION">Production</option>
          </select>
          <p className="text-xs text-muted-foreground">Test and production keep separate chains.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vf-series">Invoice series</Label>
          <Input id="vf-series" value={series} maxLength={12} disabled={hasRecords} onChange={(e) => setSeries(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Next number: {s.seriesPrefix}-{String(s.nextNumber).padStart(6, "0")}
          </p>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              { enabled, environment, seriesPrefix: series },
              { onSuccess: () => toast.success("Saved"), onError: (e) => toast.error(errMsg(e)) },
            )
          }
        >
          Save
        </Button>
      </div>

      <hr className="border-border" />

      <div className="flex flex-col gap-3">
        <div>
          <h3 className="font-medium text-foreground">Digital certificate</h3>
          <p className="text-sm text-muted-foreground">
            The company&rsquo;s electronic certificate (.p12 or .pfx) is needed to report to AEAT. It is stored encrypted.
          </p>
        </div>
        {s.hasCertificate ? (
          <p className="text-sm">
            Loaded: <span className="font-mono text-xs">{s.certSubject}</span>
            {s.certExpiresAt && <> · expires {new Date(s.certExpiresAt).toLocaleDateString()}</>}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">None uploaded yet. Records queue until one is.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vf-cert">Certificate file</Label>
            <input id="vf-cert" ref={file} type="file" accept=".p12,.pfx" className="text-sm" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vf-pass">Certificate password</Label>
            <Input id="vf-pass" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <Button
            variant="outline"
            disabled={certificate.isPending}
            onClick={() => {
              const f = file.current?.files?.[0];
              if (!f) return toast.error("Choose the certificate file first");
              certificate.mutate(
                { file: f, password },
                {
                  onSuccess: () => {
                    setPassword("");
                    if (file.current) file.current.value = "";
                    toast.success("Certificate saved");
                  },
                  onError: (e) => toast.error(errMsg(e)),
                },
              );
            }}
          >
            Upload
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Records({ branchId, s }: { branchId: string; s: VerifactuSettings }) {
  const { data, isLoading } = useVerifactuRecords(branchId);
  const { send, verify } = useVerifactuActions(branchId);
  const [result, setResult] = useState<string | null>(null);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Invoice records</h2>
          <p className="text-sm text-muted-foreground">
            {Object.entries(s.counts)
              .map(([k, n]) => `${n} ${STATUS_LABEL[k as VerifactuRecordRow["status"]]?.toLowerCase() ?? k}`)
              .join(" · ") || "No records yet."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={verify.isPending}
            onClick={() =>
              verify.mutate(undefined, {
                onSuccess: (r) =>
                  setResult(
                    r.ok
                      ? `Chain intact: ${r.checked} record${r.checked === 1 ? "" : "s"} checked.`
                      : `Chain broken at record ${r.brokenAt} (${r.environment.toLowerCase()}): ${r.reason}.`,
                  ),
                onError: (e) => toast.error(errMsg(e)),
              })
            }
          >
            Check chain
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={send.isPending}
            onClick={() =>
              send.mutate(undefined, {
                onSuccess: (r) => toast.success(r.sent ? `Sent ${r.sent} record${r.sent === 1 ? "" : "s"}` : "Nothing to send right now"),
                onError: (e) => toast.error(errMsg(e)),
              })
            }
          >
            Send now
          </Button>
          <Button variant="outline" size="sm" render={<a href={`/api/v1/verifactu/export.xml?branchId=${encodeURIComponent(branchId)}`} />}>
            Export XML
          </Button>
        </div>
      </div>
      {result && (
        <p role="status" className="text-sm text-foreground">
          {result}
        </p>
      )}
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : !data || data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Records appear here as sales are paid.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Invoice</th>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4 text-right">Total</th>
                <th className="py-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="py-2 pr-4 font-mono text-xs">
                    {r.invoiceNumber} <span className="text-muted-foreground">{r.invoiceType}</span>
                  </td>
                  <td className="py-2 pr-4">{r.issueDate}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{euro(r.totalCents)}</td>
                  <td className={cn("py-2 pr-4", r.status === "REJECTED" && "text-destructive")}>
                    {STATUS_LABEL[r.status]}
                    {r.errorText && <span className="block text-xs text-muted-foreground">{r.errorCode ? `${r.errorCode}: ` : ""}{r.errorText}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function VerifactuPage() {
  const { branchId } = useBranch();
  const { data, isLoading } = useVerifactuSettings(branchId);
  const country = useSettings(branchId).data?.branch.country;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Restaurant, branch, and staff configuration</p>
      </div>
      <SettingsTabs />
      {country && country !== "ES" ? (
        <Card className="max-w-3xl p-6 text-sm">
          VERI*FACTU applies only to branches in Spain. Set this branch&rsquo;s country to Spain (and its tax regime to Spain &ndash; IVA) under General to use it.
        </Card>
      ) : isLoading || !data || !branchId ? (
        <Skeleton className="h-72 max-w-3xl rounded-xl" />
      ) : (
        <>
          <SettingsForm key={`${branchId}|${data.enabled}|${data.environment}|${data.seriesPrefix}`} branchId={branchId} s={data} />
          <Records branchId={branchId} s={data} />
        </>
      )}
    </div>
  );
}
