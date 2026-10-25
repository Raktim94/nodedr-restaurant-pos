import { Module } from '@nestjs/common';
import { SyncKeyGuard } from './sync-key.guard';
import { SyncController, SyncPeerController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  controllers: [SyncPeerController, SyncController],
  providers: [SyncService, SyncKeyGuard],
})
export class SyncModule {}
