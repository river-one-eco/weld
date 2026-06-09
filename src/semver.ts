/**
 * semver.ts — minimal, dependency-free SemVer 2.0.0 parsing and precedence comparison.
 *
 * Supports prerelease identifiers (e.g. `1.0.0-rc.1`, `1.0.0-beta`). Build metadata (`+…`) is parsed
 * but ignored for precedence, per the spec. We keep this in-house (rather than adding the `semver`
 * package) to avoid expanding the dependency surface — see the supply-chain notes in README.md.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
  raw: string;
}

// MAJOR.MINOR.PATCH[-prerelease][+build]
const SEMVER_RE =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function isSemver(v: unknown): v is string {
  return typeof v === 'string' && SEMVER_RE.test(v.trim());
}

export function parseSemver(v: string): SemVer {
  const m = SEMVER_RE.exec(v.trim());
  if (!m) throw new Error(`Invalid semver string: "${v}"`);
  const prerelease = m[4]
    ? m[4].split('.').map(id => (/^\d+$/.test(id) ? Number(id) : id))
    : [];
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease, raw: v };
}

/**
 * Compare two semver strings by precedence: returns -1 if a < b, 0 if equal, 1 if a > b.
 * Implements the SemVer 2.0.0 rules, including: a version WITH a prerelease has LOWER precedence
 * than the same version without one, and prerelease identifiers compare field-by-field (numeric
 * numerically, alphanumeric lexically, numeric < alphanumeric, more fields > fewer).
 */
export function compareSemver(a: string, b: string): number {
  const A = parseSemver(a);
  const B = parseSemver(b);

  if (A.major !== B.major) return A.major < B.major ? -1 : 1;
  if (A.minor !== B.minor) return A.minor < B.minor ? -1 : 1;
  if (A.patch !== B.patch) return A.patch < B.patch ? -1 : 1;

  const ap = A.prerelease;
  const bp = B.prerelease;
  if (ap.length === 0 && bp.length === 0) return 0;
  if (ap.length === 0) return 1; // release > prerelease
  if (bp.length === 0) return -1;

  const n = Math.min(ap.length, bp.length);
  for (let i = 0; i < n; i++) {
    const x = ap[i];
    const y = bp[i];
    if (x === y) continue;
    const xNum = typeof x === 'number';
    const yNum = typeof y === 'number';
    if (xNum && yNum) return (x as number) < (y as number) ? -1 : 1;
    if (xNum) return -1; // numeric identifiers have lower precedence than alphanumeric
    if (yNum) return 1;
    return (x as string) < (y as string) ? -1 : 1; // ASCII lexicographic
  }
  if (ap.length === bp.length) return 0;
  return ap.length < bp.length ? -1 : 1; // a larger set of fields > a smaller one
}

export const semverLt = (a: string, b: string): boolean => compareSemver(a, b) < 0;
export const semverGt = (a: string, b: string): boolean => compareSemver(a, b) > 0;
export const semverLte = (a: string, b: string): boolean => compareSemver(a, b) <= 0;
export const semverGte = (a: string, b: string): boolean => compareSemver(a, b) >= 0;
export const semverEq = (a: string, b: string): boolean => compareSemver(a, b) === 0;
