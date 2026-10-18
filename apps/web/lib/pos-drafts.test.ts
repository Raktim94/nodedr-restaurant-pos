import assert from "node:assert/strict";
import { test } from "node:test";
import { clearDraft, switchTableDraft, type DraftLine } from "./pos-drafts.ts";

const L = (key: string, quantity = 1): DraftLine => ({ key, quantity });

test("items typed for Table 1 do not follow the user to Table 2", () => {
  const a = switchTableDraft({}, "t1", "t2", [L("dosa", 2)]);
  assert.deepEqual(a.lines, []);
  assert.deepEqual(a.drafts, { t1: [L("dosa", 2)] });
});

test("switching back restores each table's own draft", () => {
  const a = switchTableDraft({}, "t1", "t2", [L("dosa", 2)]);
  const b = switchTableDraft(a.drafts, "t2", "t1", [L("tea")]);
  assert.deepEqual(b.lines, [L("dosa", 2)]);
  assert.deepEqual(b.drafts, { t2: [L("tea")] });
});

test("a cart built before picking a table is carried onto it", () => {
  const a = switchTableDraft({}, "", "t1", [L("dosa")]);
  assert.deepEqual(a.lines, [L("dosa")]);
});

test("a carried cart merges with, and never overwrites, an existing draft", () => {
  const a = switchTableDraft({ t1: [L("dosa", 2), L("tea")] }, "", "t1", [L("dosa")]);
  assert.deepEqual(a.lines, [L("dosa", 3), L("tea")]);
});

test("same table is a no-op and does not mutate its inputs", () => {
  const drafts = { t1: [L("a")] };
  const lines = [L("b")];
  const r = switchTableDraft(drafts, "t2", "t2", lines);
  assert.equal(r.drafts, drafts);
  assert.equal(r.lines, lines);
  switchTableDraft(drafts, "t2", "t1", lines);
  assert.deepEqual(drafts, { t1: [L("a")] });
});

test("clearDraft drops only the sent table", () => {
  assert.deepEqual(clearDraft({ t1: [L("a")], t2: [L("b")] }, "t1"), { t2: [L("b")] });
});
