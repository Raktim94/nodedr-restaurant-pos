import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { TablesModule } from '../tables/tables.module';
import { NfcController, NfcPublicController } from './nfc.controller';
import { NfcService } from './nfc.service';

@Module({
  imports: [AuditModule, TablesModule],
  controllers: [NfcController, NfcPublicController],
  providers: [NfcService, BranchAccessService],
  exports: [NfcService],
})
export class NfcModule {}
