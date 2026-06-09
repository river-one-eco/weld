/**
 * patterns.ts — Codebase pattern rules:
 *   patterns/erc7201-getter-dollar      _get*Storage() must return variable named '$'
 *   patterns/require-custom-errors      require() with string literal should use custom error
 *   patterns/storage-location-suffix    Storage location constants should end with '_LOCATION'
 *   patterns/event-indexed-key          bytes32 key/role params in events should be indexed
 */
import { visit } from '@solidity-parser/parser';
import { Rule, RuleContext } from '../types.js';
import type { FunctionDef, EventDef, StateVariableDecl } from '../sol-types.js';

// require(cond, "string...") — second arg is a string literal
const REQUIRE_STRING_RE = /\brequire\s*\([^,)]+,\s*"/;

function line(node: { loc?: { start?: { line?: number } } }): number {
  return node.loc?.start?.line ?? 0;
}
function col(node: { loc?: { start?: { column?: number } } }): number {
  return (node.loc?.start?.column ?? 0) + 1;
}

export const patternRules: Rule[] = [
  {
    name: 'patterns/require-custom-errors',
    check(ctx: RuleContext) {
      const { lines } = ctx.parsed;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (REQUIRE_STRING_RE.test(l)) {
          ctx.report({
            line: i + 1, col: l.indexOf('require') + 1, severity: 'warn',
            rule: 'patterns/require-custom-errors',
            message: `Prefer a custom error over a string literal in require()`,
            fixable: false,
          });
        }
      }
    },
  },

  {
    name: 'patterns/storage-location-suffix',
    check(ctx: RuleContext) {
      if (!ctx.parsed.ast) return;
      visit(ctx.parsed.ast, {
        StateVariableDeclaration(node) {
          const n = node as unknown as StateVariableDecl;
          for (const v of n.variables) {
            if (!v.isDeclaredConst) continue;
            if (v.typeName?.name !== 'bytes32') continue;
            const name = v.name ?? '';
            // Heuristic: internal bytes32 const whose name contains STORAGE or storage
            if ((name.includes('STORAGE') || name.includes('storage')) && !name.endsWith('_LOCATION')) {
              ctx.report({
                line: line(v), col: col(v), severity: 'warn',
                rule: 'patterns/storage-location-suffix',
                message: `Storage location constant '${name}' should end with '_LOCATION'`,
                fixable: false,
              });
            }
          }
        },
      });
    },
  },

  {
    name: 'patterns/erc7201-getter-dollar',
    check(ctx: RuleContext) {
      if (!ctx.parsed.ast) return;
      visit(ctx.parsed.ast, {
        FunctionDefinition(node) {
          const n = node as unknown as FunctionDef;
          if (!n.name?.match(/^_get\w*[Ss]torage$/)) return;
          if (!n.returnParameters || n.returnParameters.length !== 1) return;
          const ret = n.returnParameters[0];
          if (ret.storageLocation !== 'storage') return;
          if (ret.name !== '$') {
            ctx.report({
              line: line(n), col: col(n), severity: 'error',
              rule: 'patterns/erc7201-getter-dollar',
              message: `Storage getter '${n.name}' must name its return variable '\$' (got '${ret.name ?? 'unnamed'}')`,
              fixable: false,
            });
          }
        },
      });
    },
  },

  {
    name: 'patterns/event-indexed-key',
    check(ctx: RuleContext) {
      if (!ctx.parsed.ast) return;
      visit(ctx.parsed.ast, {
        EventDefinition(node) {
          const n = node as unknown as EventDef;
          for (const param of n.parameters ?? []) {
            const name = param.name ?? '';
            const typeName = param.typeName?.name ?? '';
            // bytes32 params named 'key', 'role', or 'callSelector' should be indexed
            if (typeName === 'bytes32' && (name === 'key' || name === 'role' || name === 'callSelector')) {
              if (!param.isIndexed) {
                ctx.report({
                  line: line(param), col: col(param), severity: 'warn',
                  rule: 'patterns/event-indexed-key',
                  message: `bytes32 param '${name}' in event '${n.name}' should be indexed`,
                  fixable: false,
                });
              }
            }
          }
        },
      });
    },
  },
];
