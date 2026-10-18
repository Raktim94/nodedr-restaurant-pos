import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { BranchTimeService } from '../../common/services/branch-time.service';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';

@Module({
  imports: [AuditModule],
  controllers: [AccountingController, LedgerController],
  providers: [
    AccountingService,
    LedgerService,
    BranchAccessService,
    BranchTimeService,
  ],
  exports: [AccountingService],
})
export class AccountingModule {}
