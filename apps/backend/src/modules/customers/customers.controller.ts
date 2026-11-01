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
  customerAddressSchema,
  customerAddressUpdateSchema,
  customerSchema,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { ReferralsService } from '../referrals/referrals.service';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@Controller('v1/customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly branchAccess: BranchAccessService,
    private readonly referrals: ReferralsService,
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

  // Points balance, available rewards, referral code and recent point changes.
  @Auth('customers.manage')
  @Get(':id/rewards')
  async rewards(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    await this.customersService.getById(branchId, id); // 404 if not in this branch
    return this.referrals.summary(user.restaurantId, id);
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
  @UsePipes(new ZodValidationPipe(customerSchema))
  async update(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.customersService.update(branchId, id, body as never);
  }

  @Auth('customers.manage')
  @Delete(':id')
  async remove(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.customersService.remove(branchId, id);
  }

  @Auth('customers.manage')
  @Get(':id/addresses')
  async listAddresses(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.customersService.listAddresses(branchId, id);
  }

  @Auth('customers.manage')
  @Post(':id/addresses')
  async addAddress(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(customerAddressSchema)) body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.customersService.addAddress(branchId, id, body as never);
  }

  @Auth('customers.manage')
  @Patch(':id/addresses/:addressId')
  async updateAddress(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Param('addressId') addressId: string,
    @Body(new ZodValidationPipe(customerAddressUpdateSchema)) body: unknown,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.customersService.updateAddress(
      branchId,
      id,
      addressId,
      body as never,
    );
  }

  @Auth('customers.manage')
  @Delete(':id/addresses/:addressId')
  async removeAddress(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Param('addressId') addressId: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.customersService.removeAddress(branchId, id, addressId);
  }
}
