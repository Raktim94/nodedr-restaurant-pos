import { Module } from '@nestjs/common';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { RealtimeModule } from '../../realtime/realtime.module';
import { PagingController } from './paging.controller';
import { PagingService } from './paging.service';

@Module({ imports: [RealtimeModule], controllers: [PagingController], providers: [PagingService, BranchAccessService], exports: [PagingService] })
export class PagingModule {}
