import assert from "node:assert/strict";
import { test } from "node:test";
import { REALTIME_EVENTS, realtimeInvalidations } from "./realtime-keys.ts";

const keys = (event: string) => realtimeInvalidations(event, "b1").map((k) => k.join("/"));

test("order and table pushes refresh the per-table open bill cache", () => {
  for (const e of ["order.created", "order.updated", "order.deleted", "table.updated"]) {
    assert.ok(keys(e).includes("orders"), `${e} must refresh orders`);
  }
  assert.ok(keys("order.updated").includes("floors/b1"));
});

test("order pushes refresh the kitchen screen (incoming orders, cancelled/declined tickets)", () => {
  for (const e of ["order.created", "order.updated"]) {
    assert.ok(keys(e).includes("kds"), `${e} must refresh the kitchen screen`);
  }
});

test("kitchen pushes refresh the kitchen screen", () => {
  assert.ok(keys("kot.updated").includes("kds"));
  assert.ok(keys("kot.reprinted").includes("kds"));
});

test("every subscribed event maps to at least one cache", () => {
  for (const e of REALTIME_EVENTS) assert.ok(keys(e).length > 0, e);
  assert.deepEqual(keys("something.else"), []);
});
