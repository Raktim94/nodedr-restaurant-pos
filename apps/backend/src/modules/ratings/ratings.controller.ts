import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { SessionUser } from '@nodedr-restaurant/types';
import { z } from 'zod';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../../common/services/branch-access.service';
import { RatingsService } from './ratings.service';

const submitSchema = z.object({
  token: z.string().min(20).max(300),
  stars: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

@ApiTags('ratings')
@Controller('v1')
export class RatingsController {
  constructor(
    private readonly ratings: RatingsService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // Public, but useless without a token that was issued for a paid order by the server.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('public/ratings/status')
  status(@Query('token') token: string) {
    return this.ratings.status(token);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('public/ratings')
  submit(
    @Body(new ZodValidationPipe(submitSchema))
    body: z.infer<typeof submitSchema>,
  ) {
    return this.ratings.submit(body.token, body.stars, body.comment);
  }

  @Auth('ratings.view')
  @Get('ratings')
  async list(
    @CurrentUser() u: SessionUser,
    @Query('branchId') branchId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    await this.branchAccess.assertAccess(u.restaurantId, branchId);
    const d = (v?: string) =>
      v && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : undefined;
    return this.ratings.list(branchId, { from: d(from), to: d(to) });
  }
}
