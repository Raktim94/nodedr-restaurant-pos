import { BadRequestException } from '@nestjs/common';
import { priceLine } from './pricing';
import {
  assertManualDiscountAllowed,
  computeBill,
  discountPercentOf,
  manualDiscountEntry,
  settlePayments,
} from './settlement';

const line = (price: number, qty = 1, tax = 0) =>
  priceLine({ quantity: qty, unitPriceInclusive: price, taxRatePercent: tax });

describe('computeBill', () => {
  it('has no discount, tax-inclusive total equals subtotal', () => {
    const b = computeBill({ lines: [line(118, 1, 18)] });
    expect(b).toMatchObject({
      subtotal: 118,
      discountAmount: 0,
      discountPercent: 0,
      taxAmount: 18,
      totalDue: 118,
    });
  });

  it('shows a percentage discount as both percent and amount', () => {
    const b = computeBill({ lines: [line(200, 1, 0)], discountPercent: 10 });
    expect(b.discountAmount).toBe(20);
    expect(b.discountPercent).toBe(10);
    expect(b.totalDue).toBe(180);
  });

  it('shows a flat discount with its percentage equivalent', () => {
    const b = computeBill({ lines: [line(300, 1, 0)], discountFlat: 45 });
    expect(b.discountAmount).toBe(45);
    expect(b.discountPercent).toBe(15);
    expect(b.totalDue).toBe(255);
  });

  it('adds a coupon on top of the manual discount without applying it twice', () => {
    const b = computeBill({
      lines: [line(1000, 1, 0)],
      discountPercent: 10,
      autoDiscount: 50,
    });
    expect(b.discountAmount).toBe(150);
    expect(b.discountPercent).toBe(15);
    expect(b.totalDue).toBe(850);
  });

  it('never discounts below zero', () => {
    const b = computeBill({ lines: [line(100)], discountFlat: 500 });
    expect(b.discountAmount).toBe(100);
    expect(b.discountPercent).toBe(100);
    expect(b.totalDue).toBe(0);
  });

  it('reduces the tax breakup pro-rata with the discount', () => {
    // 118 incl. 18% -> 18 tax; 50% off leaves 59 incl. 9 tax.
    const b = computeBill({ lines: [line(118, 1, 18)], discountPercent: 50 });
    expect(b.taxAmount).toBe(9);
    expect(b.totalDue).toBe(59);
  });

  it('adds tip and delivery fee outside the taxable subtotal', () => {
    const b = computeBill({
      lines: [line(118, 1, 18)],
      discountPercent: 10,
      tip: 12.5,
      deliveryFee: 30,
    });
    expect(b.discountAmount).toBe(11.8);
    expect(b.taxAmount).toBe(16.2);
    expect(b.totalDue).toBe(148.7); // 118 - 11.8 + 12.5 + 30
  });

  it('caps loyalty redemption at the discounted total and leaves tax alone', () => {
    const b = computeBill({
      lines: [line(118, 1, 18)],
      loyaltyDiscountRequested: 500,
    });
    expect(b.loyaltyDiscountAmount).toBe(118);
    expect(b.taxAmount).toBe(18);
    expect(b.totalDue).toBe(0);
  });

  it('rounds to 2 decimals consistently', () => {
    const b = computeBill({ lines: [line(33.33, 3, 5)], discountPercent: 7.5 });
    expect(b.subtotal).toBe(99.99);
    expect(b.discountAmount).toBe(7.5);
    expect(b.totalDue).toBe(92.49);
  });

  it('handles an empty bill', () => {
    expect(computeBill({ lines: [] }).totalDue).toBe(0);
  });
});

describe('discount helpers', () => {
  it('computes the percentage equivalent', () => {
    expect(discountPercentOf(200, 20)).toBe(10);
    expect(discountPercentOf(0, 20)).toBe(0);
    expect(discountPercentOf(200, 0)).toBe(0);
  });
  it('remembers how the manual discount was entered', () => {
    expect(manualDiscountEntry(10, 0)).toEqual({ type: 'PERCENT', value: 10 });
    expect(manualDiscountEntry(0, 40)).toEqual({ type: 'FIXED', value: 40 });
    expect(manualDiscountEntry(0, 0)).toBeNull();
  });
});

