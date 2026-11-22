import { createHmac } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { BillPreviewDto } from '@nodedr-restaurant/types';

/**
 * The signing key for bill links, derived from the app secret but different from it. A guest link and a staff
 * session are then signed with different keys, so neither can ever validate as the other even if a claim is
 * forged or a future change loosens the `purpose` check.
 */
export function billShareSecret(appSecret: string): string {
  return createHmac('sha256', appSecret)
    .update('orderrestro:bill-share:v1')
    .digest('hex');
}

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
