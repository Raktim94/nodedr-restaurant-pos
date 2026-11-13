import { Module } from '@nestjs/common';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { RatingsController } from './ratings.controller';
import { RatingsService } from './ratings.service';

@Module({ controllers: [RatingsController], providers: [RatingsService, BranchAccessService], exports: [RatingsService] })
export class RatingsModule {}
