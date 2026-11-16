"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CloudOff, RefreshCw, TriangleAlert, WifiOff, X } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { openEntity } from "@/lib/entity-events";
import { haptic, isNativeApp, nativePlatform, plugin, savePushToken } from "@/lib/native";
import { playNotificationFeedback } from "@/lib/notification-feedback";
import { flushOutbox, nextRetryAt, outbox, retryNow, setOutboxUser } from "@/lib/outbox";
import { getRealtimeState, useRealtimeState } from "@/lib/realtime-status";

interface PushApi {
  requestPermissions: () => Promise<{ receive: string }>;
  register: () => Promise<void>;
  createChannel?: (c: { id: string; name: string; importance: number; sound?: string; vibration?: boolean }) => Promise<void>;
  addListener: (ev: string, fn: (d: never) => void) => Promise<{ remove: () => void }>;
}

type PushData = { path?: string; type?: string; entity?: string; entityId?: string };

/** Open what a tapped notification points at. Only in-app paths; the exact order or booking when we know it. */
function openFromPush(router: ReturnType<typeof useRouter>, d: PushData | undefined) {
  if (!d) return;
  if (d.path && d.path.startsWith("/") && !d.path.startsWith("//")) router.push(d.path);
  if ((d.entity === "Order" || d.entity === "Reservation") && d.entityId) openEntity(d.entity, d.entityId);
}

/** Re-render every second while a countdown is on screen. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/**
 * Mounted once for every signed-in screen. Does nothing in a normal browser.
 * Inside the phone app it registers for push, shows the connection state
 * (offline, reconnecting, updates waiting), sends queued updates with backoff
 * when the server is back, and opens the right screen when a notification is tapped.
 */
