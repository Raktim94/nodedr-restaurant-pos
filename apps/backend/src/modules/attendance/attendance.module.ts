import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { BranchTimeService } from '../../common/services/branch-time.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [AuditModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, BranchAccessService, BranchTimeService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
