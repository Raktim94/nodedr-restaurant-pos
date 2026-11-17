"use client";

import {
  ArrowDown,
  ArrowRight,
  ChefHat,
  CircleCheck,
  Cloud,
  CloudOff,
  Database,
  Globe2,
  Laptop,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Tablet,
  Wifi,
} from "lucide-react";
import { useEffect, useState } from "react";

const scenarios = [
  {
    id: "waiter",
    label: "Waiter takes an order",
    icon: Smartphone,
    title: "From a tap to a kitchen ticket in about a second.",
    status: "Inside the restaurant · WiFi / local network",
    steps: [
      "The waiter taps the dishes for table 4 in the OrderRestro app and presses Send to kitchen.",
      "The order travels over the restaurant WiFi to the restaurant server (port 1995). No internet is needed.",
      "The server checks the waiter's permissions, prices the order and saves it in the PostgreSQL database on that computer.",
      "The server pushes a live update (Socket.IO) to every screen in the restaurant.",
      "The kitchen display shows the new ticket for its station, with a timer and a sound.",
      "The counter screen in Chrome updates too: table 4 is now occupied with its running total.",
    ],
  },
  {
    id: "kitchen",
    label: "Kitchen marks it ready",
    icon: ChefHat,
    title: "One kitchen update reaches the whole team.",
    status: "Inside the restaurant · live local updates",
    steps: [
      "The kitchen marks a prepared ticket as ready on its display.",
      "The server records the status against the order and its table.",
      "Waiter and counter screens receive the live update over the local network.",
      "The waiter sees which items are ready without leaving the floor to check the pass.",
    ],
  },
  {
    id: "owner",
    label: "Owner checks from home",
    icon: Globe2,
    title: "Check the restaurant remotely through a secure route.",
    status: "Remote access · secure internet connection configured",
    steps: [
      "The owner opens OrderRestro from home and signs in.",
      "A configured secure remote connection reaches the restaurant server.",
      "The server checks access permissions and returns the latest saved figures.",
      "Inside the restaurant, phones, tills and kitchen screens keep using the local WiFi as usual.",
    ],
  },
  {
    id: "internet",
    label: "Internet goes down",
    icon: CloudOff,
    title: "The restaurant can keep serving when the WAN drops.",
    status: "Internet unavailable · local WiFi still active",
    steps: [
      "The internet connection drops, but the restaurant's local WiFi and server remain on.",
      "Phones and tablets continue sending orders to the server over the local network.",
      "The server saves orders and updates the kitchen and counter screens locally.",
      "Remote access and other internet services pause until the connection returns.",
    ],
  },
  {
    id: "phone",
    label: "Phone with no server",
    icon: Smartphone,
    title: "Use the phone on its own, then sync when ready.",
    status: "Standalone phone · local-first workflow",
    steps: [
      "The mobile app can be used without a restaurant server.",
      "Sales recorded on the phone stay available there while it is offline.",
      "Connect it to the restaurant server when one is available.",
      "The app syncs queued changes and continues with the shared restaurant workflow.",
    ],
  },
  {
    id: "windows",
    label: "Windows laptop as the server",
    icon: Laptop,
    title: "A Windows laptop can host the restaurant server.",
    status: "Windows host · local WiFi network",
    steps: [
      "Run the OrderRestro server on a Windows laptop in the restaurant.",
      "Connect phones, tablets and the kitchen display to the same WiFi.",
      "Staff open the server address on their device and sign in with their own role.",
      "The laptop stores the restaurant database and shares updates across the local network.",
    ],
  },
] as const;

