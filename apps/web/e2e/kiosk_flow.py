#!/usr/bin/env python3
"""End-to-end check of the customer kiosk + staff KDS handoff (Playwright, Python).

Needs: a running backend + web (e.g. `next dev`/`next start` proxying to the
backend), a migrated + seeded database (npx prisma migrate deploy && npx ts-node
prisma/seed.ts) and the kiosk switched on for the demo branch.

  KIOSK_URL=http://localhost:3100/kiosk/<token> \
  STAFF_URL=http://localhost:3100 SHOTS=./shots python3 e2e/kiosk_flow.py

Install once: pip install playwright && playwright install chromium
Exit code is non-zero if any assertion fails. Screenshots land in $SHOTS.
"""
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

KIOSK = os.environ["KIOSK_URL"]
STAFF = os.environ.get("STAFF_URL", KIOSK.split("/kiosk/")[0])
SHOTS = Path(os.environ.get("SHOTS", "./kiosk-shots"))
EMAIL = os.environ.get("STAFF_EMAIL", "owner@demo.local")
PASSWORD = os.environ.get("STAFF_PASSWORD", "Password123!")
SHOTS.mkdir(parents=True, exist_ok=True)

KIOSK_VIEWPORTS = {"kiosk-1920x1080": (1920, 1080), "kiosk-1280x720": (1280, 720)}
NARROW_VIEWPORTS = {"tablet-1024x600": (1024, 600), "portrait-768x1024": (768, 1024), "phone-390x844": (390, 844)}
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""))


def no_overflow(page, label):
    """No horizontal scroll and no control clipped by the right/bottom edge."""
    info = page.evaluate(
        """() => {
          const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
          const clipped = [];
          for (const el of document.querySelectorAll('button,input,[role=button],a[href]')) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            let p = el, scroller = false;
            while ((p = p.parentElement)) {
              const o = getComputedStyle(p).overflow + getComputedStyle(p).overflowX + getComputedStyle(p).overflowY;
              if (/auto|scroll/.test(o) && p !== document.body) { scroller = true; break; }
            }
            if (scroller) continue;
            if (r.right > vw + 1 || r.bottom > vh + 1 || r.left < -1 || r.top < -1)
              clipped.push((el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30));
          }
          return { sw: document.documentElement.scrollWidth, vw, sh: document.documentElement.scrollHeight, vh, clipped };
        }"""
    )
    check(f"{label}: no horizontal page scroll", info["sw"] <= info["vw"], f"scrollWidth={info['sw']} vw={info['vw']}")
    check(f"{label}: no accidental vertical page scroll", info["sh"] <= info["vh"] + 1, f"scrollHeight={info['sh']} vh={info['vh']}")
    check(f"{label}: no clipped controls", not info["clipped"], ", ".join(info["clipped"]))


def small_targets(page, label):
    bad = page.evaluate(
        """() => [...document.querySelectorAll('button,input,[role=button]')].filter(el => {
              const r = el.getBoundingClientRect();
              return r.width && r.height && (r.height < 47.5 || r.width < 47.5) && getComputedStyle(el).visibility !== 'hidden';
           }).map(el => `${(el.textContent||el.getAttribute('aria-label')||el.tagName).trim().slice(0,24)} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`)"""
    )
    check(f"{label}: touch targets >= 48px", not bad, "; ".join(bad[:5]))


def start_order(page):
    page.goto(KIOSK)
    page.get_by_role("button", name="Toca la pantalla para empezar").click()
    page.get_by_role("button", name="Para llevar").click()
    page.get_by_placeholder("Buscar en la carta").wait_for()


def add(page, name):
    page.get_by_role("button", name=re.compile(rf"Añadir {re.escape(name)}")).click()


