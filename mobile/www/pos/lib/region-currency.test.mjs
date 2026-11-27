import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestCurrency, suggestRegion } from './region-currency.js';

test('suggests a country only from an explicit region of the preferred language', () => {
  assert.equal(suggestRegion(['pt-BR', 'en-US']), 'BR');
  assert.equal(suggestRegion(['pt', 'pt-PT']), 'PT');
  assert.equal(suggestRegion(['pt', 'en-US']), '');
  assert.equal(suggestRegion(['es-419']), '');
  assert.equal(suggestRegion(['invalid_tag', 'zh-Hant-TW']), 'TW');
});

test('suggests a single local tender and leaves ambiguous countries to the owner', () => {
  for (const [country, currency] of Object.entries({ BR: 'BRL', PT: 'EUR', IN: 'INR', JP: 'JPY', PA: '', ZZ: '' })) {
    assert.equal(suggestCurrency(country), currency);
  }
});
