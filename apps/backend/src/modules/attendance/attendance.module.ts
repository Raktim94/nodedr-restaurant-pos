import { Module } from '@nestjs/common';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService, BranchAccessService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
