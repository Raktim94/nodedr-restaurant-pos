import assert from 'node:assert/strict';
import test from 'node:test';
import { addOnsText, parseAddOns } from './local.js';

test('a decimal-comma add-on keeps its price when the menu is edited again', () => {
  const choices = parseAddOns('Cheese = 2,50\nIce', [], 'pt-BR');
  assert.deepEqual(choices.map(({ name, price }) => [name, price]), [['Cheese', 2.5], ['Ice', 0]]);
  const text = addOnsText({ options: [{ choices }] }, 'pt-BR');
  assert.equal(text, 'Cheese = 2,50\nIce');
  assert.deepEqual(parseAddOns(text, choices, 'pt-BR'), choices);
});
