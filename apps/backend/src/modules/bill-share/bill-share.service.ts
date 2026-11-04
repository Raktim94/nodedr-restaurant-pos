import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { BillPreviewDto } from '@nodedr-restaurant/types';

/** Validity of a guest bill-share link/QR once issued. */
export const BILL_SHARE_TTL_SECONDS = 2 * 60 * 60;

interface BillShareClaims {
  // Separates this token from session JWTs signed with the same secret:
  // verifyToken rejects anything without it.
  purpose: 'bill-share';
  orderId: string;
  branchId: string;
  // The discount / tip / loyalty the cashier had on screen when sharing, so
  // the guest sees the same figures. Authorized when the token is issued.
  adj: BillPreviewDto;
}

const INVALID = 'This bill link has expired or is no longer valid';

/**
 * Mints and checks the stateless, time-limited token behind the guest bill
 * QR (GET /v1/public/bill/:token). No DB row to create or clean up.
 */
@Injectable()
export class BillShareService {
  constructor(private readonly jwt: JwtService) {}

  issueToken(
    orderId: string,
    branchId: string,
    adj: BillPreviewDto = {},
    ttlSeconds: number = BILL_SHARE_TTL_SECONDS,
  ): string {
    const claims: BillShareClaims = {
      purpose: 'bill-share',
      orderId,
      branchId,
      adj,
    };
    return this.jwt.sign(claims, { expiresIn: ttlSeconds });
  }

  verifyToken(token: string): {
    orderId: string;
    branchId: string;
    adj: BillPreviewDto;
  } {
    let claims: BillShareClaims;
    try {
      claims = this.jwt.verify<BillShareClaims>(token);
    } catch {
      throw new UnauthorizedException(INVALID);
    }
    if (
      claims.purpose !== 'bill-share' ||
      !claims.orderId ||
      !claims.branchId
    ) {
      throw new UnauthorizedException(INVALID);
    }
    return {
      orderId: claims.orderId,
      branchId: claims.branchId,
      adj: claims.adj ?? {},
    };
  }
}
