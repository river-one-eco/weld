#!/usr/bin/env node
/**
 * Unit checks for the semver comparator and the config migration graph.
 * Run via `npm test` (alongside the formatter idempotency gate).
 */
import { compareSemver, semverLt } from '../dist/semver.js';
import {
  CURRENT_VERSION, GENESIS_VERSION, MIGRATIONS,
  rawVersion, pendingMigrations, applyMigrations,
} from '../dist/config.js';

const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RESET = '\x1b[0m';
let failed = 0;
function ok(cond, msg) {
  if (cond) { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
  else { failed++; console.log(`  ${RED}✗ ${msg}${RESET}`); }
}

console.log(`\n${YELLOW}● semver precedence${RESET}\n`);

// Total ordering, including prerelease rules (SemVer §11).
const ordered = [
  '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta',
  '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0-rc.2', '1.0.0',
  '1.0.1', '1.1.0', '1.9.0', '1.10.0', '2.0.0',
];
for (let i = 1; i < ordered.length; i++) {
  ok(semverLt(ordered[i - 1], ordered[i]), `${ordered[i - 1]} < ${ordered[i]}`);
}
ok(compareSemver('1.0.0', '1.0.0') === 0, '1.0.0 == 1.0.0');
ok(compareSemver('1.0.0', '1.0.0-rc.1') === 1, 'release > its prerelease');
ok(compareSemver('1.0.0+build.5', '1.0.0+build.9') === 0, 'build metadata ignored');
ok(compareSemver('1.0.0-beta.11', '1.0.0-beta.2') === 1, 'numeric prerelease fields compare numerically');

console.log(`\n${YELLOW}● migration graph${RESET}  (CURRENT_VERSION = ${CURRENT_VERSION})\n`);

// Legacy integer config (old schema) and unversioned config both map to GENESIS.
ok(rawVersion({ version: 1 }) === GENESIS_VERSION, 'legacy integer version → genesis');
ok(rawVersion({}) === GENESIS_VERSION, 'missing version → genesis');
ok(rawVersion({ version: '1.0.0-rc.1' }) === '1.0.0-rc.1', 'semver string version passes through');

// Edges are a forward chain: each `to` is strictly greater than its `from`.
ok(MIGRATIONS.every(m => compareSemver(m.to, m.from) > 0), 'every edge goes forward (to > from)');

// A genesis/legacy config has at least the genesis edge pending; a current config has none.
ok(pendingMigrations(GENESIS_VERSION).length >= 1, 'genesis config has pending migration(s)');
ok(pendingMigrations(CURRENT_VERSION).length === 0, 'current config has no pending migrations');

// Pending edges resolve in ascending semver order (the forward chain).
const pend = pendingMigrations(GENESIS_VERSION);
ok(pend.every((m, i) => i === 0 || compareSemver(pend[i - 1].to, m.to) <= 0), 'pending edges are semver-ordered');

// applyMigrations on a legacy config drops the integer field and stamps the current semver.
const migrated = applyMigrations({ version: 1, format: { lineLength: 99 } });
ok(migrated.version === CURRENT_VERSION, 'applyMigrations restamps version to current');
ok(typeof migrated.version === 'string', 'migrated version is a string');
ok(migrated.format.lineLength === 99, 'applyMigrations preserves user fields');

if (failed === 0) {
  console.log(`\n${GREEN}✓ version/migration checks passed${RESET}`);
  process.exit(0);
} else {
  console.log(`\n${RED}✗ ${failed} check(s) failed${RESET}`);
  process.exit(1);
}
