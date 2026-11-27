import assert from "node:assert/strict";
import { test } from "node:test";
import { createStaffFormat, formatCurrency } from "./format.ts";
import { LOCALE_TAGS } from "./i18n/locales.ts";

test("a staff screen waiting for settings never displays another restaurant's currency", () => {
  const current = createStaffFormat(LOCALE_TAGS.en, (key) => key, "BRL");
  const loading = createStaffFormat(LOCALE_TAGS.en, (key) => key);
  assert.equal(current.currency(25), "R$25.00");
  assert.equal(loading.currency(25), "—");
});

test("guest prices follow the selected language and the restaurant currency", () => {
  assert.match(formatCurrency(25, "BRL", LOCALE_TAGS.pt), /^R\$\s25,00$/);
  assert.match(formatCurrency(25, "EUR", LOCALE_TAGS.it), /^25,00\s€$/);
  assert.match(formatCurrency(25, "CHF", LOCALE_TAGS.it), /^25,00\sCHF$/);
  assert.equal(formatCurrency(25, "BRL", LOCALE_TAGS.en), "R$25.00");
  assert.match(formatCurrency(25, "EUR", LOCALE_TAGS.pt), /^€\s25,00$/);
  assert.match(formatCurrency(25, "EUR", LOCALE_TAGS.es), /^25,00\s€$/);
  assert.match(formatCurrency(25, "EUR", LOCALE_TAGS.fr), /^25,00\s€$/);
});

test("staff prices use the current restaurant currency unless a record supplies its own", () => {
  const pt = createStaffFormat(LOCALE_TAGS.pt, (key) => key, "BRL");
  const fr = createStaffFormat(LOCALE_TAGS.fr, (key) => key, "EUR");
  assert.match(pt.currency(25), /^R\$\s25,00$/);
  assert.match(fr.currency(25), /^25,00\s€$/);
  assert.match(pt.currency(25, "EUR"), /^€\s25,00$/);
});

test("staff prices, report numbers and calendar days follow each active locale independently", () => {
  const pt = createStaffFormat(LOCALE_TAGS.pt, (key) => key);
  const en = createStaffFormat(LOCALE_TAGS.en, (key) => key);
  assert.match(pt.currency("1234.5", "BRL"), /^R\$\s1\.234,50$/);
  assert.equal(en.currency("1234.5", "BRL"), "R$1,234.50");
  assert.equal(pt.number(1234.5, 2), "1.234,50");
  assert.equal(en.number(1234.5, 2), "1,234.50");
  assert.equal(pt.percent(12.5, 2), "12,50%");
  assert.equal(en.percent(12.5, 2), "12.50%");
  assert.equal(pt.day("2026-11-05"), "05/11/2026");
  assert.equal(pt.day("2026-11-05T00:00:00.000Z"), "05/11/2026");
  assert.equal(en.day("2026-11-05", { month: "long" }), "November");
});

test("staff role labels translate seeded roles and preserve custom labels and names", () => {
  const fmt = createStaffFormat("pt-BR", (key) => key === "Owner" ? "Proprietário" : key);
  assert.equal(fmt.role("OWNER", "OWNER"), "Proprietário");
  assert.equal(fmt.role("SHIFT_HOST", "Owner"), "Owner");
  assert.equal(fmt.role("SHIFT_HOST"), "SHIFT_HOST");
  assert.equal(fmt.role(undefined), "");
});

test("predefined status formatting treats an unfamiliar code as text", () => {
  const fmt = createStaffFormat("en-GB", (label) => label);
  assert.equal(fmt.code("TEST_OK"), "Test passed");
  assert.equal(fmt.code("constructor"), "Constructor");
});

test("inventory display preserves decimal precision and recognizes only fixed stock units", () => {
  const fmt = createStaffFormat("pt-BR", (label) => label === "pcs" ? "un." : label);
  assert.equal(fmt.quantity("1.2500"), "1,2500");
  assert.equal(fmt.quantity("0.000125"), "0,000125");
  assert.equal(fmt.quantity(null), "");
  assert.equal(fmt.unit("PIECE"), "un.");
  assert.equal(fmt.unit("KG"), "kg");
  assert.equal(fmt.unit("house scoop"), "house scoop");
});
