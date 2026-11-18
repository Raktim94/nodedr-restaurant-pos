# OrderRestro 1.39.2

Includes everything in 1.39.1 (Stock Journal Manager role, producing menu items from the Stock Journal).

- **POS: "Show cost today" switch.** With costing on, people who may see cost reports get a switch beside the search box. When on, each product that has a posted production batch shows its production cost under the price (today's cost when there was a batch today, otherwise the latest day, labelled with its date). Off by default; remembered on that device. Cashiers and anyone without the cost-report permission never see the switch or the cost.
- **New finished products go on the menu.** "New finished product" in the Stock Journal now has "Also sell on the POS menu" ticked; you still type the category, price and tax. Untick it to keep the item stock-only.
- No database migrations.
