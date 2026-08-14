# Feature Checklist

Cross-referenced against the actual codebase (`apps/backend`, `apps/web`,
`apps/backend/prisma/schema.prisma`) as of 2026-08-14, not just roadmap
prose. This is the exhaustive taxonomy version of `ROADMAP.md` (which
tracks the same ground phase-by-phase, engineering-oriented) — organized
here by product category for public/roadmap use. Where a feature is
partially built, the note says what's missing.

## 🧾 Core POS / Billing

| Feature | Status | Note |
|---|---|---|
| Fast touch-friendly billing screen | Shipped | POS page, product grid + cart |
| Product/category grid | Shipped | Category tabs + search |
| Product search | Shipped | |
| Barcode scanning | Planned | No barcode field/scanner in this app (nodedr-pos has it, not ported here) |
| SKU support | Planned | No SKU field on MenuItem |
| Variants/sizes | Planned | No variant model on MenuItem |
| Add-ons/modifiers | Shipped | Modifier groups + modifiers, min/max, defaults |
| Combo/bundle products | Shipped | `ComboComponent`, combo builder UI |
| Item notes | Planned | No per-item note field on OrderItem |
| Special cooking instructions | Planned | Kitchen notes exist at KOT level, not per-item |
| Quantity adjustment | Shipped | Cart qty stepper |
| Hold/resume order | Planned | No draft/hold order state |
| Save draft orders | Planned | |
| Open orders | Shipped | Order status OPEN, visible on table/dashboard |
| Split bill | Partial | Display-only equal-split calculator, not separate per-guest checks |
| Merge bills | Shipped | `mergeOrders()` |
| Transfer items between bills | Planned | |
| Transfer table | Planned | No dedicated table-transfer action (merge exists, not a move) |
| Merge tables | Shipped | Bill-merge across tables |
| Reorder previous items | Planned | |
| Repeat last order | Planned | |
| Cancel item | Planned | Order-level void exists via refund; no per-item cancel before send |
| Void order | Partial | Refund flow covers post-payment; no pre-payment void |
| Refund | Shipped | Capped at refundable remainder |
| Partial refund | Shipped | |
| Exchange | Planned | |
| Complimentary items | Planned | |
| Discount by item | Planned | Discounts are order-level only |
| Discount by order | Shipped | %/flat |
| Percentage discount | Shipped | |
| Fixed discount | Shipped | |
| Coupon codes | Planned | No coupon/promo model |
| Tax calculation | Shipped | GST/VAT backed out of inclusive price, server-authoritative |
| Service charge | Planned | No service-charge field |
| Tips | Shipped | Added on discounted subtotal, not taxed |
| Rounding | Shipped | `round2` discipline throughout |
| Multiple payment methods | Shipped | Cash/card/UPI/wallet/bank transfer |
| Split payment | Planned | One payment method per order currently |
| Cash + card / Cash + UPI / Card + UPI | Planned | Same as split payment |
| Multiple currencies | Planned | Single `currency` field per restaurant (default INR), no multi-currency checkout |
| Customer-facing display | Planned | |
| Receipt printing | Shipped | Self-printing HTML receipt via browser dialog |
| Digital receipt | Planned | |
| WhatsApp / SMS / Email receipt | Planned | No messaging integration in codebase |

## 🪑 Restaurant Table Management

| Feature | Status | Note |
|---|---|---|
| Restaurant floor map | Shipped | Spatial tile layout (posX/posY) |
| Multiple floors | Shipped | `Floor` model |
| Multiple sections | Partial | Floors serve this role; no separate indoor/outdoor tag |
| Indoor/outdoor seating | Planned | |
| Table shapes | Shipped | square/round/rect, now rendered as real shape-aware SVG icons (2026-08-14) |
| Table capacity | Shipped | |
| Table status (Available/Occupied/Reserved/Cleaning/Out of service) | Shipped | Full enum, color-coded |
| Table timer | Planned | No elapsed-time display on table tile |
| Guest count | Shipped | Via reservation/waitlist party size |
| Server assignment | Shipped | `assignedWaiterId` on Table |
| Table merge | Shipped | |
| Table split | Planned | |
| Table transfer | Planned | |
| Move customer | Planned | |
| Table reservation | Shipped | Full status lifecycle |
| Waitlist | Shipped | Panel on Tables page |
| Estimated waiting time | Shipped | Quoted wait field |
| Table history | Planned | No per-table order history view |
| Table QR code | Shipped | Rotatable opaque token |
| QR ordering | Partial | Public read-only menu view only, no ordering yet |
| Table-specific orders | Shipped | |
| Drag-and-drop floor designer | Partial | Coordinates exist and render; no drag UI to reposition (backend PATCH exists, unused) |
| Multiple restaurant areas | Partial | Same as sections above |
| Color-coded table states | Shipped | |
| Live kitchen/order status | Shipped | Via KDS Socket.IO |
| Table revenue | Planned | |
| Average table time | Planned | |
| Table turnover | Planned | |
| Revenue per seat | Planned | |

