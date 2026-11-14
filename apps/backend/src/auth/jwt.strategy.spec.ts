import { isRevoked } from './jwt.strategy';

describe('isRevoked', () => {
  const at = new Date('2026-11-14T10:00:00.000Z');
  const sec = Math.floor(at.getTime() / 1000);
  it('never revokes when no revocation was recorded', () => {
    expect(isRevoked(sec - 99999, null)).toBe(false);
    expect(isRevoked(undefined, undefined)).toBe(false);
  });
  it('revokes sessions issued before the change, and in the same second', () => {
    expect(isRevoked(sec - 3600, at)).toBe(true);
    expect(isRevoked(sec, at)).toBe(true);
  });
  it('keeps sessions issued after the change', () => {
    expect(isRevoked(sec + 1, at)).toBe(false);
  });
  it('revokes a token with no issue time once a revocation exists', () => {
    expect(isRevoked(undefined, at)).toBe(true);
  });
});