export function ArchitectureWalkthrough() {
  const [activeId, setActiveId] = useState<(typeof scenarios)[number]["id"]>("waiter");
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const active = scenarios.find((scenario) => scenario.id === activeId)!;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setCurrentStep((step) => (step + 1) % active.steps.length);
    }, 1100);
    return () => window.clearInterval(timer);
  }, [active.steps.length, isPlaying]);

  return (
    <section id="how-it-works" className="border-y border-[#d6d0c1] bg-[#f7f3e9] px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d6d0c1] bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#075056]">
            <span className="size-1.5 rounded-full bg-[#c62646]" />
            One restaurant. One local server.
          </div>
          <h2 className="mt-5 text-3xl font-semibold tracking-tight text-[#102f32] sm:text-4xl lg:text-5xl">
            See how an order travels.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-[#536466] sm:text-lg">
            Phones, tablets and computers in the restaurant talk to one server over WiFi. The server keeps the database on the restaurant&apos;s own computer.
          </p>
        </div>

        <div role="tablist" aria-label="OrderRestro situations" className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {scenarios.map((scenario) => {
            const Icon = scenario.icon;
            const selected = scenario.id === activeId;
            return (
              <button
                key={scenario.id}
                type="button"
                role="tab"
                id={`scenario-${scenario.id}`}
                aria-controls="walkthrough-panel"
                aria-selected={selected}
                onClick={() => {
                  setActiveId(scenario.id);
                  setCurrentStep(0);
                  setIsPlaying(true);
                }}
                className={`flex min-h-12 items-center justify-start gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-semibold leading-tight transition-colors sm:min-h-14 sm:text-sm ${
                  selected
                    ? "border-[#075056] bg-[#075056] text-[#fff9ed] shadow-sm"
                    : "border-[#d6d0c1] bg-white/70 text-[#3d5355] hover:border-[#075056]/50 hover:bg-white"
                }`}
              >
                <Icon className={`size-4 shrink-0 ${selected ? "text-[#f4cfaa]" : "text-[#075056]"}`} aria-hidden="true" />
                <span>{scenario.label}</span>
              </button>
            );
          })}
        </div>

        <div id="walkthrough-panel" role="tabpanel" aria-labelledby={`scenario-${active.id}`} tabIndex={0} className="mt-5 grid items-stretch gap-4 outline-none focus-visible:ring-2 focus-visible:ring-[#c62646] lg:grid-cols-[0.92fr_1.08fr] lg:gap-5">
          <div className="rounded-3xl border border-[#164a4d] bg-[#073a3e] p-4 text-[#fff9ed] shadow-[0_24px_60px_-32px_rgba(3,39,42,0.65)] sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b9d3cc]">OrderRestro network</p>
                <p className="mt-1 text-sm font-medium text-[#fff9ed]">Restaurant WiFi / local network</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] text-[#d9e8e2]">
                <Wifi className="size-3.5" aria-hidden="true" /> Local
              </span>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
              <DeviceCard icon={Smartphone} label="Waiter phone" />
              <DeviceCard icon={ChefHat} label="Kitchen display" />
              <DeviceCard icon={Monitor} label="Counter screen" />
            </div>

            <div className="flex justify-center py-2.5 text-[#9dc2b8]">
              <ArrowDown className="size-4" aria-hidden="true" />
            </div>

            <div className="rounded-2xl border border-[#77aaa0]/35 bg-[#0b4c50] p-4 sm:p-5">
              <div className="flex items-center gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#f2d9b7] text-[#075056]">
                  <Laptop className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Restaurant server</p>
                  <p className="mt-0.5 text-xs text-[#c1dad2]">OrderRestro · port 1995</p>
                </div>
                <span className="size-2 rounded-full bg-[#80d6a7] shadow-[0_0_12px_rgba(128,214,167,0.8)]" aria-label="Server active" />
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-3 text-xs text-[#c1dad2]">
                <Database className="size-4 shrink-0" aria-hidden="true" />
                <span>PostgreSQL database stays on this computer</span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#032e32]/70 px-3 py-2.5 text-xs">
              <span className="inline-flex items-center gap-1.5 text-[#d4e6df]"><CircleCheck className="size-3.5 text-[#f1cba3]" /> Private database</span>
              <span className="text-[#b9d3cc]">Internet optional for local service</span>
            </div>
          </div>

          <div className="rounded-3xl border border-[#e1dbce] bg-white p-5 shadow-[0_18px_50px_-36px_rgba(16,47,50,0.45)] sm:p-7 lg:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e9f2ee] px-2.5 py-1 text-[11px] font-semibold text-[#075056]">
                {active.id === "owner" ? <Cloud className="size-3.5" /> : <Wifi className="size-3.5" />}
                {active.status}
              </span>
            </div>
            <h3 className="mt-4 text-xl font-semibold leading-snug tracking-tight text-[#102f32] sm:text-2xl">{active.title}</h3>
            <ol className="mt-5 space-y-0">
              {active.steps.map((step, index) => (
                <li key={step} className="relative flex gap-3 pb-4 last:pb-0 sm:gap-4">
                  {index < active.steps.length - 1 && <span aria-hidden="true" className="absolute left-[15px] top-8 h-[calc(100%-1.25rem)] w-px bg-[#e0e7e1]" />}
                  <span className={`relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${index === currentStep ? "bg-[#c62646] text-white" : "bg-[#edf3ef] text-[#075056]"}`}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className={`pt-1 text-sm leading-relaxed transition-colors ${index === currentStep ? "font-medium text-[#173c3e]" : "text-[#536466]"}`}>{step}</p>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex items-center gap-2 border-t border-[#ece8df] pt-4">
              <span className="mr-auto text-xs font-medium text-[#657272]">Step {currentStep + 1} of {active.steps.length}</span>
              <button
                type="button"
                onClick={() => setIsPlaying((playing) => !playing)}
                aria-label={isPlaying ? "Pause walkthrough" : "Play walkthrough"}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#d6d0c1] px-3 text-xs font-semibold text-[#173c3e] transition-colors hover:bg-[#f7f3e9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c62646]"
              >
                {isPlaying ? <Pause className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
                {isPlaying ? "Pause" : "Play"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCurrentStep(0);
                  setIsPlaying(true);
                }}
                aria-label="Replay walkthrough"
                className="inline-flex size-10 items-center justify-center rounded-lg border border-[#d6d0c1] text-[#173c3e] transition-colors hover:bg-[#f7f3e9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c62646]"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-6 rounded-2xl border border-[#e4dcc9] bg-[#faf7ef] p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f4e6d7] text-[#9d273e]">
                  <ShieldCheck className="size-4.5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#173c3e]">One port is opened on the server.</p>
                  <p className="mt-1 text-sm leading-relaxed text-[#5b6968]">
                    The web app forwards requests to the backend on the server&apos;s private network. The database is never reachable from the WiFi or the internet.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-2 text-xs font-medium text-[#496567]">
              <Tablet className="size-4" aria-hidden="true" />
              <span>Phones, tablets and computers stay in sync through the restaurant server.</span>
              <ArrowRight className="ml-auto size-4 shrink-0 text-[#c62646]" aria-hidden="true" />
            </div>
          </div>
        </div>

        <p className="mx-auto mt-5 max-w-3xl text-center text-xs leading-relaxed text-[#657272] sm:text-sm">
          Local ordering, billing and kitchen updates keep working without internet while the restaurant WiFi and server remain available. Remote access needs a secure connection configured by the owner.
        </p>
      </div>
    </section>
  );
}

function DeviceCard({ icon: Icon, label }: { icon: typeof Smartphone; label: string }) {
  return (
    <div className="flex min-h-[76px] flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-1.5 py-3 text-center sm:min-h-[86px]">
      <Icon className="size-5 text-[#f2d9b7]" aria-hidden="true" />
      <span className="text-[10px] font-medium leading-tight text-[#dce9e3] sm:text-xs">{label}</span>
    </div>
  );
}
