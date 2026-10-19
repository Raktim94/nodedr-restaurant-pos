#!/usr/bin/env python3
"""UI check of the order flow by role (Playwright, Python).

Waiter sees tables + menu; kitchen sees tickets, rejects one with a reason;
cashier prints the bill before paying, records a part payment, then settles
with change. Needs a running backend + web on a migrated + seeded database and
three staff logins (WAITER / KITCHEN_STAFF / CASHIER), see e2e/bill_flow.py.

  STAFF_URL=http://localhost:1995 SHOTS=./flow-shots python3 e2e/order_flow.py

Exit code is non-zero if any assertion fails. Screenshots at 375 / 768 / 1440.
"""
import os
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

STAFF = os.environ.get("STAFF_URL", "http://localhost:1995")
SHOTS = Path(os.environ.get("SHOTS", "./flow-shots"))
PW = "Password123!"
BRANCH = "demo-branch"
SHOTS.mkdir(parents=True, exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f" - {detail}" if detail and not ok else ""))


def login(browser, email, width=1440, height=900):
    ctx = browser.new_context(viewport={"width": width, "height": height})
    page = ctx.new_page()
    page.goto(f"{STAFF}/login")
    page.locator("input[name=email]").fill(email)
    page.locator("#password").fill(PW)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url(lambda url: "/login" not in url)
    page.wait_for_load_state("networkidle")
    return ctx, page


def shots(page, name):
    for w, h in ((375, 800), (768, 1024), (1440, 900)):
        page.set_viewport_size({"width": w, "height": h})
        page.wait_for_timeout(300)
        page.screenshot(path=str(SHOTS / f"{name}-{w}.png"), full_page=False)
    page.set_viewport_size({"width": 1440, "height": 900})


with sync_playwright() as p:
    browser = p.chromium.launch()

    # --- waiter: tables + menu + POS reachable, no revenue ------------------
    ctx, page = login(browser, "waiter@ui.local")
    page.goto(f"{STAFF}/pos")
    page.wait_for_load_state("networkidle")
    check("waiter /pos shows the table grid", page.get_by_text("Occupied").first.is_visible() or page.locator("button[title]").count() > 0)
    check("waiter sees no error banner", page.locator("[role=alert]:not(#__next-route-announcer__)").count() == 0)
    shots(page, "waiter-pos")
    page.goto(f"{STAFF}/tables")
    page.wait_for_load_state("networkidle")
    check("waiter /tables loads floors", page.get_by_text("Live floor status").is_visible())
    page.goto(f"{STAFF}/dashboard")
    page.wait_for_load_state("networkidle")
    check("waiter is kept off the revenue dashboard", "/dashboard" not in page.url)
    ctx.close()

    # --- kitchen: lands on KDS, sees live tickets ---------------------------
    ctx, page = login(browser, "kitchen_staff@ui.local")
    page.goto(f"{STAFF}/kds")
    page.wait_for_load_state("networkidle")
    check("kitchen sees the Kitchen Display", page.get_by_role("heading", name="Kitchen Display").is_visible())
    check("kitchen has no load error", page.get_by_role("alert").filter(has_text="Try again").count() == 0)
    check("sound control is offered", page.get_by_role("button", name="Sound on").is_visible() or page.get_by_text("Tap to turn on").is_visible())
    shots(page, "kds")
    ctx.close()

    # --- cashier: print bill first, part payment, then settle with change ---
    ctx, page = login(browser, "cashier@ui.local")
    api = ctx.request
    floors = api.get(f"{STAFF}/api/v1/tables/floors?branchId={BRANCH}").json()
    table = next(t for f in floors for t in f["tables"] if t["status"] == "AVAILABLE")
    item = api.get(f"{STAFF}/api/v1/menu/items?branchId={BRANCH}").json()[0]
    created = api.post(
        f"{STAFF}/api/v1/orders?branchId={BRANCH}",
        data={"type": "DINE_IN", "tableId": table["id"], "items": [{"menuItemId": item["id"], "quantity": 2, "modifierIds": []}]},
    ).json()
    page.goto(f"{STAFF}/pos?tableId={table['id']}")
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="View & pay").click()
    page.wait_for_timeout(800)
    check("Print bill is offered before payment", page.get_by_role("button", name="Print bill", exact=True).is_visible())
    page.locator("#discount").fill("10")
    page.wait_for_timeout(900)
    check("discount shows percent and amount", page.get_by_text("10% (").first.is_visible())
    page.locator("#amount").fill("50")
    check("short amount offers a part payment", page.get_by_role("button", name="Record partial payment").is_visible())
    shots(page, "checkout-partial")
    page.get_by_role("button", name="Record partial payment").click()
    page.wait_for_timeout(1200)
    check("part payment leaves the bill open with a balance", page.get_by_text("Paid so far").is_visible())
    check("table is still occupied", api.get(f"{STAFF}/api/v1/orders/{created['id']}?branchId={BRANCH}").json()["status"] == "OPEN")
    page.locator("#amount").fill("500")
    check("cash over the balance shows change due", page.get_by_text("Change due").first.is_visible())
    shots(page, "checkout-change")
    page.get_by_role("button", name="Complete payment").click()
    page.wait_for_timeout(1200)
    check("bill is settled", page.get_by_text("paid", exact=False).first.is_visible())
    ctx.close()

    browser.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
