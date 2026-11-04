import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { BillShareService } from './bill-share.service';

// Imported by OrdersModule (issues tokens) and PublicModule (verifies them);
// Nest shares one instance, so both sides use the same secret.
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [BillShareService],
  exports: [BillShareService],
})
export class BillShareModule {}
