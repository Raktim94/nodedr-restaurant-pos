import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AiService, ChatMessage } from './ai.service';
import type { AuthenticatedRequest } from '../common/types/authenticated-request';

export class ChatDto {
  messages: ChatMessage[];
  branchId?: string;
  model?: string;
}

type ExecuteActionPayload = Parameters<
  AiService['executeAction']
>[0]['actionPayload'];

export class ExecuteActionDto {
  branchId?: string;
  actionPayload: ExecuteActionPayload;
}

@UseGuards(JwtAuthGuard)
@Controller('v1/ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  async chat(@Body() dto: ChatDto, @Req() req: AuthenticatedRequest) {
    const user = req.user;
    return this.aiService.processChat({
      user,
      messages: dto.messages || [],
      branchId: dto.branchId,
      model: dto.model,
    });
  }

  @Post('execute-action')
  async executeAction(
    @Body() dto: ExecuteActionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const user = req.user;
    return this.aiService.executeAction({
      user,
      branchId: dto.branchId,
      actionPayload: dto.actionPayload || {},
    });
  }
}
