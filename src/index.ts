#!/usr/bin/env node
/**
 * weld — Solidity linter and formatter for the Sky/PAU diamond-pau ecosystem.
 *
 * Usage:
 *   weld lint [files...]      Lint Solidity files
 *   weld fmt  [files...]      Format (auto-fix) Solidity files   (alias: format)
 *   weld init                 Write a weld.config.json with defaults
 *   weld rules                List all available lint rules
 *
 * Configuration: a `weld.config.json` (found by walking up from the cwd) tunes formatter knobs,
 * per-rule severities (error | warn | off), and default file globs. See `weld init`.
 */
import { program } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import fg from 'fast-glob';
import { parseFile } from './parse.js';
import { lint, ALL_RULES } from './linter.js';
import { format } from './formatter.js';
import { Diagnostic } from './types.js';
import {
  loadConfig, defaultConfig, migrateConfigFile, CONFIG_FILENAME, CURRENT_VERSION,
  WeldConfig, RuleSetting, LoadedConfig,
} from './config.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function resolveFiles(patterns: string[], cfg: WeldConfig): string[] {
  const pats = patterns.length ? patterns : cfg.include;
  return fg.sync(pats, { ignore: cfg.exclude, absolute: true });
}

function severityColor(sev: Diagnostic['severity']): string {
  return sev === 'error' ? chalk.red(sev) : chalk.yellow(sev);
}

function printDiagnostics(file: string, diags: Diagnostic[], cwd: string): boolean {
  if (diags.length === 0) return false;
  const rel = file.startsWith(cwd) ? file.slice(cwd.length + 1) : file;
  console.log(chalk.underline(rel));
  for (const d of diags) {
    const loc = chalk.dim(`${d.line}:${d.col}`);
    const sev = severityColor(d.severity);
    const rule = chalk.dim(d.rule);
    const fix = d.fixable ? chalk.green(' [fixable]') : '';
    console.log(`  ${loc}  ${sev}  ${d.message}  ${rule}${fix}`);
  }
  console.log();
  return true;
}

// Warn (to stderr, non-fatal) when the on-disk config doesn't match this weld's version. We only nag
// when there are real structural migrations pending (or the config is from a newer weld) — a pure
// version-stamp drift across releases with no schema change is handled silently by `weld migrate`.
function noticeIfStale(loaded: LoadedConfig): void {
  if (loaded.newerThanTool) {
    console.error(chalk.yellow(
      `⚠ ${CONFIG_FILENAME} was written by weld ${loaded.fromVersion}, newer than this weld (${CURRENT_VERSION}). ` +
      `Consider upgrading weld; unknown fields are ignored.`));
  } else if (loaded.pending.length > 0) {
    console.error(chalk.yellow(
      `⚠ ${CONFIG_FILENAME} (from weld ${loaded.fromVersion}) has ${loaded.pending.length} pending ` +
      `schema migration(s) to ${CURRENT_VERSION}. Using migrated settings in-memory — run \`weld migrate\`.`));
  }
}

// Apply config rule settings: which rules run, and re-map their severities. CLI --rules wins.
function rulePlan(cfg: WeldConfig, cliRules?: string): {
  enabled: string[] | undefined;
  severityOf: (rule: string) => RuleSetting | undefined;
} {
  const settings = cfg.lint.rules;
  if (cliRules) {
    const enabled = cliRules.split(',').map(r => r.trim()).filter(Boolean);
    return { enabled, severityOf: r => settings[r] };
  }
  const enabled = ALL_RULES.map(r => r.name).filter(name => settings[name] !== 'off');
  return { enabled, severityOf: r => settings[r] };
}

// ─── commands ───────────────────────────────────────────────────────────────

program
  .name('weld')
  .description('Solidity formatter and linter for the Sky ecosystem')
  .version(CURRENT_VERSION);

