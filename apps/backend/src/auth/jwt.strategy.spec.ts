import { isRevoked } from './jwt.strategy';

describe('isRevoked', () => {
  const at = new Date('2026-11-14T10:00:00.500Z');
  const ms = at.getTime();
  it('never revokes when no revocation was recorded', () => {
    expect(isRevoked(ms - 99999, null)).toBe(false);
    expect(isRevoked(undefined, undefined)).toBe(false);
  });
  it('revokes sessions issued before the change', () => {
    expect(isRevoked(ms - 3_600_000, at)).toBe(true);
    expect(isRevoked(ms - 1, at)).toBe(true);
  });
  it('keeps a sign-in made right after the change, even in the same second', () => {
    expect(isRevoked(ms + 1, at)).toBe(false);
    expect(isRevoked(ms + 300, at)).toBe(false); // same wall-clock second as the change
  });
  it('revokes a token with no issue time once a revocation exists', () => {
    expect(isRevoked(undefined, at)).toBe(true);
  });
});
