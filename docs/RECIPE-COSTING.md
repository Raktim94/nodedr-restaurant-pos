# Recipe costing

What a finished dish costs to make, built from its raw ingredients, and what it earns.

## Where things are
- **Inventory → Ingredients → Cost**: how an ingredient is priced and its usable yield.
- **Menu → Edit item → Recipe & cost**: the recipe, batch size, extra costs, margin and price ideas.
- **Inventory → Preparations**: sauces, dough, spice mixes, or a dish cooked ahead in batches.
- **Inventory → Costing**: every dish's cost and margin, with warnings where a margin is shrinking.
- **Phone app → Menu (or Sync) → Recipes & costs**: the same, working offline.

## How a cost is worked out
1. **Ingredient cost per unit** (one method, shown on screen):
   - *From purchases*: the existing weighted average of goods receipts. Until the first receipt it falls back to the manual price and says so.
   - *Manual price*: "bought 5 kg for ₹250".
   - *From its recipe*: prepared items (sauce etc.) are priced live from their own recipe.
2. **Units**: kg/g, litre/ml and piece/dozen convert freely. Weight, volume and count never convert unless the ingredient has an explicit bridge (e.g. 1 L oil = 920 g). Packs and boxes only convert with a bridge too.
3. **Yield counted once**: the only place wastage is entered is the ingredient's *usable yield %*. A recipe line is the *usable* amount; cost and the raw stock taken are both grossed up by the yield, once. Cooking loss is expressed by the batch output, not by a second wastage figure.
4. **Batch**: line quantities are for a whole batch; `batch cost = ingredients + other costs`; `cost per portion = batch cost ÷ portions`. Packaging/labour/energy/other are "per batch" or "per portion".
5. Anything unpriced, in an incompatible unit, zero/negative, or a zero batch output is reported, the cost is marked **incomplete**, and no price is suggested - it never shows a cost that silently leaves something out.

Worked examples (all in the automated tests): flour ₹50/kg × 200 g = ₹10. A ₹600 batch making 20 portions = ₹30 each. At ₹30 cost, a 60% margin suggests ₹75 and a 60% markup suggests ₹48 (both before tax).

## Prices and profit
- *Margin price* = cost ÷ (1 − margin%). *Markup price* = cost × (1 + markup%).
- Margin is measured on revenue **excluding sales tax**. With tax-inclusive menu prices the revenue is price ÷ (1 + tax%); with tax-exclusive prices the price is the revenue. The suggestion shows the price before tax and what to enter on the menu.
- A price is **never** changed automatically. "Use this price" needs the Manage Menu permission, is refused if the price moved since you looked, and is written to the audit log.
- **Margin warnings**: each dish remembers its cost when its price was last reviewed. If the margin falls by the dish's threshold (default 5 points), is below target, or the dish sells below cost, it is flagged. "Price is fine" resets the baseline.

## Stock
- **Made to order** (Recipe): the raw ingredients are taken when the bill is paid, once (paid checkout is the existing, idempotent deduction point; unpaid or cancelled orders touch nothing). A half portion takes the dish's half-portion share; chosen options add (extra cheese) or remove (no onion) their own ingredients.
- **Prepared batches** (Preparations → Cook batches): cooking takes the raw stock and adds finished stock at the real cost of what was used. The dish is then set to *Prepared stock* and selling it takes finished stock only. A dish set to prepared stock refuses ingredient lines, so raw ingredients can never be taken twice.
- **Returns** put back exactly what the sale took (same portion and options), once. Waste and adjustments use the existing waste log and stock adjustment, also for prepared stock.
- **History is stable**: the cost of each sold line is frozen when it is paid (separate table, never returned with orders), and production runs keep their own cost. Changing a purchase price later changes today's cost, not past margins. The Food cost & margins report uses these frozen costs.
- Production runs carry an idempotency key, so a retried or offline-synced run is recognised, never cooked twice.

## Who can see what
- Costing screens and endpoints need **Manage Inventory**. Cashiers and waiters get 403, and the menu list no longer includes each dish's cost price for roles without inventory or financial access.
- Changing a selling price additionally needs **Manage Menu**.

## Offline (phone app)
The phone runs the same engine (generated from the shared source, with a test that fails if it drifts). In *phone-account mode* you edit ingredients and recipes and may apply a suggested price to the phone's own menu. In *server mode* the phone keeps a copy of the server's ingredients and recipes; recipe edits made offline are sent on sync with the server version they started from. If the server's copy changed meanwhile, the edit is held as a **conflict** and you choose to keep yours or take theirs - nothing is overwritten silently. Ingredient stock is only tracked on the server; sales from the phone deduct it when they sync (each sale id is recorded once).

## Migration
`20261111000000_recipe_costing` is additive: new nullable/defaulted columns and new tables only. Existing ingredients, recipes, stock and orders behave exactly as before (recipe lines without a unit use the ingredient's unit, yield defaults to 100%, batch size to 1).

## Known limits
Half portions are the only portion variant with its own share; custom portions use the full recipe. Gateway/aggregator orders deduct at payment like others. Phone-account mode does not track ingredient stock. Preparations cannot change unit once stocked or used.
