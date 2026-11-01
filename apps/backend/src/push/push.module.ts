import { Global, Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { PushService } from './push.service';

@Global()
@Module({
  controllers: [DevicesController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
