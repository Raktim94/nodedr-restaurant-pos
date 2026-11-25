import assert from "node:assert/strict";
import { test } from "node:test";
import { toInclusivePrice } from "./pricing-preview.ts";

test("EXCLUSIVE menus gross up prices for display only", () => {
  assert.equal(toInclusivePrice(100, 10, "EXCLUSIVE"), 110);
  assert.equal(toInclusivePrice(100, 0, "EXCLUSIVE"), 100);
  assert.equal(toInclusivePrice(100, 10, "INCLUSIVE"), 100);
  assert.equal(toInclusivePrice(99.99, 18, "EXCLUSIVE"), 117.99);
});
