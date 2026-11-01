import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** Default validity of a guest bill-share link/QR, once issued. */
export const BILL_SHARE_TTL_SECONDS = 2 * 60 * 60;

interface BillShareClaims {
  // Namespaces this token against the session JWTs the same JwtService
  // secret also signs elsewhere (auth.module.ts) — verifyToken below
  // rejects anything without it, so a session token can never be replayed
  // here and vice versa.
  purpose: 'bill-share';
  orderId: string;
  branchId: string;
}

/**
 * Mints and checks the opaque, time-limited token behind a guest-facing
 * bill QR/link (GET /v1/public/bill/:token). Deliberately stateless — no DB
 * row to create or clean up — because a restaurant bill is routinely shown
 * to a guest on paper already; the only thing this adds is "on their own
 * phone instead", so an expiring signed token is proportionate. See
 * OrdersController.createBillShare (issues it) and PublicBillService
 * (verifies it).
 */
@Injectable()
export class BillShareService {
  constructor(private readonly jwt: JwtService) {}

  issueToken(
    orderId: string,
    branchId: string,
    ttlSeconds: number = BILL_SHARE_TTL_SECONDS,
  ): string {
    const claims: BillShareClaims = {
      purpose: 'bill-share',
      orderId,
      branchId,
    };
    return this.jwt.sign(claims, { expiresIn: ttlSeconds });
  }

  verifyToken(token: string): { orderId: string; branchId: string } {
    let claims: BillShareClaims;
    try {
      claims = this.jwt.verify<BillShareClaims>(token);
    } catch {
      throw new UnauthorizedException(
        'This bill link has expired or is no longer valid',
      );
    }
    if (
      claims.purpose !== 'bill-share' ||
      !claims.orderId ||
      !claims.branchId
    ) {
      throw new UnauthorizedException(
        'This bill link has expired or is no longer valid',
      );
    }
    return { orderId: claims.orderId, branchId: claims.branchId };
  }
}
