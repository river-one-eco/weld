import * as parser from '@solidity-parser/parser';
import { ParsedFile } from './types.js';

export function parseFile(filePath: string, content: string): ParsedFile {
  const lines = content.split('\n');
  const isTestFile = filePath.endsWith('.t.sol');

  let ast: unknown;
  try {
    ast = parser.parse(content, { loc: true, range: true, tolerant: true });
  } catch {
    ast = null;
  }

  return { path: filePath, content, lines, ast, isTestFile };
}
