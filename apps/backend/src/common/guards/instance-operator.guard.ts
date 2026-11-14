import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from '../types/authenticated-request';

/**
 * Backups, updates and server sync act on the WHOLE server: one database holds every restaurant. On an ordinary
 * install (one restaurant) that is simply the owner's. When several restaurants share a server (sign-up left
 * open), a per-restaurant permission must not let any one of them dump, overwrite or re-point everyone's data, so
 * only the server's first restaurant (the one that set it up) may run these.
 */
@Injectable()
export class InstanceOperatorGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new ForbiddenException('No authenticated user');
    const restaurants = await this.prisma.restaurant.count();
    if (restaurants <= 1) return true;
    const first = await this.prisma.restaurant.findFirst({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
    if (first?.id === user.restaurantId) return true;
    throw new ForbiddenException('This affects every restaurant on the server, so only the restaurant that set the server up can do it.');
  }
}
