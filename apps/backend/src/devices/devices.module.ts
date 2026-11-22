import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Global()
@Module({
  imports: [AuditModule],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
