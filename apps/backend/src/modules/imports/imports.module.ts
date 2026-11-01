import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [AuditModule],
  controllers: [ImportsController],
  providers: [ImportsService, BranchAccessService],
})
export class ImportsModule {}
