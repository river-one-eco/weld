/**
 * naming.ts — Naming convention rules:
 *   naming/interface-i-prefix         Interfaces must start with 'I'
 *   naming/constants-upper-snake      All constants must be UPPER_SNAKE_CASE
 *   naming/events-pascal-case         Events must be PascalCase
 *   naming/errors-pascal-case         Custom errors must be PascalCase
 *   naming/errors-no-error-suffix     Custom errors must not end with 'Error'
 *   naming/internal-functions-prefix  Internal/private contract functions must start with '_'
 *   naming/storage-pointer-dollar     _get*Storage() return variable must be '$'
 *   naming/test-functions-prefix      Test functions must start with 'test_' (test files only)
 *   naming/test-contracts-suffix      Test contracts must end with '_Tests' or '_TestBase'
 */
import { visit } from '@solidity-parser/parser';
import { Rule, RuleContext } from '../types.js';
import type { ContractDef, FunctionDef, StateVariableDecl, EventDef, CustomErrorDef, SolNode } from '../sol-types.js';

const UPPER_SNAKE_RE = /^_?[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;
const PASCAL_CASE_RE = /^[A-Z][a-zA-Z0-9]*$/;

function isUpperSnake(name: string): boolean {
  return UPPER_SNAKE_RE.test(name);
}
function isPascalCase(name: string): boolean {
  return PASCAL_CASE_RE.test(name);
}
function ln(node: { loc?: { start?: { line?: number } } }): number {
  return node.loc?.start?.line ?? 0;
}
function cl(node: { loc?: { start?: { column?: number } } }): number {
  return (node.loc?.start?.column ?? 0) + 1;
}

/** Iterate subNodes of non-library contracts only */
function forContractSubNodes(
  ast: unknown,
  kinds: ContractDef['kind'][],
  cb: (contract: ContractDef, node: SolNode) => void,
): void {
  const root = ast as { children?: SolNode[] };
  for (const child of root.children ?? []) {
    const c = child as ContractDef;
    if (c.type !== 'ContractDefinition') continue;
    if (!kinds.includes(c.kind)) continue;
    for (const sub of c.subNodes ?? []) {
      cb(c, sub);
    }
  }
}

export const namingRules: Rule[] = [
  {
    name: 'naming/interface-i-prefix',
    check(ctx: RuleContext) {
      if (!ctx.parsed.ast) return;
      visit(ctx.parsed.ast, {
        ContractDefinition(node) {
          const n = node as unknown as ContractDef;
          if (n.kind !== 'interface') return;
          if (!n.name.startsWith('I')) {
            ctx.report({
              line: ln(n), col: cl(n), severity: 'error',
              rule: 'naming/interface-i-prefix',
              message: `Interface '${n.name}' must start with 'I'`,
              fixable: false,
            });
          }
        },
      });
    },
  },

  {
    name: 'naming/constants-upper-snake',
    check(ctx: RuleContext) {
      if (!ctx.parsed.ast) return;
      visit(ctx.parsed.ast, {
        StateVariableDeclaration(node) {
          const n = node as unknown as StateVariableDecl;
          for (const v of n.variables) {
            if (!v.isDeclaredConst) continue;
            const name = v.name ?? '';
            if (!isUpperSnake(name)) {
              ctx.report({
                line: ln(v), col: cl(v), severity: 'warn',
                rule: 'naming/constants-upper-snake',
                message: `Constant '${name}' should be UPPER_SNAKE_CASE`,
                fixable: false,
              });
            }
          }
        },
        FileLevelConstant(node) {
          const n = node as unknown as { name?: string; loc?: { start?: { line?: number; column?: number } } };
          const name = n.name ?? '';
          if (!isUpperSnake(name)) {
            ctx.report({
              line: ln(n), col: cl(n), severity: 'warn',
              rule: 'naming/constants-upper-snake',
              message: `File-level constant '${name}' should be UPPER_SNAKE_CASE`,
              fixable: false,
            });
          }
        },
      });
    },
  },

  {
    name: 'naming/events-pascal-case',
    check(ctx: RuleContext) {
      if (!ctx.parsed.ast) return;
      visit(ctx.parsed.ast, {
        EventDefinition(node) {
          const n = node as unknown as EventDef;
          if (!isPascalCase(n.name)) {
            ctx.report({
              line: ln(n), col: cl(n), severity: 'error',
              rule: 'naming/events-pascal-case',
              message: `Event '${n.name}' must be PascalCase`,
              fixable: false,
            });
          }
        },
      });
    },
  },

  {
    name: 'naming/errors-pascal-case',
    check(ctx: RuleContext) {
      if (!ctx.parsed.ast) return;
      visit(ctx.parsed.ast, {
        CustomErrorDefinition(node) {
          const n = node as unknown as CustomErrorDef;
          if (!isPascalCase(n.name)) {
            ctx.report({
              line: ln(n), col: cl(n), severity: 'error',
              rule: 'naming/errors-pascal-case',
              message: `Custom error '${n.name}' must be PascalCase`,
              fixable: false,
            });
          }
        },
      });
    },
  },

  {
    name: 'naming/errors-no-error-suffix',
    check(ctx: RuleContext) {
      if (!ctx.parsed.ast) return;
      visit(ctx.parsed.ast, {
        CustomErrorDefinition(node) {
          const n = node as unknown as CustomErrorDef;
          if (n.name.endsWith('Error') && !n.name.startsWith('Mock')) {
            ctx.report({
              line: ln(n), col: cl(n), severity: 'warn',
              rule: 'naming/errors-no-error-suffix',
              message: `Custom error '${n.name}' should not end with 'Error'`,
              fixable: false,
            });
          }
        },
      });
    },
  },

  {
    name: 'naming/internal-functions-prefix',
    check(ctx: RuleContext) {
      if (!ctx.parsed.ast) return;
      // Only check non-library contracts (libraries intentionally omit _)
      forContractSubNodes(
        ctx.parsed.ast,
        ['contract', 'abstract'],
        (_contract, sub) => {
          if ((sub as { type?: string }).type !== 'FunctionDefinition') return;
          const n = sub as FunctionDef;
          if (n.isConstructor || n.isFallback || n.isReceiveEther) return;
          if (!n.name) return;
          const vis = n.visibility ?? 'internal';
          if ((vis === 'internal' || vis === 'private') && !n.name.startsWith('_')) {
            ctx.report({
              line: ln(n), col: cl(n), severity: 'error',
              rule: 'naming/internal-functions-prefix',
              message: `Internal function '${n.name}' must start with '_'`,
              fixable: false,
            });
          }
        },
      );
    },
  },

  {
    name: 'naming/storage-pointer-dollar',
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
              line: ln(n), col: cl(n), severity: 'error',
              rule: 'naming/storage-pointer-dollar',
              message: `Storage getter '${n.name}' must name its return variable '\$' (got '${ret.name ?? 'unnamed'}')`,
              fixable: false,
            });
          }
        },
      });
    },
  },

  {
    name: 'naming/test-functions-prefix',
    check(ctx: RuleContext) {
      if (!ctx.parsed.isTestFile) return;
      if (!ctx.parsed.ast) return;
      // Only check functions in concrete test contracts (not interfaces, not libraries,
      // not harness/mock contracts whose functions are intentionally named differently)
      forContractSubNodes(
        ctx.parsed.ast,
        ['contract', 'abstract'],
        (contract, sub) => {
          // Skip harness/mock contracts — their functions are helper/shim functions
          const cname = contract.name;
          if (cname.endsWith('Harness') || cname.startsWith('Mock') || cname === 'UnitTestBase') return;

          if ((sub as { type?: string }).type !== 'FunctionDefinition') return;
          const n = sub as FunctionDef;
          if (n.isConstructor) return;
          if (!n.name) return;
          if (n.name === 'setUp' || n.name.startsWith('_')) return;
          if (n.visibility === 'internal') return;

          if (!n.name.startsWith('test')) {
            ctx.report({
              line: ln(n), col: cl(n), severity: 'warn',
              rule: 'naming/test-functions-prefix',
              message: `Public function '${n.name}' should start with 'test_'`,
              fixable: false,
            });
          } else if (!n.name.startsWith('test_') && !n.name.startsWith('testFuzz_')) {
            ctx.report({
              line: ln(n), col: cl(n), severity: 'warn',
              rule: 'naming/test-functions-prefix',
              message: `Test function '${n.name}' should use snake-case 'test_' prefix format`,
              fixable: false,
            });
          }
        },
      );
    },
  },

  {
    name: 'naming/test-contracts-suffix',
    check(ctx: RuleContext) {
      if (!ctx.parsed.isTestFile) return;
      if (!ctx.parsed.ast) return;
      visit(ctx.parsed.ast, {
        ContractDefinition(node) {
          const n = node as unknown as ContractDef;
          if (n.kind === 'interface' || n.kind === 'library') return;
          const name = n.name;
          // Allow base helpers, mocks, and harnesses
          if (
            name === 'Test' || name === 'Script' || name === 'UnitTestBase' ||
            name.startsWith('Mock') || name.endsWith('Harness') || name.endsWith('Base')
          ) return;
          // Accept anything ending with Tests or TestBase (e.g. _Tests, _FailureTests, _SuccessTests)
          if (!name.endsWith('Tests') && !name.endsWith('TestBase')) {
            ctx.report({
              line: ln(n), col: cl(n), severity: 'warn',
              rule: 'naming/test-contracts-suffix',
              message: `Test contract '${name}' should end with 'Tests' or 'TestBase'`,
              fixable: false,
            });
          }
        },
      });
    },
  },
];