## 🍽️ Menu Management

| Feature | Status | Note |
|---|---|---|
| Categories / Subcategories | Partial | Categories yes; no subcategory nesting |
| Products | Shipped | |
| Variants | Planned | |
| Add-ons / Modifier groups | Shipped | With price adjustment |
| Modifier pricing | Shipped | |
| Combo meals / Meal deals | Shipped | |
| Recipe mapping | Shipped | `RecipeIngredient` |
| Product images | Shipped | Photo upload on menu items |
| Product descriptions | Shipped | |
| Ingredients | Shipped | |
| Allergens | Shipped | `allergens String[]` on MenuItem |
| Dietary tags (Veg/Vegan/Jain/Gluten-free) | Partial | isVeg/isVegan/spiceLevel exist; no Jain/gluten-free flags |
| Spicy level | Shipped | |
| Preparation time | Planned | |
| Printer routing / Kitchen station routing | Shipped | `KitchenStation`, KOT split by station |
| Time-based menu (breakfast/lunch/etc.) | Planned | `availableFrom`/`availableTo` is a daily window only, no named menu sets |
| Seasonal / holiday menu | Planned | |
| Happy hour | Planned | |
| Menu availability | Shipped | Per-item time window + toggle |
| Location-specific menu | Planned | Menu is restaurant-wide, not per-branch |
| Channel-specific pricing | Planned | |
| Dynamic pricing | Planned | |

## 👨‍🍳 KDS — Kitchen Display System

| Feature | Status | Note |
|---|---|---|
| Kitchen order screen | Shipped | |
| Order queue / status columns (New/Preparing/Ready/Completed/Cancelled) | Shipped | Status-based columns, not per-station columns |
| Priority orders | Shipped | Star toggle |
| Order timers / prep timers | Shipped | Elapsed-time, warning ring past 15 min |
| Color-coded urgency | Shipped | |
| Sound notifications | Planned | |
| Item-level status | Planned | KOT/order-level only |
| Order-level status | Shipped | |
| Kitchen stations | Shipped | |
| Bump order | Shipped | Status-advance button |
| Recall order | Planned | |
| Delay reason / item unavailable | Planned | |
| Kitchen notes | Shipped | Per-KOT |
| Auto-routing by station | Shipped | |
| Parallel preparation | Shipped | Independent per-station KOTs |
| Course management / fire-hold | Planned | |
| Expediter screen | Planned | |
| Average preparation time | Shipped | Per-station widget |
| Station workload | Planned | |
| SLA / late-order alerts | Partial | Visual 15-min warning ring only, no push alert |
| Rush mode / order throttling | Planned | |

## 🖥️ Self-Service Kiosk

| Feature | Status | Note |
|---|---|---|
| Everything in this category | Planned | No kiosk mode/route anywhere in the codebase |

## 📱 QR / Table Ordering

| Feature | Status | Note |
|---|---|---|
| Table QR / scan & order | Partial | QR generated, opens read-only digital menu |
| Digital menu (customer view) | Shipped | `/order/[qrToken]` public route |
| Customer ordering, add modifiers, pay, split, tip via QR | Planned | View-only today, no ordering/payment |
| Call waiter / request bill/water/assistance | Planned | |
| Reorder | Planned | |
| No-app ordering | Shipped | Web-based, no app needed (for the view-only menu) |
| WhatsApp ordering | Planned | |
| QR-specific / table-specific / dynamic QR | Shipped | Per-table opaque token, rotatable |
| Personalized recommendations | Planned | |

## 📦 Inventory Management

