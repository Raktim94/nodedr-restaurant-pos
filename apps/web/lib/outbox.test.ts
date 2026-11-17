import { test } from "node:test";
import assert from "node:assert/strict";
import { flushOutbox, outbox, setOutboxUser } from "./outbox.ts";

test("offline changes remain owned across shared-terminal sign-ins", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalFetch = globalThis.fetch;
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  } } });
  try {
    const sent: string[] = [];
    globalThis.fetch = async (url) => {
      sent.push(String(url));
      setOutboxUser("bob");
      return new Response("{}", { status: 200 });
    };
    const update = (path: string) => ({ method: "PATCH" as const, path, body: {}, label: path, group: "same-ticket" });
    assert.equal(outbox.add(update("/signed-out")), false);
    data.set("orderrestro.outbox.v1", JSON.stringify([{ ...update("/legacy"), key: "old", at: 1 }]));
    setOutboxUser("alice");
    assert.equal(outbox.count(), 0, "unowned legacy writes must not be adopted by a new account");
    outbox.add(update("/alice"));
    setOutboxUser("bob");
    outbox.add(update("/bob"));
    assert.deepEqual(outbox.owned().map((item) => item.path), ["/bob"]);
    assert.equal(outbox.all().length, 3, "Bob's coalesced update must preserve Alice's");
    setOutboxUser("alice");
    outbox.add({ ...update("/alice-second"), group: "other-ticket" });
    const result = await flushOutbox();
    assert.equal(result.sent, 1);
    assert.deepEqual(sent, ["/api/v1/alice"], "a flush must stop before sending the next operation after identity changes");
    assert.equal(outbox.all().some((item) => item.path === "/alice-second"), true);
    setOutboxUser(null);
    const signedOut = await flushOutbox();
    assert.equal(signedOut.sent, 0);
  } finally {
    setOutboxUser(null);
    globalThis.fetch = originalFetch;
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
