import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { McpModule } from '../mcp/mcp.module';
import { BranchAccessService } from '../common/services/branch-access.service';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [PrismaModule, McpModule],
  controllers: [AiController],
  providers: [AiService, BranchAccessService],
  exports: [AiService],
})
export class AiModule {}
