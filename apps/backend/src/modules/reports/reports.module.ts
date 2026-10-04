import { Module } from '@nestjs/common';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { BranchTimeService } from '../../common/services/branch-time.service';
import { AccountingModule } from '../accounting/accounting.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AccountingModule],
  controllers: [ReportsController],
  providers: [ReportsService, BranchAccessService, BranchTimeService],
  exports: [ReportsService],
})
export class ReportsModule {}
