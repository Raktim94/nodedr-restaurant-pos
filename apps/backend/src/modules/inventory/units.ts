import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Decimal-safe unit conversion for the stock journal. Quantities are Prisma.Decimal (decimal.js)
// all the way: a binary float never touches an inventory balance, so 0.1 + 0.2 is exactly 0.3.
//
// A stock item has ONE base unit (Ingredient.unit). A cook may type a quantity in another unit of
// the same kind: KG<->G, L<->ML, PIECE<->DOZEN. Anything else (a 25 kg "BAG", a PACK of 12) must be
// declared on the item as a conversion {unit, per}: "1 stock unit = `per` of `unit`".
export type StockUnit =
  'KG' | 'G' | 'L' | 'ML' | 'PIECE' | 'DOZEN' | 'PACK' | 'BOX';

export interface UnitConversion {
  unit: StockUnit;
  per: number | string;
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

// how many of the first unit are in one of the second, inside one family
const FAMILY: Record<StockUnit, { family: string; toSmallest: number }> = {
  KG: { family: 'mass', toSmallest: 1000 },
  G: { family: 'mass', toSmallest: 1 },
  L: { family: 'volume', toSmallest: 1000 },
  ML: { family: 'volume', toSmallest: 1 },
  PIECE: { family: 'count', toSmallest: 1 },
  DOZEN: { family: 'count', toSmallest: 12 },
  PACK: { family: 'pack', toSmallest: 1 },
  BOX: { family: 'box', toSmallest: 1 },
};

export function parseConversions(raw: unknown): UnitConversion[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is UnitConversion =>
      !!c &&
      typeof c === 'object' &&
      typeof (c as UnitConversion).unit === 'string' &&
      (c as UnitConversion).unit in FAMILY &&
      Number((c as UnitConversion).per) > 0,
  );
}

/** Units a cook may use for an item whose base unit is `base`. */
export function allowedUnits(
  base: StockUnit,
  conversions: unknown,
): StockUnit[] {
  const out = new Set<StockUnit>([base]);
  for (const u of Object.keys(FAMILY) as StockUnit[]) {
    if (FAMILY[u].family === FAMILY[base].family) out.add(u);
  }
  for (const c of parseConversions(conversions)) out.add(c.unit);
  return [...out];
}

/** The most digits after the point we store (Decimal(12,3)). */
export const QTY_SCALE = 3;

/**
 * Convert `qty` entered in `unit` to the item's base unit. Throws a 400 if the unit cannot be
 * converted unambiguously, if the number is not positive, or if the result would need more than
 * three decimals (we refuse to round stock silently).
 */
export function toBaseQuantity(
  qty: Prisma.Decimal.Value,
  unit: StockUnit,
  base: StockUnit,
  conversions: unknown,
  label = 'item',
): Prisma.Decimal {
  let q: Prisma.Decimal;
  try {
    q = D(qty);
  } catch {
    throw new BadRequestException(`Quantity for ${label} is not a number`);
  }
  if (!q.isFinite() || q.lte(0)) {
    throw new BadRequestException(
      `Quantity for ${label} must be greater than zero`,
    );
  }
  let result: Prisma.Decimal;
  if (unit === base) {
    result = q;
  } else {
    const declared = parseConversions(conversions).filter(
      (c) => c.unit === unit,
    );
    if (declared.length > 1) {
      throw new BadRequestException(
        `${label} has more than one conversion for ${unit}`,
      );
    }
    if (declared.length === 1) {
      // 1 base = per * unit  =>  qty unit = qty / per base
      result = q.div(D(declared[0].per));
    } else if (
      FAMILY[unit].family === FAMILY[base].family &&
      FAMILY[unit].family !== 'pack' &&
      FAMILY[unit].family !== 'box'
    ) {
      result = q.mul(FAMILY[unit].toSmallest).div(FAMILY[base].toSmallest);
    } else {
      throw new BadRequestException(
        `${label} is stocked in ${base}; ${unit} cannot be converted. Add a conversion on the item first.`,
      );
    }
  }
  if (result.decimalPlaces() > QTY_SCALE) {
    throw new BadRequestException(
      `${q.toString()} ${unit} of ${label} is not a whole number of thousandths of ${base}; enter it in a smaller unit`,
    );
  }
  if (result.lte(0)) {
    throw new BadRequestException(
      `Quantity for ${label} is too small to record`,
    );
  }
  return result;
}
