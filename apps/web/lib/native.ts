// Helpers for when the web app runs inside the OrderRestro Android / iOS app
// (Capacitor). In a normal browser every function here is a quiet no-op, so
// nothing depends on the app being present. The Capacitor bridge puts the
// native plugins on window.Capacitor.Plugins, which is why this file needs no
// npm packages.

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, Record<string, (...a: never[]) => Promise<unknown>>>;
}

function cap(): CapacitorGlobal | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNativeApp(): boolean {
  return !!cap()?.isNativePlatform?.();
}

export function nativePlatform(): "ANDROID" | "IOS" | null {
  const p = cap()?.getPlatform?.();
  return p === "android" ? "ANDROID" : p === "ios" ? "IOS" : null;
}

export function plugin<T = Record<string, (...a: unknown[]) => Promise<unknown>>>(name: string): T | null {
  const p = cap()?.Plugins?.[name];
  return (p as unknown as T) ?? null;
}

/** Short vibration for a new order or delivery. */
export function haptic(kind: "light" | "heavy" = "heavy") {
  const h = plugin<{ impact: (o: { style: string }) => Promise<void>; vibrate: (o: { duration: number }) => Promise<void> }>("Haptics");
  if (!h) return;
  void (kind === "heavy" ? h.vibrate({ duration: 400 }) : h.impact({ style: "LIGHT" })).catch(() => undefined);
}

/** Switch this phone to another restaurant server (shows the connect screen). */
export function changeServer() {
  void plugin<{ forget: () => Promise<void> }>("ServerLink")?.forget();
}

const PUSH_TOKEN_KEY = "orderrestro.pushToken";

export function savedPushToken(): string | null {
  try {
    return window.localStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}
export function savePushToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(PUSH_TOKEN_KEY, token);
    else window.localStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {
    // storage blocked: push still works, it just re-registers next launch
  }
}

interface OrderRestroNativeBridge {
  saveFile?: (name: string, mime: string, base64: string) => boolean;
}

/**
 * Saves a file the page just made. In the OrderRestro Android app a blob: link cannot be downloaded by the web
 * view, so the bytes go to the app, which puts the file in Downloads. Returns false in a normal browser (use the
 * usual link download there) or when the app could not save it.
 */
export async function saveFileInApp(name: string, blob: Blob): Promise<boolean> {
  const bridge = typeof window === "undefined" ? undefined : (window as unknown as { OrderRestroNative?: OrderRestroNativeBridge }).OrderRestroNative;
  if (!bridge?.saveFile) return false;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return !!bridge.saveFile(name, blob.type || "application/octet-stream", btoa(binary));
  } catch {
    return false;
  }
}
