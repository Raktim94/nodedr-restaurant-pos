import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_LINE_QUANTITY,
  addToBasket,
  basketCount,
  basketTotal,
  changeQuantity,
  lineKey,
  removeItems,
  toInclusiveUnitPrice,
  toOrderItems,
} from "./kiosk-basket.ts";

const pizza = {
  menuItemId: "pizza",
  name: "Margherita",
  modifierIds: ["cheese"],
  modifierLabel: "Extra cheese",
  unitPrice: 9.5,
};

test("same item + same options merges into one line; different options do not", () => {
  let b = addToBasket([], pizza);
  b = addToBasket(b, pizza);
  assert.equal(b.length, 1);
  assert.equal(b[0].quantity, 2);
  b = addToBasket(b, { ...pizza, modifierIds: ["thin"], modifierLabel: "Thin" });
  assert.equal(b.length, 2);
});

test("modifier order does not create a second line", () => {
  assert.equal(lineKey("a", ["x", "y"]), lineKey("a", ["y", "x"]));
});

test("quantity changes are bounded and reaching zero removes the line", () => {
  let b = addToBasket([], pizza);
  const key = b[0].key;
  b = changeQuantity(b, key, MAX_LINE_QUANTITY + 5);
  assert.equal(b[0].quantity, MAX_LINE_QUANTITY);
  b = changeQuantity(b, key, -MAX_LINE_QUANTITY);
  assert.equal(b.length, 0);
  assert.deepEqual(changeQuantity(b, "missing", -1), []);
});

test("totals round to cents without floating-point drift", () => {
  let b = addToBasket([], { ...pizza, unitPrice: 0.1, modifierIds: [] });
  b = changeQuantity(b, b[0].key, 2); // 3 x 0.10
  assert.equal(basketTotal(b), 0.3);
  assert.equal(basketCount(b), 3);
});

test("EXCLUSIVE menus gross up by tax, INCLUSIVE (Spain IVA default) does not", () => {
  assert.equal(toInclusiveUnitPrice(10, 10, "INCLUSIVE"), 10);
  assert.equal(toInclusiveUnitPrice(10, 10, "EXCLUSIVE"), 11);
  assert.equal(toInclusiveUnitPrice(10, 0, "EXCLUSIVE"), 10);
});

test("removing unavailable items drops every line of that item", () => {
  let b = addToBasket([], pizza);
  b = addToBasket(b, { ...pizza, modifierIds: [], modifierLabel: "" });
  b = addToBasket(b, { ...pizza, menuItemId: "cola", name: "Cola", modifierIds: [] });
  assert.deepEqual(
    removeItems(b, ["pizza"]).map((l) => l.menuItemId),
    ["cola"],
  );
});

test("order payload carries only ids and quantities, never prices", () => {
  const items = toOrderItems(addToBasket([], pizza));
  assert.deepEqual(items, [{ menuItemId: "pizza", quantity: 1, modifierIds: ["cheese"] }]);
});
