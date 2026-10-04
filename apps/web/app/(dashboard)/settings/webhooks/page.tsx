"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useWebhookActions, useWebhookDeliveries, useWebhookEvents, useWebhooks } from "@/hooks/use-webhooks";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");

function Deliveries({ id }: { id: string }) {
  const { data } = useWebhookDeliveries(id);
  if (!data) return <Skeleton className="h-10" />;
  if (data.length === 0) return <p className="text-xs text-muted-foreground">Nothing sent yet.</p>;
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {data.map((d) => (
        <li key={d.id} className="flex flex-wrap justify-between gap-2">
          <span className="font-mono text-foreground">{d.event}</span>
          <span
            className={cn(
              d.status === "SUCCESS" && "text-success",
              d.status === "FAILED" && "text-destructive",
              d.status === "PENDING" && "text-muted-foreground",
            )}
          >
            {d.status.toLowerCase()} · {d.attempts} attempt{d.attempts === 1 ? "" : "s"}
            {d.lastError && ` · ${d.lastError}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function WebhooksPage() {
  const { data: hooks, isLoading } = useWebhooks();
  const { data: allEvents } = useWebhookEvents();
  const { create, setActive, remove, test } = useWebhookActions();
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<string[]>(["order.paid"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const toggle = (e: string) => setEvents(events.includes(e) ? events.filter((x) => x !== e) : [...events, e]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Restaurant, branch, and staff configuration</p>
      </div>
      <SettingsTabs />

      <Card className="flex max-w-3xl flex-col gap-4 p-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Webhooks</h2>
          <p className="text-sm text-muted-foreground">
            Send signed events to a URL when something happens — connect accounting, WhatsApp/SMS, payment or
            delivery tools through an automation service (n8n, Zapier, Make) or your own server.
          </p>
        </div>

        {secret && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
            <p className="font-medium text-foreground">Signing secret — copy it now, it won&rsquo;t be shown again</p>
            <p className="mt-1 select-all break-all font-mono text-xs">{secret}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(secret).then(() => toast.success("Copied"))}>
                Copy
              </Button>
              <Button size="sm" onClick={() => setSecret(null)}>Done</Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <Input placeholder="https://example.com/orderrestro-hook" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            {allEvents?.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => toggle(e)}
                className={cn(
                  "rounded-full border px-3 py-1 font-mono text-xs",
                  events.includes(e) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
                )}
              >
                {e}
              </button>
            ))}
          </div>
          <div>
            <Button
              disabled={!url.trim() || events.length === 0 || create.isPending}
              onClick={() =>
                create.mutate(
                  { url: url.trim(), events, description: description.trim() || undefined },
                  {
                    onSuccess: (r) => {
                      setSecret(r.secret);
                      setUrl("");
                      setDescription("");
                    },
                    onError: (e) => toast.error(errMsg(e)),
                  },
                )
              }
            >
              Add webhook
            </Button>
          </div>
        </div>
      </Card>

      <Card className="flex max-w-3xl flex-col divide-y divide-border p-2">
        {isLoading ? (
          <Skeleton className="m-4 h-12" />
        ) : hooks && hooks.length > 0 ? (
          hooks.map((h) => (
            <div key={h.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn("truncate font-mono text-sm", !h.isActive && "text-muted-foreground line-through")}>{h.url}</p>
                  <p className="text-xs text-muted-foreground">{h.events.join(", ")}{h.description && ` · ${h.description}`}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={test.isPending}
                    onClick={() =>
                      test.mutate(h.id, {
                        onSuccess: (r) =>
                          r.status === "SUCCESS"
                            ? toast.success(`Receiver answered ${r.lastStatusCode}`)
                            : toast.error(r.lastError ?? "Receiver did not accept the test (it will be retried)"),
                        onError: (e) => toast.error(errMsg(e)),
                      })
                    }
                  >
                    Send test
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setOpen(open === h.id ? null : h.id)}>Log</Button>
                  <Button size="sm" variant="outline" onClick={() => setActive.mutate({ id: h.id, isActive: !h.isActive })}>
                    {h.isActive ? "Pause" : "Resume"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => confirm("Delete this webhook?") && remove.mutate(h.id)}>Delete</Button>
                </div>
              </div>
              {open === h.id && <Deliveries id={h.id} />}
            </div>
          ))
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">No webhooks yet.</p>
        )}
      </Card>

      <Card className="max-w-3xl p-6 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Verifying a request</p>
        <p className="mt-1">
          Each request has an <code>X-OrderRestro-Signature</code> header: <code>t=&lt;unix time&gt;,v1=&lt;hex&gt;</code>,
          where <code>v1</code> is the HMAC-SHA256 of <code>{"{t}.{raw body}"}</code> with your signing secret. Reject
          anything older than five minutes. Failed deliveries are retried up to 6 times (1 min, 5 min, 30 min, 2 h,
          12 h). Respond with any 2xx to accept.
        </p>
      </Card>
    </div>
  );
}
