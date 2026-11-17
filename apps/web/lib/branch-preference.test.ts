import { test } from "node:test";
import assert from "node:assert/strict";
import { readBranchPreference, saveBranchPreference } from "./branch-preference.ts";

test("branch selection works without browser storage", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      get localStorage() { throw new Error("Storage is blocked"); },
    } });
    assert.equal(readBranchPreference(), null);
    assert.doesNotThrow(() => saveBranchPreference("branch-1"));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
