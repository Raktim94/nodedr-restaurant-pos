import assert from "node:assert/strict";
import { test } from "node:test";
import { readStation, resolveStation, stationKey, writeStation, type KeyValueStorage } from "./kds-station.ts";

// A tiny in-memory localStorage that survives a simulated page reload because
// the same instance is handed to the "new page".
function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
const blocked: KeyValueStorage = {
  getItem() {
    throw new DOMException("denied", "SecurityError");
  },
  setItem() {
    throw new DOMException("denied", "SecurityError");
  },
  removeItem() {
    throw new DOMException("denied", "SecurityError");
  },
};

test("a chosen station survives a reload on the same device", () => {
  const storage = memoryStorage();
  assert.equal(writeStation(storage, "b1", "grill"), true);
  // "reload": a fresh reader over the same storage
  assert.deepEqual(readStation(storage, "b1"), { value: "grill", storageOk: true });
});

test("each branch keeps its own station and never leaks into another", () => {
  const storage = memoryStorage();
  writeStation(storage, "b1", "grill");
  writeStation(storage, "b2", "bar");
  assert.equal(readStation(storage, "b1").value, "grill");
  assert.equal(readStation(storage, "b2").value, "bar");
  assert.equal(readStation(storage, "b3").value, "");
  assert.equal(stationKey("b1"), "kds-station:b1");
});

test("choosing All stations clears the saved value", () => {
  const storage = memoryStorage();
  writeStation(storage, "b1", "grill");
  writeStation(storage, "b1", "");
  assert.equal(storage.data.size, 0);
  assert.equal(readStation(storage, "b1").value, "");
});

test("blocked or missing storage is reported, not thrown", () => {
  assert.deepEqual(readStation(blocked, "b1"), { value: "", storageOk: false });
  assert.equal(writeStation(blocked, "b1", "grill"), false);
  assert.deepEqual(readStation(null, "b1"), { value: "", storageOk: false });
  assert.equal(writeStation(null, "b1", "grill"), false);
});

test("a saved station is not trusted until the station list has loaded", () => {
  assert.deepEqual(resolveStation("grill", undefined), { active: "", stale: false, ready: false });
  assert.deepEqual(resolveStation("", undefined), { active: "", stale: false, ready: true });
});

test("a saved station that still exists is applied", () => {
  assert.deepEqual(resolveStation("grill", [{ id: "bar" }, { id: "grill" }]), {
    active: "grill",
    stale: false,
    ready: true,
  });
});

test("a deleted station falls back to all stations and is flagged", () => {
  assert.deepEqual(resolveStation("old", [{ id: "bar" }]), { active: "", stale: true, ready: true });
});

test("if the station list cannot load, the saved station is used instead of a blank board", () => {
  assert.deepEqual(resolveStation("grill", undefined, true), { active: "grill", stale: false, ready: true });
});
