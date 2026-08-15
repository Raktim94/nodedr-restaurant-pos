import { Body, Controller, Get, Patch, Query, UsePipes } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  branchSettingsSchema,
  restaurantSettingsSchema,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('v1/settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  @Auth('settings.manage')
  @Get()
  async get(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.settingsService.get(user.restaurantId, branchId);
  }

  @Auth('settings.manage')
  @Patch('restaurant')
  @UsePipes(new ZodValidationPipe(restaurantSettingsSchema))
  async updateRestaurant(
    @CurrentUser() user: SessionUser,
    @Body() body: unknown,
  ) {
    return this.settingsService.updateRestaurant(
      user.restaurantId,
      user.id,
      body as never,
    );
  }

  @Auth('settings.manage')
  @Patch('branch')
  @UsePipes(new ZodValidationPipe(branchSettingsSchema))
  async updateBranch(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.settingsService.updateBranch(branchId, user.id, body as never);
  }
}
