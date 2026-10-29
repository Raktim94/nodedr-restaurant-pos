import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionKey } from '@nodedr-restaurant/types';
import { EntitlementsService } from '../../saas/entitlements.service';
import { moduleForPermission } from '../../saas/permission-modules';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { AuthenticatedRequest } from '../types/authenticated-request';

@Injectable()
export class EntitlementsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) return true;

    const modules = new Set((required ?? []).map(moduleForPermission).filter(Boolean));
    for (const moduleKey of modules) {
      await this.entitlements.assertModuleEnabled(
        request.user.restaurantId,
        moduleKey!,
      );
    }
    return true;
  }
}
