import assert from "node:assert/strict";
import { test } from "node:test";
import { loginSchema, registerSchema } from "@nodedr-restaurant/types";
import { formResolver } from "./form-validation.ts";

const options = { fields: {}, shouldUseNativeValidation: false };

test("invalid login values return errors for each field", async () => {
  const result = await formResolver(loginSchema)({ email: "x", password: "", totp: "1" }, undefined, options);
  assert.deepEqual(Object.keys(result.errors).sort(), ["email", "password", "totp"]);
});

test("signup validation keeps regional errors nested and returns normalized values on success", async () => {
  const resolve = formResolver(registerSchema);
  const values = {
    restaurantName: "Osteria", branchName: "Centro", ownerName: "Anna",
    email: "anna@example.com", password: "password",
    regionalSettings: { country: "", currency: "?", timezone: "", taxRegime: "EU_VAT" as const },
  };
  const invalid = await resolve(values, undefined, options);
  assert.deepEqual(Object.keys(invalid.errors.regionalSettings ?? {}).sort(), ["country", "currency", "timezone"]);

  const valid = await resolve({
    ...values,
    regionalSettings: { ...values.regionalSettings, country: "it", currency: "eur", timezone: "Europe/Rome" },
  }, undefined, options);
  assert.deepEqual(valid.errors, {});
  assert.deepEqual(valid.values.regionalSettings, { country: "IT", currency: "EUR", timezone: "Europe/Rome", taxRegime: "EU_VAT" });
});
