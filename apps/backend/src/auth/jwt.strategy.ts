import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { SessionUser } from '@nodedr-restaurant/types';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  effectivePermissions,
  permissionInclude,
} from './effective-permissions';
import { PrismaService } from '../prisma/prisma.service';

interface JwtPayload {
  sub: string;
  /** Set when the session was created by a phone: that phone's id. */
  did?: string;
  /** Seconds since epoch, set by the JWT library when the session was issued. */
  iat?: number;
}

/** A session is dead if it was issued at or before the moment the account's sessions were revoked. */
export function isRevoked(iat: number | undefined, validFrom: Date | null | undefined): boolean {
  if (!validFrom) return false;
  if (typeof iat !== 'number') return true; // cannot prove it is newer
  return iat <= Math.floor(validFrom.getTime() / 1000);
}

const cookieExtractor = (req: {
  cookies?: Record<string, string>;
}): string | null => {
  return req.cookies?.['nodedr_session'] ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: permissionInclude,
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Session no longer valid');
    }

    if (isRevoked(payload.iat, user.sessionsValidFrom)) {
      throw new UnauthorizedException('Session no longer valid');
    }

    if (payload.did) {
      const device = await this.prisma.posDevice.findUnique({
        where: { restaurantId_deviceId: { restaurantId: user.restaurantId, deviceId: payload.did } },
        select: { revokedAt: true },
      });
      if (device?.revokedAt) {
        throw new UnauthorizedException({ message: 'This phone was removed by the owner.', code: 'DEVICE_REVOKED' });
      }
    }

    return {
      id: user.id,
      restaurantId: user.restaurantId,
      name: user.name,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions: effectivePermissions(user),
    };
  }
}
