import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ROLE_PERMISSIONS } from "@nodedr-restaurant/types";
import { canOpen, firstAllowedHref, requiredPermissionFor } from "./route-access.ts";

const routes = [
  { href: "/dashboard", permission: "dashboard.sales.view" },
  { href: "/pos", permission: "orders.create" },
  { href: "/tables", permission: "tables.view" },
  { href: "/menu", permission: "menu.view" },
  { href: "/kds", permission: "kds.manage" },
  { href: "/attendance" },
];

test("dashboard needs dashboard.sales.view, including sub-paths", () => {
  assert.equal(requiredPermissionFor("/dashboard", routes), "dashboard.sales.view");
  assert.equal(requiredPermissionFor("/dashboard/x", routes), "dashboard.sales.view");
  assert.equal(requiredPermissionFor("/dashboardish", routes), undefined);
});

test("default waiter: menu, tables, POS — not the dashboard", () => {
  const held = DEFAULT_ROLE_PERMISSIONS.WAITER;
  assert.equal(canOpen("/menu", held, routes), true);
  assert.equal(canOpen("/tables", held, routes), true);
  assert.equal(canOpen("/pos", held, routes), true);
  assert.equal(canOpen("/dashboard", held, routes), false);
  assert.equal(firstAllowedHref(held, routes), "/pos");
});

test("only the four default roles open the dashboard", () => {
  const allowed = Object.entries(DEFAULT_ROLE_PERMISSIONS)
    .filter(([, perms]) => canOpen("/dashboard", perms, routes))
    .map(([role]) => role)
    .sort();
  assert.deepEqual(allowed, ["ACCOUNTANT", "ADMINISTRATOR", "CASHIER", "OWNER"]);
});

test("kitchen staff are sent to the KDS, not the dashboard", () => {
  assert.equal(firstAllowedHref(DEFAULT_ROLE_PERMISSIONS.KITCHEN_STAFF, routes), "/kds");
});

test("a manage permission implies its view permission", () => {
  assert.equal(canOpen("/menu", ["menu.manage"], routes), true);
  assert.equal(canOpen("/tables", ["tables.manage"], routes), true);
  assert.equal(canOpen("/menu", ["tables.manage"], routes), false);
});
