import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  bulkTableCreateSchema,
  layoutNameSchema,
  permissionSatisfied,
  bulkTableDeleteSchema,
  bulkTableUpdateSchema,
  floorSchema,
  floorUpdateSchema,
  tableSchema,
  tableUpdateSchema,
  tableLayoutUpdateSchema,
  type SessionUser,
  type TableLayoutUpdateDto,
} from '@nodedr-restaurant/types';
import { z } from 'zod';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { TableLifecycleService } from './table-lifecycle.service';
import { TableSessionsService } from './table-sessions.service';
import { TablesService } from './tables.service';

@ApiTags('tables')
@Controller('v1/tables')
export class TablesController {
  constructor(
    private readonly sessions: TableSessionsService,
    private readonly lifecycle: TableLifecycleService,
    private readonly tablesService: TablesService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  @Auth('tables.view')
  @Get('requests')
  async listRequests(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.listOpenRequests(branchId);
  }

  @Auth('tables.view', 'orders.edit')
  @Patch('requests/:id/resolve')
  async resolveRequest(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.resolveRequest(branchId, id);
  }

  @Auth('tables.view')
  @Get('floors')
  async listFloors(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Query('edit') forEditing?: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.listFloors(
      branchId,
      forEditing === '1' &&
        permissionSatisfied(user.permissions, 'tables.manage'),
    );
  }

  @Auth('tables.manage')
  @Post('floors')
  @UsePipes(new ZodValidationPipe(floorSchema))
  async createFloor(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.createFloor(branchId, body as never);
  }

  @Auth('tables.manage')
  @Post()
  @UsePipes(new ZodValidationPipe(tableSchema))
  async createTable(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.createTable(branchId, body as never);
  }

  @Auth('tables.manage')
  @Post('bulk')
  @UsePipes(new ZodValidationPipe(bulkTableCreateSchema))
  async createTables(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.createTables(branchId, body as never);
  }

  @Auth('tables.manage')
  @Post('floors/:id/layouts')
  @UsePipes(new ZodValidationPipe(layoutNameSchema))
  async saveLayout(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: { name: string },
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.saveLayout(branchId, id, body.name);
  }

  @Auth('tables.manage')
  @Post('layouts/:id/activate')
  async activateLayout(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.activateLayout(branchId, id);
  }

  @Auth('tables.manage')
  @Post('layouts/:id/save-current')
  async saveCurrent(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.updateLayoutFromFloor(branchId, id);
  }

  @Auth('tables.manage')
  @Patch('layouts/:id')
  @UsePipes(new ZodValidationPipe(layoutNameSchema))
  async renameLayout(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: { name: string },
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.renameLayout(branchId, id, body.name);
  }

  @Auth('tables.manage')
  @Delete('layouts/:id')
  async deleteLayout(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.deleteLayout(branchId, id);
  }

  @Auth('tables.manage')
  @Patch('bulk')
  @UsePipes(new ZodValidationPipe(bulkTableUpdateSchema))
  async updateTables(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.updateTables(branchId, body as never);
  }

  // ---- live table sessions (guest ordering codes) ---------------------------------------------

  // The live table board: each table's state, derived by the server from orders, kitchen tickets, payments and calls.
  @Auth('tables.view')
  @Get('overview')
  async overview(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.lifecycle.overview(branchId);
  }

  @Auth('table.session')
  @Get('sessions')
  async listSessions(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.sessions.list(branchId);
  }

  @Auth('table.session')
  @Post(':id/session')
  async openSession(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: { hours?: number },
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.sessions.open(
      branchId,
      id,
      user.id,
      Number(body?.hours) || undefined,
    );
  }

  @Auth('table.session')
  @Delete(':id/session')
  async closeSession(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.sessions.close(branchId, id, user.id);
  }

  @Auth('tables.manage')
  @Post('bulk-delete')
  @UsePipes(new ZodValidationPipe(bulkTableDeleteSchema))
  async deleteTables(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.deleteTables(branchId, body as never);
  }

  @Auth('tables.manage')
  @Patch('floors/:id')
  @UsePipes(new ZodValidationPipe(floorUpdateSchema))
  async updateFloor(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.updateFloor(branchId, id, body as never);
  }

  @Auth('tables.manage')
  @Patch('layout')
  @UsePipes(new ZodValidationPipe(z.array(tableLayoutUpdateSchema)))
  async updateLayout(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: TableLayoutUpdateDto[],
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.updateTableLayout(branchId, body);
  }

  @Auth('tables.manage')
  @Patch(':id')
  @UsePipes(new ZodValidationPipe(tableUpdateSchema))
  async updateTable(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.updateTable(branchId, id, body as never);
  }

  @Auth('tables.view', 'orders.edit')
  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: { status: never; assignedWaiterId?: string },
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.updateTableStatus(
      branchId,
      id,
      body.status,
      body.assignedWaiterId,
    );
  }

  @Auth('tables.manage')
  @Post(':id/qr-token')
  async rotateQrToken(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.rotateQrToken(branchId, id);
  }

  @Auth('tables.manage')
  @Delete(':id')
  async deleteTable(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.tablesService.deleteTable(branchId, id);
  }
}
