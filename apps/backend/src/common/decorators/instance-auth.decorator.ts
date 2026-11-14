import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiCookieAuth } from '@nestjs/swagger';
import type { PermissionKey } from '@nodedr-restaurant/types';
import { InstanceOperatorGuard } from '../guards/instance-operator.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { RequirePermission } from './permissions.decorator';

// Like @Auth, for operations on the whole server (backup, update, sync): the permission AND the server operator.
export const InstanceAuth = (...permissions: PermissionKey[]) =>
  applyDecorators(UseGuards(JwtAuthGuard, PermissionsGuard, InstanceOperatorGuard), RequirePermission(...permissions), ApiCookieAuth());
