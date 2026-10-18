#!/usr/bin/env python3
"""UI check of table switching, cancel, bill edit and the printer card (Playwright, Python).

Needs a running backend + web on a migrated + seeded database (see kiosk_flow.py).

  STAFF_URL=http://localhost:3100 SHOTS=./bill-shots python3 e2e/bill_flow.py

Exit code is non-zero if any assertion fails. Screenshots land in $SHOTS at
375 / 768 / 1440 px wide.
"""
import os
import re
import sys
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

STAFF = os.environ.get("STAFF_URL", "http://localhost:3100")
SHOTS = Path(os.environ.get("SHOTS", "./bill-shots"))
EMAIL = os.environ.get("STAFF_EMAIL", "owner@demo.local")
PASSWORD = os.environ.get("STAFF_PASSWORD", "Password123!")
BRANCH = "demo-branch"
SHOTS.mkdir(parents=True, exist_ok=True)
tag = uuid.uuid4().hex[:5]
results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def panel_fits(page, label):
    """The checkout panel must not scroll sideways inside its card."""
    bad = page.evaluate("""() => [...document.querySelectorAll('.overflow-y-auto')]
      .filter(e => e.scrollWidth - e.clientWidth > 1).map(e => e.className.slice(0, 60))""")
    check(f"{label}: no panel scrolls sideways", not bad, str(bad))


