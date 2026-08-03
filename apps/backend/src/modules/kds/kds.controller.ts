import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  kotItemStatusUpdateSchema,
  setPrioritySchema,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { KdsService } from './kds.service';

@ApiTags('kds')
@Controller('v1/kds')
export class KdsController {
  constructor(
    private readonly kdsService: KdsService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  @Auth('kds.manage')
  @Get('tickets')
  async listTickets(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Query('stationId') stationId?: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.kdsService.listActiveTickets(branchId, stationId);
  }

  @Auth('kds.manage')
  @Get('performance')
  async getPerformance(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Query('date') date?: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.kdsService.getPerformanceReport(branchId, date);
  }

  @Auth('kds.manage')
  @Patch('tickets/:id/status')
  @UsePipes(new ZodValidationPipe(kotItemStatusUpdateSchema))
  async updateStatus(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    const { status } = body as { status: string };
    return this.kdsService.updateStatus(branchId, id, status);
  }

  @Auth('kds.manage')
  @Patch('tickets/:id/priority')
  @UsePipes(new ZodValidationPipe(setPrioritySchema))
  async setPriority(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    const { isPriority } = body as { isPriority: boolean };
    return this.kdsService.setPriority(branchId, id, isPriority);
  }

  @Auth('kds.manage')
  @Post('tickets/:id/reprint')
  async reprint(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.kdsService.reprint(branchId, id);
  }
}
