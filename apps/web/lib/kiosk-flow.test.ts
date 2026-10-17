import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initialKioskState,
  isBasketLocked,
  kioskReducer,
  type KioskAction,
  type KioskState,
} from "./kiosk-flow.ts";

const line = {
  menuItemId: "pizza",
  name: "Pizza",
  modifierIds: [],
  modifierLabel: "",
  unitPrice: 9,
};
const both = { dineIn: true, takeaway: true };
const confirmation = {
  orderNumber: "20261017-0001",
  createdAt: "2026-10-17T10:00:00Z",
  currency: "EUR",
  items: [{ name: "Pizza", quantity: 1, lineTotal: "9" }],
  subtotal: "9",
  taxAmount: "0.82",
  totalAmount: "9",
  paid: false as const,
};

const run = (actions: KioskAction[], from: KioskState = initialKioskState) =>
  actions.reduce(kioskReducer, from);

const atReview = () =>
  run([
    { type: "START", services: both },
    { type: "CHOOSE_SERVICE", serviceType: "TAKEAWAY" },
    { type: "ADD", line },
    { type: "GOTO", step: "review" },
  ]);

test("welcome -> service -> menu, and the service step is skipped when only one is configured", () => {
  assert.equal(run([{ type: "START", services: both }]).step, "service");
  const only = run([{ type: "START", services: { dineIn: false, takeaway: true } }]);
  assert.equal(only.step, "menu");
  assert.equal(only.serviceType, "TAKEAWAY");
});

test("cannot reach review with an empty basket", () => {
  const s = run([
    { type: "START", services: both },
    { type: "CHOOSE_SERVICE", serviceType: "DINE_IN" },
    { type: "GOTO", step: "review" },
  ]);
  assert.equal(s.step, "menu");
});

test("double-submit guard: a second SUBMIT_START while pending changes nothing", () => {
  const once = kioskReducer(atReview(), { type: "SUBMIT_START", newRequestId: "k1" });
  const twice = kioskReducer(once, { type: "SUBMIT_START", newRequestId: "k2" });
  assert.equal(twice.requestId, "k1");
  assert.deepEqual(twice, once);
});

test("retry after a network failure re-sends the same idempotency key", () => {
  let s = kioskReducer(atReview(), { type: "SUBMIT_START", newRequestId: "k1" });
  s = kioskReducer(s, { type: "SUBMIT_FAIL", kind: "network" });
  s = kioskReducer(s, { type: "SUBMIT_START", newRequestId: "k2" });
  assert.equal(s.requestId, "k1");
  assert.equal(s.submit.status, "pending");
});

test("after an ambiguous failure the basket is locked (no edits, no leaving review)", () => {
  let s = kioskReducer(atReview(), { type: "SUBMIT_START", newRequestId: "k1" });
  s = kioskReducer(s, { type: "SUBMIT_FAIL", kind: "server" });
  assert.equal(isBasketLocked(s), true);
  assert.deepEqual(kioskReducer(s, { type: "ADD", line }), s);
  assert.deepEqual(kioskReducer(s, { type: "REMOVE", key: s.basket[0].key }), s);
  assert.equal(kioskReducer(s, { type: "GOTO", step: "menu" }).step, "review");
});

test("a definite rejection (validation) unlocks editing and mints a new key", () => {
  let s = kioskReducer(atReview(), { type: "SUBMIT_START", newRequestId: "k1" });
  s = kioskReducer(s, { type: "SUBMIT_FAIL", kind: "validation", message: "Elige una opción" });
  assert.equal(isBasketLocked(s), false);
  s = kioskReducer(s, { type: "CHANGE_QTY", key: s.basket[0].key, delta: 1 });
  assert.equal(s.requestId, null);
  assert.equal(s.basket[0].quantity, 2);
});

test("success shows the confirmation, clears the basket, and keeps no key", () => {
  let s = kioskReducer(atReview(), { type: "SUBMIT_START", newRequestId: "k1" });
  s = kioskReducer(s, { type: "SUBMIT_OK", confirmation });
  assert.equal(s.step, "done");
  assert.equal(s.basket.length, 0);
  assert.equal(s.requestId, null);
  assert.equal(s.confirmation?.orderNumber, "20261017-0001");
  assert.equal(s.confirmation?.serviceType, "TAKEAWAY");
  // a late/duplicate success can't overwrite it
  assert.deepEqual(kioskReducer(s, { type: "SUBMIT_OK", confirmation }), s);
});

test("unavailable items are removed, the customer is told, and the flow returns to the menu", () => {
  let s = run([{ type: "ADD", line: { ...line, menuItemId: "cola", name: "Cola" } }], atReview());
  s = kioskReducer(s, { type: "SUBMIT_START", newRequestId: "k1" });
  s = kioskReducer(s, { type: "ITEMS_UNAVAILABLE", ids: ["pizza"], names: ["Pizza"] });
  assert.equal(s.step, "menu");
  assert.deepEqual(s.basket.map((l) => l.menuItemId), ["cola"]);
  assert.deepEqual(s.unavailableNames, ["Pizza"]);
  assert.equal(s.submit.status, "idle");
  assert.equal(s.requestId, null);
});

test("RESET leaves nothing of the previous guest behind", () => {
  let s = kioskReducer(atReview(), { type: "SUBMIT_START", newRequestId: "k1" });
  s = kioskReducer(s, { type: "SUBMIT_OK", confirmation });
  assert.deepEqual(kioskReducer(s, { type: "RESET" }), initialKioskState);
});
