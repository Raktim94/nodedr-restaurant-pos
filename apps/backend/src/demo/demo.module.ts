import {
  Controller,
  Get,
  Injectable,
  MiddlewareConsumer,
  Module,
  NestMiddleware,
  NestModule,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ApiTags } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';

export const isDemo = () => process.env.DEMO_MODE === 'true';

// Anything a public visitor could use to hurt the server or other people. Matched against the path under /api.
// Reading is fine; these are blocked for every method.
const DENY = [
  /^\/v1\/(users|roles|api-keys|webhooks|backups?|sync|integrations?|payment-gateways|updates?|reports\/schedules)(\/|$)/,
  /^\/v1\/auth\/(password|change-password|two-factor|2fa|pin|me)(\/|$)/,
  /^\/v1\/settings\/(email|smtp|printers?)(\/|$)/,
  /upload|\/media\b|\/photo\b|\/import/,
  /^\/v1\/paging\/buzzers\/[^/]+\/test$/, // test calls could hit a webhook address
];

@Injectable()
export class DemoGuardMiddleware implements NestMiddleware {
  constructor(private readonly jwt: JwtService) {}
  use(req: Request, res: Response, next: NextFunction) {
    if (!isDemo()) return next();
    const raw = /(?:^|;\s*)nodedr_session=([^;]+)/.exec(
      req.headers.cookie ?? '',
    )?.[1];
    if (!raw) return next();
    let demo = false;
    try {
      demo = this.jwt.verify<{ demo?: boolean }>(raw).demo === true;
    } catch {
      /* not a valid session: the normal auth guard deals with it */
    }
    if (!demo) return next();
    // originalUrl, not req.path: inside middleware mounted on '*', path is relative to the mount point.
    const path = req.originalUrl.split('?')[0].replace(/^\/api/, '');
    const mutating =
      req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    if (mutating && DENY.some((r) => r.test(path))) {
      return void res.status(403).json({
        message: 'This is switched off in the public demo.',
        code: 'DEMO_RESTRICTED',
        statusCode: 403,
      });
    }
    next();
  }
}

@ApiTags('demo')
@Controller('v1/public')
export class DemoController {
  /** Tells the web app whether this is the public demo, and when it next resets (every DEMO_RESET_HOURS from midnight UTC). */
  @Get('demo-info')
  info() {
    if (!isDemo()) return { demo: false };
    const hours = Math.max(1, Number(process.env.DEMO_RESET_HOURS) || 3);
    const now = new Date();
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(Math.floor(now.getUTCHours() / hours) * hours + hours);
    return {
      demo: true,
      resetEveryHours: hours,
      nextResetAt: next.toISOString(),
    };
  }
}

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [DemoController],
  providers: [DemoGuardMiddleware],
})
export class DemoModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DemoGuardMiddleware).forRoutes('*');
  }
}
