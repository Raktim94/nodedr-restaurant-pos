import assert from "node:assert/strict";
import { test } from "node:test";
import { retryDelay, shouldRetry } from "./backoff.ts";

test("backoff doubles from 2s and never exceeds 60s plus jitter", () => {
  const mid = () => 0.5; // no jitter
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 20].map((n) => retryDelay(n, mid)), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  for (let n = 0; n < 30; n++) {
    assert.ok(retryDelay(n, () => 0) >= 1400);
    assert.ok(retryDelay(n, () => 0.999999) <= 78000);
  }
});

test("jitter spreads retries", () => {
  assert.notEqual(retryDelay(3, () => 0), retryDelay(3, () => 0.99));
});

test("only failures that may succeed later are kept", () => {
  for (const s of [null, 401, 408, 429, 500, 502, 503, 504]) assert.equal(shouldRetry(s), true, String(s));
  for (const s of [400, 403, 404, 409, 422]) assert.equal(shouldRetry(s), false, String(s));
});
