import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Costing of ONE manufacturing voucher with one or more finished products. Exact decimals only.
//
//   batch cost            = material cost + included additional costs - recovered scrap/by-product value
//   direct material       = inputs the operator tied to one output; that output carries all of it
//   shared cost           = every other input + additional costs - recovery
//   shared cost is split  = by OUTPUT QUANTITY (all outputs in one unit) or by MANUAL PERCENT (must total 100)
//   allocated total       = direct material + share of shared cost
//   unit cost             = allocated total / GOOD saleable quantity of that output
//
// Rejected/damaged pieces carry no stock and no divisor: their cost stays inside the batch and is therefore
// absorbed by the good units (cost per good unit). That is the one wastage treatment, stated on the screen.
// A single output skips the choice: it takes 100% and the formula is the plain
// (ingredients + additional - recovery) / good quantity.
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
export const RECOVERY_CATEGORY = 'Recovered scrap / by-product';

export interface AllocInput {
  key: string;
  name: string;
  quantity: Prisma.Decimal.Value; // stock unit
  rate: Prisma.Decimal.Value; // per stock unit
  directTo?: string | null; // output key
}
export interface AllocOutput {
  key: string;
  name: string;
  goodQty: Prisma.Decimal.Value; // saleable, stock unit
  unit: string; // stock unit (used to check the quantity basis)
  percent?: Prisma.Decimal.Value | null; // MANUAL only
}
export interface AllocCost {
  category: string;
  description?: string | null;
  amount: Prisma.Decimal.Value;
  included: boolean;
}
export type AllocMethod = 'QUANTITY' | 'MANUAL';

export function costVoucher(args: {
  inputs: AllocInput[];
  outputs: AllocOutput[];
  costs: AllocCost[];
  method?: AllocMethod | null;
}) {
  const { inputs, outputs } = args;
  if (!inputs.length)
    throw new BadRequestException('Add at least one ingredient');
  if (!outputs.length)
    throw new BadRequestException('Add the finished product made');

  const lines = inputs.map((l) => {
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
      ...l,
      quantity: q,
      rate: r,
      lineCost: q.mul(r).toDecimalPlaces(4, HALF_UP),
    };
  });
  const outs = outputs.map((o) => {
    const g = D(o.goodQty);
    if (!g.isFinite() || g.lte(0))
      throw new BadRequestException(
        `${o.name}: the good quantity must be greater than zero`,
      );
    return { ...o, goodQty: g };
  });
  const keys = new Set(outs.map((o) => o.key));
  for (const l of lines)
    if (l.directTo && !keys.has(l.directTo))
      throw new BadRequestException(
        `${l.name} is tied to a product that is not on this voucher`,
      );

  const costs = args.costs.map((c) => {
    const a = D(c.amount);
    const cat = c.category.trim();
    if (!cat)
      throw new BadRequestException('Every additional cost needs a category');
    if (!a.isFinite() || a.isNegative())
      throw new BadRequestException(`${cat}: the amount must be zero or more`);
    if (a.decimalPlaces() > 2)
      throw new BadRequestException(
        `${cat}: enter the amount to at most 2 decimals`,
      );
    return {
      category: cat,
      description: c.description?.trim() || null,
      amount: a,
      included: c.included,
    };
  });
  const isRecovery = (c: { category: string }) =>
    c.category === RECOVERY_CATEGORY;
  const additionalGross = costs
    .filter((c) => c.included && !isRecovery(c))
    .reduce((s, c) => s.plus(c.amount), D(0));
  const recovery = costs
    .filter((c) => c.included && isRecovery(c))
    .reduce((s, c) => s.plus(c.amount), D(0));
  const additionalCost = additionalGross.minus(recovery); // net, shown as "additional (net of recovery)"
  const ingredientCost = lines.reduce((s, l) => s.plus(l.lineCost), D(0));
  const totalCost = ingredientCost.plus(additionalCost);
  if (totalCost.isNegative())
    throw new BadRequestException(
      'Recovered value cannot be more than the cost of the batch',
    );

  // ---- split ----
  const direct = new Map<string, Prisma.Decimal>(
    outs.map((o) => [o.key, D(0)]),
  );
  let shared = additionalCost;
  for (const l of lines) {
    if (l.directTo)
      direct.set(l.directTo, direct.get(l.directTo)!.plus(l.lineCost));
    else shared = shared.plus(l.lineCost);
  }

  let method: AllocMethod | null = null;
  const share = new Map<string, Prisma.Decimal>(); // fraction of shared cost per output
  if (outs.length === 1) {
    share.set(outs[0].key, D(1));
  } else {
    method = args.method ?? null;
    if (!method)
      throw new BadRequestException(
        'This voucher makes more than one product. Choose how shared cost is split between them (by quantity or by percent).',
      );
    if (method === 'QUANTITY') {
      const unit = outs[0].unit;
      if (outs.some((o) => o.unit !== unit))
        throw new BadRequestException(
          'Splitting by quantity needs every product in the same unit. Use a manual percent instead.',
        );
      const total = outs.reduce((s, o) => s.plus(o.goodQty), D(0));
      for (const o of outs) share.set(o.key, o.goodQty.div(total));
    } else {
      let sum = D(0);
      for (const o of outs) {
        const p = o.percent == null || o.percent === '' ? null : D(o.percent);
        if (p === null || !p.isFinite() || p.isNegative())
          throw new BadRequestException(`Enter a percent for ${o.name}`);
        sum = sum.plus(p);
        share.set(o.key, p.div(100));
      }
      if (sum.minus(100).abs().gt('0.001'))
        throw new BadRequestException(
          `The percents add up to ${sum.toString()}, they must add up to 100`,
        );
    }
  }

  // Shared cost is split to 4 dp; the rounding remainder goes to the first output so the parts always sum to the batch.
  const parts = outs.map((o) => ({
    o,
    shared: shared.mul(share.get(o.key)!).toDecimalPlaces(4, HALF_UP),
  }));
  const remainder = shared.minus(
    parts.reduce((s, p) => s.plus(p.shared), D(0)),
  );
  parts[0].shared = parts[0].shared.plus(remainder);

  const outputsOut = parts.map(({ o, shared: sh }) => {
    const dir = direct.get(o.key)!;
    const allocated = dir.plus(sh);
    return {
      key: o.key,
      name: o.name,
      goodQty: o.goodQty,
      percent: share.get(o.key)!.mul(100).toDecimalPlaces(3, HALF_UP),
      directMaterial: dir,
      sharedShare: sh,
      allocatedCost: allocated,
      unitCost: allocated.div(o.goodQty).toDecimalPlaces(4, HALF_UP),
    };
  });
  return {
    lines,
    costs,
    ingredientCost,
    additionalCost,
    recovery,
    totalCost,
    method,
    outputs: outputsOut,
  };
}
