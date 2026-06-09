/**
 * config.ts — weld.config.json discovery, parsing, and defaults.
 *
 * A project may drop a `weld.config.json` at its root (found by walking up from the cwd). It tunes
 * the formatter knobs, sets per-rule severities (error | warn | off), and provides default file
 * globs. `weld init` writes a fully-populated file with the defaults below.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { ALL_RULES } from './linter.js';
import { compareSemver, isSemver, semverGt, semverLt, semverLte } from './semver.js';
import { FORMAT_DEFAULTS } from './formatter.js';
import { DEFAULT_SOLIDITY } from './types.js';
import type { FormatOptions } from './formatter.js';
import type { Severity, SolidityExpectations } from './types.js';

export const CONFIG_FILENAME = 'weld.config.json';

// The current weld (tool) version, read from package.json — this is the semver that `weld init` and
// `weld migrate` stamp into a config, and the target the migration graph upgrades toward.
function readPackageVersion(): string {
  // dist/config.js → ../package.json (and src/config.ts → ../package.json under tsx); CJS __dirname.
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as { version: string };
  return pkg.version;
}
export const CURRENT_VERSION: string = readPackageVersion();

// Sentinel for configs with no usable semver `version` (pre-versioning files, or the earlier integer
// schema). Treated as the oldest possible version so every migration applies.
export const GENESIS_VERSION = '0.0.0';

export type RuleSetting = Severity | 'off';

export interface WeldConfig {
  version: string;   // semver of the weld release that wrote/last-migrated this config
  solidity: SolidityExpectations;  // required SPDX identifier + pragma version
  format: Required<FormatOptions>;
  lint: { rules: Record<string, RuleSetting> };
  include: string[];
  exclude: string[];
}

// Single source of truth for formatter defaults lives in formatter.ts (FORMAT_DEFAULTS).
export const DEFAULT_FORMAT: Required<FormatOptions> = { ...FORMAT_DEFAULTS };

export const DEFAULT_INCLUDE = ['src/**/*.sol', 'test/**/*.sol', 'script/**/*.sol'];
export const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/lib/**', '**/out/**', '**/cache/**'];

// Each rule's NATIVE severity (the one it reports with in code). `weld init` writes these so they
// can be flipped to error / warn / off without silently escalating a rule. A rule not listed here
// (e.g. a future rule) falls back to 'warn'.
const NATIVE_SEVERITY: Record<string, RuleSetting> = {
  'file/spdx': 'error',
  'file/pragma-version': 'error',
  'file/blank-after-pragma': 'warn',
  'imports/named-only': 'error',
  'imports/alignment': 'warn',
  'naming/interface-i-prefix': 'error',
  'naming/constants-upper-snake': 'warn',
  'naming/events-pascal-case': 'error',
  'naming/errors-pascal-case': 'error',
  'naming/errors-no-error-suffix': 'warn',
  'naming/internal-functions-prefix': 'error',
  'naming/storage-pointer-dollar': 'error',
  'naming/test-functions-prefix': 'warn',
  'naming/test-contracts-suffix': 'warn',
  'structure/section-header-format': 'error',
  'structure/modifier-order': 'error',
  'structure/setup-external': 'warn',
  'patterns/require-custom-errors': 'warn',
  'patterns/storage-location-suffix': 'warn',
  'patterns/erc7201-getter-dollar': 'error',
  'patterns/event-indexed-key': 'warn',
  'ordering/interface-members-alphabetical': 'warn',
  'ordering/constructor-args-alphabetical': 'warn',
  'ordering/contract-section-order': 'warn',
};

export function defaultConfig(): WeldConfig {
  const rules: Record<string, RuleSetting> = {};
  for (const r of ALL_RULES) rules[r.name] = NATIVE_SEVERITY[r.name] ?? 'warn';
  return {
    version: CURRENT_VERSION,
    solidity: { ...DEFAULT_SOLIDITY },
    format: { ...DEFAULT_FORMAT },
    lint: { rules },
    include: [...DEFAULT_INCLUDE],
    exclude: [...DEFAULT_EXCLUDE],
  };
}

// ─── migrations ───────────────────────────────────────────────────────────────
//
// A raw (parsed-from-disk) config object. Typed loosely because an on-disk file may use an OLD schema
// that no longer matches WeldConfig.
type RawConfig = Record<string, unknown>;

// A single edge in the update graph: upgrade the config schema from one release to the next.
export interface Migration {
  from: string;        // release the config is coming FROM (documentation + chain validation)
  to: string;          // release that introduced this schema change
  description: string; // human-readable summary, shown by `weld migrate`
  migrate: (c: RawConfig) => RawConfig; // STRUCTURAL transform only — never touch `version`
}

// The update graph: a forward chain of migrations keyed by semver. Resolution (pendingMigrations)
// selects every edge whose `to` is in (configVersion, CURRENT_VERSION] and applies them in ascending
// semver order — so an old config is carried across multiple releases in one pass (e.g. a config from
// the integer era → 1.0.0-rc.1 → 1.1.0 → …). Add an edge ONLY when a release changes the config
// SHAPE (rename / restructure / remove a field); additive fields are backfilled by mergeOntoDefaults.
export const MIGRATIONS: Migration[] = [
  {
    from: GENESIS_VERSION,
    to: '1.0.0-rc.1',
    description: 'replace the legacy integer "version" field with a semver string',
    // Drop the old integer version; applyMigrations() restamps `version` with the current semver.
    migrate: ({ version: _legacyIntegerVersion, ...rest }) => rest,
  },
  {
    from: '1.0.0-rc.1',
    to: '1.0.0-rc.2',
    description: 'rename lint rule "file/spdx-agpl" → "file/spdx" (SPDX is now configurable)',
    migrate: (c) => {
      const lint = (c.lint ?? {}) as { rules?: Record<string, unknown> };
      const rules = { ...(lint.rules ?? {}) };
      if ('file/spdx-agpl' in rules) {
        if (!('file/spdx' in rules)) rules['file/spdx'] = rules['file/spdx-agpl'];
        delete rules['file/spdx-agpl'];
      }
      return { ...c, lint: { ...lint, rules } };
    },
  },
  // Template for the next schema change:
  // {
  //   from: '1.0.0-rc.1',
  //   to: '1.1.0',
  //   description: 'rename format.lineLength → format.maxLineLength',
  //   migrate: (c) => { const f = (c.format ?? {}) as Record<string, unknown>;
  //     return { ...c, format: { ...f, maxLineLength: f.lineLength } }; },
  // },
];

// Read the version off a raw config. A non-semver value (missing, or the legacy integer) ⇒ GENESIS.
export function rawVersion(raw: RawConfig): string {
  return isSemver(raw.version) ? (raw.version as string).trim() : GENESIS_VERSION;
}

// The ordered list of migration edges needed to bring `fromVersion` up to CURRENT_VERSION.
export function pendingMigrations(fromVersion: string): Migration[] {
  return MIGRATIONS
    .filter(m => semverGt(m.to, fromVersion) && semverLte(m.to, CURRENT_VERSION))
    .sort((a, b) => compareSemver(a.to, b.to));
}

// Apply pending structural migrations, then restamp `version` to the current release. Additive fields
// are filled later by mergeOntoDefaults.
export function applyMigrations(raw: RawConfig): RawConfig {
  let out = raw;
  for (const m of pendingMigrations(rawVersion(raw))) out = m.migrate(out);
  return { ...out, version: CURRENT_VERSION };
}

// Walk up from `startDir` looking for weld.config.json. Returns its absolute path or null.
export function findConfig(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    const candidate = join(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export interface LoadedConfig {
  config: WeldConfig;
  path: string | null;
  fromVersion: string;        // version found on disk (GENESIS if unversioned/legacy; CURRENT if no file)
  needsMigration: boolean;    // on-disk config is older than this weld
  newerThanTool: boolean;     // on-disk config was written by a newer weld than this one
  pending: Migration[];       // structural migration edges that would be applied
}

// Merge a (possibly migrated) raw config onto defaults, producing a complete, current-shape config.
function mergeOntoDefaults(raw: RawConfig): WeldConfig {
  const base = defaultConfig();
  const rawFormat = (raw.format ?? {}) as Partial<FormatOptions>;
  const rawLint = (raw.lint ?? {}) as { rules?: Record<string, RuleSetting> };
  const rawSolidity = (raw.solidity ?? {}) as Partial<SolidityExpectations>;
  return {
    version: CURRENT_VERSION,
    solidity: { ...base.solidity, ...rawSolidity },
    format: { ...base.format, ...rawFormat },
    lint: { rules: { ...base.lint.rules, ...(rawLint.rules ?? {}) } },
    include: (raw.include as string[]) ?? base.include,
    exclude: (raw.exclude as string[]) ?? base.exclude,
  };
}

// Load config (migrated in-memory, then merged onto defaults). If none is found, returns defaults.
export function loadConfig(startDir: string): LoadedConfig {
  const path = findConfig(startDir);
  if (!path) {
    return {
      config: defaultConfig(), path: null, fromVersion: CURRENT_VERSION,
      needsMigration: false, newerThanTool: false, pending: [],
    };
  }

  let parsed: RawConfig;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8')) as RawConfig;
  } catch (e) {
    throw new Error(`Failed to parse ${path}: ${(e as Error).message}`);
  }

  const fromVersion = rawVersion(parsed);
  const config = mergeOntoDefaults(applyMigrations(parsed));
  return {
    config,
    path,
    fromVersion,
    needsMigration: semverLt(fromVersion, CURRENT_VERSION),
    newerThanTool: semverGt(fromVersion, CURRENT_VERSION),
    pending: pendingMigrations(fromVersion),
  };
}

export interface MigrationResult {
  path: string;
  fromVersion: string;
  toVersion: string;
  applied: Migration[];  // structural edges that ran
  changed: boolean;      // did the file content actually change?
}

// Migrate the config file on disk to the current version and write it back (pretty-printed).
// Returns info about what happened. Throws if no config file is found.
export function migrateConfigFile(startDir: string): MigrationResult {
  const path = findConfig(startDir);
  if (!path) throw new Error(`No ${CONFIG_FILENAME} found (run \`weld init\` first)`);

  const before = readFileSync(path, 'utf-8');
  let parsed: RawConfig;
  try {
    parsed = JSON.parse(before) as RawConfig;
  } catch (e) {
    throw new Error(`Failed to parse ${path}: ${(e as Error).message}`);
  }

  const fromVersion = rawVersion(parsed);
  const applied = pendingMigrations(fromVersion);
  const migrated = mergeOntoDefaults(applyMigrations(parsed));
  const after = JSON.stringify(migrated, null, 2) + '\n';
  if (after !== before) writeFileSync(path, after, 'utf-8');

  return { path, fromVersion, toVersion: CURRENT_VERSION, applied, changed: after !== before };
}