with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # ---------------- 1. full customer flow at the kiosk size ---------------
    for label, (w, h) in KIOSK_VIEWPORTS.items():
        ctx = browser.new_context(viewport={"width": w, "height": h}, has_touch=True, locale="en-GB")
        page = ctx.new_page()
        page.goto(KIOSK)
        page.get_by_role("button", name="Toca la pantalla para empezar").wait_for()
        no_overflow(page, f"{label} welcome")
        page.screenshot(path=str(SHOTS / f"{label}-1-welcome.png"))
        page.get_by_role("button", name="Toca la pantalla para empezar").click()
        page.get_by_role("button", name="Para llevar").wait_for()
        page.screenshot(path=str(SHOTS / f"{label}-2-service.png"))
        page.get_by_role("button", name="Para llevar").click()
        page.get_by_text("Todavía no has añadido nada").wait_for()
        no_overflow(page, f"{label} menu")
        small_targets(page, f"{label} menu")
        page.screenshot(path=str(SHOTS / f"{label}-3-menu.png"))
        ctx.close()

    ctx = browser.new_context(viewport={"width": 1920, "height": 1080}, has_touch=True, locale="en-GB")
    page = ctx.new_page()
    page.goto(KIOSK)
    page.get_by_role("button", name="Toca la pantalla para empezar").click()
    page.get_by_role("button", name="Comer aquí").click()
    page.get_by_text("Todavía no has añadido nada").wait_for()

    # language toggle is page-local (does not touch the staff UI's saved language)
    page.get_by_role("button", name="EN", exact=True).click()
    expect(page.get_by_text("Your order")).to_be_visible()
    page.get_by_role("button", name="ES", exact=True).click()

    page.get_by_role("button", name="Drinks").click()
    add(page, "Coca-Cola")
    # modifier item: required option must be chosen
    page.get_by_role("button", name="Main Course").click()
    add(page, "Margherita Pizza")
    # "Thin Crust" is pre-selected; un-pick it so the required group is empty
    page.get_by_role("radio", name=re.compile("Thin Crust")).click()
    page.get_by_role("button", name="Añadir al pedido").click()
    expect(page.locator("[role=dialog] p[role=alert]")).to_contain_text("Crust Type")
    page.get_by_role("radio", name=re.compile("Extra Cheese")).click()
    page.screenshot(path=str(SHOTS / "kiosk-4-modifiers.png"))
    page.get_by_role("button", name="Añadir al pedido").click()
    add(page, "Margherita Pizza")  # same item again -> another picker
    page.get_by_role("radio", name=re.compile("Extra Cheese")).click()
    page.get_by_role("button", name="Añadir al pedido").click()  # merges into one line, qty 2
    # search
    page.get_by_placeholder("Buscar en la carta").fill("paneer")
    expect(page.get_by_role("heading", name="Paneer Tikka")).to_be_visible()
    page.get_by_placeholder("Buscar en la carta").fill("zzzz")
    expect(page.get_by_text("No hay resultados")).to_be_visible()
    page.get_by_role("button", name="Borrar búsqueda").click()
    page.screenshot(path=str(SHOTS / "kiosk-5-basket.png"))
    basket_text = page.locator("aside").inner_text()
    check("basket merges identical item+options into one line (x2)", "Margherita Pizza" in basket_text and re.search(r"\n2\n", basket_text) is not None, basket_text.replace("\n", " | ")[:140])
    check("basket shows preview total (2x(420+60)+90 = 1.050,00 EUR)", re.search(r"1\.?050,00\s*€", basket_text) is not None)

    page.get_by_role("button", name="Revisar pedido").click()
    page.get_by_role("heading", name="Revisa tu pedido").wait_for()
    check("review states tax-inclusive prices (IVA)", page.get_by_text("IVA incluido").count() > 0)
    page.screenshot(path=str(SHOTS / "kiosk-6-review.png"))

    # ---- network loss: first submit is lost; retry must not duplicate -------
    posts = []
    page.on("request", lambda r: posts.append(r) if r.method == "POST" and "/public/kiosk/" in r.url else None)
    page.route("**/api/v1/public/kiosk/*/order", lambda route: route.abort("connectionfailed"))
    page.get_by_role("button", name="Confirmar pedido").click()
    expect(page.get_by_text("Sin conexión con el restaurante")).to_be_visible()
    check("network failure shows recovery state, order NOT confirmed", page.get_by_text("¡Pedido enviado!").count() == 0)
    check("basket is locked after an ambiguous failure", page.get_by_role("button", name="Seguir pidiendo").count() == 0)
    page.screenshot(path=str(SHOTS / "kiosk-7-network-error.png"))
    first_key = re.search(r'"requestId":"([^"]+)"', posts[0].post_data or "").group(1)
    page.unroute("**/api/v1/public/kiosk/*/order")

    # double tap on retry -> still one request
    retry = page.get_by_role("button", name="Reintentar")
    retry.dblclick()
    page.get_by_role("heading", name="¡Pedido enviado!").wait_for(timeout=15000)
    sent = [r for r in posts][1:]
    keys = {re.search(r'"requestId":"([^"]+)"', r.post_data or "").group(1) for r in posts}
    check("retry re-sends the same idempotency key", keys == {first_key}, f"{len(posts)} attempts")
    check("double-tap on confirm sends a single request", len(sent) == 1, f"{len(sent)} requests after the failure")

    order_number = page.get_by_test_id("order-number").inner_text()
    full_number = page.locator("text=/\\d{8}-\\d{4}/").first.inner_text()
    check("confirmation shows an order reference", bool(re.fullmatch(r"\d{4}", order_number)), full_number)
    check("confirmation does not claim the order is paid", page.get_by_text("aún no está pagado").count() == 1)
    no_overflow(page, "kiosk done")
    page.screenshot(path=str(SHOTS / "kiosk-8-confirmation.png"))

    # printing: click must open a print attempt or report unavailable, never claim success of payment
    page.evaluate("window.__printed = 0; window.print = () => { window.__printed++ }")
    page.get_by_role("button", name="Imprimir ticket").click()
    page.wait_for_timeout(1500)
    frame_printed = page.evaluate("() => [...document.querySelectorAll('iframe')].length")
    check("print button builds an 80 mm ticket frame (manual action, no auto-print)", frame_printed >= 1)
    ticket = page.evaluate("() => document.querySelector('iframe')?.srcdoc || ''")
    check("ticket is 80 mm, marked NOT PAID, has order QR", "size: 80mm auto" in ticket and "NO PAGADO" in ticket and "<svg" in ticket)

    page.get_by_role("button", name="Nuevo pedido").click()
    page.get_by_role("button", name="Toca la pantalla para empezar").wait_for()
    check("after 'New order' no previous order data is on screen", page.get_by_text(full_number).count() == 0)
    ctx.close()

    # ---------------- 2. staff KDS handoff on the tablet --------------------
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, has_touch=True)
    sp = ctx.new_page()
    sp.goto(f"{STAFF}/login")
    sp.locator("#email").fill(EMAIL)
    sp.locator('input[type="password"]').first.fill(PASSWORD)
    sp.locator("form button[type=submit]").click()
    sp.wait_for_url(re.compile(r"/dashboard"), timeout=20000)
    sp.goto(f"{STAFF}/kds")
    sp.get_by_role("heading", name="Kitchen Display").wait_for()
    expect(sp.get_by_text(full_number).first).to_be_visible(timeout=15000)
    check("kiosk order appears on the staff KDS", True, full_number)
    sp.screenshot(path=str(SHOTS / "kds-1-all-stations.png"))
    # drinks go to the Bar station only
    sp.get_by_role("button", name="Bar", exact=True).click()
    sp.wait_for_timeout(800)
    bar_text = sp.locator("main, body").first.inner_text()
    check("Bar station shows the Coca-Cola ticket", "Coca-Cola" in bar_text and "Margherita" not in bar_text)
    sp.screenshot(path=str(SHOTS / "kds-2-bar-station.png"))
    sp.reload()
    sp.get_by_role("heading", name="Kitchen Display").wait_for()
    check("KDS remembers its station after reload", sp.get_by_role("button", name="Bar", exact=True).get_attribute("aria-pressed") == "true")

    # realtime: a second kiosk order must show up WITHOUT reloading the KDS
    sp.get_by_role("button", name="All stations").click()
    kctx = browser.new_context(viewport={"width": 1920, "height": 1080}, has_touch=True)
    kp = kctx.new_page()
    kp.goto(KIOSK)
    kp.get_by_role("button", name="Toca la pantalla para empezar").click()
    kp.get_by_role("button", name="Para llevar").click()
    kp.get_by_role("button", name="Starters").wait_for()
    add(kp, "Paneer Tikka")
    kp.get_by_role("button", name="Revisar pedido").click()
    kp.get_by_role("button", name="Confirmar pedido").click()
    kp.get_by_role("heading", name="¡Pedido enviado!").wait_for(timeout=15000)
    second = kp.locator("text=/\\d{8}-\\d{4}/").first.inner_text()
    expect(sp.get_by_text(second).first).to_be_visible(timeout=8000)
    check("second order arrives on the KDS live (no reload)", True, second)
    kctx.close()

    # ---------------- 3. scanner fallback on the staff Orders page ----------
    sp.goto(f"{STAFF}/orders")
    sp.get_by_role("heading", name="Orders").wait_for()
    box = sp.get_by_label("Scan or type an order number")
    box.fill("garbage!!")
    box.press("Enter")
    expect(sp.get_by_text("Not a recognised order code")).to_be_visible()
    box.fill(f"orderrestro:order:{second}\r\n")
    box.press("Enter")
    expect(sp.get_by_text(second).first).to_be_visible(timeout=8000)
    check("scan input rejects junk and opens a real order from a wedge-style payload", True)
    sp.screenshot(path=str(SHOTS / "staff-orders-scan.png"))
    ctx.close()

    # ---------------- 4. public surface has no staff/admin access -----------
    ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
    api = ctx.request
    base = KIOSK.split("/kiosk/")[0]
    for path in ("/api/v1/orders/manage?branchId=demo-branch&tab=active", "/api/v1/kds/tickets?branchId=demo-branch",
                 "/api/v1/settings?branchId=demo-branch", "/api/v1/customers?branchId=demo-branch"):
        r = api.get(base + path)
        check(f"anonymous kiosk client is refused {path.split('?')[0]}", r.status == 401, str(r.status))
    page = ctx.new_page()
    page.goto(KIOSK)
    page.get_by_role("button", name="Toca la pantalla para empezar").wait_for()
    hrefs = page.evaluate("() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))")
    check("kiosk page has no links out to admin/staff routes", not [h for h in hrefs if re.search(r"/(dashboard|settings|login|kds|orders)", h or "")], str(hrefs))
    storage = page.evaluate("() => JSON.stringify({l: {...localStorage}, s: {...sessionStorage}})")
    check("kiosk stores no credentials/personal data in browser storage", "token" not in storage.lower() and "password" not in storage.lower(), storage[:120])
    bad = api.get(base + "/api/v1/public/kiosk/" + "0" * 32)
    check("unknown kiosk token is a 404", bad.status == 404)
    ctx.close()

    # ---------------- 5. narrower responsive widths -------------------------
    for label, (w, h) in NARROW_VIEWPORTS.items():
        ctx = browser.new_context(viewport={"width": w, "height": h}, has_touch=True, is_mobile=w < 800)
        page = ctx.new_page()
        start_order(page)
        no_overflow(page, f"{label} menu")
        page.get_by_role("button", name=re.compile("Añadir")).first.click()
        page.wait_for_timeout(300)
        page.screenshot(path=str(SHOTS / f"{label}-menu.png"))
        page.get_by_role("button", name="Revisar pedido").last.click()
        page.get_by_role("heading", name="Revisa tu pedido").wait_for()
        no_overflow(page, f"{label} review")
        page.screenshot(path=str(SHOTS / f"{label}-review.png"))
        ctx.close()

    # ---------------- 6. failure states, service worker, caches -------------
    ctx = browser.new_context(viewport={"width": 1920, "height": 1080}, has_touch=True)
    page = ctx.new_page()
    page.route("**/api/v1/public/kiosk/*", lambda route: route.abort("connectionfailed") if route.request.method == "GET" else route.continue_())
    page.goto(KIOSK)
    expect(page.get_by_text("No podemos conectar con el restaurante")).to_be_visible()
    check("server unreachable shows recovery state, not 'empty menu', and no Start button",
          page.get_by_text("No hay productos disponibles").count() == 0
          and page.get_by_role("button", name="Toca la pantalla para empezar").count() == 0)
    page.screenshot(path=str(SHOTS / "kiosk-9-server-unreachable.png"))
    page.unroute("**/api/v1/public/kiosk/*")
    page.get_by_role("button", name="Reintentar ahora").click()
    page.get_by_role("button", name="Toca la pantalla para empezar").wait_for()
    check("recovery: after the server returns, the kiosk becomes usable again", True)
    ctx.close()

    ctx = browser.new_context(viewport={"width": 1920, "height": 1080}, has_touch=True)
    page = ctx.new_page()
    def empty_menu(route):
        if route.request.method != "GET":
            return route.continue_()
        resp = route.fetch()
        body = resp.json()
        body["categories"] = []
        route.fulfill(response=resp, json=body)
    page.route("**/api/v1/public/kiosk/*", empty_menu)
    page.goto(KIOSK)
    expect(page.get_by_text("No hay productos disponibles ahora mismo")).to_be_visible()
    check("empty menu is shown as empty (distinct from server down)", page.get_by_text("No podemos conectar").count() == 0)
    page.screenshot(path=str(SHOTS / "kiosk-10-empty-menu.png"))
    ctx.close()

    ctx = browser.new_context(viewport={"width": 1920, "height": 1080}, has_touch=True)
    page = ctx.new_page()
    start_order(page)
    page.get_by_role("button", name="Drinks").click()
    add(page, "Coca-Cola")
    page.get_by_role("button", name="Revisar pedido").first.click()
    page.route("**/api/v1/public/kiosk/*/order", lambda route: route.fulfill(
        status=409, content_type="application/json",
        body='{"statusCode":409,"code":"ITEM_UNAVAILABLE","message":"x","unavailableItemIds":["demo-item-cola"]}'))
    page.get_by_role("button", name="Confirmar pedido").click()
    expect(page.get_by_text("Ya no está disponible: Coca-Cola")).to_be_visible()
    check("unavailable product: customer is told and the line is removed", page.get_by_text("Todavía no has añadido nada").count() == 1)
    page.screenshot(path=str(SHOTS / "kiosk-11-unavailable.png"))
    page.unroute("**/api/v1/public/kiosk/*/order")

    # offline: browser goes offline -> banner, confirm disabled, nothing sent
    page.get_by_role("button", name="Drinks").click()
    add(page, "Coca-Cola")
    page.get_by_role("button", name="Revisar pedido").first.click()
    ctx.set_offline(True)
    expect(page.get_by_text("No se puede hacer pedidos hasta que vuelva la conexión.")).to_be_visible()
    check("offline: confirm is disabled", page.get_by_role("button", name="Confirmar pedido").is_disabled())
    page.screenshot(path=str(SHOTS / "kiosk-12-offline.png"))
    ctx.set_offline(False)
    ctx.close()

    ctx = browser.new_context(viewport={"width": 1920, "height": 1080})
    page = ctx.new_page()
    page.goto(KIOSK)
    page.get_by_role("button", name="Toca la pantalla para empezar").wait_for()
    page.evaluate("() => navigator.serviceWorker.ready")
    page.reload()
    page.wait_for_timeout(1500)
    cached = page.evaluate("""async () => {
        const out = [];
        for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
        return out;
    }""")
    controlled = page.evaluate("() => !!navigator.serviceWorker.controller")
    check("service worker active for /kiosk/", controlled)
    check("caches hold only static shell assets (no /api, no private data)",
          cached and all(p.startswith(("/_next/static/", "/icons/", "/kiosk/")) for p in cached) and not any("/api/" in p for p in cached),
          f"{len(cached)} entries")
    ctx.close()

    # settings card (staff)
    ctx = browser.new_context(viewport={"width": 1280, "height": 1000})
    sp = ctx.new_page()
    sp.goto(f"{STAFF}/login")
    sp.locator("#email").fill(EMAIL)
    sp.locator('input[type="password"]').first.fill(PASSWORD)
    sp.locator("form button[type=submit]").click()
    sp.wait_for_url(re.compile(r"/dashboard"), timeout=20000)
    sp.goto(f"{STAFF}/settings")
    sp.get_by_role("heading", name="Customer kiosk").wait_for()
    sp.get_by_role("heading", name="Customer kiosk").scroll_into_view_if_needed()
    check("settings shows the kiosk address", KIOSK in sp.locator("#kiosk-url").input_value())
    sp.screenshot(path=str(SHOTS / "staff-settings-kiosk.png"), full_page=True)
    ctx.close()

    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
