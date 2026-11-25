/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- hand-built fakes */
import { ForbiddenException } from '@nestjs/common';
import { ReportSchedulesController } from './report-schedules.controller';

const controller = (reportKey: string) => {
  const c: any = Object.create(ReportSchedulesController.prototype);
  c.schedules = { get: jest.fn(async () => ({ reportKey })) };
  return c;
};

const limited = { permissions: ['reports.access', 'data.export'] } as never;
const allowed = {
  permissions: ['reports.access', 'data.export', 'dashboard.sales.view'],
} as never;

describe('scheduled report RBAC', () => {
  it('refuses a sales schedule without the sales-view permission', async () => {
    const c = controller('sales-daily');
    await expect(
      c.assertScheduleReportAccess(limited, 'b1', 's1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(c.schedules.get).toHaveBeenCalledWith('b1', 's1');
  });

  it('allows a non-sales report with only generic export access', async () => {
    const c = controller('stock-summary');
    await expect(
      c.assertScheduleReportAccess(limited, 'b1', 's1'),
    ).resolves.toBeUndefined();
  });

  it('allows a sales schedule when the permission is held', async () => {
    const c = controller('sales-daily');
    await expect(
      c.assertScheduleReportAccess(allowed, 'b1', 's1'),
    ).resolves.toBeUndefined();
  });
});
