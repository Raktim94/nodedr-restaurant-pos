// The phone runs the same recipe-costing code as the server. This runs the shared vectors through the
// generated copy (costing.js) and fails if it has drifted from packages/types/src/costing.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as e from './costing.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../..');
const vectors = JSON.parse(readFileSync(join(root, 'packages/types/costing-vectors.json'), 'utf8'));

function subset(actual, expected, path) {
  if (expected === null) return assert.equal(actual, null, path);
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), path);
    for (const [i, x] of expected.entries()) {
      assert.ok(actual.some((a) => { try { subset(a, x, path); return true; } catch { return false; } }), `${path}[${i}] no match in ${JSON.stringify(actual)}`);
    }
    return;
  }
  if (typeof expected === 'object') {
    for (const k of Object.keys(expected)) subset(actual && actual[k], expected[k], `${path}.${k}`);
    return;
  }
  if (typeof expected === 'number') return assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-6, `${path}: ${actual} != ${expected}`);
  assert.equal(actual, expected, path);
}

function run(v) {
  const map = new Map((v.ingredients || []).map((i) => [i.id, i]));
  const a = v.args;
  switch (v.fn) {
    case 'convertQty': return e.convertQty(a.qty, a.from_, a.to, a.stockUnit, a.conversions);
    case 'costRecipe': return e.costRecipe(a.recipe, map);
    case 'suggestPrice': return e.suggestPrice(a);
    case 'profitability': return e.profitability(a);
    case 'marginAlert': return e.marginAlert(a);
    case 'wouldCreateCycle': return e.wouldCreateCycle(a.output, a.candidates, (id) => a.graph[id] || []);
    case 'costModifierLines': return e.costModifierLines(a.lines, map);
    case 'unitCostOfSale': return e.unitCostOfSale(a);
    case 'stockNeedsForPortions': return e.stockNeedsForPortions(a.recipe, map, a.portions);
    default: throw new Error('unknown vector ' + v.fn);
  }
}

for (const v of vectors) {
  test(v.name, () => {
    const got = run(v);
    if (v.expect === null) assert.equal(got, null);
    else if (typeof v.expect === 'boolean') assert.equal(got, v.expect);
    else if (typeof v.expect === 'number') assert.ok(Math.abs(got - v.expect) < 1e-6);
    else subset(got, v.expect, 'result');
  });
}

test('generated costing.js is in step with packages/types/src/costing.ts', () => {
  execFileSync('node', [join(root, 'scripts/gen-mobile-costing.mjs'), '--check'], { stdio: 'pipe' });
});
