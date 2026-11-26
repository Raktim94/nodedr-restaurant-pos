import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPauseTime, menuPausesAt, withReportedMenuPauses, withReportedPauses } from "./menu-pauses.ts";

const noon = "2026-11-25T12:00:00.000Z";
const later = "2026-11-25T12:15:00.000Z";
const items = [
  { id: "soup", pausedUntil: noon },
  { id: "rice", pausedUntil: later },
  { id: "salad", pausedUntil: null },
  { id: "bread" },
];

test("each dish returns exactly at its own deadline while the menu stays open", () => {
  const before = menuPausesAt(items, Date.parse(noon) - 1);
  assert.deepEqual([...before.paused], [["soup", noon], ["rice", later]]);
  assert.equal(before.nextExpiry, Date.parse(noon));
  const atNoon = menuPausesAt(items, Date.parse(noon));
  assert.deepEqual([...atNoon.paused], [["rice", later]]);
  assert.equal(atNoon.nextExpiry, Date.parse(later));
  const after = menuPausesAt(items, Date.parse(later));
  assert.equal(after.paused.size, 0);
  assert.equal(after.nextExpiry, null);
});

test("guests see the restaurant's local date and time even across midnight UTC", () => {
  const when = "2026-11-26T02:05:00Z";
  const label = formatPauseTime(when, "pt-BR", "America/Sao_Paulo");
  assert.match(label, /25/);
  assert.match(label, /23:05/);
  assert.doesNotMatch(label, /02:05/);
});

test("an unconfigured or invalid restaurant timezone still gives an unambiguous return time", () => {
  for (const timezone of [undefined, "old setting"]) {
    const label = formatPauseTime(noon, "en-GB", timezone);
    assert.match(label, /12:00/);
    assert.match(label, /UTC/);
  }
});

test("a checkout conflict updates the reported deadlines in both menu shapes without a second request", () => {
  const items = [{ id: "pizza", pausedUntil: null, options: ["cheese"] }, { id: "salad", pausedUntil: later }];
  const reported = [{ id: "pizza", pausedUntil: noon }];
  const expected = [{ id: "pizza", pausedUntil: noon, options: ["cheese"] }, items[1]];
  assert.deepEqual(withReportedPauses(items, reported), expected);
  const menu = { categories: [{ id: "mains", items }] };
  assert.deepEqual(withReportedMenuPauses(menu, reported)?.categories[0].items, expected);
  assert.equal(items[0].pausedUntil, null);
});
