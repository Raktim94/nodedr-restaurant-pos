const ZERO = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF"]);
const THREE = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);

/** Integer minor units (as the server stores them) to a display number. */
export function fromMinorUnits(minor: number, currency: string): number {
  const c = currency.toUpperCase();
  return minor / 10 ** (ZERO.has(c) ? 0 : THREE.has(c) ? 3 : 2);
}
