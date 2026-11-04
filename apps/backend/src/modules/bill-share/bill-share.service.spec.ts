import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BillShareService } from './bill-share.service';

const jwt = new JwtService({ secret: 'test-secret' });
const svc = new BillShareService(jwt);

describe('BillShareService', () => {
  it('round-trips order, branch and adjustments', () => {
    const t = svc.issueToken('o1', 'b1', { tipAmount: 20, discountFlat: 5 });
    expect(svc.verifyToken(t)).toEqual({
      orderId: 'o1',
      branchId: 'b1',
      adj: { tipAmount: 20, discountFlat: 5 },
    });
  });

  it('rejects a session JWT signed with the same secret', () => {
    const session = jwt.sign({ sub: 'user-1' });
    expect(() => svc.verifyToken(session)).toThrow(UnauthorizedException);
  });

  it('rejects an expired or garbage token', () => {
    expect(() => svc.verifyToken(svc.issueToken('o', 'b', {}, -10))).toThrow(
      UnauthorizedException,
    );
    expect(() => svc.verifyToken('nope')).toThrow(UnauthorizedException);
  });
});
