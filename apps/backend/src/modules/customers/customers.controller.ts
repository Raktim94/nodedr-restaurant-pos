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
import { customerSchema, type SessionUser } from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@Controller('v1/customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  @Auth('customers.manage')
  @Get()
  async list(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Query('search') search?: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.customersService.list(branchId, search);
  }

  @Auth('customers.manage')
  @Get(':id')
  async getById(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.customersService.getById(branchId, id);
  }

  @Auth('customers.manage')
  @Post()
  @UsePipes(new ZodValidationPipe(customerSchema))
  async create(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.customersService.create(branchId, body as never);
  }

  @Auth('customers.manage')
  @Patch(':id')
  async update(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.customersService.update(branchId, id, body as never);
  }
}
