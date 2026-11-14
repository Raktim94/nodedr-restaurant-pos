import { costVoucher, RECOVERY_CATEGORY } from './manufacturing-alloc';

const base = {
  inputs: [
    { key: 'maida', name: 'Maida', quantity: '20', rate: '40' }, // 800
    { key: 'chicken', name: 'Chicken', quantity: '15', rate: '220' }, // 3300
    { key: 'veg', name: 'Veg', quantity: '10', rate: '30' }, // 300
  ],
  costs: [{ category: 'Labour', amount: '300', included: true }],
};

describe('costVoucher', () => {
  it('single output: (ingredients + additional) / good quantity', () => {
    const r = costVoucher({
      ...base,
      outputs: [{ key: 'momo', name: 'Momo', goodQty: '200', unit: 'PIECE' }],
    });
    expect(r.ingredientCost.toString()).toBe('4400');
    expect(r.totalCost.toString()).toBe('4700');
    expect(r.outputs[0].unitCost.toString()).toBe('23.5');
    expect(r.outputs[0].percent.toString()).toBe('100');
  });
  it('rejects are not in the divisor, so good units carry the cost', () => {
    const r = costVoucher({
      ...base,
      outputs: [{ key: 'momo', name: 'Momo', goodQty: '190', unit: 'PIECE' }],
    });
    expect(r.outputs[0].unitCost.toString()).toBe('24.7368');
  });
  it('recovered scrap value is subtracted from batch cost', () => {
    const r = costVoucher({
      ...base,
      costs: [
        ...base.costs,
        { category: RECOVERY_CATEGORY, amount: '200', included: true },
      ],
      outputs: [{ key: 'momo', name: 'Momo', goodQty: '200', unit: 'PIECE' }],
    });
    expect(r.additionalCost.toString()).toBe('100');
    expect(r.totalCost.toString()).toBe('4500');
    expect(r.outputs[0].unitCost.toString()).toBe('22.5');
  });
  it('multi output by quantity (same unit) splits shared cost and parts sum to the batch', () => {
    const r = costVoucher({
      ...base,
      method: 'QUANTITY',
      outputs: [
        { key: 'a', name: 'Momo', goodQty: '150', unit: 'PIECE' },
        { key: 'b', name: 'Big momo', goodQty: '50', unit: 'PIECE' },
      ],
    });
    expect(r.outputs[0].allocatedCost.toString()).toBe('3525');
    expect(r.outputs[1].allocatedCost.toString()).toBe('1175');
    expect(
      r.outputs
        .reduce(
          (s, o) => s.plus(o.allocatedCost),
          r.totalCost.minus(r.totalCost),
        )
        .toString(),
    ).toBe(r.totalCost.toString());
  });
  it('manual percent must total 100 and direct material goes wholly to its output', () => {
    const inputs = [
      { ...base.inputs[0], directTo: 'b' },
      base.inputs[1],
      base.inputs[2],
    ];
    const r = costVoucher({
      inputs,
      costs: base.costs,
      method: 'MANUAL',
      outputs: [
        { key: 'a', name: 'A', goodQty: '100', unit: 'PIECE', percent: '60' },
        { key: 'b', name: 'B', goodQty: '100', unit: 'KG', percent: '40' },
      ],
    });
    // shared = 3300 + 300 + 300 = 3900; a = 2340; b = 800 direct + 1560
    expect(r.outputs[0].allocatedCost.toString()).toBe('2340');
    expect(r.outputs[1].allocatedCost.toString()).toBe('2360');
    expect(() =>
      costVoucher({
        inputs,
        costs: base.costs,
        method: 'MANUAL',
        outputs: [
          { key: 'a', name: 'A', goodQty: '1', unit: 'PIECE', percent: '60' },
          { key: 'b', name: 'B', goodQty: '1', unit: 'PIECE', percent: '30' },
        ],
      }),
    ).toThrow(/add up to 100/);
  });
  it('refuses a missing split method, mixed units by quantity, and a negative batch', () => {
    const outs = [
      { key: 'a', name: 'A', goodQty: '1', unit: 'PIECE' },
      { key: 'b', name: 'B', goodQty: '1', unit: 'KG' },
    ];
    expect(() => costVoucher({ ...base, outputs: outs })).toThrow(
      /Choose how shared cost/,
    );
    expect(() =>
      costVoucher({ ...base, method: 'QUANTITY', outputs: outs }),
    ).toThrow(/same unit/);
    expect(() =>
      costVoucher({
        ...base,
        costs: [
          { category: RECOVERY_CATEGORY, amount: '99999', included: true },
        ],
        outputs: [{ key: 'a', name: 'A', goodQty: '1', unit: 'PIECE' }],
      }),
    ).toThrow(/Recovered value/);
  });
});
