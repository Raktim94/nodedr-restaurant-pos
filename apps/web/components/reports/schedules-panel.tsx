"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";

interface Schedule {
  id: string;
  reportKey: string;
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  format: string;
  recipients: string[];
  isActive: boolean;
  lastSentAt: string | null;
  lastError: string | null;
}

const WHEN = { DAILY: "every day · yesterday", WEEKLY: "Mondays · previous 7 days", MONTHLY: "1st of the month · previous month" };

export function SchedulesPanel({
  branchId,
  reportKey,
  titles,
}: {
  branchId: string | null;
  reportKey: string;
  titles: Record<string, string>;
}) {
  const qc = useQueryClient();
  const [frequency, setFrequency] = useState<Schedule["frequency"]>("WEEKLY");
  const [format, setFormat] = useState("xlsx");
  const [recipients, setRecipients] = useState("");
  const { data } = useQuery({
    queryKey: ["report-schedules", branchId],
    queryFn: () => api.get<{ emailConfigured: boolean; schedules: Schedule[] }>(`/report-schedules?branchId=${branchId}`),
    enabled: !!branchId,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["report-schedules"] });
  const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");

  const create = useMutation({
    mutationFn: () =>
      api.post(`/report-schedules?branchId=${branchId}`, {
        reportKey,
        frequency,
        format,
        recipients: recipients.split(/[,\s;]+/).filter(Boolean),
      }),
    onSuccess: () => {
      setRecipients("");
      refresh();
      toast.success("Schedule created");
    },
    onError: (e) => toast.error(msg(e)),
  });
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => api.patch(`/report-schedules/${id}?branchId=${branchId}`, { isActive }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/report-schedules/${id}?branchId=${branchId}`),
    onSuccess: refresh,
  });
  const sendNow = useMutation({
    mutationFn: (id: string) => api.post(`/report-schedules/${id}/send?branchId=${branchId}`),
    onSuccess: () => {
      refresh();
      toast.success("Report emailed");
    },
    onError: (e) => toast.error(msg(e)),
  });
  const sel = "h-9 rounded-lg border border-border bg-background px-2 text-sm";

  return (
    <Card className="flex flex-col gap-4 p-4 print:hidden">
      <div>
        <h3 className="font-medium text-foreground">Email this report on a schedule</h3>
        <p className="text-xs text-muted-foreground">
          Sent through your own SMTP server at 06:00 branch time.
          {data && !data.emailConfigured && " Email is not set up on this server yet (SMTP_URL and SMTP_FROM)."}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <select aria-label="Frequency" className={sel} value={frequency} onChange={(e) => setFrequency(e.target.value as Schedule["frequency"])}>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
        </select>
        <select aria-label="File format" className={sel} value={format} onChange={(e) => setFormat(e.target.value)}>
          <option value="xlsx">Excel (.xlsx)</option>
          <option value="pdf">PDF</option>
          <option value="csv">CSV</option>
        </select>
        <Input aria-label="Recipients" className="min-w-64 flex-1" placeholder="owner@cafe.com, accountant@firm.com" value={recipients} onChange={(e) => setRecipients(e.target.value)} />
        <Button disabled={!recipients.trim() || create.isPending} onClick={() => create.mutate()}>Schedule</Button>
      </div>
      {data && data.schedules.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {data.schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <p className="font-medium text-foreground">{titles[s.reportKey] ?? s.reportKey} <span className="font-normal text-muted-foreground">· {s.format.toUpperCase()} · {WHEN[s.frequency]}</span></p>
                <p className="text-xs text-muted-foreground">
                  To {s.recipients.join(", ")}
                  {s.lastSentAt ? ` · last sent ${s.lastSentAt.slice(0, 16).replace("T", " ")}` : ""}
                  {s.lastError ? ` · ${s.lastError}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={sendNow.isPending} onClick={() => sendNow.mutate(s.id)}>Send now</Button>
                <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: s.id, isActive: !s.isActive })}>{s.isActive ? "Pause" : "Resume"}</Button>
                <Button size="sm" variant="outline" onClick={() => remove.mutate(s.id)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
