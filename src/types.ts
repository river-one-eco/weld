export type Severity = 'error' | 'warn';

export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  severity: Severity;
  rule: string;
  message: string;
  fixable: boolean;
}

export interface ParsedFile {
  path: string;
  content: string;
  lines: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ast: any;
  isTestFile: boolean;
}

// Language-level expectations a project can configure (weld.config.json → "solidity").
export interface SolidityExpectations {
  spdx: string | null;  // required SPDX identifier (e.g. "AGPL-3.0-or-later", "BUSL-1.1"); null = any
  pragma: string;       // required pragma version string (e.g. "^0.8.34", "0.8.30")
}

export const DEFAULT_SOLIDITY: SolidityExpectations = {
  spdx: 'AGPL-3.0-or-later',
  pragma: '^0.8.34',
};

export interface RuleContext {
  parsed: ParsedFile;
  solidity: SolidityExpectations;
  report(diag: Omit<Diagnostic, 'file'>): void;
}

export interface Rule {
  name: string;
  check(ctx: RuleContext): void;
}

export interface FormatResult {
  content: string;
  changed: boolean;
  fixes: string[];
}
