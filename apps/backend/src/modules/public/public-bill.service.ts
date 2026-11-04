import { Injectable } from '@nestjs/common';
import { BillShareService } from '../bill-share/bill-share.service';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class PublicBillService {
  constructor(
    private readonly billShare: BillShareService,
    private readonly orders: OrdersService,
  ) {}

  // Returns only what a paper bill already shows: no internal ids, costs or
  // other orders. Priced live with the adjustments signed into the token, so
  // an item added after the QR was shown is reflected and a paid order shows
  // its stored receipt figures.
  async getByToken(token: string) {
    const { orderId, branchId, adj } = this.billShare.verifyToken(token);
    const { order, overrides } = await this.orders.getBillForPrint(
      branchId,
      orderId,
      adj,
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
      // Only while something is still owed and a VPA is configured.
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
