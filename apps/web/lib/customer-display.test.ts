import { test } from "node:test";
import assert from "node:assert/strict";
import { publishDisplay, setDisplayTerminal } from "./customer-display.ts";

test("debounced customer state follows the selected terminal", async () => {
  const originalFetch = globalThis.fetch;
  const descriptors = ["localStorage", "BroadcastChannel"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  Object.defineProperty(globalThis, "BroadcastChannel", { configurable: true, value: undefined });
  try {
    const sent: { url: string; body: unknown }[] = [];
    let done: () => void = () => {};
    const completed = new Promise<void>((resolve) => { done = resolve; });
    globalThis.fetch = async (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      done();
      return new Response("{}", { status: 200 });
    };
    setDisplayTerminal({ id: "old", branchId: "branch-a" });
    publishDisplay({ kind: "paid", total: 100 });
    setDisplayTerminal({ id: "new", branchId: "branch-b" });
    publishDisplay({ kind: "paid", total: 200 });
    await completed;
    assert.deepEqual(sent, [{ url: "/api/v1/display/terminals/new/state?branchId=branch-b", body: { kind: "paid", total: 200 } }]);
  } finally {
    setDisplayTerminal(null);
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
