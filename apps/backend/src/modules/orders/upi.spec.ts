import { buildUpiUri, upiForBill } from './upi';
import { buildReceiptEscPosJob } from './escpos-receipt';

const base = {
  vpa: 'shop@upi',
  payeeName: 'PKUSS Hotel',
  orderNumber: '20261102-0001',
  balanceDue: 1080,
  isProvisional: true,
};

describe('UPI QR on the bill', () => {
  it('builds an NPCI deep link with the exact amount', () => {
    const uri = buildUpiUri({ vpa: 'a@b', name: 'My Shop', amount: 12.5 });
    expect(uri).toBe('upi://pay?pa=a%40b&pn=My%20Shop&am=12.50&cu=INR');
  });

  it('only appears on an unpaid bill with a UPI id and an amount due', () => {
    expect(upiForBill(base)?.uri).toContain('am=1080.00');
    expect(upiForBill({ ...base, vpa: null })).toBeNull();
    expect(upiForBill({ ...base, vpa: '  ' })).toBeNull();
    expect(upiForBill({ ...base, isProvisional: false })).toBeNull();
    expect(upiForBill({ ...base, balanceDue: 0 })).toBeNull();
  });

  it('prints the QR and the amount on the thermal bill, not on a paid receipt', () => {
    const upi = upiForBill(base)!;
    const mk = (isProvisional: boolean, withUpi: boolean) =>
      buildReceiptEscPosJob({
        restaurantName: 'PKUSS',
        currency: 'INR',
        branch: {
          name: 'Main',
          address: null,
          phone: null,
          gstNumber: null,
          taxRegime: 'INDIA_GST' as never,
          taxMode: 'INCLUSIVE' as never,
          taxLabel: null,
          taxId: null,
        },
        order: {
          orderNumber: '1',
          type: 'DINE_IN',
          createdAt: new Date(),
          table: null,
          customer: null,
          subtotal: 1080,
          discountAmount: 0,
          taxAmount: 0,
          tipAmount: 0,
          loyaltyPointsRedeemed: 0,
          loyaltyDiscountAmount: 0,
          totalAmount: 1080,
          items: [],
          payments: [],
          isProvisional,
          upi: withUpi ? upi : null,
        } as never,
      }).buffer.toString('latin1');
    expect(mk(true, true)).toContain('upi://pay?pa=shop%40upi');
    expect(mk(true, true)).toContain('Scan to pay by UPI');
    expect(mk(true, false)).not.toContain('upi://pay');
    expect(mk(false, true)).not.toContain('upi://pay');
  });
});
