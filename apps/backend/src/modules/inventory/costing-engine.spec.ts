// Runs the shared vectors (packages/types/costing-vectors.json) through the engine the server
// uses. The phone's copy runs the same vectors in mobile/www/pos/lib/costing.test.mjs.
import { readFileSync } from 'fs';
import { join } from 'path';
import * as engine from '@nodedr-restaurant/types';

interface Vector {
  name: string;
  fn: string;
  args: Record<string, any>;
  ingredients?: any[];
  expect: any;
}
const vectors: Vector[] = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../packages/types/costing-vectors.json'),
    'utf8',
  ),
);

function subset(actual: any, expected: any, path: string): void {
  if (expected === null) return expect({ path, actual }).toEqual({ path, actual: null });
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true);
    expected.forEach((e, i) => {
      // issues / lines arrays: match the element that satisfies the expectation
      const hit = (actual as any[]).some((a) => {
        try {
          subset(a, e, `${path}[${i}]`);
          return true;
        } catch {
          return false;
        }
      });
      expect({ path: `${path}[${i}]`, hit, actual }).toMatchObject({ hit: true });
    });
    return;
  }
  if (typeof expected === 'object') {
    for (const k of Object.keys(expected)) subset(actual?.[k], expected[k], `${path}.${k}`);
    return;
  }
  if (typeof expected === 'number') {
    expect({ path, v: actual }).toEqual({ path, v: expect.any(Number) });
    expect(Math.abs((actual as number) - expected)).toBeLessThan(1e-6);
    return;
  }
  expect({ path, actual }).toEqual({ path, actual: expected });
}

function run(v: Vector): any {
  const map = new Map<string, engine.CostIngredient>(
    (v.ingredients ?? []).map((i) => [i.id, i]),
  );
  const a = v.args;
  switch (v.fn) {
    case 'convertQty':
      return engine.convertQty(a.qty, a.from_, a.to, a.stockUnit, a.conversions);
    case 'costRecipe':
      return engine.costRecipe(a.recipe, map);
    case 'suggestPrice':
      return engine.suggestPrice(a as any);
    case 'profitability':
      return engine.profitability(a as any);
    case 'marginAlert':
      return engine.marginAlert(a as any);
    case 'wouldCreateCycle':
      return engine.wouldCreateCycle(a.output, a.candidates, (id) => a.graph[id] ?? []);
    case 'costModifierLines':
      return engine.costModifierLines(a.lines, map);
    case 'unitCostOfSale':
      return engine.unitCostOfSale(a as any);
    case 'stockNeedsForPortions':
      return engine.stockNeedsForPortions(a.recipe, map, a.portions);
    default:
      throw new Error(`unknown vector fn ${v.fn}`);
  }
}

describe('recipe costing engine (shared vectors)', () => {
  it('has the required spec examples', () => {
    const names = vectors.map((v) => v.name).join('|');
    expect(names).toContain('flour 50/kg x 200 g = 10');
    expect(names).toContain('batch 600 over 20 portions = 30 each');
    expect(names).toContain('30 cost, 60% margin -> 75 before tax');
    expect(names).toContain('30 cost, 60% markup -> 48 before tax');
  });
  for (const v of vectors) {
    it(v.name, () => {
      const got = run(v);
      if (v.expect === null) expect(got).toBeNull();
      else if (typeof v.expect === 'boolean') expect(got).toBe(v.expect);
      else if (typeof v.expect === 'number') expect(got).toBeCloseTo(v.expect, 6);
      else subset(got, v.expect, 'result');
    });
  }
});
