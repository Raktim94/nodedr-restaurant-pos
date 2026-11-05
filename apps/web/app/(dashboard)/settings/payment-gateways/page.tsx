"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Copy, ExternalLink, FlaskConical, ShieldAlert, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusNote, useNoteToast } from "@/components/ui/status-note";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useGatewayActions,
  useGatewayCatalog,
  useGatewayConnections,
  useRecentGatewayPayments,
  useRefundsToReview,
  type GatewayMode,
  type GatewayPaymentRow,
  type GatewayProvider,
} from "@/hooks/use-payment-gateways";
import { ApiError } from "@/lib/api";
import { countryOptions } from "@/lib/countries";
import { formatCurrency } from "@/lib/format";
import { fromMinorUnits } from "@/lib/money-units";

const LIVE_PHRASE = "ENABLE LIVE PAYMENTS";
const when = (s: string | null) => (s ? new Date(s).toLocaleString() : "Never");
const SELECT =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

const PILL = "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm font-medium";
/** Words plus an icon, never colour alone. */
function StatusLine({ p }: { p: GatewayProvider }) {
  const c = p.connection;
  if (!p.integrated) return <span className="text-sm text-muted-foreground">Not integrated with OrderRestro yet</span>;
  if (!c) return <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><CircleDashed className="h-4 w-4" aria-hidden />Not set up</span>;
  if (c.lastTestOk === false)
    return <span className={`${PILL} bg-destructive/10 text-destructive`}><ShieldAlert className="h-4 w-4" aria-hidden />Connection problem</span>;
  if (!c.enabled)
    return <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"><CircleDashed className="h-4 w-4" aria-hidden />Saved, not switched on</span>;
  if (c.mode === "TEST")
    return <span className={`${PILL} bg-warning/10 text-warning`}><FlaskConical className="h-4 w-4" aria-hidden />On in Test mode — no real money moves</span>;
  return <span className={`${PILL} bg-success/10 text-success`}><Zap className="h-4 w-4" aria-hidden />Live — customers are charged real money</span>;
}

function CredentialsForm({ p, country, mode }: { p: GatewayProvider; country: string; mode: GatewayMode }) {
  const { save, removeCredentials, test } = useGatewayActions();
  const { note, clear, toast } = useNoteToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const c = p.connection;
  const set = new Set(mode === "TEST" ? (c?.testKeys ?? []) : (c?.liveKeys ?? []));
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Something went wrong");
  const hook = c?.webhookPaths[mode];
  const hookUrl = hook ? `${typeof window === "undefined" ? "" : window.location.origin}${hook}` : null;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const credentials = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
        if (!Object.keys(credentials).length) return toast.info("Nothing new to save");
        save.mutate(
          { provider: p.key, country, mode, credentials },
          {
            onSuccess: () => {
              setValues({});
              toast.success(`${mode === "TEST" ? "Test" : "Live"} credentials saved`);
            },
            onError: fail,
          },
        );
      }}
    >
      {mode === "LIVE" && (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning" role="note">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          These are your Live keys. Payments taken with them are real.
        </p>
      )}
      {p.fields.map((f) => {
        const isSet = set.has(f.key);
        return (
          <div key={f.key} className="flex flex-col gap-1.5">
            <Label htmlFor={`${p.key}-${mode}-${f.key}`}>
              {f.label}
              {f.required ? "" : " (optional)"}
            </Label>
            <Input
              id={`${p.key}-${mode}-${f.key}`}
              // Secrets are write-only: the field is a password input, autofill is off and the saved value is never shown.
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              spellCheck={false}
              value={values[f.key] ?? ""}
              placeholder={isSet ? (f.secret ? "Saved — leave blank to keep" : "Saved — type to replace") : ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
            {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
            {isSet && (
              <p className="inline-flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Saved
              </p>
            )}
          </div>
        );
      })}

      {hookUrl && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-secondary/40 p-3 text-xs">
          <p className="font-medium text-foreground">{mode === "TEST" ? "Test" : "Live"} webhook URL</p>
          <p className="text-muted-foreground">
            Add this in {p.name}&apos;s dashboard under webhooks for your {mode === "TEST" ? "test" : "live"} account. It must be reachable from the
            internet (a Cloudflare Tunnel works). Test and Live use different URLs so they never mix.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1 text-foreground">{hookUrl}</code>
            <CopyButton text={hookUrl} label="webhook URL" />
          </div>
        </div>
      )}

      <StatusNote note={note} onClear={clear} />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save credentials"}</Button>
        {c && (mode === "TEST" ? c.testKeys.length > 0 : c.liveKeys.length > 0) && (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={test.isPending || !(mode === "TEST" ? c.testComplete : c.liveComplete)}
              onClick={() =>
                test.mutate(
                  { provider: p.key, mode },
                  { onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error(r.message)), onError: fail },
                )
              }
            >
              {test.isPending ? "Checking…" : "Test connection"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={removeCredentials.isPending}
              onClick={() => {
                if (window.confirm(`Delete the saved ${mode === "TEST" ? "Test" : "Live"} credentials for ${p.name}?`)) {
                  removeCredentials.mutate({ provider: p.key, mode }, { onSuccess: () => toast.success("Credentials deleted"), onError: fail });
                }
              }}
            >
              Delete credentials
            </Button>
          </>
        )}
      </div>
      {c?.lastTestedAt && (
        <p className="text-xs text-muted-foreground">
          Last check: {when(c.lastTestedAt)} — {c.lastTestOk ? "accepted" : (c.lastError ?? "failed")}
        </p>
      )}
    </form>
  );
}

