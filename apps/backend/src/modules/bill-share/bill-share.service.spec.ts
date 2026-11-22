import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BillShareService, billShareSecret } from './bill-share.service';

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

describe('billShareSecret', () => {
  it('is deterministic and never equals the session secret', () => {
    expect(billShareSecret('app-secret')).toBe(billShareSecret('app-secret'));
    expect(billShareSecret('app-secret')).not.toBe('app-secret');
    expect(billShareSecret('a')).not.toBe(billShareSecret('b'));
  });

  it('a link signed with the derived key is not accepted as a session, and vice versa', () => {
    const session = new JwtService({ secret: 'app-secret' });
    const links = new BillShareService(
      new JwtService({ secret: billShareSecret('app-secret') }),
    );
    expect(() => links.verifyToken(session.sign({ sub: 'u1' }))).toThrow(
      UnauthorizedException,
    );
    const link = links.issueToken('o1', 'b1');
    expect(() => {
      session.verify(link);
    }).toThrow();
  });
});