def no_overflow(page, label):
    over = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check(f"{label}: no horizontal scroll", over <= 1, f"overflow={over}")


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.goto(f"{STAFF}/login")
    page.locator("#email").fill(EMAIL)
    page.locator('input[type="password"]').first.fill(PASSWORD)
    page.locator("form button[type=submit]").click()
    page.wait_for_url(re.compile(r"/dashboard"), timeout=20000)

    api = ctx.request

    def post(path, body):
        r = api.post(f"{STAFF}/api/v1{path}?branchId={BRANCH}", data=body)
        assert r.ok, (path, r.status, r.text())
        return r.json()

    def get(path):
        r = api.get(f"{STAFF}/api/v1{path}{'&' if '?' in path else '?'}branchId={BRANCH}")
        assert r.ok, (path, r.status, r.text())
        return r.json()

    floor = get("/tables/floors")[0]["id"]
    t1 = post("/tables", {"floorId": floor, "number": f"U1-{tag}", "name": f"UI One {tag}", "capacity": 4})
    t2 = post("/tables", {"floorId": floor, "number": f"U2-{tag}", "name": f"UI Two {tag}", "capacity": 4})
    cat = get("/menu/categories")[0]["id"]
    item = post("/menu/items", {"categoryId": cat, "name": f"UICurry {tag}", "price": 150, "taxRatePercent": 0})
    item2 = post("/menu/items", {"categoryId": cat, "name": f"UINaan {tag}", "price": 50, "taxRatePercent": 0})
    order = post("/orders", {"type": "DINE_IN", "tableId": t1["id"], "items": [
        {"menuItemId": item["id"], "quantity": 2, "modifierIds": []},
        {"menuItemId": item2["id"], "quantity": 1, "modifierIds": []},
    ]})

    # --- table 1 shows its bill; table 2 is empty; switching never hides it ---
    page.goto(f"{STAFF}/pos?tableId={t1['id']}")
    expect(page.get_by_text(f"#{order['orderNumber']}").first).to_be_visible(timeout=15000)
    check("Table 1 shows its open bill", True, order["orderNumber"])
    page.screenshot(path=str(SHOTS / "pos-table1-1440.png"))

    def pick_table(name):
        page.get_by_role("combobox").filter(has_text=re.compile(r"UI (One|Two)")).click()
        page.get_by_role("option", name=re.compile(re.escape(name))).click()

    # put an item in the cart for table 1, then switch away and back
    page.get_by_text(f"UICurry {tag}").first.click()
    expect(page.get_by_text("Cart is empty")).to_have_count(0)
    pick_table(f"UI Two {tag}")
    expect(page.get_by_text("Cart is empty")).to_be_visible(timeout=10000)
    check("Table 1's unsent cart does not follow to Table 2", True)
    expect(page.get_by_text(f"#{order['orderNumber']}")).to_have_count(0)
    check("Table 2 does not show Table 1's bill", True)
    page.screenshot(path=str(SHOTS / "pos-table2-1440.png"))
    pick_table(f"UI One {tag}")
    expect(page.get_by_text(f"#{order['orderNumber']}").first).to_be_visible(timeout=10000)
    expect(page.get_by_text("Cart is empty")).to_have_count(0)
    check("back on Table 1: bill and its cart are both still there", True)

    # --- edit the bill from the checkout panel -------------------------------
    page.get_by_role("button", name="View & pay").click()
    panel_fits(page, "checkout panel 1440px")
    page.get_by_role("button", name="Edit bill").click()
    dlg = page.get_by_role("dialog")
    expect(dlg.get_by_text(f"UINaan {tag}")).to_be_visible(timeout=10000)
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / "edit-bill-1440.png"))
    dlg.get_by_role("button", name=f"One fewer UICurry {tag}").click()
    expect(dlg.get_by_text("1× " + f"UICurry {tag}")).to_be_visible(timeout=10000)
    expect(dlg.get_by_text(re.compile(r"200\.00|₹\s?200|200"))).to_be_visible()
    check("lowering a quantity updates the line and total", True)
    dlg.get_by_role("button", name=f"Remove UINaan {tag}").click()
    dlg.get_by_label(re.compile("Reason")).fill("guest changed mind")
    dlg.get_by_role("button", name="Remove item").click()
    expect(dlg.get_by_role("button", name=f"Remove UINaan {tag}")).to_have_count(0, timeout=10000)
    expect(dlg.get_by_text(re.compile(r"UINaan .* removed from the bill"))).to_be_visible()
    check("removing a line (with a reason) works and says so", True)
    page.keyboard.press("Escape")

    # --- cancel through the in-app dialog (not window.confirm) ---------------
    page.get_by_role("button", name="Cancel order").click()
    dlg = page.get_by_role("dialog")
    expect(dlg.get_by_text(re.compile("Cancel order #"))).to_be_visible()
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / "cancel-dialog-1440.png"))
    expect(dlg.get_by_role("button", name="Cancel order")).to_be_disabled()
    dlg.get_by_label("Reason").fill("Guest left")
    dlg.get_by_role("button", name="Cancel order").click()
    expect(page.get_by_text(re.compile(r"Order #\S+ was cancelled"))).to_be_visible(timeout=10000)
    page.screenshot(path=str(SHOTS / "cancelled-result-1440.png"))
    check("cancel confirms in-app and shows a visible result", True)
    page.get_by_role("button", name="Done").click()
    detail = get(f"/orders/{order['id']}")
    check("server: order CANCELLED with reason", detail["status"] == "CANCELLED" and detail["cancelReason"] == "Guest left")
    floors = get("/tables/floors")
    status = {t["id"]: t["status"] for f in floors for t in f["tables"]}
    check("server: table released", status[t1["id"]] == "AVAILABLE", status[t1["id"]])

    # --- printer settings card ----------------------------------------------
    page.goto(f"{STAFF}/settings")
    page.get_by_text("Thermal printer").first.wait_for(timeout=15000)
    page.get_by_role("radio", name="Network (IP address)").scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / "printer-card-1440.png"))
    expect(page.get_by_role("button", name="Test kitchen ticket")).to_be_visible()
    check("printer card offers network mode and a kitchen test print", True)

    # --- responsive: 375 / 768 --------------------------------------------------
    order2 = post("/orders", {"type": "DINE_IN", "tableId": t2["id"], "items": [
        {"menuItemId": item["id"], "quantity": 1, "modifierIds": []}]})
    for w, h in ((375, 812), (768, 1024)):
        page.set_viewport_size({"width": w, "height": h})
        page.goto(f"{STAFF}/pos?tableId={t2['id']}")
        page.get_by_role("button", name=re.compile(r"Open bill #")).wait_for(timeout=15000)
        no_overflow(page, f"pos {w}px")
        page.screenshot(path=str(SHOTS / f"pos-{w}.png"))
        page.get_by_role("button", name=re.compile(r"Open bill #")).click()
        expect(page.get_by_text(f"#{order2['orderNumber']}").first).to_be_visible(timeout=15000)
        page.get_by_role("button", name="View & pay").click()
        panel_fits(page, f"checkout panel {w}px")
        page.get_by_role("button", name="Edit bill").click()
        expect(page.get_by_role("dialog")).to_be_visible()
        no_overflow(page, f"edit dialog {w}px")
        page.wait_for_timeout(500)
        clipped = page.evaluate("""() => {
          const d = document.querySelector('[role=dialog]');
          const box = d.getBoundingClientRect();
          return [...d.querySelectorAll('input,select,button')].filter(e => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1);
          }).length;
        }""")
        check(f"edit dialog {w}px: no control sticks out of the dialog", clipped == 0, str(clipped))
        page.screenshot(path=str(SHOTS / f"edit-bill-{w}.png"))
        page.keyboard.press("Escape")
        page.goto(f"{STAFF}/settings")
        page.get_by_text("Thermal printer").first.wait_for(timeout=15000)
        no_overflow(page, f"settings {w}px")

    browser.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
