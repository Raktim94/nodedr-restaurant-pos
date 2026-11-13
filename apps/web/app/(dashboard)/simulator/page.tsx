"use client";

import { useEffect, useRef, useState } from "react";
import { selectClass } from "@/components/inventory/production-entry-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useBranch } from "@/hooks/use-branch";
import { useTerminals } from "@/hooks/use-display";
import { useBuzzers } from "@/hooks/use-paging";
import { useFloors } from "@/hooks/use-tables";
import { setDisplayTerminal } from "@/lib/customer-display";

// Test the software without the hardware. Everything here is the real application in frames sized like the
// devices they stand for; the buzzer is a pretend device that talks to the real server the way a real one would.
// What this cannot tell you: touch-screen feel, real screen brightness and colour, Wi-Fi range, battery, NFC reads
// or how a given buzzer's radio behaves. Those need the actual devices.

const SIZES: Record<string, { label: string; w: number; h: number }> = {
  tpv15: { label: '15" till display 1366×768', w: 1366, h: 768 },
  fhd: { label: "Monitor 1920×1080", w: 1920, h: 1080 },
  tablet: { label: "Tablet landscape 1280×800", w: 1280, h: 800 },
  portrait: { label: "Portrait screen 1080×1920", w: 1080, h: 1920 },
  small: { label: 'Small 10" 1024×600', w: 1024, h: 600 },
};

function ScaledFrame({ src, w, h, title, maxH = 520 }: { src: string; w: number; h: number; title: string; maxH?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(el.clientWidth / w, maxH / h)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h, maxH]);
  return (
    <div ref={box} className="w-full">
      <div style={{ width: w * scale, height: h * scale }} className="overflow-hidden rounded-lg border border-border bg-black">
        <iframe title={title} src={src} style={{ width: w, height: h, transform: `scale(${scale})`, transformOrigin: "top left", border: 0 }} />
      </div>
    </div>
  );
}

interface BuzzPoll { call: { id: string } | null; buzzer: { name: string; number: string | null } }

function BuzzerSim({ token }: { token: string }) {
  const [out, setOut] = useState(false); // "out of range": the device stops polling
  const [ringing, setRinging] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const add = (t: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${t}`, ...l].slice(0, 8));
  useEffect(() => {
    if (out) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/v1/public/buzzer/${encodeURIComponent(token)}/poll`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as BuzzPoll;
        if (!stop) setRinging((cur) => { if (j.call && cur !== j.call.id) add("BZZZ: your order is ready"); return j.call ? j.call.id : null; });
      } catch { if (!stop) add("could not reach the server"); }
    };
    void tick();
    const i = setInterval(tick, 1500);
    return () => { stop = true; clearInterval(i); };
  }, [token, out]);
  const ack = async () => {
    if (!ringing) return;
    await fetch(`/api/v1/public/buzzer/${encodeURIComponent(token)}/ack`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callId: ringing }) });
    add("collected: acknowledged");
    setRinging(null);
  };
  return (
    <div className="flex flex-col items-center gap-3">
      <div role="img" aria-label={ringing ? "Buzzer ringing" : out ? "Buzzer out of range" : "Buzzer idle"} className={`flex h-28 w-28 items-center justify-center rounded-full border-4 text-center text-sm font-semibold ${ringing ? "animate-pulse border-red-500 bg-red-500/20" : out ? "border-border bg-muted text-muted-foreground" : "border-green-600 bg-green-600/10"}`}>
        {ringing ? "RINGING" : out ? "OUT OF RANGE" : "IDLE"}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!ringing} onClick={ack}>Guest presses to collect</Button>
        <Button size="sm" variant="outline" onClick={() => { setOut((v) => !v); add(out ? "back in range" : "left range: polling stopped"); }}>{out ? "Back in range" : "Take out of range"}</Button>
      </div>
      <ul className="w-full text-xs text-muted-foreground">{log.map((l, i) => (<li key={i}>{l}</li>))}</ul>
    </div>
  );
}

