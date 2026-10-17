import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeScan, orderQrPayload } from "./scan.ts";

test("round-trips the order QR payload the kiosk ticket prints", () => {
  assert.deepEqual(normalizeScan(orderQrPayload("20261017-0042")), {
    kind: "order",
    orderNumber: "20261017-0042",
  });
});

test("tolerates the CR/LF and whitespace a keyboard-wedge scanner appends", () => {
  assert.deepEqual(normalizeScan("  orderrestro:order:20261017-0042\r\n"), {
    kind: "order",
    orderNumber: "20261017-0042",
  });
  assert.deepEqual(normalizeScan("\u0002ta-demo-0001\u0003\n"), {
    kind: "order",
    orderNumber: "TA-DEMO-0001",
  });
});

test("recognises a table QR url", () => {
  const token = "a".repeat(32);
  assert.deepEqual(normalizeScan(`https://example.com/order/${token}`), {
    kind: "table",
    qrToken: token,
  });
});

test("rejects empty, oversized and unknown payloads instead of guessing", () => {
  assert.deepEqual(normalizeScan("   \r\n"), { kind: "invalid", reason: "empty" });
  assert.deepEqual(normalizeScan("x".repeat(500)), { kind: "invalid", reason: "unrecognized" });
  assert.deepEqual(normalizeScan("hello world"), { kind: "invalid", reason: "unrecognized" });
  assert.deepEqual(normalizeScan("https://evil.example/order/short"), {
    kind: "invalid",
    reason: "unrecognized",
  });
  assert.deepEqual(normalizeScan("orderrestro:order:<script>"), {
    kind: "invalid",
    reason: "unrecognized",
  });
});
