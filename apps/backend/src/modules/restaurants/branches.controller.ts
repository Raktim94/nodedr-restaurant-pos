import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { SessionUser } from '@nodedr-restaurant/types';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('branches')
@Controller('v1/branches')
export class BranchesController {
  constructor(private readonly prisma: PrismaService) {}

  @Auth()
  @Get()
  listBranches(@CurrentUser() user: SessionUser) {
    return this.prisma.branch.findMany({
      where: { restaurantId: user.restaurantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }
}