// ---- lint ------------------------------------------------------------------
program
  .command('lint [files...]')
  .description('Lint Solidity files for style and pattern violations')
  .option('--rules <rules>', 'Comma-separated list of rules to run (default: from config / all)')
  .option('--errors-only', 'Only report errors, not warnings')
  .option('--fix', 'Apply auto-fixable issues (same as running format)')
  .action(async (files: string[], opts: { rules?: string; errorsOnly?: boolean; fix?: boolean }) => {
    const cwd = process.cwd();
    const loaded = loadConfig(cwd);
    noticeIfStale(loaded);
    const { config } = loaded;
    const paths = resolveFiles(files, config);
    if (paths.length === 0) {
      console.error(chalk.red('No .sol files found'));
      process.exit(1);
    }

    const { enabled, severityOf } = rulePlan(config, opts.rules);

    let totalErrors = 0;
    let totalWarns = 0;

    for (const filePath of paths) {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = parseFile(filePath, content);
      let { diagnostics } = lint(parsed, enabled, config.solidity);

      // Re-map severities per config (and drop any rule turned 'off').
      diagnostics = diagnostics.flatMap(d => {
        const setting = severityOf(d.rule);
        if (setting === 'off') return [];
        return [{ ...d, severity: (setting ?? d.severity) as Diagnostic['severity'] }];
      });

      if (opts.errorsOnly) diagnostics = diagnostics.filter(d => d.severity === 'error');

      if (opts.fix) {
        const fixable = diagnostics.filter(d => d.fixable);
        if (fixable.length > 0) {
          const result = format(content, filePath, config.format);
          if (result.changed) {
            writeFileSync(filePath, result.content, 'utf-8');
            console.log(chalk.green(`Fixed ${filePath}: ${result.fixes.join(', ')}`));
          }
        }
      }

      printDiagnostics(filePath, diagnostics, cwd);
      totalErrors += diagnostics.filter(d => d.severity === 'error').length;
      totalWarns += diagnostics.filter(d => d.severity === 'warn').length;
    }

    console.log([
      chalk.bold(`${paths.length} file(s) checked`),
      totalErrors > 0 ? chalk.red(`${totalErrors} error(s)`) : chalk.green('0 errors'),
      totalWarns > 0 ? chalk.yellow(`${totalWarns} warning(s)`) : chalk.green('0 warnings'),
    ].join('  '));

    if (totalErrors > 0) process.exit(1);
  });

// ---- format / fmt ----------------------------------------------------------
program
  .command('format [files...]')
  .alias('fmt')
  .description('Auto-format Solidity files to match house style')
  .option('--check', 'Dry run — report what would change without writing files')
  .action(async (files: string[], opts: { check?: boolean }) => {
    const cwd = process.cwd();
    const loaded = loadConfig(cwd);
    noticeIfStale(loaded);
    const { config } = loaded;
    const paths = resolveFiles(files, config);
    if (paths.length === 0) {
      console.error(chalk.red('No .sol files found'));
      process.exit(1);
    }

    let changed = 0;
    for (const filePath of paths) {
      const content = readFileSync(filePath, 'utf-8');
      const result = format(content, filePath, config.format);
      if (!result.changed) continue;

      const rel = filePath.startsWith(cwd) ? filePath.slice(cwd.length + 1) : filePath;
      changed++;

      if (opts.check) {
        console.log(chalk.yellow(`Would fix ${rel}:`));
      } else {
        writeFileSync(filePath, result.content, 'utf-8');
        console.log(chalk.green(`Fixed ${rel}:`));
      }
      for (const fix of result.fixes) console.log(`  ${chalk.dim('→')} ${fix}`);
    }

    if (changed === 0) {
      console.log(chalk.green(`All ${paths.length} file(s) are already formatted`));
    } else if (opts.check) {
      console.log(chalk.yellow(`\n${changed} file(s) would be reformatted`));
      process.exit(1);
    } else {
      console.log(chalk.green(`\nFormatted ${changed} file(s)`));
    }
  });

