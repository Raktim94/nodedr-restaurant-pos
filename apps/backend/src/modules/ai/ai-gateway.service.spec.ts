import { AiGatewayService } from './ai-gateway.service';

describe('AiGatewayService invoice parser', () => {
  const service = new AiGatewayService({} as never, {} as never);

  it('extracts common Indian invoice fields without an external API', () => {
    expect(
      service.parseInvoiceText(`
        TAX INVOICE
        Invoice No: INV-2026/104
        Date: 30/10/2026
        GSTIN 24ABCDE1234F1Z5
        Grand Total ₹ 12,450.75
      `),
    ).toMatchObject({
      invoiceNumber: 'INV-2026/104',
      invoiceDate: '30/10/2026',
      gstNumber: '24ABCDE1234F1Z5',
      totalAmount: 12450.75,
      requiresHumanReview: false,
    });
  });

  it('requires review when mandatory values are missing', () => {
    expect(service.parseInvoiceText('Supplier ABC')).toMatchObject({
      requiresHumanReview: true,
      totalAmount: null,
    });
  });
});
