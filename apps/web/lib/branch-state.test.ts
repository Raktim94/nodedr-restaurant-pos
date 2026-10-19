import assert from "node:assert/strict";
import { test } from "node:test";
import { branchViewState } from "./branch-state.ts";

test("still loading is never reported as no branch", () => {
  assert.equal(branchViewState({ isPending: true, isError: false, count: 0 }), "loading");
});

test("a failed request is an error, not no branch", () => {
  assert.equal(branchViewState({ isPending: false, isError: true, count: 0 }), "error");
  // react-query keeps isPending true for a query with no data that errored
  assert.equal(branchViewState({ isPending: true, isError: true, count: 0 }), "error");
});

test("only a loaded, empty list is no branch", () => {
  assert.equal(branchViewState({ isPending: false, isError: false, count: 0 }), "empty");
});

test("any branch means ready, even while refetching or after an error", () => {
  assert.equal(branchViewState({ isPending: false, isError: false, count: 1 }), "ready");
  assert.equal(branchViewState({ isPending: false, isError: true, count: 2 }), "ready");
});
