import { Injectable } from '@nestjs/common';
import { BillShareService } from '../bill-share/bill-share.service';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class PublicBillService {
  constructor(
    private readonly billShare: BillShareService,
    private readonly orders: OrdersService,
  ) {}

  // Deliberately returns only what a paper bill already shows the guest —
  // no internal ids, cost prices, or anything from another order. Live
  // prices (getBillForPrint, same as the staff receipt route) so a bill
  // shared before payment reflects any item added since the QR was shown.
  async getByToken(token: string) {
    const { orderId, branchId } = this.billShare.verifyToken(token);
    const { order, overrides } = await this.orders.getBillForPrint(
      branchId,
      orderId,
      {},
    );
    const restaurant = order.branch.restaurant;

    return {
      restaurantName: restaurant.name,
      currency: restaurant.currency,
      branch: {
        name: order.branch.name,
        address: order.branch.address,
        phone: order.branch.phone,
      },
      order: {
        orderNumber: order.orderNumber,
        type: order.type,
        createdAt: order.createdAt,
        table: order.table
          ? { label: order.table.name ?? `#${order.table.number}` }
          : null,
        customer: order.customer ? { name: order.customer.name } : null,
        subtotal: Number(order.subtotal),
        discountAmount: Number(overrides.discountAmount),
        taxAmount: Number(overrides.taxAmount),
        tipAmount: Number(overrides.tipAmount),
        loyaltyDiscountAmount: Number(overrides.loyaltyDiscountAmount),
        totalAmount: Number(overrides.totalAmount),
        isProvisional: overrides.isProvisional,
        amountPaid: Number(overrides.amountPaid),
        balanceDue: Number(overrides.balanceDue),
        items: order.items.map((item) => ({
          nameSnapshot: item.nameSnapshot,
          quantity: item.quantity,
          unitPriceSnapshot: Number(item.unitPriceSnapshot),
          lineTotal: Number(item.lineTotal),
          modifiers: item.modifiers.map((m) => ({
            nameSnapshot: m.nameSnapshot,
            priceAdjSnapshot: Number(m.priceAdjSnapshot),
          })),
        })),
        payments: order.payments.map((p) => ({
          method: p.method,
          amount: Number(p.amount),
        })),
      },
      // Only offered while something is still owed — a paid bill has
      // nothing left to collect, so no payment prompt on the guest's screen.
      upi:
        overrides.isProvisional && overrides.balanceDue > 0 && restaurant.upiVpa
          ? {
              vpa: restaurant.upiVpa,
              payeeName: restaurant.upiPayeeName || restaurant.name,
            }
          : null,
    };
  }
}
