import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { BillShareService } from './bill-share.service';

// A static module, imported by both OrdersModule (issues tokens) and
// PublicModule (verifies them) — Nest resolves the same module class to one
// shared instance, so both sides agree on the same JwtService/secret without
// either importing the other.
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
