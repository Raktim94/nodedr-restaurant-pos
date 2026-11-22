import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCurrency, setDefaultCurrency } from "./format.ts";

test("formatCurrency follows the configured default currency", () => {
  try {
    setDefaultCurrency("EUR");
    assert.match(formatCurrency(12.5), /€/);
    assert.doesNotMatch(formatCurrency(12.5), /₹/);
    setDefaultCurrency("not-a-code");
    assert.match(formatCurrency(12.5), /€/); // invalid codes are ignored
    assert.match(formatCurrency(12.5, "INR"), /₹/); // an explicit currency still wins
  } finally {
    setDefaultCurrency("INR");
  }
});
