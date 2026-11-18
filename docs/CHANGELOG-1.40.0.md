# OrderRestro 1.40.0

- **Stock Journal: recipes per product.** Choose the product first; its saved recipes appear. "No saved recipes for this product yet" shows only when the server returned none for that product (a failed or slow request says so instead). *Save as recipe* keeps the ingredients as a template and never moves stock; *Save draft* never moves stock; *Post* records the movement once.
- **Drafts can be reopened.** Production drafts can be edited, posted or deleted from the journal. A posted voucher is never edited: Correct (reverse and replace) or Reverse.
- **Add inventory item / Add menu item** from the voucher are separate actions; the new item is selected in the row you are working on.
- **Clearer guidance** for a missing ingredient cost (type a rate, or receive it with a unit cost on a purchase order) and for an incompatible unit. Post is disabled without permission to post; "Add menu item" needs menu permission.
- **Customers:** optional PIN code and status (Active/Inactive); shown on the customer details, list and POS picker.
- **Phone app (1.40.0):** the same Stock Journal on the phone: recipes, fill from recipe, stock on hand, add inventory/menu item, review, post (kept on the phone and sent once if offline), save draft, save as recipe, drafts and posted list.
- **Database:** one additive migration, `20261122000000_customer_pincode_status` (new optional `customers.pincode`, `customers.status` defaulting to ACTIVE). Nothing is dropped or rewritten.