function LiveDialog({ p, open, onClose }: { p: GatewayProvider; open: boolean; onClose: () => void }) {
  const { setMode } = useGatewayActions();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Switch {p.name} to Live mode?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <dl className="grid gap-2 rounded-lg border border-border bg-secondary/40 p-3">
            <div><dt className="font-medium text-foreground">What changes</dt><dd className="text-muted-foreground">New payment links use your Live {p.name} account. Customers are charged real money, and a paid link closes the bill.</dd></div>
            <div><dt className="font-medium text-foreground">What stays the same</dt><dd className="text-muted-foreground">Your Test credentials, past test payments and every bill already paid.</dd></div>
            <div><dt className="font-medium text-foreground">Can I undo it?</dt><dd className="text-muted-foreground">Yes. Switch back to Test mode at any time. Money already collected is not reversed; refund it from the order.</dd></div>
            <div><dt className="font-medium text-foreground">Before switching</dt><dd className="text-muted-foreground">We check that {p.name} accepts your Live credentials. If it does not, nothing changes.</dd></div>
          </dl>
          <Label htmlFor="live-confirm">Type {LIVE_PHRASE} to confirm</Label>
          <Input id="live-confirm" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
          {err && <p className="text-destructive" role="alert">{err}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Stay in Test mode</Button>
          <Button
            disabled={text !== LIVE_PHRASE || setMode.isPending}
            onClick={() =>
              setMode.mutate(
                { provider: p.key, mode: "LIVE", confirm: text },
                { onSuccess: onClose, onError: (e) => setErr(e instanceof ApiError ? e.message : "Failed") },
              )
            }
          >
            {setMode.isPending ? "Checking credentials…" : "Switch to Live mode"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderSetup({ p, country, open, onToggle }: { p: GatewayProvider; country: string; open: boolean; onToggle: () => void }) {
  const { setEnabled, setMode, removeConnection, removeCustom } = useGatewayActions();
  const { note, clear, toast } = useNoteToast();
  const c = p.connection;
  const [tab, setTab] = useState<GatewayMode>("TEST");
  const [liveOpen, setLiveOpen] = useState(false);
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Something went wrong");

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[18px] font-medium text-foreground">{p.name}</h3>
          <StatusLine p={p} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
        {c && (
          <div className="flex items-center gap-2">
            <Label htmlFor={`en-${p.key}`} className="text-xs text-muted-foreground">Accept online payments</Label>
            <Switch
              id={`en-${p.key}`}
              checked={c.enabled}
              disabled={setEnabled.isPending}
              onCheckedChange={(enabled) => setEnabled.mutate({ provider: p.key, enabled }, { onError: fail })}
            />
          </div>
        )}
        <Button size="sm" variant={open || !p.integrated ? "outline" : "default"} aria-expanded={open} onClick={onToggle}>
          {open ? "Close" : c ? "Manage" : p.integrated ? "Set up" : "Details"}
        </Button>
        </div>
      </div>

      {!open && <p className="text-sm text-muted-foreground">{p.integration}</p>}

      {!open ? null : !p.integrated ? (
        <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
          OrderRestro cannot take payments through {p.name} yet, so no credentials are collected for it. {p.custom ? "This is a provider you added." : ""}
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>How it works: {p.integration}. The customer pays on the provider&apos;s own page; card details never touch OrderRestro.</p>
            {p.limitations.map((l) => (
              <p key={l}>• {l}</p>
            ))}
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as GatewayMode)}>
            <TabsList aria-label="Credential mode" className="w-full">
              {(["TEST", "LIVE"] as const).map((m) => (
                <TabsTrigger key={m} value={m} className="min-h-11 flex-1">
                  {m === "TEST" ? "Test credentials" : "Live credentials"}
                  {c?.mode === m && <Badge className="ml-2" variant="secondary">in use</Badge>}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <CredentialsForm key={`${p.key}-${tab}`} p={p} country={country} mode={tab} />

          {c && (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">Mode for customer payments</p>
              {c.mode === "TEST" ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    <strong>Test mode.</strong> Uses your Test credentials. A test payment proves the setup works but moves no real money and does <em>not</em> mark the bill as paid.
                  </p>
                  <div><Button size="sm" variant="outline" disabled={!c.liveComplete} onClick={() => setLiveOpen(true)}>Switch to Live…</Button>
                    {!c.liveComplete && <span className="ml-2 text-xs text-muted-foreground">Save all Live credentials first.</span>}</div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground"><strong>Live mode</strong> since {when(c.liveConfirmedAt)}. Real money is charged and a paid link settles the bill.</p>
                  <div><Button size="sm" variant="outline" disabled={setMode.isPending} onClick={() => setMode.mutate({ provider: p.key, mode: "TEST" }, { onError: fail })}>Back to Test mode</Button></div>
                </>
              )}
            </div>
          )}
          {c && <LiveDialog p={p} open={liveOpen} onClose={() => setLiveOpen(false)} />}
        </>
      )}

      <StatusNote note={note} onClear={clear} />

      {open && (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <a className="inline-flex items-center gap-1 font-medium underline underline-offset-2" href={p.docsUrl} target="_blank" rel="noopener noreferrer">
          {p.name} setup documentation <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
        {c && (
          <Button size="sm" variant="ghost" className="text-destructive" disabled={removeConnection.isPending}
            onClick={() => window.confirm(`Remove ${p.name} and delete all its saved credentials?`) && removeConnection.mutate(p.key, { onError: fail })}>
            Remove gateway
          </Button>
        )}
        {p.custom && (
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeCustom.mutate(p.key, { onError: fail })}>
            Delete this custom entry
          </Button>
        )}
      </div>
      )}
    </Card>
  );
}

function CustomProviderDialog({ country, open, onClose, adapters }: { country: string; open: boolean; onClose: () => void; adapters: { key: string; name: string }[] }) {
  const { saveCustom } = useGatewayActions();
  const [name, setName] = useState("");
  const [docsUrl, setDocsUrl] = useState("");
  const [adapter, setAdapter] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add a custom provider</DialogTitle></DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
            saveCustom.mutate(
              { key: `custom-${key}`, name, countries: [country], docsUrl, adapter: adapter || null },
              { onSuccess: () => { setName(""); setDocsUrl(""); setAdapter(""); onClose(); }, onError: (e2) => setErr(e2 instanceof ApiError ? e2.message : "Failed") },
            );
          }}
        >
          <p className="text-sm text-muted-foreground">
            Adds a provider to this country&apos;s list. It can only take payments if you pick one of the integrations OrderRestro already has; otherwise it is kept as a reference with a link to its documentation.
          </p>
          <Label htmlFor="cp-name">Provider name</Label>
          <Input id="cp-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          <Label htmlFor="cp-docs">Documentation link (https://)</Label>
          <Input id="cp-docs" type="url" value={docsUrl} onChange={(e) => setDocsUrl(e.target.value)} required />
          <Label htmlFor="cp-adapter">Use an existing integration</Label>
          <select id="cp-adapter" className={SELECT} value={adapter} onChange={(e) => setAdapter(e.target.value)}>
            <option value="">None — reference only</option>
            {adapters.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
          </select>
          {err && <p className="text-sm text-destructive" role="alert">{err}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saveCustom.isPending}>Add provider</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PAY_LABEL: Record<string, string> = {
  NEEDS_REVIEW: "Needs review",
  SUCCEEDED: "Paid",
  CREATED: "Waiting for customer",
  EXPIRED: "Link expired",
  FAILED: "Could not create link",
};

function PaymentRow({ r }: { r: GatewayPaymentRow }) {
  const attention = r.status === "NEEDS_REVIEW";
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="font-medium tabular-nums text-foreground">{formatCurrency(fromMinorUnits(r.amountMinor, r.currency), r.currency)}</span>
        <span className={`${PILL} ${attention ? "bg-destructive/10 text-destructive" : r.status === "SUCCEEDED" ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground"}`}>
          {attention && <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
          {r.status === "SUCCEEDED" && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />}
          {PAY_LABEL[r.status]}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {r.provider} · {r.mode === "TEST" ? "Test payment, no real money" : "Live payment"} · <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time>
      </p>
      {r.note && <p className={`text-sm ${attention ? "text-foreground" : "text-muted-foreground"}`}>{r.note}</p>}
    </li>
  );
}

/** What needs a person comes first; the history sits below it. */
function RecentPayments() {
  const q = useRecentGatewayPayments();
  const rq = useRefundsToReview();
  const badRefunds = rq.data ?? [];
  if (q.isLoading) return <Skeleton className="h-24 w-full" />;
  if (q.isError) return <p className="text-sm text-destructive" role="alert">Could not load recent payments. Try again shortly.</p>;
  const rows = q.data ?? [];
  const review = rows.filter((r) => r.status === "NEEDS_REVIEW");
  return (
    <>
      {badRefunds.length > 0 && (
        <Card className="flex flex-col gap-2 border-destructive/40 p-5" role="region" aria-label="Refunds needing review">
          <h2 className="flex items-center gap-2 text-[18px] font-medium text-foreground">
            <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden /> {badRefunds.length} refund{badRefunds.length > 1 ? "s" : ""} need{badRefunds.length > 1 ? "" : "s"} review
          </h2>
          <p className="text-sm text-muted-foreground">
            Check each one in the provider dashboard before trying again. Refunding twice returns the customer&apos;s money twice.
          </p>
          <ul className="divide-y divide-border text-sm">
            {badRefunds.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-3">
                <span className="font-medium tabular-nums">{formatCurrency(fromMinorUnits(r.amountMinor, r.currency), r.currency)} · {r.provider}{r.providerRefundId ? ` · ${r.providerRefundId}` : ""}</span>
                {r.note && <span className="text-muted-foreground">{r.note}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {review.length > 0 && (
        <Card className="flex flex-col gap-2 border-destructive/40 p-5" role="region" aria-label="Payments needing review">
          <h2 className="flex items-center gap-2 text-[18px] font-medium text-foreground">
            <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden /> {review.length} payment{review.length > 1 ? "s" : ""} need{review.length > 1 ? "" : "s"} review
          </h2>
          <p className="text-sm text-muted-foreground">
            Money reached the gateway but the bill could not be closed, or the amount did not match. Nothing was applied automatically. Check it in the provider dashboard, then settle or refund the order.
          </p>
          <ul className="divide-y divide-border">{review.map((r) => <PaymentRow key={r.id} r={r} />)}</ul>
        </Card>
      )}
      <Card className="flex flex-col gap-1 p-5">
        <h2 className="text-[18px] font-medium text-foreground">Recent online payments</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No online payments yet. When a cashier creates a payment link from the POS checkout, it appears here with its status and whether it was a test.
          </p>
        ) : (
          <ul className="divide-y divide-border">{rows.map((r) => <PaymentRow key={r.id} r={r} />)}</ul>
        )}
      </Card>
    </>
  );
}

export default function PaymentGatewaysPage() {
  const conns = useGatewayConnections();
  const saved = conns.data?.[0]?.country ?? "";
  const [picked, setPicked] = useState<string | null>(null);
  const country = picked ?? saved;
  const catalog = useGatewayCatalog(country);
  const options = useMemo(() => countryOptions(), []);
  const [customOpen, setCustomOpen] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <SettingsTabs />
      <header className="flex flex-col gap-1">
        <h1 className="text-[24px] font-semibold text-foreground">Payment gateways</h1>
        <p className="text-sm text-muted-foreground">Take card, UPI and wallet payments online. Customers pay on the provider&apos;s own secure page.</p>
      </header>

      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-[18px] font-medium text-foreground">1. Where is your business based?</h2>
        <Label htmlFor="gw-country" className="sr-only">Business country</Label>
        <select id="gw-country" className={SELECT} value={country} onChange={(e) => setPicked(e.target.value)}>
          <option value="" disabled>Choose a country…</option>
          {options.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">
          This only filters the list below. It does not decide where you may open an account: provider availability, merchant approval, payment methods and
          settlement depend on the provider&apos;s current rules and your merchant account.
        </p>
      </Card>

      {country && (
        <section className="flex flex-col gap-3" aria-labelledby="gw-choose">
          <h2 id="gw-choose" className="text-[18px] font-medium text-foreground">2. Choose a gateway</h2>
          {catalog.isLoading && <Skeleton className="h-32 w-full" />}
          {catalog.data && (
            <>
              <p className="text-xs text-muted-foreground">
                Listed in no particular order; integrated gateways come first. Availability checked from public sources on {catalog.data.researchedAt}.
              </p>
              {catalog.data.providers.length === 0 && (
                <p className="rounded-lg bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
                  No gateways are listed for this country yet. You can add one as a custom provider.
                </p>
              )}
              {catalog.data.providers.map((p) => (
                <ProviderSetup key={p.key} p={p} country={country} open={openKey === p.key} onToggle={() => setOpenKey(openKey === p.key ? null : p.key)} />
              ))}
              <div>
                <Button variant="outline" onClick={() => setCustomOpen(true)}>Custom provider…</Button>
              </div>
              <CustomProviderDialog
                country={country}
                open={customOpen}
                onClose={() => setCustomOpen(false)}
                adapters={catalog.data.providers.filter((p) => p.integrated && !p.custom).map((p) => ({ key: p.key, name: p.name }))}
              />
            </>
          )}
        </section>
      )}

      <RecentPayments />
    </div>
  );
}
