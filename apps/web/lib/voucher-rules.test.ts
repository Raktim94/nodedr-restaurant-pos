import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_RECIPES_FOR_PRODUCT, recipeState, unitProblem } from "./voucher-rules.ts";

test("the empty message is exactly the agreed wording", () => {
  assert.equal(NO_RECIPES_FOR_PRODUCT, "No saved recipes for this product yet");
});

test("no product chosen is never 'no recipes'", () => {
  assert.equal(recipeState({ hasProduct: false, isError: false, isSuccess: false, count: 0 }), "choose-product");
  assert.equal(recipeState({ hasProduct: false, isError: false, isSuccess: true, count: 0 }), "choose-product");
});

test("loading and failed requests are never 'no recipes'", () => {
  assert.equal(recipeState({ hasProduct: true, isError: false, isSuccess: false, count: 0 }), "loading");
  assert.equal(recipeState({ hasProduct: true, isError: true, isSuccess: false, count: 0 }), "error");
  // a stale success with an error on refetch is still an error, not an empty list
  assert.equal(recipeState({ hasProduct: true, isError: true, isSuccess: true, count: 0 }), "error");
});

test("empty only for a successful, genuinely empty product result", () => {
  assert.equal(recipeState({ hasProduct: true, isError: false, isSuccess: true, count: 0 }), "empty");
  assert.equal(recipeState({ hasProduct: true, isError: false, isSuccess: true, count: 2 }), "ready");
});

test("unit problems are readable and name the allowed units", () => {
  const flour = { name: "Flour", unit: "KG", units: ["KG", "G"] };
  assert.equal(unitProblem(flour, "G"), null);
  assert.equal(unitProblem(flour, ""), null);
  assert.equal(unitProblem(undefined, "L"), null);
  assert.match(unitProblem(flour, "L")!, /Flour is stocked in KG, so it cannot be entered in L\. Choose KG, G/);
});
