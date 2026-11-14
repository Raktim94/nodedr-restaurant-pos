import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Costing of a production batch. Exact decimals throughout (Prisma.Decimal), never JS floats; the browser's totals are
// never trusted, the server recomputes everything from quantities and rates.
//
// Rounding policy (stated once, used everywhere):
//   * ingredient line cost = stock-unit quantity (3 dp) x rate per STOCK unit (4 dp), rounded half-up to 4 dp;
//   * additional costs are entered in money (2 dp) and kept as entered;
//   * batch total = sum of line costs + sum of INCLUDED additional costs (no further rounding);
//   * unit cost = batch total / finished quantity, rounded half-up to 4 dp.
// The batch total is the authority. unit cost x quantity can differ from it by a rounding remainder below
// 0.00005 x quantity; the remainder is never redistributed or hidden in stock value.
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

export interface RateLine {
  key: string;
  name: string;
  quantity: Prisma.Decimal.Value; // in the item's stock unit
  rate: Prisma.Decimal.Value; // per STOCK unit
}
export interface ExtraCost {
  category: string;
  description?: string | null;
  amount: Prisma.Decimal.Value;
  included: boolean;
}

export function costBatch(input: {
  lines: RateLine[];
  costs: ExtraCost[];
  outputQty: Prisma.Decimal.Value;
}) {
  const qty = D(input.outputQty);
  if (!qty.isFinite() || qty.lte(0))
    throw new BadRequestException(
      'The finished quantity must be greater than zero',
    );
  if (input.lines.length === 0)
    throw new BadRequestException('Add at least one ingredient');

  const lines = input.lines.map((l) => {
    const q = D(l.quantity);
    const r = D(l.rate);
    if (!q.isFinite() || q.lte(0))
      throw new BadRequestException(
        `${l.name}: quantity must be greater than zero`,
      );
    if (!r.isFinite() || r.isNegative())
      throw new BadRequestException(
        `${l.name}: the cost rate is missing or negative`,
      );
    return {
      key: l.key,
      rate: r,
      quantity: q,
      lineCost: q.mul(r).toDecimalPlaces(4, HALF_UP),
    };
  });
  const ingredientCost = lines.reduce((s, l) => s.plus(l.lineCost), D(0));

  const costs = input.costs.map((c) => {
    const a = D(c.amount);
    if (!c.category.trim())
      throw new BadRequestException('Every additional cost needs a category');
    if (!a.isFinite() || a.isNegative())
      throw new BadRequestException(
        `${c.category}: the amount must be zero or more`,
      );
    if (a.decimalPlaces() > 2)
      throw new BadRequestException(
        `${c.category}: enter the amount to at most 2 decimals`,
      );
    return {
      category: c.category.trim(),
      description: c.description?.trim() || null,
      amount: a,
      included: c.included,
    };
  });
  const additionalCost = costs
    .filter((c) => c.included)
    .reduce((s, c) => s.plus(c.amount), D(0));
  const totalCost = ingredientCost.plus(additionalCost);
  const unitCost = totalCost.div(qty).toDecimalPlaces(4, HALF_UP);
  return { lines, costs, ingredientCost, additionalCost, totalCost, unitCost };
}

/**
 * Gross profit, gross MARGIN % (of the selling price) and MARKUP % (on cost): different numbers, labelled apart.
 * The price is the tax-inclusive menu price as the app stores it; cost has no tax, so margin here is before tax is
 * taken out of the price (the screen says so).
 */
export function priceMetrics(
  price: Prisma.Decimal.Value,
  unitCost: Prisma.Decimal.Value,
) {
  const p = D(price);
  const c = D(unitCost);
  const profit = p.minus(c);
  return {
    grossProfit: profit.toDecimalPlaces(4, HALF_UP),
    marginPercent: p.gt(0)
      ? profit.div(p).mul(100).toDecimalPlaces(2, HALF_UP)
      : null,
    markupPercent: c.gt(0)
      ? profit.div(c).mul(100).toDecimalPlaces(2, HALF_UP)
      : null,
  };
}
