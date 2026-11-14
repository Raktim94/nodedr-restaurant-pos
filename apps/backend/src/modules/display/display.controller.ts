import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  adSchema,
  displayStateSchema,
  terminalSchema,
  type AdDto,
  type DisplayStateDto,
  type SessionUser,
  type TerminalDto,
} from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import {
  checkMedia,
  mediaUploadOptions,
} from '../../common/upload/media-upload.config';
import { DisplayService } from './display.service';

@ApiTags('display')
@Controller('v1')
export class DisplayController {
  constructor(
    private readonly display: DisplayService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  private access(u: SessionUser, branchId: string) {
    return this.branchAccess.assertAccess(u.restaurantId, branchId);
  }

  // ---- staff: set up screens and adverts ----------------------------------------------------

  @Auth('settings.manage')
  @Get('display/terminals')
  async terminals(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.access(u, branchId);
    return this.display.terminals(branchId);
  }

  @Auth('settings.manage')
  @Post('display/terminals')
  @UsePipes(new ZodValidationPipe(terminalSchema))
  async createTerminal(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.access(u, branchId);
    return this.display.createTerminal(branchId, body as TerminalDto);
  }

  @Auth('settings.manage')
  @Patch('display/terminals/:id')
  async updateTerminal(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(terminalSchema.partial()))
    body: Partial<TerminalDto>,
  ) {
    await this.access(u, branchId);
    return this.display.updateTerminal(branchId, id, body);
  }

  @Auth('settings.manage')
  @Post('display/terminals/:id/rotate-token')
  async rotate(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.access(u, branchId);
    return this.display.rotateToken(branchId, id);
  }

  @Auth('settings.manage')
  @Delete('display/terminals/:id')
  async deleteTerminal(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.access(u, branchId);
    return this.display.deleteTerminal(branchId, id);
  }

  @Auth('settings.manage')
  @Get('display/ads')
  async ads(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.access(u, branchId);
    return this.display.ads(branchId);
  }

  @Auth('settings.manage')
  @Post('display/media')
  @UseInterceptors(FileInterceptor('file', mediaUploadOptions))
  media(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    const kind = checkMedia(file);
    return { url: `/api/uploads/${file.filename}`, kind, bytes: file.size };
  }

  @Auth('settings.manage')
  @Post('display/ads')
  @UsePipes(new ZodValidationPipe(adSchema))
  async createAd(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Body() body: unknown,
  ) {
    await this.access(u, branchId);
    return this.display.createAd(branchId, body as AdDto);
  }

  @Auth('settings.manage')
  @Patch('display/ads/:id')
  async updateAd(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adSchema.partial())) body: Partial<AdDto>,
  ) {
    await this.access(u, branchId);
    return this.display.updateAd(branchId, id, body);
  }

  @Auth('settings.manage')
  @Delete('display/ads/:id')
  async deleteAd(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
  ) {
    await this.access(u, branchId);
    return this.display.deleteAd(branchId, id);
  }

  // ---- the staff screen reports what is on the counter ----------------------------------------

  @Auth('orders.create')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Put('display/terminals/:id/state')
  async push(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(displayStateSchema)) body: DisplayStateDto,
  ) {
    await this.access(u, branchId);
    return this.display.pushState(branchId, id, body);
  }

  @Auth('orders.create')
  @Get('display/terminals/lite')
  async lite(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
  ) {
    await this.access(u, branchId);
    return (await this.display.terminals(branchId))
      .filter((t) => t.isActive)
      .map((t) => ({ id: t.id, name: t.name }));
  }

  // ---- the customer screen reads (no login; the token is the key) --------------------------------

  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @Get('public/display/:token')
  view(@Param('token') token: string) {
    return this.display.publicView(token);
  }
}
