import { Module } from '@nestjs/common';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { AuditModule } from '../../audit/audit.module';
import { TableSessionsService } from './table-sessions.service';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';

@Module({
  imports: [AuditModule],
  controllers: [TablesController],
  providers: [TablesService, TableSessionsService, BranchAccessService],
  exports: [TablesService, TableSessionsService],
})
export class TablesModule {}
