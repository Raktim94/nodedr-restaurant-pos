import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';

@Module({
  controllers: [BranchesController],
})
export class RestaurantsModule {}
