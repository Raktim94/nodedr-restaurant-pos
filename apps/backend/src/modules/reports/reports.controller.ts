import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SessionUser } from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { toCsv } from './csv';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('v1/reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  @Auth('reports.access')
  @Get()
  catalog() {
    return this.reports.catalog();
  }

  @Auth('reports.access')
  @Get(':key')
  async run(
    @CurrentUser() u: SessionUser,
    @Param('key') key: string,
    @Query('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    await this.branchAccess.assertAccess(u.restaurantId, branchId);
    return this.reports.run(key, branchId, from, to);
  }

  // Exporting takes the extra data.export permission on top of viewing.
  @Auth('reports.access', 'data.export')
  @Get(':key/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async csv(
    @CurrentUser() u: SessionUser,
    @Param('key') key: string,
    @Query('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    await this.branchAccess.assertAccess(u.restaurantId, branchId);
    const r = await this.reports.run(key, branchId, from, to);
    return toCsv(r.columns, r.rows);
  }
}
