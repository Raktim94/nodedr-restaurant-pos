import { BadRequestException } from '@nestjs/common';
import { costBatch, priceMetrics } from './manufacturing-calc';

const line = (key: string, quantity: string, rate: string) => ({
  key,
  name: key,
  quantity,
  rate,
});

describe('costBatch', () => {
  it('adds ingredient lines and included costs, and divides by the finished quantity', () => {
    const r = costBatch({
      lines: [line('rice', '6', '60'), line('dal', '2', '120.50')],
      costs: [
        { category: 'Labour', amount: '150', included: true },
        { category: 'Fuel', amount: '40.25', included: true },
      ],
      outputQty: '120',
    });
    expect(r.ingredientCost.toString()).toBe('601'); // 360 + 241
    expect(r.additionalCost.toString()).toBe('190.25');
    expect(r.totalCost.toString()).toBe('791.25');
    expect(r.unitCost.toString()).toBe('6.5938'); // 791.25 / 120 = 6.59375 -> half up
  });

  it('is exact where floats drift', () => {
    const r = costBatch({
      lines: [line('a', '0.1', '0.2'), line('b', '0.2', '0.1')],
      costs: [],
      outputQty: '1',
    });
    expect(r.ingredientCost.toString()).toBe('0.04'); // 0.02 + 0.02, not 0.04000000000000001
  });

  it('keeps excluded costs out of the product cost', () => {
    const r = costBatch({
      lines: [line('a', '1', '10')],
      costs: [{ category: 'Rent share', amount: '500', included: false }],
      outputQty: '2',
    });
    expect(r.additionalCost.toString()).toBe('0');
    expect(r.totalCost.toString()).toBe('10');
    expect(r.unitCost.toString()).toBe('5');
  });

  it('rounds the line cost and the unit cost half-up to 4 decimals, and the total is the authority', () => {
    const r = costBatch({
      lines: [line('a', '1', '0.33335')].map((l) => ({ ...l, rate: '0.3333' })),
      costs: [],
      outputQty: '3',
    });
    expect(r.unitCost.toString()).toBe('0.1111');
    expect(r.totalCost.toString()).toBe('0.3333');
  });

  it('rejects incomplete or impossible input instead of guessing', () => {
    expect(() =>
      costBatch({ lines: [line('a', '1', '10')], costs: [], outputQty: '0' }),
    ).toThrow(BadRequestException);
    expect(() =>
      costBatch({ lines: [line('a', '1', '10')], costs: [], outputQty: '-2' }),
    ).toThrow();
    expect(() => costBatch({ lines: [], costs: [], outputQty: '1' })).toThrow(
      /at least one ingredient/,
    );
    expect(() =>
      costBatch({ lines: [line('a', '1', '-1')], costs: [], outputQty: '1' }),
    ).toThrow(/negative/);
    expect(() =>
      costBatch({ lines: [line('a', '0', '1')], costs: [], outputQty: '1' }),
    ).toThrow(/greater than zero/);
    expect(() =>
      costBatch({
        lines: [line('a', '1', '1')],
        costs: [{ category: 'Labour', amount: '-5', included: true }],
        outputQty: '1',
      }),
    ).toThrow(/zero or more/);
    expect(() =>
      costBatch({
        lines: [line('a', '1', '1')],
        costs: [{ category: ' ', amount: '5', included: true }],
        outputQty: '1',
      }),
    ).toThrow(/category/);
    expect(() =>
      costBatch({
        lines: [line('a', '1', '1')],
        costs: [{ category: 'X', amount: '5.123', included: true }],
        outputQty: '1',
      }),
    ).toThrow(/2 decimals/);
    expect(() =>
      costBatch({ lines: [line('a', '1', 'abc')], costs: [], outputQty: '1' }),
    ).toThrow();
  });
});

describe('priceMetrics', () => {
  it('margin is of the price, markup is on the cost, and they are different numbers', () => {
    const m = priceMetrics('150', '100');
    expect(m.grossProfit.toString()).toBe('50');
    expect(m.marginPercent!.toString()).toBe('33.33'); // 50 / 150
    expect(m.markupPercent!.toString()).toBe('50'); // 50 / 100
  });
  it('does not divide by zero', () => {
    expect(priceMetrics('0', '10').marginPercent).toBeNull();
    expect(priceMetrics('10', '0').markupPercent).toBeNull();
  });
  it('shows a loss as a negative number', () => {
    const m = priceMetrics('80', '100');
    expect(m.grossProfit.toString()).toBe('-20');
    expect(m.marginPercent!.toString()).toBe('-25');
  });
});
