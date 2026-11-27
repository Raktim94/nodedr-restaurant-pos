import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUpiUri } from "./upi.ts";

test("only INR bills can generate a UPI payment request", () => {
  const opts = { vpa: "cafe@upi", amount: 12.5 };
  assert.equal(buildUpiUri({ ...opts, currency: "BRL" }), null);
  assert.match(buildUpiUri({ ...opts, currency: "INR" }) ?? "", /am=12.50&cu=INR/);
});
