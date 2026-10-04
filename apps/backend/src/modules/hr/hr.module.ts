import { Module } from '@nestjs/common';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';

@Module({
  controllers: [HrController],
  providers: [HrService, BranchAccessService],
  exports: [HrService],
})
export class HrModule {}
