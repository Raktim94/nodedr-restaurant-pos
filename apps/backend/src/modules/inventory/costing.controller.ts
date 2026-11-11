import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  applyPriceSchema,
  menuItemCostingSchema,
  modifierCostingSchema,
  preparationSchema,
  productionRunSchema,
  type ApplyPriceDto,
  type MenuItemCostingDto,
  type ModifierCostingDto,
  type PreparationDto,
  type ProductionRunDto,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { CostingService } from './costing.service';

// Recipe costs are business-sensitive (margins, supplier prices), so every route here needs
// inventory.manage - the same permission that already guards ingredients and recipes. Changing a
// selling price additionally needs menu.manage (checked in CostingService.applyPrice).
@ApiTags('costing')
@Controller('v1/costing')
export class CostingController {
  constructor(
    private readonly costing: CostingService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  private async scope(user: SessionUser, branchId: string) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return branchId;
  }

  @Auth('inventory.manage')
  @Get('overview')
  async overview(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    return this.costing.overview(await this.scope(user, branchId));
  }

  @Auth('inventory.manage')
  @Get('bundle')
  async bundle(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    return this.costing.bundle(await this.scope(user, branchId));
  }

  @Auth('inventory.manage')
  @Get('menu-items/:id')
  async getItem(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    return this.costing.getMenuItem(await this.scope(user, branchId), id);
  }

  @Auth('inventory.manage')
  @Put('menu-items/:id')
  @UsePipes(new ZodValidationPipe(menuItemCostingSchema))
  async saveItem(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.costing.saveMenuItem(
      await this.scope(user, branchId),
      user.id,
      id,
      body as MenuItemCostingDto,
    );
  }

  @Auth('inventory.manage')
  @Post('menu-items/:id/acknowledge')
  async acknowledge(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    return this.costing.acknowledge(
      await this.scope(user, branchId),
      user.id,
      id,
    );
  }

  @Auth('inventory.manage')
  @Post('menu-items/:id/apply-price')
  @UsePipes(new ZodValidationPipe(applyPriceSchema))
  async applyPrice(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.costing.applyPrice(
      await this.scope(user, branchId),
      user,
      id,
      body as ApplyPriceDto,
    );
  }

  @Auth('inventory.manage')
  @Put('modifiers/:id')
  @UsePipes(new ZodValidationPipe(modifierCostingSchema))
  async setModifier(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.costing.setModifier(
      await this.scope(user, branchId),
      id,
      body as ModifierCostingDto,
    );
  }

  // --- Preparations ---------------------------------------------------------------

  @Auth('inventory.manage')
  @Get('preparations')
  async listPreparations(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    return this.costing.listPreparations(await this.scope(user, branchId));
  }

  @Auth('inventory.manage')
  @Get('preparations/:id')
  async getPreparation(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    return this.costing.getPreparation(await this.scope(user, branchId), id);
  }

  @Auth('inventory.manage')
  @Post('preparations')
  @UsePipes(new ZodValidationPipe(preparationSchema))
  async createPreparation(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    return this.costing.createPreparation(
      await this.scope(user, branchId),
      user.id,
      body as PreparationDto,
    );
  }

  @Auth('inventory.manage')
  @Put('preparations/:id')
  @UsePipes(new ZodValidationPipe(preparationSchema))
  async updatePreparation(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.costing.updatePreparation(
      await this.scope(user, branchId),
      user.id,
      id,
      body as PreparationDto,
    );
  }

  @Auth('inventory.manage')
  @Delete('preparations/:id')
  async deletePreparation(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    return this.costing.deletePreparation(
      await this.scope(user, branchId),
      user.id,
      id,
    );
  }

  @Auth('inventory.manage')
  @Post('preparations/:id/produce')
  @UsePipes(new ZodValidationPipe(productionRunSchema))
  async produce(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.costing.produce(
      await this.scope(user, branchId),
      user.id,
      id,
      body as ProductionRunDto,
    );
  }
}
