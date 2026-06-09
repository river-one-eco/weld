/**
 * file.ts — File-level rules:
 *   file/spdx              SPDX must match the configured identifier (weld.config.json → solidity.spdx)
 *   file/pragma-version    pragma must match the configured version (weld.config.json → solidity.pragma)
 *   file/blank-after-pragma blank line must follow pragma
 */
import { Rule, RuleContext } from '../types.js';

export const fileRules: Rule[] = [
  {
    name: 'file/spdx',
    check(ctx: RuleContext) {
      const { lines } = ctx.parsed;
      const { spdx } = ctx.solidity;

      const spdxIdx = lines.findIndex(l => l.startsWith('// SPDX-License-Identifier:'));
      if (spdxIdx === -1) {
        ctx.report({ line: 1, col: 1, severity: 'error', rule: 'file/spdx', message: 'Missing SPDX license identifier', fixable: false });
        return;
      }

      // When `spdx` is null, any present identifier is accepted (only presence is enforced).
      if (spdx !== null) {
        const expected = `// SPDX-License-Identifier: ${spdx}`;
        if (lines[spdxIdx].trim() !== expected) {
          ctx.report({
            line: spdxIdx + 1, col: 1, severity: 'error', rule: 'file/spdx',
            message: `Expected '${expected}', got '${lines[spdxIdx].trim()}'`,
            fixable: false,
          });
        }
      }

      if (spdxIdx !== 0) {
        ctx.report({ line: 1, col: 1, severity: 'warn', rule: 'file/spdx', message: 'SPDX identifier should be on line 1', fixable: false });
      }
    },
  },

  {
    name: 'file/pragma-version',
    check(ctx: RuleContext) {
      const { lines } = ctx.parsed;
      const expected = `pragma solidity ${ctx.solidity.pragma};`;
      const pragmaIdx = lines.findIndex(l => l.trim().startsWith('pragma solidity'));
      if (pragmaIdx === -1) {
        ctx.report({ line: 1, col: 1, severity: 'error', rule: 'file/pragma-version', message: 'Missing pragma directive', fixable: false });
        return;
      }

      if (lines[pragmaIdx].trim() !== expected) {
        ctx.report({
          line: pragmaIdx + 1, col: 1, severity: 'error', rule: 'file/pragma-version',
          message: `Expected '${expected}', got '${lines[pragmaIdx].trim()}'`,
          fixable: false,
        });
      }
    },
  },

  {
    name: 'file/blank-after-pragma',
    check(ctx: RuleContext) {
      const { lines } = ctx.parsed;
      const pragmaIdx = lines.findIndex(l => l.trim().startsWith('pragma solidity'));
      if (pragmaIdx === -1) return;

      if (pragmaIdx + 1 < lines.length && lines[pragmaIdx + 1].trim() !== '') {
        ctx.report({
          line: pragmaIdx + 2, col: 1, severity: 'warn', rule: 'file/blank-after-pragma',
          message: 'Expected blank line after pragma directive',
          fixable: true,
        });
      }
    },
  },
];
