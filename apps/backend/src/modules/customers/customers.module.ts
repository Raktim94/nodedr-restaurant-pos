import { Module } from '@nestjs/common';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { ReferralsModule } from '../referrals/referrals.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [ReferralsModule],
  controllers: [CustomersController],
  providers: [CustomersService, BranchAccessService],
  exports: [CustomersService],
})
export class CustomersModule {}
