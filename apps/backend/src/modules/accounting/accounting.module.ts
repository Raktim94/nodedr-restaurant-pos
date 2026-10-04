import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { BranchTimeService } from '../../common/services/branch-time.service';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

@Module({
  imports: [AuditModule],
  controllers: [AccountingController],
  providers: [AccountingService, BranchAccessService, BranchTimeService],
  exports: [AccountingService],
})
export class AccountingModule {}
