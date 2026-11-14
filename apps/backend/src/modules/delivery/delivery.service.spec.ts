/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access */
import { BadRequestException } from '@nestjs/common';
import { DeliveryService } from './delivery.service';

function setup(order: Record<string, unknown> | null, zoneClash = false) {
  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue(order),
      update: jest
        .fn()
        .mockImplementation(({ data }) => ({ ...order, ...data })),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'd1' }) },
    deliveryAssignment: { create: jest.fn().mockResolvedValue({}) },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
    deliveryZone: {
      findFirst: jest
        .fn()
        .mockResolvedValue(zoneClash ? { name: 'Central' } : null),
      create: jest.fn().mockResolvedValue({ id: 'z1' }),
    },
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  (prisma.order as Record<string, unknown>).findUniqueOrThrow = jest
    .fn()
    .mockImplementation(() => ({ ...order, driverId: 'd1' }));
  const realtime = { emitToBranch: jest.fn(), emitToUsers: jest.fn() };
  const webhooks = { emitForBranch: jest.fn() };
  const svc = new DeliveryService(
    prisma as never,
    realtime as never,
    webhooks as never,
    { sendToUsers: jest.fn() } as never,
  );
  return { svc, prisma, realtime };
}

describe('DeliveryService', () => {
  it('assigning a driver moves UNASSIGNED to ASSIGNED', async () => {
    const { svc, prisma, realtime } = setup({
      id: 'o1',
      deliveryStatus: 'UNASSIGNED',
    });
    await svc.assignDriver('b1', 'o1', 'd1', 'staff1');
    expect(
      prisma.deliveryAssignment.create.mock.calls[0][0].data,
    ).toMatchObject({
      fromDriverId: undefined,
      toDriverId: 'd1',
      assignedById: 'staff1',
    });
    expect(prisma.order.update.mock.calls[0][0].data).toEqual({
      driverId: 'd1',
      deliveryStatus: 'ASSIGNED',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest asymmetric matcher
      assignedAt: expect.any(Date),
    });
    // the rider's phone is told straight away
    expect(realtime.emitToUsers).toHaveBeenCalledWith(
      ['d1'],
      'rider.assigned',
      expect.objectContaining({ orderId: 'o1' }),
    );
    expect(realtime.emitToBranch).toHaveBeenCalledWith('b1', 'order.updated', {
      id: 'o1',
    });
  });

  it('refuses to reassign once picked up', async () => {
    const { svc } = setup({ id: 'o1', deliveryStatus: 'PICKED_UP' });
    await expect(
      svc.assignDriver('b1', 'o1', 'd1', 'staff1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('giving the same rider again does nothing (double click, retry)', async () => {
    const { svc, prisma, realtime } = setup({
      id: 'o1',
      deliveryStatus: 'ASSIGNED',
      driverId: 'd1',
    });
    await svc.assignDriver('b1', 'o1', 'd1', 'staff1');
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.deliveryAssignment.create).not.toHaveBeenCalled();
    expect(realtime.emitToUsers).not.toHaveBeenCalled();
  });

  it('moving to a different rider needs a reason, then records it and tells the old rider', async () => {
    const { svc, prisma, realtime } = setup({
      id: 'o1',
      deliveryStatus: 'ASSIGNED',
      driverId: 'd0',
    });
    await expect(svc.assignDriver('b1', 'o1', 'd1', 'staff1')).rejects.toThrow(
      /why/,
    );
    await svc.assignDriver('b1', 'o1', 'd1', 'staff1', 'Rider d0 is off sick');
    expect(
      prisma.deliveryAssignment.create.mock.calls[0][0].data,
    ).toMatchObject({
      fromDriverId: 'd0',
      toDriverId: 'd1',
      reason: 'Rider d0 is off sick',
    });
    expect(realtime.emitToUsers).toHaveBeenCalledWith(
      ['d0'],
      'rider.unassigned',
      expect.anything(),
    );
  });

  it('cannot pick up without a driver', async () => {
    const { svc } = setup({
      id: 'o1',
      deliveryStatus: 'ASSIGNED',
      driverId: null,
    });
    await expect(svc.setStatus('b1', 'o1', 'PICKED_UP')).rejects.toThrow(
      'Assign a driver first',
    );
  });

  it('cannot skip straight from UNASSIGNED to DELIVERED', async () => {
    const { svc } = setup({ id: 'o1', deliveryStatus: 'UNASSIGNED' });
    await expect(svc.setStatus('b1', 'o1', 'DELIVERED')).rejects.toThrow(
      /Cannot move/,
    );
  });

  it('stamps deliveredAt when delivered', async () => {
    const { svc, prisma } = setup({
      id: 'o1',
      deliveryStatus: 'PICKED_UP',
      driverId: 'd1',
    });
    await svc.setStatus('b1', 'o1', 'DELIVERED');
    expect(
      prisma.order.update.mock.calls[0][0].data.deliveredAt,
    ).toBeInstanceOf(Date);
  });

  it('rejects a pincode already covered by another active zone', async () => {
    const { svc } = setup(null, true);
    await expect(
      svc.createZone('b1', {
        name: 'N',
        fee: 10,
        minOrderAmount: 0,
        etaMinutes: 30,
        pincodes: ['700001'],
        isActive: true,
      }),
    ).rejects.toThrow(/already covered/);
  });
});
