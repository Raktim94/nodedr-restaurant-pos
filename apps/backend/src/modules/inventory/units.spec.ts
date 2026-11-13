import { BadRequestException } from '@nestjs/common';
import { allowedUnits, toBaseQuantity } from './units';

describe('toBaseQuantity (decimal-safe)', () => {
  it('is exact where floats drift: 0.1 + 0.2 kg is 0.3 kg', () => {
    const a = toBaseQuantity('100', 'G', 'KG', []);
    const b = toBaseQuantity('200', 'G', 'KG', []);
    expect(a.plus(b).toString()).toBe('0.3');
  });
  it('converts within a family both ways', () => {
    expect(toBaseQuantity('2.5', 'KG', 'G', []).toString()).toBe('2500');
    expect(toBaseQuantity('250', 'ML', 'L', []).toString()).toBe('0.25');
    expect(toBaseQuantity('2', 'DOZEN', 'PIECE', []).toString()).toBe('24');
  });
  it('uses a declared conversion, 25 kg bag consumed in grams', () => {
    // 1 PACK(base) = 25000 G
    expect(toBaseQuantity('500', 'G', 'PACK', [{ unit: 'G', per: 25000 }]).toString()).toBe('0.02');
    // received as KG for an item stocked in KG, 1 KG = 1000 G
    expect(toBaseQuantity('1', 'G', 'KG', []).toString()).toBe('0.001');
  });
  it('refuses ambiguous or impossible conversions', () => {
    expect(() => toBaseQuantity('1', 'KG', 'PIECE', [])).toThrow(BadRequestException);
    expect(() => toBaseQuantity('1', 'PACK', 'KG', [])).toThrow(/cannot be converted/);
    expect(() =>
      toBaseQuantity('1', 'G', 'PACK', [
        { unit: 'G', per: 10 },
        { unit: 'G', per: 20 },
      ]),
    ).toThrow(/more than one/);
  });
  it('refuses zero, negative, NaN and silent rounding', () => {
    expect(() => toBaseQuantity('0', 'KG', 'KG', [])).toThrow();
    expect(() => toBaseQuantity('-1', 'KG', 'KG', [])).toThrow();
    expect(() => toBaseQuantity('abc', 'KG', 'KG', [])).toThrow(/not a number/);
    expect(() => toBaseQuantity('0.5', 'G', 'KG', [])).toThrow(/smaller unit/); // 0.0005 kg needs 4 decimals
  });
  it('lists the units a cook may pick', () => {
    expect(allowedUnits('KG', []).sort()).toEqual(['G', 'KG']);
    expect(allowedUnits('PACK', [{ unit: 'G', per: 500 }]).sort()).toEqual(['G', 'PACK']);
  });
});
