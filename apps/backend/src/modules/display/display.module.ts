import { Module } from '@nestjs/common';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { DisplayController } from './display.controller';
import { DisplayService } from './display.service';

@Module({
  controllers: [DisplayController],
  providers: [DisplayService, BranchAccessService],
})
export class DisplayModule {}