| Feature | Status | Note |
|---|---|---|
| Stock tracking (ingredient + product) | Shipped | Ingredient-based |
| Stock adjustment | Shipped | Ledgered |
| Stock transfer (branch-to-branch) | Planned | Deferred to multi-branch phase |
| Stock count / stocktake | Shipped | Via adjustments |
| Low-stock alerts | Shipped | Badge + endpoint, no push/email |
| Out-of-stock alerts | Partial | Same as above |
| Expiry tracking | Shipped | Per-batch, captured not alerted |
| Batch/lot tracking | Shipped | |
| Waste / spoilage / damaged stock tracking | Shipped | Reason-coded, FIFO-priced |
| Stock consumption | Shipped | Via recipe deduction |
| Recipe-based inventory deduction | Shipped | FIFO, auto on checkout, combos expand one level |
| Theoretical vs actual consumption | Planned | |
| Yield calculation | Planned | |
| Wastage % | Planned | No aggregate report yet, raw data exists |
| Food cost | Shipped | Live recipe costing |
| Portion control | Planned | |
| Production batches / prep inventory | Planned | |

## 🧪 Recipe / Food Cost Management

| Feature | Status | Note |
|---|---|---|
| Recipe builder (ingredients, quantities, units) | Shipped | |
| Yield / portion size | Planned | |
| Recipe cost / ingredient cost | Shipped | Weighted-average, recomputed on every GRN |
| Food cost % / gross margin | Planned | Cost exists per item, no %/margin report |
| Recipe versioning / history | Planned | |
| Automatic food-cost calculation | Shipped | Snapshotted onto MenuItem.costPrice |
| Menu engineering / contribution margin | Planned | |
| Recommended selling price | Planned | |

## 🛒 Purchasing & Suppliers

| Feature | Status | Note |
|---|---|---|
| Supplier management | Shipped | |
| Purchase orders | Shipped | Draft→sent→partially received→received/cancelled |
| Purchase invoices | Planned | Deferred (procurement depth) |
| Goods received (GRN) | Shipped | Linked or unlinked to PO |
| Purchase returns | Planned | |
| Supplier payments/credits | Planned | Deferred |
| Supplier price history | Planned | |
| Purchase history | Shipped | Via PO records |
| Reorder levels | Shipped | Per-ingredient |
| Automatic reorder suggestions | Planned | |
| Vendor quotations, purchase requests, price variance, supplier comparison/performance | Planned | Explicitly deferred "procurement depth" in ROADMAP Phase 4 |

## 🚚 Delivery Management

| Feature | Status | Note |
|---|---|---|
| Everything in this category | Planned | No `Delivery` model or module — Phase 5, not started |

## 📦 Takeaway / Pickup

| Feature | Status | Note |
|---|---|---|
| Takeaway order type | Shipped | POS supports dine-in + takeaway |
| Scheduled pickup, pickup time, notifications, curbside | Planned | |

## 👤 Customer CRM

| Feature | Status | Note |
|---|---|---|
| Customer profiles (name/phone/email/birthday/etc.) | Shipped | Plus address/anniversary/allergies/notes |
| Order history | Shipped | Per-customer profile page |
| Favorite products / avg order value / visit frequency | Planned | Not computed/displayed |
| Customer notes | Shipped | |
| Loyalty points | Shipped | Fixed earn/redeem rate, not per-restaurant configurable |
| Memberships / tiered loyalty / VIP | Planned | Points ledger only, no tiers |
| Rewards / cashback | Partial | Points-as-discount only |
| Coupons | Planned | |
| Referral program | Planned | |
| Birthday offers | Planned | Birthday field captured, no automation |
| Customer segmentation / RFM / churn / CLV | Planned | |
| Automated campaigns | Planned | |

## 🎟️ Discounts & Promotions

| Feature | Status | Note |
|---|---|---|
| Percentage / flat discount | Shipped | Order-level |
| Item / category discount | Planned | |
| Coupons / promo codes | Planned | |
| Buy 1 Get 1 / Buy 2 Get 1 | Planned | |
| Happy hour / happy-day pricing | Planned | |
| First-order / loyalty / employee / membership discount | Planned | |
| Time-based / weather-based / customer-specific promotions | Planned | |
| Automated campaigns | Planned | |
| Minimum-spend / bundle / conditional discounts | Planned | |

## 💳 Payments

| Feature | Status | Note |
|---|---|---|
| Cash / Card / UPI / Wallet / Bank transfer | Shipped | `PaymentMethod` enum |
| QR payment | Planned | UPI recorded, no live QR payment collection flow |
| Payment gateway integration | Planned | |
| Card terminal integration | Planned | |
| Split payment / partial / advance payment | Planned | |
| Refund / payment reversal | Shipped | |
| Payment reconciliation | Planned | |
| Automatic payment confirmation | Planned | |

## 👨‍💼 Staff Management

