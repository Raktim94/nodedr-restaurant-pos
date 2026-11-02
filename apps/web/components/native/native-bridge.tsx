"use client";

import { useQueryClient } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { haptic, isNativeApp, nativePlatform, plugin, savePushToken } from "@/lib/native";
import { flushOutbox, outbox } from "@/lib/outbox";

interface PushApi {
  requestPermissions: () => Promise<{ receive: string }>;
  register: () => Promise<void>;
  createChannel?: (c: { id: string; name: string; importance: number; sound?: string; vibration?: boolean }) => Promise<void>;
  addListener: (ev: string, fn: (d: never) => void) => Promise<{ remove: () => void }>;
}

/**
 * Mounted once for every signed-in screen. Does nothing in a normal browser.
 * Inside the phone app it registers for push, shows a banner while offline,
 * sends queued updates when the connection returns and opens the right screen
 * when a notification is tapped.
 */
export function NativeBridge() {
  const router = useRouter();
  const qc = useQueryClient();
  const { resolvedTheme } = useTheme();
  const [online, setOnline] = useState(true);
  const waiting = useSyncExternalStore(outbox.subscribe, outbox.count, () => 0);

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

    // Status bar over the app's own header colour.
    void plugin<{ setStyle: (o: { style: string }) => Promise<void> }>("StatusBar")?.setStyle({ style: "DEFAULT" }).catch(() => undefined);

    // Push notifications. Without a Firebase project the register call fails; the app still works.
    const push = plugin<PushApi>("PushNotifications");
    const link = plugin<{ pushReady: () => Promise<{ ready: boolean }> }>("ServerLink");
    if (push) {
      void (async () => {
        try {
          // A build without a Firebase config would crash on register(), so ask first.
          if (link && !(await link.pushReady()).ready) return;
          await push.createChannel?.({ id: "orders", name: "Orders and deliveries", importance: 5, vibration: true });
          const perm = await push.requestPermissions();
          if (perm.receive !== "granted") return;
          keep(
            push.addListener("registration", (t: never) => {
              const token = (t as { value: string }).value;
              savePushToken(token);
              void api
                .post("/devices", { token, platform: nativePlatform(), appVersion: undefined })
                .catch(() => undefined);
            }),
          );
          keep(push.addListener("registrationError", () => undefined));
          keep(
            push.addListener("pushNotificationReceived", () => {
              haptic("heavy");
              void qc.invalidateQueries();
            }),
          );
          keep(
            push.addListener("pushNotificationActionPerformed", (a: never) => {
              const path = (a as { notification?: { data?: { path?: string } } }).notification?.data?.path;
              if (path && path.startsWith("/")) router.push(path);
            }),
          );
          await push.register();
        } catch {
          // push not configured on this build or server
        }
      })();
    }

    // Connection state and queued updates.
    const net = plugin<{
      getStatus: () => Promise<{ connected: boolean }>;
      addListener: PushApi["addListener"];
    }>("Network");
    const apply = (connected: boolean) => {
      setOnline(connected);
      if (connected) {
        void flushOutbox().then(() => qc.invalidateQueries());
      }
    };
    void net?.getStatus().then((s) => apply(s.connected)).catch(() => undefined);
    keep(net?.addListener("networkStatusChange", (s: never) => apply((s as { connected: boolean }).connected)));

    // Coming back to the app: refresh everything and send anything waiting.
    const app = plugin<{ addListener: PushApi["addListener"] }>("App");
    keep(
      app?.addListener("appStateChange", (s: never) => {
        if ((s as { isActive: boolean }).isActive) {
          void flushOutbox().then(() => qc.invalidateQueries());
        }
      }),
    );

    return () => {
      alive = false;
      subs.forEach((s) => s.remove());
    };
  }, [qc, router]);

  if (!isNativeApp() || (online && waiting === 0)) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 flex items-center gap-2 bg-foreground px-4 py-2.5 text-sm text-background"
      style={{ paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))" }}
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>
        {!online ? "No connection to the restaurant server." : "Sending saved updates…"}
        {waiting > 0 ? ` ${waiting} update${waiting === 1 ? "" : "s"} saved on this phone.` : ""}
      </span>
    </div>
  );
}
