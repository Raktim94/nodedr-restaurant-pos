import assert from "node:assert/strict";
import { test } from "node:test";
import { findItemByCode, pushKey, type ScanBuffer } from "./pos-scan.ts";

const items = [
  { id: "a", isActive: true, barcode: "8901234567890", sku: null, stockIngredient: null },
  { id: "b", isActive: true, barcode: null, sku: "COLA-500", stockIngredient: null },
  { id: "c", isActive: true, barcode: null, sku: null, stockIngredient: { sku: "5449000000996" } },
  { id: "d", isActive: false, barcode: "000111", sku: null, stockIngredient: null },
];

test("matches menu barcode, menu SKU and linked ingredient SKU", () => {
  assert.equal(findItemByCode(items, "8901234567890")?.id, "a");
  assert.equal(findItemByCode(items, "cola-500\r\n")?.id, "b");
  assert.equal(findItemByCode(items, " 5449000000996 ")?.id, "c");
});

test("ignores archived items, empty input and unknown codes", () => {
  assert.equal(findItemByCode(items, "000111"), undefined);
  assert.equal(findItemByCode(items, ""), undefined);
  assert.equal(findItemByCode(items, "nope"), undefined);
  assert.equal(findItemByCode(undefined, "a"), undefined);
});

function type(text: string, gap: number, start = 1000) {
  let buf: ScanBuffer = { text: "", last: 0 };
  let t = start;
  for (const ch of text) ({ buf } = pushKey(buf, ch, (t += gap)));
  return pushKey(buf, "Enter", (t += gap)).code;
}

test("a fast burst ending in Enter is a scan; slow typing is not", () => {
  assert.equal(type("8901234567890", 10), "8901234567890");
  assert.equal(type("8901234567890", 300), undefined);
  assert.equal(type("12", 10), undefined);
});
