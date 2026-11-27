import { DashboardService } from './dashboard.service';

describe('dashboard reporting region', () => {
  it('uses the restaurant day for revenue, order counts and trend buckets', async () => {
    const sale = new Date('2026-06-15T01:00:00Z');
    jest.useFakeTimers().setSystemTime(sale);
    try {
      const prisma = {
        branch: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            restaurant: { currency: 'BRL', timezone: 'America/Sao_Paulo' },
          }),
        },
        order: {
          aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: 25 } }),
          count: jest.fn().mockResolvedValue(1),
          groupBy: jest.fn().mockResolvedValue([]),
          findMany: jest
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockResolvedValue([{ billedAt: sale, totalAmount: 25 }]),
        },
        table: { groupBy: jest.fn().mockResolvedValue([]) },
        kot: { groupBy: jest.fn().mockResolvedValue([]) },
        wasteLog: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = new DashboardService(prisma as never);
      expect(await service.getSummary('b1')).toMatchObject({
        currency: 'BRL',
        todayRevenue: 25,
      });
      const range = {
        gte: new Date('2026-06-14T03:00:00Z'),
        lt: new Date('2026-06-15T03:00:00Z'),
      };
      expect(prisma.order.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { branchId: 'b1', status: 'PAID', billedAt: range },
        }),
      );
      expect(prisma.order.count).toHaveBeenCalledWith({
        where: { branchId: 'b1', createdAt: range },
      });
      expect((await service.getTrends('b1', 2)).revenue).toEqual([
        { date: '2026-06-13', amount: 0 },
        { date: '2026-06-14', amount: 25 },
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
});
