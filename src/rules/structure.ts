/**
 * structure.ts — Structural rules:
 *   structure/section-header-format  Section comment headers must be exactly 96 chars
 *   structure/modifier-order         Modifier order: nonReentrant before onlyRole, override before nonReentrant
 *   structure/setup-external         setUp() in test files must be external
 */
import { visit } from '@solidity-parser/parser';
import { Rule, RuleContext } from '../types.js';
import type { FunctionDef } from '../sol-types.js';

// Section headers total line length (including indentation) must be 100.
// At contract level that means 4-space indent + /.../ of 96 chars.
// Inside function bodies (8-space indent) that means /.../ of 92 chars.
const HEADER_TOTAL_LEN = 100;
// For the formatter we reconstruct using a 96-char stripped border (4-space indent)
const HEADER_BORDER = '/' + '*'.repeat(94) + '/';

// Ordered list of modifier names (lower index = must come first)
const MODIFIER_ORDER: string[] = [
  'view', 'pure', 'payable', 'override', 'virtual', 'nonReentrant', 'onlyRole', 'initializer',
];

function modifierIndex(name: string): number {
  const idx = MODIFIER_ORDER.indexOf(name);
  return idx === -1 ? MODIFIER_ORDER.length : idx;
}

function line(node: { loc?: { start?: { line?: number } } }): number {
  return node.loc?.start?.line ?? 0;
}
function col(node: { loc?: { start?: { column?: number } } }): number {
  return (node.loc?.start?.column ?? 0) + 1;
}

export const structureRules: Rule[] = [
  {
    name: 'structure/section-header-format',
    check(ctx: RuleContext) {
      const { lines } = ctx.parsed;
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const rawLen = raw.trimEnd().length;  // total length excluding trailing whitespace
        const stripped = raw.trim();

        // Only process lines that look like section headers (long enough to be real headers)
        // A real section header stripped is at least 88 chars to distinguish from short dividers.
        if (stripped.length < 88) continue;

        // Border line: starts with / followed only by * and ending with /
        if (/^\/\*+\/$/.test(stripped)) {
          if (rawLen !== HEADER_TOTAL_LEN) {
            ctx.report({
              line: i + 1, col: 1, severity: 'error',
              rule: 'structure/section-header-format',
              message: `Section header border must be ${HEADER_TOTAL_LEN} chars total (got ${rawLen})`,
              fixable: true,
            });
          }
          continue;
        }

        // Section title line: /*** ... ***/
        if (stripped.startsWith('/***') && stripped.endsWith('***/')) {
          if (rawLen !== HEADER_TOTAL_LEN) {
            ctx.report({
              line: i + 1, col: 1, severity: 'error',
              rule: 'structure/section-header-format',
              message: `Section title line must be ${HEADER_TOTAL_LEN} chars total (got ${rawLen})`,
              fixable: true,
            });
          }
        }
      }
    },
  },

  {
    name: 'structure/modifier-order',
    check(ctx: RuleContext) {
      if (!ctx.parsed.ast) return;
      visit(ctx.parsed.ast, {
        FunctionDefinition(node) {
          const n = node as unknown as FunctionDef;
          if (!n.modifiers || n.modifiers.length === 0) return;

          const modNames = n.modifiers.map(m =>
            typeof m.name === 'string' ? m.name : (m.name as { namePath?: string; name?: string }).namePath ?? (m.name as { name?: string }).name ?? ''
          );

          for (let i = 0; i < modNames.length - 1; i++) {
            for (let j = i + 1; j < modNames.length; j++) {
              if (modifierIndex(modNames[i]) > modifierIndex(modNames[j])) {
                ctx.report({
                  line: line(n), col: col(n), severity: 'error',
                  rule: 'structure/modifier-order',
                  message: `Modifier '${modNames[j]}' should come before '${modNames[i]}'`,
                  fixable: true,
                });
                return; // one report per function
              }
            }
          }
        },
      });
    },
  },

  {
    name: 'structure/setup-external',
    check(ctx: RuleContext) {
      if (!ctx.parsed.isTestFile) return;
      if (!ctx.parsed.ast) return;
      visit(ctx.parsed.ast, {
        FunctionDefinition(node) {
          const n = node as unknown as FunctionDef;
          if (n.name !== 'setUp') return;
          if (n.visibility !== 'external') {
            ctx.report({
              line: line(n), col: col(n), severity: 'warn',
              rule: 'structure/setup-external',
              message: `setUp() should be 'external' (got '${n.visibility ?? 'default'}')`,
              fixable: false,
            });
          }
        },
      });
    },
  },
];