export function NativeBridge({ userId }: { userId?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { resolvedTheme } = useTheme();
  const [network, setNetwork] = useState(true); // the phone has WiFi or mobile data
  const waiting = useSyncExternalStore(outbox.subscribe, outbox.count, () => 0);
  const others = useSyncExternalStore(outbox.subscribe, outbox.othersCount, () => 0);
  const retryAt = useSyncExternalStore(outbox.subscribe, nextRetryAt, () => 0);
  const refused = useSyncExternalStore(outbox.subscribe, outbox.refused, () => [] as string[]);
  const realtime = useRealtimeState();
  const [serverDown, setServerDown] = useState(false);
  const [restored, setRestored] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wasDown = useRef(false);
  const now = useNow(retryAt > 0);

  useEffect(() => {
    setOutboxUser(userId ?? null);
    if (userId) void flushOutbox(); // someone signed in: send their waiting updates
  }, [userId]);

  // The live socket drops for a moment on every reconnect; only call the server "unreachable" after 4 seconds.
  useEffect(() => {
    if (!isNativeApp()) return;
    const t = setTimeout(() => setServerDown(getRealtimeState() === "offline"), realtime === "offline" ? 4000 : 0);
    return () => clearTimeout(t);
  }, [realtime]);

  const trouble = !network || serverDown;
  useEffect(() => {
    if (trouble) {
      wasDown.current = true;
      return;
    }
    if (!wasDown.current) return;
    wasDown.current = false;
    void flushOutbox().then((r) => {
      void qc.invalidateQueries();
      setRestored(r.sent > 0 ? `Back online. ${r.sent} saved update${r.sent === 1 ? "" : "s"} sent.` : "Back online.");
      setTimeout(() => setRestored(null), 4000);
    });
  }, [trouble, qc]);

  // Clock and battery icons must stay readable: dark icons on the light theme,
  // light icons on the dark theme (Android 15+ draws the app under the status bar).
  useEffect(() => {
    if (!isNativeApp()) return;
    const bar = plugin<{ setStyle: (o: { style: string }) => Promise<void> }>("StatusBar");
    // Capacitor naming: style DARK = light icons (for a dark app), LIGHT = dark icons.
    void bar?.setStyle({ style: resolvedTheme === "dark" ? "DARK" : "LIGHT" }).catch(() => undefined);
  }, [resolvedTheme]);

  useEffect(() => {
    if (!isNativeApp()) return;
    const subs: Array<{ remove: () => void }> = [];
    let alive = true;
    // addListener gives back a promise on some bridge versions and the handle itself on others.
    const keep = (p: unknown) => {
      if (!p) return;
      void Promise.resolve(p as { remove: () => void })
        .then((s) => {
          if (!s || typeof s.remove !== "function") return;
          if (alive) subs.push(s);
          else s.remove();
        })
        .catch(() => undefined);
    };

    // Push notifications. Without a Firebase project the register call fails; the app still works,
    // and every alert is still in the bell (the in-app inbox) and on the live screens.
    const push = plugin<PushApi>("PushNotifications");
    const link = plugin<{ pushReady: () => Promise<{ ready: boolean }> }>("ServerLink");
    if (push) {
      void (async () => {
        try {
          // A build without a Firebase config would crash on register(), so ask first.
          if (link && !(await link.pushReady()).ready) return;
          await push.createChannel?.({ id: "orders", name: "Orders and deliveries", importance: 5, vibration: true });
          // Listeners first: a tap that opened the app from a closed state is delivered as soon as one exists.
          keep(
            push.addListener("pushNotificationActionPerformed", (a: never) => {
              openFromPush(router, (a as { notification?: { data?: PushData } }).notification?.data);
            }),
          );
          keep(
            push.addListener("registration", (t: never) => {
              const token = (t as { value: string }).value;
              savePushToken(token);
              void api.post("/devices", { token, platform: nativePlatform(), appVersion: undefined }).catch(() => undefined);
            }),
          );
          keep(push.addListener("registrationError", () => undefined));
          keep(
            push.addListener("pushNotificationReceived", () => {
              // App open: Android shows no system notification. When the live socket is up the bell has
              // already rung for this event, so only refresh; otherwise ring here so it is never silent.
              void qc.invalidateQueries({ queryKey: ["notifications"] });
              if (getRealtimeState() !== "live") {
                haptic("heavy");
                playNotificationFeedback();
                void qc.invalidateQueries({ queryKey: ["orders"] });
                void qc.invalidateQueries({ queryKey: ["kds"] });
              }
            }),
          );
          const perm = await push.requestPermissions();
          if (perm.receive !== "granted") return; // denied: alerts stay in the bell and on screen
          await push.register();
        } catch {
          // push not configured on this build or server
        }
      })();
    }

    // Phone network state. The server itself can still be down with WiFi up: that is the live socket's job.
    const net = plugin<{
      getStatus: () => Promise<{ connected: boolean }>;
      addListener: PushApi["addListener"];
    }>("Network");
    void net?.getStatus().then((s) => setNetwork(s.connected)).catch(() => undefined);
    keep(net?.addListener("networkStatusChange", (s: never) => setNetwork((s as { connected: boolean }).connected)));

    // Coming back to the app: send anything waiting (the live socket refreshes the screens itself).
    const app = plugin<{ addListener: PushApi["addListener"] }>("App");
    keep(
      app?.addListener("appStateChange", (s: never) => {
        if ((s as { isActive: boolean }).isActive && outbox.count() > 0) void retryNow();
      }),
    );

    return () => {
      alive = false;
      subs.forEach((s) => s.remove());
    };
  }, [qc, router]);

  if (!isNativeApp()) return null;

  const retry = async () => {
    setBusy(true);
    try {
      await retryNow();
      await qc.invalidateQueries();
    } finally {
      setBusy(false);
    }
  };
  const secs = retryAt > 0 ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  const saved = waiting > 0 ? `${waiting} update${waiting === 1 ? "" : "s"} saved on this phone, not yet on the server.` : "";

  let tone: "dark" | "warn" | "ok" | null = null;
  let icon = WifiOff;
  let title = "";
  let detail = "";
  let canRetry = false;
  if (!network) {
    tone = "dark";
    title = "No WiFi or mobile data";
    detail = `Screens may be out of date. ${saved}`.trim();
  } else if (serverDown) {
    tone = "dark";
    icon = CloudOff;
    title = "Can't reach the restaurant server";
    detail = `${saved} ${secs > 0 ? `Trying again in ${secs}s.` : "Trying again…"} If it stays down, check the restaurant computer is on.`.trim();
    canRetry = true;
  } else if (waiting > 0) {
    tone = "warn";
    icon = RefreshCw;
    title = secs > 0 ? "Updates waiting to send" : "Sending saved updates…";
    detail = `${saved}${secs > 0 ? ` Next try in ${secs}s.` : ""}`;
    canRetry = secs > 0;
  } else if (restored && !trouble) {
    tone = "ok";
    icon = CheckCircle2;
    title = restored;
  }

  return (
    // Sits just above the phone bottom bar (h-16 + safe area) so it never hides navigation; at lg the bar is gone.
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 flex flex-col gap-px lg:bottom-[env(safe-area-inset-bottom)]">
      {refused.length > 0 && (
        <div role="alert" className="flex items-start gap-3 bg-destructive px-4 py-3 text-sm text-white">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">The server did not accept {refused.length === 1 ? "an update" : `${refused.length} updates`}</p>
            <p className="mt-0.5 opacity-90">{refused.join(" · ")}. Another screen probably changed it first; check the item and try again.</p>
          </div>
          <button type="button" onClick={() => outbox.clearRefused()} className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md" aria-label="Dismiss">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      )}
      {others > 0 && !tone && (
        <div role="status" className="bg-muted px-4 py-2.5 text-sm text-foreground">
          {others} update{others === 1 ? "" : "s"} from another account on this phone will be sent when that person signs in again.
        </div>
      )}
      {tone && (
        <div
          role="status"
          aria-live="polite"
          className={
            tone === "ok"
              ? "flex items-center gap-3 bg-emerald-700 px-4 py-3 text-sm text-white"
              : tone === "warn"
                ? "flex items-center gap-3 bg-amber-100 px-4 py-3 text-sm text-amber-950 dark:bg-amber-900 dark:text-amber-50"
                : "flex items-center gap-3 bg-foreground px-4 py-3 text-sm text-background"
          }
        >
          {(() => {
            const Icon = icon;
            return <Icon className="h-5 w-5 shrink-0" aria-hidden />;
          })()}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{title}</p>
            {detail && <p className="mt-0.5 opacity-90">{detail}</p>}
          </div>
          {canRetry && (
            <button
              type="button"
              onClick={() => void retry()}
              disabled={busy}
              className="min-h-11 shrink-0 rounded-md border border-current px-3 text-sm font-semibold disabled:opacity-60"
            >
              {busy ? "Trying…" : "Retry now"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