describe('settlePayments', () => {
  it('settles an exact single payment', () => {
    const s = settlePayments({
      balance: 100,
      payments: [{ method: 'UPI', amount: 100 }],
    });
    expect(s).toMatchObject({
      fullyPaid: true,
      paidNow: 100,
      balanceAfter: 0,
      changeDue: 0,
    });
  });

  it('records cash handed over and the change given back', () => {
    const s = settlePayments({
      balance: 180,
      payments: [{ method: 'CASH', amount: 180, tendered: 200 }],
    });
    expect(s.payments[0]).toMatchObject({
      amount: 180,
      tendered: 200,
      changeGiven: 20,
    });
    expect(s.changeDue).toBe(20);
    expect(s.fullyPaid).toBe(true);
  });

  it('treats an over-sized cash amount from an older client as change', () => {
    const s = settlePayments({
      balance: 180,
      payments: [{ method: 'CASH', amount: 200 }],
    });
    expect(s.payments[0]).toMatchObject({
      amount: 180,
      tendered: 200,
      changeGiven: 20,
    });
    expect(s.paidNow).toBe(180);
  });

  it('supports several methods that add up to the balance', () => {
    const s = settlePayments({
      balance: 500,
      payments: [
        { method: 'CASH', amount: 200 },
        { method: 'CARD', amount: 300 },
      ],
    });
    expect(s.fullyPaid).toBe(true);
    expect(s.payments).toHaveLength(2);
  });

  it('takes change out of the cash line when a card line already covers part', () => {
    const s = settlePayments({
      balance: 500,
      payments: [
        { method: 'CARD', amount: 300 },
        { method: 'CASH', amount: 250, tendered: 250 },
      ],
    });
    expect(s.payments[1]).toMatchObject({
      amount: 200,
      tendered: 250,
      changeGiven: 50,
    });
  });

  it('refuses an overpayment that cash cannot absorb', () => {
    expect(() =>
      settlePayments({
        balance: 100,
        payments: [{ method: 'CARD', amount: 150 }],
      }),
    ).toThrow(BadRequestException);
  });

  it('refuses a short payment unless partial is allowed', () => {
    expect(() =>
      settlePayments({
        balance: 100,
        payments: [{ method: 'CASH', amount: 40 }],
      }),
    ).toThrow(/do not cover/);
    const s = settlePayments({
      balance: 100,
      payments: [{ method: 'CASH', amount: 40 }],
      allowPartial: true,
    });
    expect(s).toMatchObject({
      fullyPaid: false,
      paidNow: 40,
      balanceAfter: 60,
    });
  });

  it('refuses a partial settlement with no payment in it', () => {
    expect(() =>
      settlePayments({ balance: 100, payments: [], allowPartial: true }),
    ).toThrow(/Enter a payment/);
  });

  it('counts a gift card toward the balance', () => {
    const s = settlePayments({
      balance: 100,
      giftCardApplied: 60,
      payments: [{ method: 'UPI', amount: 40 }],
    });
    expect(s).toMatchObject({ fullyPaid: true, paidNow: 100 });
  });

  it('allows a zero balance with no payments (fully covered by points)', () => {
    expect(settlePayments({ balance: 0, payments: [] }).fullyPaid).toBe(true);
  });

  it('rejects tendered on a non-cash payment or below the amount', () => {
    expect(() =>
      settlePayments({
        balance: 100,
        payments: [{ method: 'CARD', amount: 100, tendered: 120 }],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      settlePayments({
        balance: 100,
        payments: [{ method: 'CASH', amount: 100, tendered: 90 }],
      }),
    ).toThrow(BadRequestException);
  });

  it('survives binary-float cents', () => {
    const s = settlePayments({
      balance: 0.3,
      payments: [
        { method: 'CASH', amount: 0.1 },
        { method: 'UPI', amount: 0.2 },
      ],
    });
    expect(s.fullyPaid).toBe(true);
  });
});

describe('billing scenarios from the field (350 / 300 / 400, 500 less 50)', () => {
  const bill350 = () => computeBill({ lines: [line(350)] }).totalDue;

  it('exact cash: paid, stored payment is the full 350', () => {
    const s = settlePayments({
      balance: bill350(),
      payments: [{ method: 'CASH', amount: 350 }],
    });
    expect(s.fullyPaid).toBe(true);
    expect(s.payments.map((p) => p.amount)).toEqual([350]);
    expect(s.balanceAfter).toBe(0);
  });

  it('short cash: records 300, never 350, leaves 50 due and is not paid', () => {
    const s = settlePayments({
      balance: bill350(),
      payments: [{ method: 'CASH', amount: 300 }],
      allowPartial: true,
    });
    expect(s.fullyPaid).toBe(false);
    expect(s.paidNow).toBe(300);
    expect(s.payments.map((p) => p.amount)).toEqual([300]);
    expect(s.balanceAfter).toBe(50);
  });

  it('short cash without the partial flag is refused, not silently marked paid', () => {
    expect(() =>
      settlePayments({
        balance: bill350(),
        payments: [{ method: 'CASH', amount: 300 }],
      }),
    ).toThrow(BadRequestException);
  });

  it('excess cash: stores 350 applied, 400 tendered, 50 change, nothing due', () => {
    const s = settlePayments({
      balance: bill350(),
      payments: [{ method: 'CASH', amount: 350, tendered: 400 }],
    });
    expect(s.payments[0]).toMatchObject({
      amount: 350,
      tendered: 400,
      changeGiven: 50,
    });
    expect(s.changeDue).toBe(50);
    expect(s.balanceAfter).toBe(0);
    expect(s.fullyPaid).toBe(true);
  });

  it('second part-payment settles only what is left', () => {
    const s = settlePayments({
      balance: 50,
      payments: [{ method: 'UPI', amount: 50 }],
    });
    expect(s.fullyPaid).toBe(true);
  });

  it('500 with a 50 cash discount is 450 payable', () => {
    const b = computeBill({ lines: [line(500)], discountFlat: 50 });
    expect(b.subtotal).toBe(500);
    expect(b.discountAmount).toBe(50);
    expect(b.totalDue).toBe(450);
  });
});

describe('assertManualDiscountAllowed', () => {
  const base = {
    subtotal: 500,
    maxPercent: 10,
    requireReason: false,
    mayExceedCap: false,
  };

  it('allows a discount at or under the cap', () => {
    expect(() =>
      assertManualDiscountAllowed({ ...base, discountPercent: 10 }),
    ).not.toThrow();
    expect(() =>
      assertManualDiscountAllowed({ ...base, discountFlat: 50 }),
    ).not.toThrow();
  });

  it('refuses a percentage over the cap', () => {
    expect(() =>
      assertManualDiscountAllowed({ ...base, discountPercent: 11 }),
    ).toThrow(/above 10%/);
  });

  it('measures a flat discount by its percentage of the subtotal', () => {
    expect(() =>
      assertManualDiscountAllowed({ ...base, discountFlat: 51 }),
    ).toThrow(BadRequestException);
  });

  it('lets an owner / unlimited grant go past the cap', () => {
    expect(() =>
      assertManualDiscountAllowed({
        ...base,
        discountPercent: 100,
        mayExceedCap: true,
      }),
    ).not.toThrow();
  });

  it('default cap of 100 changes nothing', () => {
    expect(() =>
      assertManualDiscountAllowed({
        ...base,
        maxPercent: 100,
        discountPercent: 100,
      }),
    ).not.toThrow();
  });

  it('requires a reason only when configured and a discount is given', () => {
    const req = { ...base, maxPercent: 100, requireReason: true };
    expect(() =>
      assertManualDiscountAllowed({ ...req, discountPercent: 5 }),
    ).toThrow(/reason/);
    expect(() =>
      assertManualDiscountAllowed({ ...req, discountPercent: 5, reason: '  ' }),
    ).toThrow(/reason/);
    expect(() =>
      assertManualDiscountAllowed({
        ...req,
        discountPercent: 5,
        reason: 'Regular guest',
      }),
    ).not.toThrow();
    expect(() => assertManualDiscountAllowed({ ...req })).not.toThrow();
  });
});
