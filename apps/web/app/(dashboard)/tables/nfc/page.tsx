"use client";

import { useState } from "react";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useBranch } from "@/hooks/use-branch";
import {
  type NfcTag,
  type Provisioning,
  type TagWithBundle,
  useCreateNfcTag,
  useDisableNfcTag,
  useNfcSettings,
  useNfcTags,
  useNfcTaps,
  useReplaceNfcTag,
  useRotateNfcTag,
  useTestNfcTag,
  useUpdateNfcSettings,
} from "@/hooks/use-nfc";
import { useFloors } from "@/hooks/use-tables";
import { ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";

const msg = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const STATUS: Record<NfcTag["status"], { label: string; variant: "default" | "outline" | "secondary" }> = {
  PROVISIONING: { label: "Not proven yet", variant: "secondary" },
  ACTIVE: { label: "Active", variant: "default" },
  DISABLED: { label: "Disabled", variant: "outline" },
};

function Copy({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2 font-mono text-xs" aria-label={label} />
        <Button type="button" variant="outline" className="h-11" onClick={() => { void navigator.clipboard?.writeText(value); toast.success("Copied"); }}>Copy</Button>
      </div>
    </div>
  );
}

/** Shown once: after this the keys cannot be read back. */
function ProvisioningDialog({ result, onClose }: { result: TagWithBundle; onClose: () => void }) {
  const p: Provisioning | null = result.provisioning;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{p ? "Write this tag" : "Tag added"}</DialogTitle>
          <DialogDescription>Table {result.tag.tableNumber}{result.tag.label ? ` · ${result.tag.label}` : ""}</DialogDescription>
        </DialogHeader>
        {p ? (
          <div className="flex flex-col gap-3 text-sm">
            <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">These keys are shown <b>once</b>. The server keeps only sealed copies and cannot show them again. Write them to the tag now; if you lose them, rotate the keys.</p>
            <Copy label="Link to write (with the two placeholders)" value={p.urlTemplate} />
            <Copy label="SDM meta-read key (decrypts the UID and counter)" value={p.keys.sdmMetaReadKey} />
            <Copy label="SDM file-read key (checks the MAC)" value={p.keys.sdmFileReadKey} />
            <Copy label="Application master key (never stored here; keep it if you will re-configure the tag)" value={p.keys.appMasterKey} />
            <p className="text-xs text-muted-foreground">{p.note} Mirror the encrypted UID + read counter at <b>e=</b> and the MAC at <b>c=</b>, and set the MAC input offset equal to the MAC offset. See the NFC provisioning guide.</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{result.basicLink?.note}{result.basicLink?.requiresTableQr ? " This table has no QR link yet: create one first under Tables." : ""}</p>
        )}
        <DialogFooter><Button className="h-11" onClick={onClose}>{p ? "I have written the keys" : "Done"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestDialog({ branchId, tag, onClose }: { branchId: string | null; tag: NfcTag; onClose: () => void }) {
  const test = useTestNfcTag(branchId);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    let e = "", c = "";
    try {
      const u = new URL(url.trim());
      e = u.searchParams.get("e") ?? "";
      c = u.searchParams.get("c") ?? "";
    } catch { /* not a URL: the checks below explain it */ }
    if (!e || !c) return setErr("Paste the full link the tag opened (it ends with ?e=…&c=…).");
    setErr(null);
    test.mutate({ id: tag.id, e, c }, { onSuccess: () => { toast.success("Tag verified"); onClose(); }, onError: (x) => setErr(msg(x, "That tap did not verify.")) });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Test tap</DialogTitle><DialogDescription>Tap the tag with a phone, copy the address it opens, and paste it here. The first good test proves the tag and ties it to its chip.</DialogDescription></DialogHeader>
        {err && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{err}</p>}
        <div className="flex flex-col gap-1.5"><Label htmlFor="tt-url">Link the tag opened</Label><Textarea id="tt-url" rows={3} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/t/abc123?e=…&c=…" /></div>
        <DialogFooter className="gap-2"><Button variant="outline" className="h-11" onClick={onClose}>Cancel</Button><Button className="h-11" disabled={test.isPending} onClick={submit}>{test.isPending ? "Checking…" : "Verify"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LogDialog({ branchId, tag, onClose }: { branchId: string | null; tag: NfcTag; onClose: () => void }) {
  const { data, isLoading } = useNfcTaps(branchId, tag.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader><DialogTitle>Tap log</DialogTitle><DialogDescription>Table {tag.tableNumber}. The latest 100 taps, good and bad.</DialogDescription></DialogHeader>
        {isLoading ? <Skeleton className="h-24" /> : !data?.length ? <p className="text-sm text-muted-foreground">No taps yet.</p> : (
          <ul className="divide-y divide-border text-sm">{data.map((t) => (<li key={t.id} className="flex justify-between gap-3 py-1.5"><span className={t.result === "OK" || t.result === "TEST_OK" ? "" : "font-medium text-destructive"}>{t.result.replace("_", " ").toLowerCase()}</span><span className="text-muted-foreground">{t.counter != null ? `#${t.counter} · ` : ""}{new Date(t.createdAt).toLocaleString()}</span></li>))}</ul>
        )}
        <DialogFooter><Button className="h-11" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function NfcTablesPage() {
  const { branchId } = useBranch();
  const { data: settings, isLoading: sl, isError: se } = useNfcSettings();
  const update = useUpdateNfcSettings();
  const { data: tags, isLoading: tl } = useNfcTags(branchId);
  const { data: floors } = useFloors(branchId);
  const create = useCreateNfcTag(branchId);
  const rotate = useRotateNfcTag(branchId);
  const disable = useDisableNfcTag(branchId);
  const replace = useReplaceNfcTag(branchId);
  const [tableId, setTableId] = useState("");
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"SECURE" | "BASIC">("SECURE");
  const [shown, setShown] = useState<TagWithBundle | null>(null);
  const [testing, setTesting] = useState<NfcTag | null>(null);
  const [log, setLog] = useState<NfcTag | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "rotate" | "replace" | "disable"; tag: NfcTag } | null>(null);
  const [reason, setReason] = useState("");
  const tables = (floors ?? []).flatMap((f) => f.tables.map((t) => ({ id: t.id, label: `${f.name} · Table ${t.number}` })));

  const setFlag = (v: { nfcTablesEnabled?: boolean; autoTableSessions?: boolean }) => update.mutate(v, { onError: (e) => toast.error(msg(e, "Could not change that setting")) });
  const add = () => {
    if (!tableId) return toast.error("Choose a table");
    create.mutate({ tableId, label: label.trim() || undefined, mode }, { onSuccess: (r) => { setShown(r); setLabel(""); }, onError: (e) => toast.error(msg(e, "Could not add the tag")) });
  };
  const runConfirmed = () => {
    if (!confirm) return;
    const { kind, tag } = confirm;
    const done = { onSettled: () => { setConfirm(null); setReason(""); }, onError: (e: unknown) => toast.error(msg(e, "That did not work")) };
    if (kind === "rotate") rotate.mutate(tag.id, { ...done, onSuccess: (r) => setShown(r) });
    else if (kind === "replace") replace.mutate({ id: tag.id }, { ...done, onSuccess: (r) => setShown(r) });
    else disable.mutate({ id: tag.id, reason }, { ...done, onSuccess: () => toast.success("Tag disabled") });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Table ordering mode</h1>
        <p className="text-sm text-muted-foreground">Choose how guests start ordering at a table. The simple way needs nothing extra; NFC tags are optional.</p>
      </div>

      {sl ? <Skeleton className="h-40 rounded-xl" /> : se || !settings ? (
        <Card className="p-4 text-sm text-muted-foreground">You need the permission to manage NFC table tags to see this page.</Card>
      ) : (
        <Card className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-2"><Badge>{settings.mode === "ADVANCED" ? "Advanced" : "Basic"}</Badge><span className="text-sm text-muted-foreground">{settings.mode === "ADVANCED" ? "Guests can tap a secure tag; the first order opens the table." : "Guests scan the table QR and enter the table code staff give them."}</span></div>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div><Label htmlFor="sw-nfc" className="font-medium">Secure NFC tags</Label><p className="text-xs text-muted-foreground">Guests tap the card on the table with their own phone. Needs NTAG 424 DNA tags; ordinary cards stay as low-security QR links. Works over the guest&rsquo;s mobile data, no restaurant Wi-Fi.</p></div>
            <Switch id="sw-nfc" checked={settings.nfcTablesEnabled} disabled={update.isPending || (settings.autoTableSessions && settings.nfcTablesEnabled)} onCheckedChange={(v) => setFlag({ nfcTablesEnabled: v })} />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div><Label htmlFor="sw-auto" className="font-medium">Open and close tables automatically</Label><p className="text-xs text-muted-foreground">The first valid guest order opens the table; settling the last order closes it. Staff no longer open tables by hand. An unpaid table is never closed by a timer. Needs secure NFC tags.</p></div>
            <Switch id="sw-auto" checked={settings.autoTableSessions} disabled={update.isPending || !settings.nfcTablesEnabled} onCheckedChange={(v) => setFlag({ autoTableSessions: v })} />
          </div>
          <p className="text-xs text-muted-foreground">Turning these off never deletes anything: tags, taps and past sessions are kept.</p>
        </Card>
      )}

      {settings?.nfcTablesEnabled && (
        <>
          <Card className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_9rem_auto] sm:items-end">
            <div className="flex flex-col gap-1.5"><Label htmlFor="nt-table">Table</Label><select id="nt-table" className={`${selectClass} h-11`} value={tableId} onChange={(e) => setTableId(e.target.value)}><option value="">Choose…</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="nt-label">Label (optional)</Label><Input id="nt-label" className="h-11" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="Window side" /></div>
            <div className="flex flex-col gap-1.5"><Label htmlFor="nt-mode">Type</Label><select id="nt-mode" className={`${selectClass} h-11`} value={mode} onChange={(e) => setMode(e.target.value as "SECURE" | "BASIC")}><option value="SECURE">Secure (NTAG 424)</option><option value="BASIC">Ordinary card</option></select></div>
            <Button className="h-11" disabled={create.isPending} onClick={add}>{create.isPending ? "Adding…" : "Add tag"}</Button>
          </Card>

          {tl ? <Skeleton className="h-32 rounded-xl" /> : !tags?.length ? (
            <Card className="py-10 text-center text-sm text-muted-foreground">No tags yet. Add one above, write it with an NTAG 424 DNA tool, then press Test tap.</Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {tags.map((t) => (
                <li key={t.id}>
                  <Card className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">Table {t.tableNumber}</span>{t.label && <span className="text-sm text-muted-foreground">{t.label}</span>}
                      <Badge variant={STATUS[t.status].variant}>{STATUS[t.status].label}</Badge>
                      <Badge variant="outline">{t.mode === "SECURE" ? "Secure" : "Ordinary card"}</Badge>
                      {t.replacesId && <span className="text-xs text-muted-foreground">replaces an older tag</span>}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                      <div><dt>Chip</dt><dd className="break-all font-mono text-foreground">{t.uid ?? "not bound yet"}</dd></div>
                      <div><dt>Keys</dt><dd className="text-foreground">{t.mode === "SECURE" ? `version ${t.keyVersion}` : "none"}</dd></div>
                      <div><dt>Last good tap</dt><dd className="text-foreground">{t.lastAuthAt ? new Date(t.lastAuthAt).toLocaleString() : "never"}</dd></div>
                      <div><dt>Counter</dt><dd className="text-foreground">{t.lastCounter >= 0 ? t.lastCounter : "–"}</dd></div>
                    </dl>
                    {t.disabledReason && <p className="text-xs text-muted-foreground">Disabled: {t.disabledReason}</p>}
                    <div className="flex flex-wrap gap-2">
                      {t.mode === "SECURE" && t.status !== "DISABLED" && <Button variant="outline" className="h-11" onClick={() => setTesting(t)}>Test tap</Button>}
                      <Button variant="outline" className="h-11" onClick={() => setLog(t)}>Tap log</Button>
                      {t.mode === "SECURE" && <Button variant="outline" className="h-11" onClick={() => setConfirm({ kind: "rotate", tag: t })}>Rotate keys</Button>}
                      <Button variant="outline" className="h-11" onClick={() => setConfirm({ kind: "replace", tag: t })}>Replace tag</Button>
                      {t.status !== "DISABLED" && <Button variant="outline" className="h-11 text-destructive" onClick={() => setConfirm({ kind: "disable", tag: t })}>Disable</Button>}
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {shown && <ProvisioningDialog result={shown} onClose={() => setShown(null)} />}
      {testing && <TestDialog branchId={branchId} tag={testing} onClose={() => setTesting(null)} />}
      {log && <LogDialog branchId={branchId} tag={log} onClose={() => setLog(null)} />}
      {confirm && (
        <Dialog open onOpenChange={(o) => !o && setConfirm(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{confirm.kind === "rotate" ? "Rotate keys?" : confirm.kind === "replace" ? "Replace this tag?" : "Disable this tag?"}</DialogTitle>
              <DialogDescription>
                {confirm.kind === "rotate" && "The old keys stop working immediately and the tag must be written with the new keys and tested again before guests can use it."}
                {confirm.kind === "replace" && "The old tag is disabled for good and a new tag record is made for the same table."}
                {confirm.kind === "disable" && "Taps on this tag stop working immediately. Use this for a lost, copied or photographed tag."}
              </DialogDescription>
            </DialogHeader>
            {confirm.kind === "disable" && <div className="flex flex-col gap-1.5"><Label htmlFor="dis-reason">Why (kept in the record)</Label><Input id="dis-reason" className="h-11" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lost, copied, damaged…" /></div>}
            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-11" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button className="h-11" variant={confirm.kind === "disable" ? "destructive" : "default"} disabled={confirm.kind === "disable" && reason.trim().length < 3} onClick={runConfirmed}>{confirm.kind === "rotate" ? "Rotate keys" : confirm.kind === "replace" ? "Replace" : "Disable tag"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
