import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { DevicesService } from './devices.service';

/** A phone that sends X-Device-Id and has been revoked gets 401 DEVICE_REVOKED, whatever its session says. */
@Injectable()
export class DeviceRevocationMiddleware implements NestMiddleware {
  constructor(private readonly devices: DevicesService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const id = req.headers['x-device-id'];
    if (
      typeof id === 'string' &&
      id.length >= 8 &&
      id.length <= 120 &&
      (await this.devices.isRevoked(id))
    ) {
      throw new UnauthorizedException({
        message: 'This phone was removed by the owner.',
        code: 'DEVICE_REVOKED',
      });
    }
    next();
  }
}