// ---- init ------------------------------------------------------------------
program
  .command('init')
  .description(`Write a ${CONFIG_FILENAME} with default settings into the current directory`)
  .option('-f, --force', 'Overwrite an existing config file')
  .action((opts: { force?: boolean }) => {
    const target = join(process.cwd(), CONFIG_FILENAME);
    if (existsSync(target) && !opts.force) {
      console.error(chalk.red(`${CONFIG_FILENAME} already exists. Use --force to overwrite.`));
      process.exit(1);
    }
    writeFileSync(target, JSON.stringify(defaultConfig(), null, 2) + '\n', 'utf-8');
    console.log(chalk.green(`Wrote ${CONFIG_FILENAME}`));
    console.log(chalk.dim('  Edit format knobs, set rules to error | warn | off, or adjust include/exclude globs.'));
  });

// ---- migrate ---------------------------------------------------------------
program
  .command('migrate')
  .description(`Upgrade ${CONFIG_FILENAME} to the current weld version (${CURRENT_VERSION})`)
  .option('--check', 'Report whether a migration is needed without writing')
  .action((opts: { check?: boolean }) => {
    const loaded = loadConfig(process.cwd());
    if (!loaded.path) {
      console.error(chalk.red(`No ${CONFIG_FILENAME} found (run \`weld init\` first)`));
      process.exit(1);
    }
    if (loaded.newerThanTool) {
      console.error(chalk.red(
        `${loaded.path} was written by weld ${loaded.fromVersion}, newer than this weld (${CURRENT_VERSION}). ` +
        `Upgrade weld instead of migrating down.`));
      process.exit(1);
    }
    if (!loaded.needsMigration) {
      console.log(chalk.green(`${CONFIG_FILENAME} is already current (${CURRENT_VERSION}).`));
      return;
    }
    // --check: a pending STRUCTURAL migration is a real incompatibility (exit 1); a pure version-stamp
    // drift (no schema change) is informational only (exit 0).
    if (opts.check) {
      if (loaded.pending.length > 0) {
        console.log(chalk.yellow(
          `${CONFIG_FILENAME} would migrate ${loaded.fromVersion} → ${CURRENT_VERSION} ` +
          `(${loaded.pending.length} schema change(s)).`));
        process.exit(1);
      }
      console.log(chalk.dim(
        `${CONFIG_FILENAME} version stamp ${loaded.fromVersion} is behind ${CURRENT_VERSION} ` +
        `(no schema changes). \`weld migrate\` will refresh the stamp.`));
      return;
    }
    const result = migrateConfigFile(process.cwd());
    console.log(chalk.green(`Migrated ${result.path}: ${result.fromVersion} → ${result.toVersion}`));
    for (const m of result.applied) {
      console.log(`  ${chalk.dim('→')} ${m.from} → ${m.to}: ${m.description}`);
    }
    if (result.applied.length === 0) console.log(chalk.dim('  (version stamp refreshed; no schema changes)'));
  });

// ---- rules -----------------------------------------------------------------
program
  .command('rules')
  .description('List all available lint rules')
  .action(() => {
    const loaded = loadConfig(process.cwd());
    noticeIfStale(loaded);
    const { config, path } = loaded;
    if (path) console.log(chalk.dim(`(severities from ${path})\n`));
    const byCategory: Record<string, typeof ALL_RULES> = {};
    for (const rule of ALL_RULES) {
      const cat = rule.name.split('/')[0];
      (byCategory[cat] ??= []).push(rule);
    }
    for (const [cat, rules] of Object.entries(byCategory)) {
      console.log(chalk.bold.cyan(`\n${cat}`));
      for (const rule of rules) {
        const setting = config.lint.rules[rule.name] ?? 'error';
        const tag = setting === 'off' ? chalk.dim('off')
          : setting === 'error' ? chalk.red('error') : chalk.yellow('warn');
        console.log(`  ${chalk.white(rule.name.padEnd(42))} ${tag}`);
      }
    }
    console.log();
  });

program.parse();