export default function SimulatorPage() {
  const { branchId } = useBranch();
  const { data: terminals } = useTerminals(branchId);
  const { data: buzzers } = useBuzzers(branchId);
  const { data: floors } = useFloors(branchId, true);
  const tables = (floors ?? []).flatMap((f) => f.tables.filter((t) => t.qrToken).map((t) => ({ id: t.id, label: `${f.name} · ${t.number}`, qr: t.qrToken as string })));
  const [term, setTerm] = useState("");
  const [size, setSize] = useState("tpv15");
  const [table, setTable] = useState("");
  const [buzz, setBuzz] = useState("");
  const terminal = terminals?.find((t) => t.id === term) ?? null;
  const tbl = tables.find((t) => t.id === table) ?? null;
  const bz = buzzers?.find((b) => b.id === buzz) ?? null;
  const sz = SIZES[size];

  const pick = (id: string) => {
    setTerm(id);
    const t = terminals?.find((x) => x.id === id);
    setDisplayTerminal(t && branchId ? { id: t.id, branchId, name: t.name } : null); // the till frame below now drives this screen
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Hardware simulator</h1>
        <p className="text-sm text-muted-foreground">Try the till, customer screen, table menu, kitchen and buzzer together before the real devices arrive.</p>
      </div>
      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">Customer screen<select className={selectClass} value={term} onChange={(e) => pick(e.target.value)}><option value="">Choose…</option>{(terminals ?? []).filter((t) => t.isActive).map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}</select></label>
        <label className="flex flex-col gap-1 text-sm">Screen size<select className={selectClass} value={size} onChange={(e) => setSize(e.target.value)}>{Object.entries(SIZES).map(([k, v]) => (<option key={k} value={k}>{v.label}</option>))}</select></label>
        <label className="flex flex-col gap-1 text-sm">Table (QR / NFC link)<select className={selectClass} value={table} onChange={(e) => setTable(e.target.value)}><option value="">Choose…</option>{tables.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}</select></label>
        <label className="flex flex-col gap-1 text-sm">Buzzer (polling type)<select className={selectClass} value={buzz} onChange={(e) => setBuzz(e.target.value)}><option value="">Choose…</option>{(buzzers ?? []).filter((b) => b.driver === "SIMULATED").map((b) => (<option key={b.id} value={b.id}>{b.name}{b.table ? ` (${b.table})` : ""}</option>))}</select></label>
        <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">Set up screens under Settings &gt; Customer screen, buzzers under Settings &gt; Buzzers (assign each to a table). Choosing a customer screen makes the till frame below drive it.</p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Staff till" className="flex flex-col gap-2"><h2 className="text-sm font-semibold">1. Staff till</h2><ScaledFrame src="/pos" w={1366} h={768} title="Staff till" /></section>
        <section aria-label="Customer display" className="flex flex-col gap-2"><h2 className="flex items-center gap-2 text-sm font-semibold">2. Customer display {terminal ? <Badge variant="outline">{sz.label}</Badge> : null}</h2>
          {terminal ? <ScaledFrame src={`/customer-display?t=${terminal.token}`} w={sz.w} h={sz.h} title="Customer display" /> : <Card className="py-16 text-center text-sm text-muted-foreground">Choose a customer screen above.</Card>}</section>
        <section aria-label="Table web menu" className="flex flex-col gap-2"><h2 className="text-sm font-semibold">3. Guest phone (table QR / NFC)</h2>
          {tbl ? <ScaledFrame src={`/order/${tbl.qr}`} w={390} h={844} title="Guest phone" maxH={640} /> : <Card className="py-16 text-center text-sm text-muted-foreground">Choose a table above.</Card>}</section>
        <section aria-label="Kitchen" className="flex flex-col gap-2"><h2 className="text-sm font-semibold">4. Kitchen tablet</h2><ScaledFrame src="/kds" w={1280} h={800} title="Kitchen tablet" /></section>
      </div>

      <section aria-label="Buzzer" className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">5. Table buzzer</h2>
        <Card className="mx-auto w-full max-w-sm p-4">{bz ? <BuzzerSim token={bz.deviceToken} /> : <p className="py-8 text-center text-sm text-muted-foreground">Choose a polling buzzer above.</p>}</Card>
      </section>
    </div>
  );
}
