import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SessionUser } from '@nodedr-restaurant/types';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { AttendanceService } from './attendance.service';

const clockInSchema = z.object({
  branchId: z.string().min(1),
  note: z.string().trim().max(200).optional(),
});
const clockOutSchema = z.object({
  note: z.string().trim().max(200).optional(),
});
const correctionSchema = z
  .object({
    clockInAt: z.coerce.date().optional(),
    clockOutAt: z.union([z.coerce.date(), z.null()]).optional(),
    note: z.string().trim().max(200).optional(),
    reason: z
      .string()
      .trim()
      .min(3, 'Give a reason for the correction')
      .max(200),
  })
  .refine(
    (v) =>
      v.clockInAt !== undefined ||
      v.clockOutAt !== undefined ||
      v.note !== undefined,
    { message: 'Nothing to change' },
  );

@ApiTags('attendance')
@Controller('v1/attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // Any signed-in staff member can clock themselves in/out.
  @Auth()
  @Get('me')
  async me(@CurrentUser() user: SessionUser) {
    return (await this.attendance.current(user.id)) ?? null;
  }

  @Auth()
  @Post('clock-in')
  async clockIn(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(clockInSchema))
    body: z.infer<typeof clockInSchema>,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, body.branchId);
    return this.attendance.clockIn(user.id, body.branchId, body.note);
  }

  @Auth()
  @Post('clock-out')
  clockOut(
    @CurrentUser() user: SessionUser,
    @Body(new ZodValidationPipe(clockOutSchema))
    body: z.infer<typeof clockOutSchema>,
  ) {
    return this.attendance.clockOut(user.id, body.note);
  }

  @Auth('attendance.manage')
  @Get()
  async list(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
    @Query('date') date?: string,
    @Query('userId') userId?: string,
  ) {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    return this.attendance.list(branchId, date, userId);
  }

  // Manager correction (forgotten clock-out, wrong time). Needs a reason, is
  // audited with before/after, and is refused inside a finalized payroll run.
  @Auth('attendance.manage')
  @Patch(':id')
  correct(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(correctionSchema))
    body: z.infer<typeof correctionSchema>,
  ) {
    return this.attendance.correct(user.restaurantId, user.id, id, body);
  }
}
