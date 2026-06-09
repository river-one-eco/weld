#!/usr/bin/env node
/**
 * weld formatter test harness.
 *
 *   node test/run.mjs              # idempotency gate (default) — exit 1 on any diff
 *   node test/run.mjs --roundtrip  # round-trip recovery report (informational)
 *   node test/run.mjs --all        # run both
 *
 * Corpus: curated, human-reviewed canonical files in test/corpus/ representing the house style.
 *
 *  1. IDEMPOTENCY GATE — `format(goldenFile)` must produce ZERO changes. If formatting a known-good
 *     file changes it, the formatter has drifted (over- or under-formatting). This is the regression
 *     gate (run via `npm test`).
 *
 *  2. ROUND-TRIP RECOVERY — `flatten()` strips column alignment from a golden file, then `format()`
 *     tries to restore it. The recovery score = fraction of lines that match the original. Measures
 *     how much of the canonical alignment the formatter can reconstruct from scratch. Informational:
 *     100% is ideal but not required (some alignment can't be recovered from flattened input).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { format } from '../dist/formatter.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(HERE, 'corpus');

const RESET = '\x1b[0m', RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', DIM = '\x1b[2m';

function corpusFiles() {
  return readdirSync(CORPUS_DIR)
    .filter(f => f.endsWith('.sol'))
    .sort()
    .map(f => ({ name: f, path: join(CORPUS_DIR, f) }));
}

// Show the first `max` differing line pairs between two texts.
function showDiff(a, b, max = 12) {
  const al = a.split('\n'), bl = b.split('\n');
  const n = Math.max(al.length, bl.length);
  let shown = 0;
  for (let i = 0; i < n && shown < max; i++) {
    if (al[i] !== bl[i]) {
      console.log(`    ${DIM}${i + 1}${RESET} ${RED}- ${JSON.stringify(al[i] ?? '')}${RESET}`);
      console.log(`    ${DIM}${i + 1}${RESET} ${GREEN}+ ${JSON.stringify(bl[i] ?? '')}${RESET}`);
      shown++;
    }
  }
  if (shown === max) console.log(`    ${DIM}… (more differences omitted)${RESET}`);
}

// Strip column-alignment whitespace from a golden file to test the formatter's ability to rebuild it.
// Conservatively skips comment lines and lines containing string literals to avoid corrupting content.
function flatten(content) {
  return content.split('\n').map(line => {
    const lead = line.match(/^(\s*)/)[1];
    const rest = line.slice(lead.length);
    const t = rest.trimStart();
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return line; // comment
    if (rest.includes('"') || rest.includes("'")) return line;                       // string literal
    return lead + rest.replace(/ {2,}/g, ' ');                                        // collapse alignment
  }).join('\n');
}

function runIdempotency(files) {
  console.log(`\n${YELLOW}● Idempotency gate${RESET} (${files.length} golden files)\n`);
  let failed = 0;
  for (const { name, path } of files) {
    const content = readFileSync(path, 'utf-8');
    const result = format(content, path);
    if (result.changed) {
      failed++;
      console.log(`  ${RED}✗ ${name}${RESET} — format would change it: ${result.fixes.join(', ')}`);
      showDiff(content, result.content);
    } else {
      console.log(`  ${GREEN}✓ ${name}${RESET}`);
    }
  }
  if (failed === 0) {
    console.log(`\n${GREEN}✓ all ${files.length} golden files are idempotent${RESET}`);
  } else {
    console.log(`\n${RED}✗ ${failed}/${files.length} golden files changed under format — formatter has drifted${RESET}`);
  }
  return failed === 0;
}

function runRoundtrip(files) {
  console.log(`\n${YELLOW}● Round-trip recovery${RESET} (flatten → format → compare)\n`);
  let totalLines = 0, totalRecovered = 0;
  for (const { name, path } of files) {
    const original = readFileSync(path, 'utf-8');
    const flat = flatten(original);
    const reformatted = format(flat, path).content;
    const o = original.split('\n'), r = reformatted.split('\n');
    const n = Math.max(o.length, r.length);
    let recovered = 0;
    for (let i = 0; i < n; i++) if (o[i] === r[i]) recovered++;
    totalLines += n; totalRecovered += recovered;
    const pct = ((recovered / n) * 100).toFixed(1);
    const color = pct === '100.0' ? GREEN : pct >= 95 ? YELLOW : RED;
    console.log(`  ${color}${pct.padStart(5)}%${RESET}  ${name}  ${DIM}(${recovered}/${n} lines)${RESET}`);
  }
  const overall = ((totalRecovered / totalLines) * 100).toFixed(1);
  console.log(`\n  overall recovery: ${overall}%  ${DIM}(${totalRecovered}/${totalLines} lines)${RESET}`);
  console.log(`  ${DIM}note: <100% is expected — not all alignment is recoverable from flattened input${RESET}`);
}

const args = process.argv.slice(2);
const files = corpusFiles();
if (files.length === 0) {
  console.error(`${RED}No .sol files in ${CORPUS_DIR}${RESET}`);
  process.exit(1);
}

const roundtrip = args.includes('--roundtrip');
const all = args.includes('--all');

let ok = true;
if (!roundtrip || all) ok = runIdempotency(files);
if (roundtrip || all) runRoundtrip(files);

process.exit(ok ? 0 : 1);
