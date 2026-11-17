import { GoodsReceiptsService } from './goods-receipts.service';
import { PurchaseOrdersService } from './purchase-orders.service';

function fixture() {
  let count = 0;
  let ingredient = { id: 'rice', currentStock: 10, costPerUnit: 2 };
  const po = {
    id: 'po',
    status: 'SENT',
    items: [
      {
        id: 'line',
        ingredientId: 'rice',
        quantityReceived: 1,
        quantityOrdered: 20,
      },
    ],
  };
  const tx = {
    $queryRaw: jest.fn((sql: TemplateStringsArray) => {
      const statement = sql.join('?');
      if (statement.includes('FROM branches')) count = 7;
      if (statement.includes('FROM purchase_orders'))
        po.items[0].quantityReceived = 4;
      if (statement.includes('FROM ingredients'))
        ingredient = { id: 'rice', currentStock: 15, costPerUnit: 4 };
      return [];
    }),
    purchaseOrder: {
      findFirst: jest.fn(() => po),
      update: jest.fn(() => ({})),
    },
    purchaseOrderItem: {
      update: jest.fn(({ data }: { data: { quantityReceived: number } }) => {
        po.items[0].quantityReceived = data.quantityReceived;
      }),
      findMany: jest.fn(() => po.items),
    },
    ingredient: {
      findMany: jest.fn(() => [ingredient]),
      update: jest.fn(
        ({ data }: { data: { currentStock: number; costPerUnit: number } }) => {
          Object.assign(ingredient, data);
        },
      ),
    },
    goodsReceipt: {
      count: jest.fn(() => count),
      create: jest.fn(() => ({ id: 'grn' })),
      findUniqueOrThrow: jest.fn(() => ({ id: 'grn' })),
    },
    goodsReceiptItem: { create: jest.fn(() => ({ id: 'grn-item' })) },
    stockBatch: { create: jest.fn(() => ({ id: 'batch' })) },
    stockMovement: { create: jest.fn(() => ({})) },
  };
  const prisma = {
    supplier: { findFirst: jest.fn(() => ({ id: 'supplier' })) },
    $transaction: (work: (t: typeof tx) => unknown) => work(tx),
  };
  return { tx, prisma, po, balance: () => ingredient };
}

const receipt = {
  supplierId: 'supplier',
  purchaseOrderId: 'po',
  items: [
    {
      ingredientId: 'rice',
      purchaseOrderItemId: 'line',
      quantity: 2,
      unitCost: 10,
    },
    {
      ingredientId: 'rice',
      purchaseOrderItemId: 'line',
      quantity: 3,
      unitCost: 10,
    },
  ],
};

describe('receipt posting against concurrent inventory changes', () => {
  it('allocates its number and applies stock, costs and PO totals from locked state', async () => {
    const f = fixture();
    await new GoodsReceiptsService(f.prisma as never).createGoodsReceipt(
      'branch',
      'user',
      receipt,
    );
    expect(Number(f.balance().currentStock)).toBe(20);
    // 15 units at 4 plus 5 units at 10: 110 / 20 = 5.5.
    expect(Number(f.balance().costPerUnit)).toBe(5.5);
    expect(f.po.items[0].quantityReceived).toBe(9);
    const receiptData = f.tx.goodsReceipt.create.mock.calls as unknown as Array<
      [{ data: { grnNumber: string } }]
    >;
    expect(receiptData[0][0].data.grnNumber).toBe('GRN-0008');
    expect(f.tx.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: 'po' },
      data: { status: 'PARTIALLY_RECEIVED' },
    });
  });

  it('rejects receipt posting if the locked PO is already cancelled', async () => {
    const f = fixture();
    f.po.status = 'CANCELLED';
    await expect(
      new GoodsReceiptsService(f.prisma as never).createGoodsReceipt(
        'branch',
        'user',
        receipt,
      ),
    ).rejects.toThrow('already CANCELLED');
    expect(f.tx.goodsReceipt.create).not.toHaveBeenCalled();
    expect(f.tx.ingredient.update).not.toHaveBeenCalled();
  });

  it('rejects a PO cancelled while receipt posting was waiting', async () => {
    const f = fixture();
    f.tx.purchaseOrder.findFirst.mockImplementation(() => ({
      ...f.po,
      status: 'CANCELLED',
    }));
    await expect(
      new GoodsReceiptsService(f.prisma as never).createGoodsReceipt(
        'branch',
        'user',
        receipt,
      ),
    ).rejects.toThrow('already CANCELLED');
    expect(f.tx.goodsReceipt.create).not.toHaveBeenCalled();
  });

  it('does not cancel a PO whose receipt completed while cancellation waited', async () => {
    const f = fixture();
    f.tx.purchaseOrder.findFirst.mockImplementation(() => ({
      ...f.po,
      status: 'RECEIVED',
    }));
    await expect(
      new PurchaseOrdersService(f.prisma as never).updateStatus(
        'branch',
        'po',
        'CANCELLED',
      ),
    ).rejects.toThrow('from RECEIVED to CANCELLED');
    expect(f.tx.$queryRaw).toHaveBeenCalled();
    expect(f.tx.purchaseOrder.update).not.toHaveBeenCalled();
  });
});

it('allocates a PO number from the count after acquiring the branch lock', async () => {
  let count = 2;
  const tx = {
    $queryRaw: jest.fn(() => {
      count = 3;
      return [];
    }),
    purchaseOrder: {
      count: jest.fn(() => count),
      create: jest.fn((args: { data: { poNumber: string } }) => args.data),
    },
  };
  const prisma = {
    supplier: { findFirst: jest.fn(() => ({ id: 'supplier' })) },
    ingredient: { count: jest.fn(() => 1) },
    $transaction: (work: (client: typeof tx) => unknown) => work(tx),
  };
  const result = await new PurchaseOrdersService(
    prisma as never,
  ).createPurchaseOrder('branch', 'user', {
    supplierId: 'supplier',
    items: [{ ingredientId: 'rice', quantityOrdered: 2, unitCost: 10 }],
  });
  expect(result.poNumber).toBe('PO-0004');
  expect(tx.$queryRaw).toHaveBeenCalled();
});
