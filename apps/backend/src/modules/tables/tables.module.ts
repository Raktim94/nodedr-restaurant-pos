import { Module } from '@nestjs/common';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { AuditModule } from '../../audit/audit.module';
import { TableLifecycleService } from './table-lifecycle.service';
import { TableSessionsService } from './table-sessions.service';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';

@Module({
  imports: [AuditModule],
  controllers: [TablesController],
  providers: [
    TablesService,
    TableSessionsService,
    TableLifecycleService,
    BranchAccessService,
  ],
  exports: [TablesService, TableSessionsService, TableLifecycleService],
})
export class TablesModule {}
