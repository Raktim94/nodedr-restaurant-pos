import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { SessionUser } from '@nodedr-restaurant/types';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { ImportsService } from './imports.service';
import { templateCsv, templateFileName, type ImportKind } from './templates';

const MAX_BYTES = 2 * 1024 * 1024;

// What a person needs to be allowed to bulk-load each kind of data: the same
// permission as managing it one record at a time.
const PERMISSION: Record<ImportKind, string> = {
  menu: 'menu.manage',
  ingredients: 'inventory.manage',
};

const upload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!/\.(csv|txt)$/i.test(file.originalname)) {
      cb(new BadRequestException('Choose a .csv file'), false);
      return;
    }
    cb(null, true);
  },
});

const asKind = (k: string): ImportKind => {
  if (k === 'menu' || k === 'ingredients') return k;
  throw new BadRequestException('Unknown import type');
};
const flag = (v: string | undefined, fallback: boolean) =>
  v === undefined ? fallback : v === 'true' || v === '1';

@ApiTags('imports')
@Controller('v1/imports')
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  private allow(user: SessionUser, kind: ImportKind) {
    if (!user.permissions.includes(PERMISSION[kind])) {
      throw new ForbiddenException(
        `You need the ${PERMISSION[kind]} permission to import this`,
      );
    }
  }

  @Auth()
  @Get('templates/:kind')
  template(
    @CurrentUser() user: SessionUser,
    @Param('kind') k: string,
    @Query('example') example: string | undefined,
    @Res() res: Response,
  ) {
    const kind = asKind(k);
    this.allow(user, kind);
    const withExamples = flag(example, false);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${templateFileName(kind, withExamples)}"`,
    );
    // A BOM makes Excel open the file as UTF-8 (so ₹ and accents survive).
    res.send('﻿' + templateCsv(kind, withExamples));
  }

  private async handle(
    commit: boolean,
    user: SessionUser,
    k: string,
    branchId: string,
    file: Express.Multer.File | undefined,
    q: { updateExisting?: string; skipInvalid?: string },
  ) {
    const kind = asKind(k);
    this.allow(user, kind);
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    if (!file) throw new BadRequestException('No file uploaded');
    if (file.size === 0) throw new BadRequestException('The file is empty');
    return this.imports.run(kind, branchId, user.id, file, {
      commit,
      updateExisting: flag(q.updateExisting, true),
      skipInvalid: flag(q.skipInvalid, false),
    });
  }

  @Auth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':kind/preview')
  @UseInterceptors(upload)
  preview(
    @CurrentUser() user: SessionUser,
    @Param('kind') kind: string,
    @Query('branchId') branchId: string,
    @Query() q: { updateExisting?: string },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.handle(false, user, kind, branchId, file, q);
  }

  @Auth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':kind/commit')
  @UseInterceptors(upload)
  commit(
    @CurrentUser() user: SessionUser,
    @Param('kind') kind: string,
    @Query('branchId') branchId: string,
    @Query() q: { updateExisting?: string; skipInvalid?: string },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.handle(true, user, kind, branchId, file, q);
  }
}
