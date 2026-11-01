import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { IntegrationHubController } from './integration-hub.controller';
import { IntegrationHubService } from './integration-hub.service';

@Module({
  imports: [AuditModule],
  controllers: [IntegrationHubController],
  providers: [IntegrationHubService],
  exports: [IntegrationHubService],
})
export class IntegrationHubModule {}
