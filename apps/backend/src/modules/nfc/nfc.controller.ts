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
import { Throttle } from '@nestjs/throttler';
import type { SessionUser } from '@nodedr-restaurant/types';
import { z } from 'zod';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { NfcService } from './nfc.service';

const createTagSchema = z.object({
  tableId: z.string().min(1),
  label: z.string().trim().max(60).optional(),
  mode: z.enum(['SECURE', 'BASIC']).optional(),
});
const settingsSchema = z.object({
  nfcTablesEnabled: z.boolean().optional(),
  autoTableSessions: z.boolean().optional(),
});
const testSchema = z.object({
  e: z.string().trim().max(64),
  c: z.string().trim().max(32),
});
const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'Say why').max(200),
});
const labelSchema = z.object({ label: z.string().trim().max(60).optional() });

/** Staff side: set tables up for tapping, provision and retire tags. Everything needs nfc.manage and a branch the user may see. */
@ApiTags('nfc')
@Controller('v1/nfc')
export class NfcController {
  constructor(
    private readonly nfc: NfcService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  @Auth('nfc.manage')
  @Get('settings')
  settings(@CurrentUser() u: SessionUser) {
    return this.nfc.settings(u.restaurantId);
  }

  @Auth('nfc.manage')
  @Patch('settings')
  @UsePipes(new ZodValidationPipe(settingsSchema))
  updateSettings(@CurrentUser() u: SessionUser, @Body() body: unknown) {
    return this.nfc.updateSettings(u.restaurantId, u.id, body as never);
  }

  @Auth('nfc.manage')
  @Get('tags')
  async list(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.branchAccess.assertAccess(u.restaurantId, branchId);
    return this.nfc.list(branchId);
  }

  @Auth('nfc.manage')
  @Post('tags')
  @UsePipes(new ZodValidationPipe(createTagSchema))
  async create(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.branchAccess.assertAccess(u.restaurantId, branchId);
    return this.nfc.createTag(branchId, u.id, body as never);
  }

  @Auth('nfc.manage')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('tags/:id/test')
  @UsePipes(new ZodValidationPipe(testSchema))
  async test(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: { e: string; c: string },
  ) {
    await this.branchAccess.assertAccess(u.restaurantId, branchId);
    return this.nfc.testTap(branchId, u.id, id, body.e, body.c);
  }

  @Auth('nfc.manage')
  @Post('tags/:id/rotate')
  async rotate(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(u.restaurantId, branchId);
    return this.nfc.rotateKeys(branchId, u.id, id);
  }

  @Auth('nfc.manage')
  @Post('tags/:id/disable')
  @UsePipes(new ZodValidationPipe(reasonSchema))
  async disable(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    await this.branchAccess.assertAccess(u.restaurantId, branchId);
    return this.nfc.disable(branchId, u.id, id, body.reason);
  }

  @Auth('nfc.manage')
  @Post('tags/:id/replace')
  @UsePipes(new ZodValidationPipe(labelSchema))
  async replace(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body() body: { label?: string },
  ) {
    await this.branchAccess.assertAccess(u.restaurantId, branchId);
    return this.nfc.replace(branchId, u.id, id, body.label);
  }

  @Auth('nfc.manage')
  @Get('tags/:id/taps')
  async taps(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.branchAccess.assertAccess(u.restaurantId, branchId);
    return this.nfc.taps(branchId, id);
  }
}

/** Guest side, unauthenticated by design: it verifies the tag itself and says nothing about which check failed. */
@ApiTags('nfc')
@Controller('v1/public/nfc')
export class NfcPublicController {
  constructor(private readonly nfc: NfcService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('tap/:publicRef')
  tap(
    @Param('publicRef') publicRef: string,
    @Query('e') e: string,
    @Query('c') c: string,
  ) {
    return this.nfc.tap(
      String(publicRef).slice(0, 32),
      String(e ?? '').slice(0, 64),
      String(c ?? '').slice(0, 32),
    );
  }
}