| Feature | Status | Note |
|---|---|---|
| Staff accounts | Shipped | |
| Roles (Owner/Manager/Cashier/Waiter/Kitchen/etc.) | Shipped | 11 seeded roles |
| Permissions | Shipped | Granular, individually toggleable per role |
| PIN login | Shipped | `POST /auth/pin-login` |
| Password login | Shipped | |
| Biometric login | Planned | |
| Role-based / permission-level access | Shipped | |
| Manager approval (void/discount/refund) | Planned | No approval-gate workflow, only permission checks |
| Login/logout tracking | Partial | Session exists; no explicit login-history log beyond AuditLog |
| Shift tracking, sales/orders/discounts/voids/refunds per employee | Planned | Not aggregated in reports yet |

## 💰 Cash Drawer Management

| Feature | Status | Note |
|---|---|---|
| Everything in this category | Planned | No shift open/close, cash reconciliation model in schema |

## 📊 Analytics & Reports

| Feature | Status | Note |
|---|---|---|
| Daily sales, today's revenue/orders | Shipped | Dashboard `GET /dashboard/summary`, `/trends` |
| Sales by hour/day/category/product/employee/payment method | Planned | Only aggregate summary + trend exist, not these breakdowns |
| Restaurant KPIs (AOV, covers, table turnover, food cost %, etc.) | Planned | |
| Full reports catalog, exports (CSV/PDF/Excel), scheduled email | Planned | Explicitly Phase 7, not started |
| Sales forecasting / AI recommendations / anomaly detection | Planned | |

## 📈 Owner Dashboard

| Feature | Status | Note |
|---|---|---|
| One-screen sales/orders summary | Shipped | Dashboard v1: revenue, orders, table status, kitchen queue, recent transactions |
| "What needs attention" alert feed | Planned | No proactive alert/anomaly feed |
| Real-time refresh | Partial | 15s polling, not yet on the realtime gateway (KDS/Tables are) |

## 🏪 Multi-Outlet Management

| Feature | Status | Note |
|---|---|---|
| Multiple restaurants / branches (schema) | Shipped | `Restaurant` → `Branch`, already multi-tenant by design |
| Branch switcher (UI) | Shipped | Sidebar branch switcher |
| Central dashboard / consolidated reports across branches | Planned | Dashboard is per-branch only today |
| Branch-specific menus/pricing | Planned | |
| Central inventory / stock transfers | Planned | Deferred to Phase 6 |
| Franchise management, HQ controls, benchmarking | Planned | |

## 🖨️ Hardware / Device Management

| Feature | Status | Note |
|---|---|---|
| Receipt printer (browser print) | Shipped | HTML receipt via print dialog |
| Direct USB/ESC-POS printer | Planned | nodedr-pos has this transport built; not yet ported here (Phase 8) |
| Kitchen printers, label printers, weighing scales, payment terminals | Planned | |
| Barcode scanners | Planned | |
| Customer displays, kiosks, tablets as POS terminals | Planned | |
| Device registration/health/remote config | Planned | |

## 🌐 Offline-First POS

| Feature | Status | Note |
|---|---|---|
| Single-branch runs fully on local LAN with zero internet dependency | Shipped | Full Docker Compose stack (Postgres+backend+web) on one server, by construction |
| Client continues working while disconnected from its own local server (true offline writer + conflict resolution) | Planned | Explicitly out of scope per `ARCHITECTURE.md` — not attempted, not silently dropped |
| Offline payments, local printing, offline KDS/kiosk | Shipped/Planned mix | Local-network operation covers most of this; no client-side offline cache |
| Sync status / connection indicator | Planned | |

## 🔄 Sync Engine

| Feature | Status | Note |
|---|---|---|
| Branch-level sync agent to a central aggregation instance | Planned | Designed in `ARCHITECTURE.md`, not built — Phase 6 |
| Local-first data, retry queue, conflict resolution, idempotency | Planned | |

## 🔐 Security

| Feature | Status | Note |
|---|---|---|
| RBAC | Shipped | Granular per-permission, per-role |
| PIN authentication | Shipped | |
| 2FA | Planned | Mentioned as "optional per spec" in ARCHITECTURE.md, not implemented |
| Session timeout | Shipped | JWT expiry |
| Audit logs | Shipped | `AuditLog` model exists and is written to |
| Device authorization / IP restrictions / login history | Planned | |
| Data encryption at rest | Planned | Relies on Postgres/host-level, no app-level field encryption |
| Backup / restore / export / delete policies | Planned | No backup/restore endpoint yet |

