/**
 * imports.ts — Import rules:
 *   imports/named-only    All imports must use named import syntax { Symbol }
 *   imports/alignment     Consecutive imports from same directory should align 'from'
 */
import { Rule, RuleContext } from '../types.js';

// Bare import: import "path" or import * as X from "path"
const BARE_IMPORT_RE = /^import\s+"[^"]+"\s*;/;
const STAR_IMPORT_RE = /^import\s+\*\s+as\s+\w+\s+from\s+"[^"]+"\s*;/;
// Named import: import { X } from "path" or multiline version
const NAMED_IMPORT_RE = /^import\s*\{/;

export const importRules: Rule[] = [
  {
    name: 'imports/named-only',
    check(ctx: RuleContext) {
      const { lines } = ctx.parsed;
      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (BARE_IMPORT_RE.test(trimmed)) {
          ctx.report({
            line: i + 1, col: 1, severity: 'error', rule: 'imports/named-only',
            message: `Bare import: use named import syntax — import { Symbol } from "..."`,
            fixable: false,
          });
        }
        if (STAR_IMPORT_RE.test(trimmed)) {
          ctx.report({
            line: i + 1, col: 1, severity: 'warn', rule: 'imports/named-only',
            message: `Wildcard import: prefer named imports — import { Symbol } from "..."`,
            fixable: false,
          });
        }
      }
    },
  },

  {
    name: 'imports/alignment',
    check(ctx: RuleContext) {
      const { lines } = ctx.parsed;

      // Collect runs of consecutive single-line named imports
      const groups = getImportGroups(lines);

      for (const group of groups) {
        if (group.length < 2) continue;

        // Find the 'from' positions in each import line
        const fromPositions = group.map(({ line }) => {
          const fromIdx = line.indexOf(' from ');
          return fromIdx;
        });

        const maxFrom = Math.max(...fromPositions);

        // Check if any line doesn't align at the max position
        for (let i = 0; i < group.length; i++) {
          if (fromPositions[i] !== maxFrom) {
            ctx.report({
              line: group[i].lineNum + 1,
              col: fromPositions[i] + 1,
              severity: 'warn',
              rule: 'imports/alignment',
              message: `Import 'from' keyword should be aligned to column ${maxFrom + 1} in this group`,
              fixable: true,
            });
          }
        }
      }
    },
  },
];

interface ImportLine {
  lineNum: number;  // 0-based
  line: string;
}

function getImportGroups(lines: string[]): ImportLine[][] {
  const groups: ImportLine[][] = [];
  let current: ImportLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Single-line named import (not multiline)
    if (NAMED_IMPORT_RE.test(trimmed) && trimmed.includes(' from ') && trimmed.endsWith(';')) {
      current.push({ lineNum: i, line: lines[i] });
    } else {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }
    }
  }

  if (current.length > 0) groups.push(current);
  return groups;
}
