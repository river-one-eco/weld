import { Diagnostic, ParsedFile, Rule, RuleContext, SolidityExpectations, DEFAULT_SOLIDITY } from './types.js';
import { fileRules } from './rules/file.js';
import { importRules } from './rules/imports.js';
import { namingRules } from './rules/naming.js';
import { structureRules } from './rules/structure.js';
import { patternRules } from './rules/patterns.js';
import { orderingRules } from './rules/ordering.js';

const ALL_RULES: Rule[] = [
  ...fileRules,
  ...importRules,
  ...namingRules,
  ...structureRules,
  ...patternRules,
  ...orderingRules,
];

export interface LintResult {
  file: string;
  diagnostics: Diagnostic[];
}

export function lint(parsed: ParsedFile, enabledRules?: string[], solidity: SolidityExpectations = DEFAULT_SOLIDITY): LintResult {
  const diagnostics: Diagnostic[] = [];

  const rules = enabledRules
    ? ALL_RULES.filter(r => enabledRules.includes(r.name))
    : ALL_RULES;

  for (const rule of rules) {
    try {
      const ctx: RuleContext = {
        parsed,
        solidity,
        report(diag) {
          diagnostics.push({ ...diag, file: parsed.path });
        },
      };
      rule.check(ctx);
    } catch {
      // Rule threw unexpectedly — skip silently
    }
  }

  // Sort by line, then col
  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);
  return { file: parsed.path, diagnostics };
}

export { ALL_RULES };
