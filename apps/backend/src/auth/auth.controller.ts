import {
  Body,
  Controller,
  Get,
  Post,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { loginSchema, pinLoginSchema } from '@nodedr-restaurant/types';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';

const SESSION_COOKIE = 'nodedr_session';
const COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// A `Secure` cookie is silently dropped by every browser on a plain
// `http://` origin — including the default `http://<lan-ip>:1995` this app
// is normally reached at. Deriving this from `NODE_ENV === 'production'`
// (the old behavior) meant every Docker deployment set `Secure` on the
// session cookie yet was served over HTTP, so login "succeeded" but the
// browser never stored the cookie and every following request came back
// 401 Unauthorized. Default to false; opt in explicitly via COOKIE_SECURE
// once the app is actually served over HTTPS (see README).
function isCookieSecure(): boolean {
  return process.env.COOKIE_SECURE === 'true';
}

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.authService.login(body as never);
    this.setSessionCookie(res, token);
    return { user };
  }

  @Post('pin-login')
  @UsePipes(new ZodValidationPipe(pinLoginSchema))
  async pinLogin(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.authService.pinLogin(body as never);
    this.setSessionCookie(res, token);
    return { user };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isCookieSecure(),
    });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: unknown) {
    return { user };
  }

  private setSessionCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isCookieSecure(),
      maxAge: COOKIE_MAX_AGE_MS,
    });
  }
}
