import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DeviceRevocationMiddleware } from './device-revocation.middleware';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Global()
@Module({
  imports: [AuditModule],
  controllers: [DevicesController],
  providers: [DevicesService, DeviceRevocationMiddleware],
  exports: [DevicesService],
})
export class DevicesModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DeviceRevocationMiddleware).forRoutes('*');
  }
}
