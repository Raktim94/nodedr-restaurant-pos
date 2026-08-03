import { Module } from '@nestjs/common';
import { PublicMenuController } from './public-menu.controller';
import { PublicMenuService } from './public-menu.service';

@Module({
  controllers: [PublicMenuController],
  providers: [PublicMenuService],
})
export class PublicModule {}
