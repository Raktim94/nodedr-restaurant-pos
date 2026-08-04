import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import {
  menuCategorySchema,
  menuItemSchema,
  modifierGroupSchema,
  setComboComponentsSchema,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { imageUploadOptions } from '../../common/upload/image-upload.config';
import { MenuService } from './menu.service';

@ApiTags('menu')
@Controller('v1/menu')
export class MenuController {
  constructor(
    private readonly menuService: MenuService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // --- Categories ---------------------------------------------------------

  @Auth('menu.manage')
  @Get('categories')
  async listCategories(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.menuService.listCategories(branchId);
  }

  @Auth('menu.manage')
  @Post('categories')
  @UsePipes(new ZodValidationPipe(menuCategorySchema))
  async createCategory(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.menuService.createCategory(branchId, body as never);
  }

  @Auth('menu.manage')
  @Patch('categories/:id')
  async updateCategory(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.menuService.updateCategory(branchId, id, body as never);
  }

  @Auth('menu.manage')
  @Delete('categories/:id')
  async deleteCategory(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.menuService.deleteCategory(branchId, id);
  }

  // --- Kitchen stations -----------------------------------------------------

  @Auth('menu.manage')
  @Get('stations')
  async listStations(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.menuService.listStations(branchId);
  }

  @Auth('menu.manage')
  @Post('stations')
  async createStation(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: { name: string; printerName?: string },
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.menuService.createStation(
      branchId,
      body.name,
      body.printerName,
    );
  }

  // --- Menu items -----------------------------------------------------------

  @Auth()
  @Get('items')
  async listItems(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Query('categoryId') categoryId?: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.menuService.listItems(branchId, categoryId);
  }

  @Auth()
  @Get('items/:id')
  async getItem(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.menuService.getItem(branchId, id);
  }

  @Auth('menu.manage')
  @Post('items')
  @UsePipes(new ZodValidationPipe(menuItemSchema))
  async createItem(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.menuService.createItem(branchId, body as never);
  }

  @Auth('menu.manage')
  @Post('items/upload-image')
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  uploadItemImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return { url: `/api/uploads/${file.filename}` };
  }

  @Auth('menu.manage')
  @Patch('items/:id')
  async updateItem(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.menuService.updateItem(branchId, id, body as never);
  }

  @Auth('menu.manage')
  @Delete('items/:id')
  async deleteItem(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.menuService.deleteItem(branchId, id);
  }

  // --- Modifier groups --------------------------------------------------------

  @Auth('menu.manage')
  @Get('modifier-groups')
  listModifierGroups() {
    return this.menuService.listModifierGroups();
  }

  @Auth('menu.manage')
  @Post('modifier-groups')
  @UsePipes(new ZodValidationPipe(modifierGroupSchema))
  createModifierGroup(@Body() body: unknown) {
    return this.menuService.createModifierGroup(body as never);
  }

  @Auth('menu.manage')
  @Patch('modifier-groups/:id')
  updateModifierGroup(@Param('id') id: string, @Body() body: unknown) {
    return this.menuService.updateModifierGroup(id, body as never);
  }

  @Auth('menu.manage')
  @Delete('modifier-groups/:id')
  deleteModifierGroup(@Param('id') id: string) {
    return this.menuService.deleteModifierGroup(id);
  }

  // --- Combo meals -----------------------------------------------------------

  @Auth('menu.manage')
  @Get('items/:id/combo-components')
  getComboComponents(@Param('id') id: string) {
    return this.menuService.getComboComponents(id);
  }

  @Auth('menu.manage')
  @Post('items/:id/combo-components')
  @UsePipes(new ZodValidationPipe(setComboComponentsSchema))
  async setComboComponents(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    const { components } = body as {
      components: { componentItemId: string; quantity: number }[];
    };
    return this.menuService.setComboComponents(branchId, id, components);
  }
}