## 📋 Reservations & Waitlist

| Feature | Status | Note |
|---|---|---|
| Table reservations (full lifecycle) | Shipped | reserved→confirmed→arrived→completed/cancelled/no_show |
| Guest count, notes, confirmation, cancellation, no-show | Shipped | |
| Waitlist + estimated wait | Shipped | |
| SMS/WhatsApp notification | Planned | No messaging integration |
| Table assignment | Shipped | |
| Reservation deposit | Partial | Field exists on schema, no payment-collection UI |
| No-show fee / automatic table allocation / forecasting | Planned | |

## 📣 Marketing

| Feature | Status | Note |
|---|---|---|
| Everything in this category | Planned | No campaign/messaging module in codebase |

## 🧾 Accounting

| Feature | Status | Note |
|---|---|---|
| Everything in this category | Planned | Phase 6, not started — no ledger/P&L/reconciliation models |

## 🇮🇳 India-Specific Features

| Feature | Status | Note |
|---|---|---|
| GST-inclusive pricing (CGST/SGST backed out correctly) | Shipped | Verified numerically, see docs/decisions ADR in nodedr-ecommerce-template |
| UPI as a payment method | Shipped | Recorded as a payment method, no live UPI QR collection |
| Indian currency (INR) | Shipped | Default currency |
| Dynamic UPI QR, IGST, HSN/SAC, FSSAI, WhatsApp receipts/ordering, Tally/Razorpay/PhonePe/BharatPe, Swiggy/Zomato integration | Planned | None integrated |

## 🤖 AI Features

| Feature | Status | Note |
|---|---|---|
| Everything in this category | Planned | No AI/LLM integration anywhere in the codebase |

## 🔥 Advanced "Enterprise POS" Features

| Feature | Status | Note |
|---|---|---|
| Multi-location (schema-level) | Shipped | `Restaurant`→`Branch` from day one, not bolted on |
| Multi-brand, multi-language, multi-currency | Planned | |
| API / Swagger docs | Shipped | Versioned REST (`/api/v1`), Swagger at `/api/docs` |
| Webhooks, developer portal, app marketplace | Planned | |
| Advanced audit logs | Partial | AuditLog model exists; no dedicated UI/report over it yet |
| GraphQL | Planned | Explicitly deferred, additive-alongside-REST per ROADMAP Phase 8 |
| Custom reports/workflows/fields, automation engine, BI dashboards | Planned | |

---

## Summary

Rough counts across all 29 categories (line-item granularity, not
category granularity): **~95 Shipped, ~30 Partial, ~180 Planned** out of
~305 line items in the pasted taxonomy.

**Closest to complete (of the 10 core modules):**
1. **Tables / Floor Plan** — full status lifecycle, reservations, waitlist, QR tokens, shape-aware icons; missing mainly the drag-to-reposition designer UI and table-level analytics (turnover, revenue/seat).
2. **Kitchen / KDS** — status columns, timers, priority, stations, performance widget all real; missing sound alerts, per-station column view, expediter screen.
3. **POS / Billing** — correct India tax model, discounts, tips, refunds, combos, merge; missing split payment, item-level discounts/notes, hold/draft orders, digital/WhatsApp receipts.
4. **Inventory** — genuinely deep (weighted-average costing, FIFO waste, batch/expiry, auto-deduction); missing yield/wastage-% reporting and procurement depth (quotations, vendor invoices).
5. **Menu / Recipes** — solid (modifiers, combos, allergens, recipe costing); missing time-based/seasonal menu sets and per-branch menus.

**Furthest from complete:**
1. **Kiosk / QR Ordering** — QR *viewing* exists, but no ordering, payment, or self-service kiosk mode at all.
2. **Analytics** — only a summary + trend widget exists; the entire reports catalog, exports, and KPI breakdowns are unbuilt.
3. **Purchasing** — core PO/GRN/supplier flow works, but the "procurement depth" half (quotations, invoices, payment tracking, supplier performance) is explicitly deferred.
4. **Payments** — methods are recorded, but no live payment-gateway/UPI-QR collection, no split payment.
5. **Customers/Loyalty** — a real points ledger exists, but no tiers, campaigns, segmentation, or coupons.

Entirely unbuilt as standalone categories: **Delivery, Cash Drawer
Management, Marketing, Accounting, AI Features, Self-Service Kiosk.** All
six are either an explicit later ROADMAP phase or, for AI/Kiosk, not yet
scoped into any phase at all.
