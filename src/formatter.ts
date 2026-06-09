/**
 * formatter.ts — Text-based auto-fixer for sky/pau Solidity style.
 *
 * Fixes applied (in order):
 *  1. Section header borders normalised to 100 chars total
 *  2. Align consecutive single-line named imports' 'from' keywords
 *  3. Fix returns( → returns (
 *  4. Fix mapping ( → mapping(
 *  5. Align type-name columns in struct fields and multi-line param lists
 *  6. Align consecutive same-type variable declarations at '='
 */
import { FormatResult } from './types.js';

// Tunable knobs (overridable per-call via FormatOptions / weld.config.json).
export interface FormatOptions {
  lineLength?: number;          // wrap (single → multi) over this many cols
  collapseLength?: number;      // collapse (multi → single) only when result ≤ this
  sectionHeaderLength?: number; // total width of /*** ... ***/ section-header banners
  mappingSpace?: boolean;       // true → `mapping (` ; false → `mapping(`
}

export const FORMAT_DEFAULTS: Required<FormatOptions> = {
  lineLength: 120,
  collapseLength: 90,
  sectionHeaderLength: 100,
  mappingSpace: true,
};

// Effective config for the current format() call. Set at the top of format(); read by the passes
// below. (The CLI processes files sequentially, so module-level state is safe here.)
let cfg = { ...FORMAT_DEFAULTS };

export function format(content: string, filePath: string, opts?: FormatOptions): FormatResult {
  cfg = { ...FORMAT_DEFAULTS, ...(opts ?? {}) };
  // Nothing to format in an empty / whitespace-only file — leave it untouched.
  if (content.trim() === '') return { content, changed: false, fixes: [] };
  // Test code (incl. `.sol` mocks/helpers under a test/ dir) follows looser, judgment-based blank-line
  // and alignment conventions in the canonical corpus, so structural passes skip it.
  const isTestFile = filePath.endsWith('.t.sol') || /(^|\/)test\//.test(filePath);
  let src = content;
  const fixes: string[] = [];

  src = stripTrailingWhitespace(src, fixes);  // run first so later passes don't measure phantom width
  src = ensureBlankAfterPragma(src, fixes);
  src = fixSectionHeaders(src, fixes);
  src = normalizeImportSpacing(src, fixes);   // `{Foo}` → `{ Foo }`, `}from` → `} from`
  src = isolateMultilineImports(src, fixes);  // multi-line brace import gets surrounding blank lines
  src = alignImports(src, fixes);
  src = fixReturnsSyntax(src, fixes);
  src = fixMappingSyntax(src, fixes);
  src = fixModifierOrder(src, fixes);
  src = fixInlineCommentSpacing(src, fixes);
  src = normalizeLineCommentSpace(src, fixes); // `//text` → `// text`
  src = convertNatSpecRuns(src, fixes);       // multi-tag `///` run → `/** */` block
  src = alignNatSpec(src, fixes);             // align @param/@return/@dev columns in `/** */` blocks
  src = collapseFunctionDecls(src, fixes, isTestFile); // multi-line → single when short; before the wrap pass
  src = normalizeFunctionDecls(src, fixes);   // must run before alignTypeNameGroups
  src = expandPackedModifierSignatures(src, fixes); // wrapped-param sig + complex modifier → stack modifiers
  src = normalizeEventErrorDecls(src, fixes); // must run before alignTypeNameGroups
  src = alignTypeNameGroups(src, fixes);
  src = alignNamedArgBlocks(src, fixes);
  src = alignPureAssignments(src, fixes);
  src = alignVariableDeclarations(src, fixes);
  src = alignRequireStatements(src, fixes);
  src = alignMappingDeclarations(src, fixes);
  src = alignConsecutiveCalls(src, fixes, isTestFile);
  src = normalizeBooleanOperatorWrap(src, fixes);        // leading ||/&& continuation → trailing operator
  src = normalizeTernaryReturn(src, fixes);              // `return <cond>` + ?/: → return alone, cond +4, ?/: +8
  src = separateMemberDecls(src, fixes, isTestFile);     // blank line between glued member declarations
  src = normalizeDeclBodyBlanks(src, fixes, isTestFile); // blank line after `{` and before `}` of a decl body
  src = separateUnalignableStatements(src, fixes, isTestFile); // blank between non-alignable adjacent statements
  src = normalizeBlankLines(src, fixes, isTestFile);
  src = ensureBlankBeforeComments(src, fixes, isTestFile);
  src = normalizeEof(src, fixes);             // run last: exactly one terminating newline

  return { content: src, changed: src !== content, fixes };
}

// ---------------------------------------------------------------------------
// G15. A wrapped ternary used as a return value: `return` goes on its own line, the condition one
//      level in (+4), and the `?`/`:` branches one more level (+8). Only fires when the condition is
//      currently on the `return` line followed by a `?` continuation (canonical always breaks the
//      condition out, so it never matches conforming code).
// ---------------------------------------------------------------------------
function normalizeTernaryReturn(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^(\s+)return\s+(\S.*)$/);
    if (!m || /[;{]\s*$/.test(lines[i])) { i++; continue; }
    const indent = m[1];
    const cond = m[2].replace(/\s+$/, '');

    let n = i + 1;
    while (n < lines.length && lines[n].trim() === '') n++;
    if (n >= lines.length || !/^\s*\?/.test(lines[n])) { i++; continue; }

    let end = i + 1;
    while (end < lines.length && !/;\s*$/.test(lines[end])) end++;
    if (end >= lines.length) { i++; continue; }

    const reindented = lines.slice(i + 1, end + 1).map(l => (l.trim() === '' ? l : '    ' + l));
    const out = [`${indent}return`, `${indent}    ${cond}`, ...reindented];
    lines.splice(i, end - i + 1, ...out);
    changed = true;
    i += out.length;
  }
  if (changed) fixes.push('Reformatted multi-line ternary returns');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// G16. Boolean operator position: a continuation line that STARTS with `||`/`&&` is rewritten so the
//      operator trails the previous line (canonical uses trailing boolean operators; 0 leading).
//      Scoped to boolean operators only — arithmetic operators are intentionally left alone.
// ---------------------------------------------------------------------------
function normalizeBooleanOperatorWrap(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(\|\||&&)\s+(\S.*)$/);
    if (!m) continue;
    const prev = lines[i - 1];
    const prevTrim = prev.replace(/\s+$/, '');
    // Previous line must be a continuable expression (not blank, comment, or an opener).
    if (prevTrim === '' || prevTrim.includes('//') || prevTrim.endsWith('{') || prevTrim.endsWith('(')) continue;
    lines[i - 1] = `${prevTrim} ${m[2]}`;
    lines[i] = m[1] + m[3];
    changed = true;
  }
  if (changed) fixes.push('Moved boolean operators to line end');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 0. Whole-buffer whitespace normalisation
// ---------------------------------------------------------------------------

// A1: strip trailing spaces/tabs from every physical line.
function stripTrailingWhitespace(src: string, fixes: string[]): string {
  const fixed = src.replace(/[ \t]+(\r?\n)/g, '$1').replace(/[ \t]+$/, '');
  if (fixed !== src) fixes.push('Stripped trailing whitespace');
  return fixed;
}

// A2: collapse trailing blank lines and ensure exactly one terminating newline.
function normalizeEof(src: string, fixes: string[]): string {
  const fixed = src.replace(/\n*$/, '') + '\n';
  if (fixed !== src) fixes.push('Normalised end-of-file newline');
  return fixed;
}

// A3: ensure a single space after `//` in line comments (`//text` → `// text`).
//   Carve-outs: NatSpec `///`, `//!`, banner runs (`////…`), `//` inside string literals, and
//   commented-out code whose first non-space char after `//` is another `/` (handled by the above).
function normalizeLineCommentSpace(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;
  let inBlock = false; // inside a /* ... */ block comment (tracked across lines)
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    // Find a `//` line comment that is not inside a string literal or a block comment.
    let q = '';
    let pos = -1;
    for (let k = 0; k < ln.length; k++) {
      const c = ln[k], n = ln[k + 1];
      if (inBlock) { if (c === '*' && n === '/') { inBlock = false; k++; } continue; }
      if (q) { if (c === q && ln[k - 1] !== '\\') q = ''; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '/' && n === '*') { inBlock = true; k++; continue; }
      if (c === '/' && n === '/') { pos = k; break; } // line comment → rest of line is the comment
    }
    if (pos === -1) continue;
    const after = ln.slice(pos + 2);
    // Skip NatSpec (///), bang (//!), banner runs (////...), already-spaced, empty, and URL schemes.
    if (after === '' || after[0] === ' ' || after[0] === '/' || after[0] === '!') continue;
    if (ln[pos - 1] === ':') continue; // e.g. https:// inside a line comment
    lines[i] = ln.slice(0, pos) + '// ' + after;
    changed = true;
  }
  if (changed) fixes.push('Normalised line-comment spacing');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// H18: convert a contiguous `///` run carrying MULTIPLE tags into a `/** */` block.
//      Lone `///` natspec (single @notice/@inheritdoc/@custom) and forge-config directives stay `///`.
// H17: within a `/** */` block, align the @param/@return/@dev tag-content column and the @param/@return
//      name column, and strip a ` - ` name/description separator.
// ---------------------------------------------------------------------------
function convertNatSpecRuns(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^(\s*)\/\/\/(.*)$/);
    if (!m) { i++; continue; }
    const indent = m[1];
    const contents: string[] = [];
    let hasForgeConfig = false;
    let tagCount = 0;
    let j = i;
    while (j < lines.length) {
      const mj = lines[j].match(/^(\s*)\/\/\/(.*)$/);
      if (!mj || mj[1] !== indent) break;
      const c = mj[2].replace(/^ /, '');
      if (/forge-config/.test(c)) hasForgeConfig = true;
      if (/^@\w/.test(c.trimStart())) tagCount++;
      contents.push(c);
      j++;
    }
    // Only convert a genuine multi-tag doc run (keeps lone /// and forge-config as `///`).
    if (!hasForgeConfig && tagCount > 1) {
      const block = [
        `${indent}/**`,
        ...contents.map(c => (c.trim() === '' ? `${indent} *` : `${indent} * ${c}`)),
        `${indent} */`,
      ];
      lines.splice(i, j - i, ...block);
      changed = true;
      i += block.length;
      continue;
    }
    i = j;
  }
  if (changed) fixes.push('Converted multi-tag /// runs to /** */ blocks');
  return lines.join('\n');
}

function alignNatSpec(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;
  let i = 0;
  while (i < lines.length) {
    const openM = lines[i].match(/^(\s*)\/\*\*\s*$/);
    if (!openM) { i++; continue; }
    const indent = openM[1];

    let close = i + 1;
    while (close < lines.length && !/^\s*\*\/\s*$/.test(lines[close])) {
      if (!/^\s*\*/.test(lines[close])) { close = -1; break; } // not a clean star-prefixed block
      close++;
    }
    if (close === -1 || close >= lines.length) { i++; continue; }

    const bodyRaw = lines.slice(i + 1, close);
    // Parse only @param/@return lines (the part canonical aligns consistently); everything else is
    // preserved verbatim. We KEEP each block's keyword spacing (canonical uses different content
    // columns in different blocks — 7/8/9 — so we don't impose one) and only re-align the name column
    // and strip a ` - ` name/description separator.
    interface NamedParse { kw: string; kwSpaces: string; name: string; desc: string }
    const named: (NamedParse | null)[] = bodyRaw.map(raw => {
      const c = raw.replace(/^\s*\*\s?/, '').replace(/\s+$/, '');
      const m2 = c.match(/^(@param|@return)(\s+)(\S+)\s*(.*)$/);
      if (!m2) return null;
      return { kw: m2[1], kwSpaces: m2[2], name: m2[3], desc: m2[4].replace(/^(-{1,2}|:)\s+/, '') };
    });

    const maxName = Math.max(0, ...named.filter(Boolean).map(p => p!.name.length));
    const star = `${indent} *`;
    const out = bodyRaw.map((raw, k) => {
      const p = named[k];
      if (!p) return raw.replace(/\s+$/, ''); // not a @param/@return line: preserve verbatim
      const body = (p.desc ? `${p.name.padEnd(maxName)} ${p.desc}` : p.name).replace(/\s+$/, '');
      return `${star} ${p.kw}${p.kwSpaces}${body}`;
    });

    if (out.join('\n') !== bodyRaw.join('\n')) {
      lines.splice(i + 1, bodyRaw.length, ...out);
      changed = true;
    }
    i = close + 1;
  }
  if (changed) fixes.push('Aligned NatSpec tag columns');
  return lines.join('\n');
}

// B4: ensure exactly one blank line between the pragma and the first following non-blank line.
function ensureBlankAfterPragma(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  const pragmaIdx = lines.findIndex(l => /^\s*pragma\s+solidity\b/.test(l));
  if (pragmaIdx === -1 || pragmaIdx + 1 >= lines.length) return src;
  if (lines[pragmaIdx + 1].trim() === '') return src; // already blank
  lines.splice(pragmaIdx + 1, 0, '');
  fixes.push('Added blank line after pragma');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 4. Section header borders — enforce total line length of 100 chars
// ---------------------------------------------------------------------------
function fixSectionHeaders(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (stripped.length < 88) continue;  // too short to be a real section header

    const indent = lines[i].match(/^(\s*)/)?.[1] ?? '';
    const indentLen = indent.length;
    // Number of content chars available for the comment (excluding indent)
    const contentWidth = cfg.sectionHeaderLength - indentLen;

    // Border line: / + n * + /
    if (/^\/\*+\/$/.test(stripped)) {
      const correctBorder = '/' + '*'.repeat(contentWidth - 2) + '/';
      if (stripped !== correctBorder) {
        lines[i] = indent + correctBorder;
        changed = true;
      }
      continue;
    }

    // Title line: /*** title ***/
    if (stripped.startsWith('/***') && stripped.endsWith('***/')) {
      const inner = stripped.slice(4, stripped.length - 4); // between /*** and ***/
      const title = inner.trim();
      // contentWidth = /*** + space + title + spaces + space + ***/ = 5 + title + spaces + 5
      const titleArea = contentWidth - 10; // 5 for '/*** ' and 5 for ' ***/'
      if (titleArea > 0) {
        const newLine = '/*** ' + title.padEnd(titleArea) + ' ***/';
        if (newLine !== stripped) {
          lines[i] = indent + newLine;
          changed = true;
        }
      }
    }
  }

  if (changed) fixes.push(`Normalised section header widths to ${cfg.sectionHeaderLength} chars`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 5a. Normalise single-line named-import brace spacing: `import {A,B} from "x";`
//     → `import { A, B } from "x";` (space inside braces, `, ` between symbols, `} from`).
// ---------------------------------------------------------------------------
function normalizeImportSpacing(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)import\s*\{([^}]*)\}([ \t]*)from\s*"([^"]+)"\s*;(.*)$/);
    if (!m) continue;
    const symbols = m[2].split(',').map(s => s.trim()).filter(Boolean);
    if (symbols.length === 0) continue;
    // Preserve the existing `} … from` gap (it may be padded for column alignment); only guarantee
    // at least one space. alignImports owns the gap for multi-import groups.
    const gap = m[3].length >= 1 ? m[3] : ' ';
    const trailing = m[5].trim();
    const rebuilt = `${m[1]}import { ${symbols.join(', ')} }${gap}from "${m[4]}";` + (trailing ? ` ${trailing}` : '');
    if (rebuilt !== lines[i]) { lines[i] = rebuilt; changed = true; }
  }
  if (changed) fixes.push('Normalised import brace spacing');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 5b. Isolate a multi-line brace import (`import {` … `} from "x";`) with a single blank line on
//     each side, so it forms its own group rather than being glued to adjacent imports.
// ---------------------------------------------------------------------------
function isolateMultilineImports(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(/^\s*import\s*\{/);
    if (!open || lines[i].includes('}')) { i++; continue; }
    // find the closing line (first line containing '}' at/after i)
    let close = i;
    while (close < lines.length && !lines[close].includes('}')) close++;
    if (close >= lines.length) { i++; continue; }

    // blank line after the close
    if (close + 1 < lines.length && lines[close + 1].trim() !== '') {
      lines.splice(close + 1, 0, '');
      changed = true;
    }
    // blank line before the open
    if (i > 0 && lines[i - 1].trim() !== '') {
      lines.splice(i, 0, '');
      changed = true;
      close++;
    }
    i = close + 1;
  }
  if (changed) fixes.push('Isolated multi-line imports');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 5. Align consecutive single-line named imports
// ---------------------------------------------------------------------------
const SINGLE_NAMED_IMPORT_RE = /^(\s*)import\s*\{[^}]+\}\s+from\s+"[^"]+"\s*;/;

function alignImports(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;

  let i = 0;
  while (i < lines.length) {
    // Find start of a group of consecutive named imports
    if (!SINGLE_NAMED_IMPORT_RE.test(lines[i])) { i++; continue; }

    let j = i;
    while (j < lines.length && SINGLE_NAMED_IMPORT_RE.test(lines[j])) j++;

    const group = lines.slice(i, j);
    if (group.length >= 2) {
      const aligned = alignImportGroup(group);
      if (aligned.join('\n') !== group.join('\n')) {
        lines.splice(i, group.length, ...aligned);
        changed = true;
      }
    }
    i = j;
  }

  if (changed) fixes.push('Aligned import groups');
  return lines.join('\n');
}

function alignImportGroup(lines: string[]): string[] {
  // Parse each import into its natural prefix (import {specifiers}) and path ("...";).
  // Using natural prefix length avoids inheriting over-padding from previous formatter runs.
  const parsed = lines.map(l => {
    const m = l.match(/^(\s*import\s*\{[^}]+\})\s+from\s+(".*";\s*)$/);
    return m ? { prefix: m[1], path: m[2] } : null;
  });

  if (parsed.some(p => !p)) return lines;

  const maxPrefixLen = Math.max(...parsed.map(p => p!.prefix.length));

  // If all prefixes are the same length, nothing to do
  if (parsed.every(p => p!.prefix.length === maxPrefixLen)) return lines;

  return parsed.map(p => {
    const spaces = ' '.repeat(maxPrefixLen - p!.prefix.length + 1);
    return p!.prefix + spaces + 'from ' + p!.path;
  });
}

// ---------------------------------------------------------------------------
// 7. Fix returns( → returns (
// ---------------------------------------------------------------------------
function fixReturnsSyntax(src: string, fixes: string[]): string {
  const fixed = src.replace(/\breturns\(/g, 'returns (');
  if (fixed !== src) fixes.push('Fixed returns( → returns (');
  return fixed;
}

// ---------------------------------------------------------------------------
// 8. Normalise mapping( / mapping  ( → mapping (
//    House style (dss/Sky heritage) uses a single space: `mapping (key => val)`.
// ---------------------------------------------------------------------------
function fixMappingSyntax(src: string, fixes: string[]): string {
  if (cfg.mappingSpace) {
    const fixed = src.replace(/\bmapping[ \t]*\(/g, 'mapping (');
    if (fixed !== src) fixes.push('Normalised mapping( → mapping (');
    return fixed;
  }
  const fixed = src.replace(/\bmapping[ \t]+\(/g, 'mapping(');
  if (fixed !== src) fixes.push('Normalised mapping ( → mapping(');
  return fixed;
}

// ---------------------------------------------------------------------------
// 9. Normalize function declarations: split long single-line declarations
//    Rule: if a single-line `function … { / ;` is > 100 chars, split to:
//      - one param per line at indent+4
//      - each modifier/visibility/mutability on its own line at indent+4
//      - returns (...) on its own line at indent+4
//      - { on its own line at indent (for function bodies)
//      - ; appended to the last modifier line (for interface methods)
//    Only EXPANDS (single-line → multi-line). Never collapses existing multi-line.
//    Must run BEFORE alignTypeNameGroups so wrapped params get aligned.
// ---------------------------------------------------------------------------

// Parse the portion of a function signature after the closing ) of the params.
// Returns: { modifiers, returnsType, end } where end is '{' or ';'.
function _parseFuncRest(s: string): {
  modifiers: string[];
  returnsType: string | null;
  end: '{' | ';';
} | null {
  let i = 0;
  const modifiers: string[] = [];
  let returnsType: string | null = null;

  while (i < s.length) {
    while (i < s.length && /[ \t]/.test(s[i])) i++;
    if (i >= s.length) break;

    if (s[i] === '{') return { modifiers, returnsType, end: '{' };
    if (s[i] === ';') return { modifiers, returnsType, end: ';' };

    // Read keyword
    const kwStart = i;
    while (i < s.length && /\w/.test(s[i])) i++;
    const kw = s.slice(kwStart, i);
    if (!kw) break;

    // Skip spaces between keyword and optional '('
    while (i < s.length && s[i] === ' ') i++;

    let token = kw;
    if (i < s.length && s[i] === '(') {
      const argStart = i;
      let depth = 0;
      while (i < s.length) {
        if (s[i] === '(') depth++;
        else if (s[i] === ')') { if (--depth === 0) { i++; break; } }
        i++;
      }
      token = kw + s.slice(argStart, i);
    }

    if (kw === 'returns') {
      // token is e.g. "returns(uint256)" or just "returns" if paren-less (unusual)
      const m = token.match(/^returns\s*\((.+)\)$/s);
      returnsType = m ? m[1].trim() : null;
    } else {
      modifiers.push(token);
    }
  }

  return null;
}

// Split a single-line function declaration into multi-line form.
// Returns null if the line doesn't look like a parseable function declaration.
function _splitFuncDecl(line: string): string[] | null {
  const m = line.match(/^(\s+)function\s+(\w+)\(/);
  if (!m) return null;

  const indent = m[1];
  const name = m[2];

  // Find the balanced ) closing the params list
  let pos = m[0].length;
  let depth = 1;
  while (pos < line.length && depth > 0) {
    if (line[pos] === '(') depth++;
    else if (line[pos] === ')') depth--;
    if (depth > 0) pos++;
    else break;
  }
  if (depth !== 0) return null;

  const paramsStr = line.slice(m[0].length, pos);
  const rest = line.slice(pos + 1);

  const parsed = _parseFuncRest(rest);
  if (!parsed) return null;
  const { modifiers, returnsType, end } = parsed;

  const paramsList = paramsStr.trim()
    ? _splitTopLevelCommas(paramsStr).map(p => p.trim()).filter(Boolean)
    : [];

  const innerIndent = indent + '    ';
  const result: string[] = [];

  // First line: function name + opening paren
  if (paramsList.length === 0) {
    result.push(indent + 'function ' + name + '()');
  } else {
    result.push(indent + 'function ' + name + '(');
    for (let i = 0; i < paramsList.length; i++) {
      result.push(innerIndent + paramsList[i] + (i < paramsList.length - 1 ? ',' : ''));
    }
    result.push(indent + ')');
  }

  // Modifiers / visibility / mutability
  const lastItems: string[] = [...modifiers];
  if (returnsType !== null) lastItems.push('returns (' + returnsType + ')');

  if (end === '{') {
    for (const item of lastItems) result.push(innerIndent + item);
    result.push(indent + '{');
  } else {
    // ';' — append to last modifier line
    for (let i = 0; i < lastItems.length; i++) {
      const suffix = i === lastItems.length - 1 ? ';' : '';
      result.push(innerIndent + lastItems[i] + suffix);
    }
    if (lastItems.length === 0) {
      // no modifiers at all: put ; after closing )
      result[result.length - 1] += ';';
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 9b. Collapse a multi-line function declaration to a single line when the result is short.
//     Mirrors the event/error collapse: only fires when the single-line form is ≤ collapseLength,
//     so the band (collapseLength, lineLength] is a no-reflow zone that preserves the author's
//     wrapping. Tuned below where the canonical codebase begins hand-wrapping, so it never fights
//     the audited style. Bails (leaves multi-line) on anything risky: comments inside the signature,
//     or non-comment code after the terminator (inline body).
// ---------------------------------------------------------------------------

// Rebuild a (whitespace-collapsed) signature string into a single canonical line.
function _normalizeFuncToSingleLine(indent: string, sigText: string): string | null {
  const fm = sigText.match(/^function\s+(\w+)\(/);
  if (!fm) return null;
  const name = fm[1];

  // Find the ')' that closes the parameter list.
  let pos = fm[0].length;
  let depth = 1;
  while (pos < sigText.length && depth > 0) {
    if (sigText[pos] === '(') depth++;
    else if (sigText[pos] === ')') { if (--depth === 0) break; }
    pos++;
  }
  if (depth !== 0) return null;

  const paramsStr = sigText.slice(fm[0].length, pos);
  const params = paramsStr.trim()
    ? _splitTopLevelCommas(paramsStr).map(p => p.trim()).filter(Boolean)
    : [];

  const parsed = _parseFuncRest(sigText.slice(pos + 1));
  if (!parsed) return null;
  const { modifiers, returnsType, end } = parsed;

  const items = [...modifiers];
  if (returnsType !== null) items.push('returns (' + returnsType + ')');

  let s = indent + 'function ' + name + '(' + params.join(', ') + ')';
  if (items.length) s += ' ' + items.join(' ');
  s += end === '{' ? ' {' : ';';
  return s;
}

// Render "Form 2": parameters inline on the `function name(...)` line, each modifier / returns on its
// own line, and the opening `{` (or `;`) on its own. Used when the full single-line is too long but
// the params themselves fit — canonical never wraps short parameters one-per-line.
function _normalizeFuncToFormTwo(indent: string, sigText: string): string[] | null {
  const fm = sigText.match(/^function\s+(\w+)\(/);
  if (!fm) return null;
  let pos = fm[0].length, depth = 1;
  while (pos < sigText.length && depth > 0) {
    if (sigText[pos] === '(') depth++;
    else if (sigText[pos] === ')') { if (--depth === 0) break; }
    pos++;
  }
  if (depth !== 0) return null;
  const params = sigText.slice(fm[0].length, pos).trim()
    ? _splitTopLevelCommas(sigText.slice(fm[0].length, pos)).map(p => p.trim()).filter(Boolean)
    : [];
  const parsed = _parseFuncRest(sigText.slice(pos + 1));
  if (!parsed) return null;
  const { modifiers, returnsType, end } = parsed;

  // Only stack when a COMPLEX modifier is present (override/virtual/named like onlyRole, initializer).
  // Plain visibility/mutability/returns stay packed on the `)` line (handled elsewhere), matching
  // canonical — so we don't reflow `) external view returns (…)` into a stack.
  if (!modifiers.some(mod => !PLAIN_MODIFIERS.has(mod.replace(/\(.*$/, '')))) return null;

  const items = [...modifiers];
  if (returnsType !== null) items.push('returns (' + returnsType + ')');
  const inner = indent + '    ';
  const out = [`${indent}function ${fm[1]}(${params.join(', ')})`];
  if (end === '{') {
    for (const it of items) out.push(inner + it);
    out.push(`${indent}{`);
  } else {
    for (let k = 0; k < items.length; k++) out.push(inner + items[k] + (k === items.length - 1 ? ';' : ''));
    if (items.length === 0) out[out.length - 1] += ';';
  }
  return out;
}

function collapseFunctionDecls(src: string, fixes: string[], isTestFile: boolean): string {
  const lines = src.split('\n');
  let changed = false;
  let i = 0;

  while (i < lines.length) {
    const m = lines[i].match(/^(\s+)function\s+\w+\(/);
    if (!m) { i++; continue; }

    // Find the signature terminator (';' or '{') at paren-depth 0.
    let depth = 0, started = false, endLine = -1, termIdx = -1, term = '';
    for (let j = i; j < lines.length && j - i <= 40; j++) {
      const ln = lines[j];
      for (let k = 0; k < ln.length; k++) {
        const c = ln[k];
        if (c === '(') { depth++; started = true; }
        else if (c === ')') depth--;
        else if (started && depth === 0 && (c === ';' || c === '{')) {
          endLine = j; termIdx = k; term = c; break;
        }
      }
      if (endLine !== -1) break;
    }

    if (endLine === -1) { i++; continue; }
    if (endLine === i) { i = endLine + 1; continue; } // already single-line — wrap pass handles length

    const block = lines.slice(i, endLine + 1);
    const lastSigPart = block[block.length - 1].slice(0, termIdx);

    // Bail on comments inside the signature (joining would mangle them).
    const sigBody = block.slice(0, -1).join('\n') + '\n' + lastSigPart;
    if (sigBody.includes('//') || sigBody.includes('/*')) { i = endLine + 1; continue; }

    // Trailing content after the terminator: only a line comment is allowed (preserved); anything
    // else (e.g. an inline body after '{') means we leave it alone.
    const trailing = block[block.length - 1].slice(termIdx + 1).trim();
    if (trailing !== '' && !trailing.startsWith('//')) { i = endLine + 1; continue; }

    const sigText = (block.slice(0, -1).join(' ') + ' ' + lastSigPart + term)
      .replace(/\s+/g, ' ')
      .trim();
    const single = _normalizeFuncToSingleLine(m[1], sigText);
    if (!single) { i = endLine + 1; continue; }

    const finalLine = trailing.startsWith('//') ? single + ' ' + trailing : single;
    if (finalLine.length <= cfg.collapseLength) {
      lines.splice(i, block.length, finalLine);
      changed = true;
      i += 1;
      continue;
    }

    // Too long for one line — but if the WHOLE signature would fit within the line limit (so the
    // params aren't genuinely long), pull the params back inline and keep modifiers stacked (Form 2).
    // Canonical only wraps params one-per-line when the full single-line exceeds the limit.
    // Form-2 param inlining is a structural reflow — source files only (test mocks pack modifiers
    // more loosely). Only inline params for short (≤ 2 param) signatures; canonical wraps 3+ params
    // one-per-line even when the full signature would fit.
    const formTwo = isTestFile ? null : _normalizeFuncToFormTwo(m[1], sigText);
    const pstr = formTwo ? formTwo[0].slice(formTwo[0].indexOf('(') + 1, formTwo[0].lastIndexOf(')')) : '';
    const paramCount = pstr.trim() === '' ? 0 : _splitTopLevelCommas(pstr).length;
    if (formTwo && paramCount <= 2 && finalLine.length <= cfg.lineLength && formTwo.join('\n') !== block.join('\n')) {
      if (trailing.startsWith('//')) formTwo[formTwo.length - 1] += ' ' + trailing;
      lines.splice(i, block.length, ...formTwo);
      changed = true;
      i += formTwo.length;
      continue;
    }

    i = endLine + 1;
  }

  if (changed) fixes.push('Collapsed short function declarations');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 9c. When a function's parameter list is wrapped multi-line AND the signature carries a COMPLEX
//     modifier (override / virtual / a named modifier like nonReentrant, onlyRole(...), initializer),
//     the modifiers must each be on their own line — not packed onto the closing-paren line.
//     Plain visibility/mutability/returns stay packed (`) internal view returns (x) {`). Canonical
//     has zero packed-complex hybrids, so this only ever fires on non-conforming input.
// ---------------------------------------------------------------------------
const PLAIN_MODIFIERS = new Set(['public', 'external', 'internal', 'private', 'view', 'pure', 'payable']);

function expandPackedModifierSignatures(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    // A closing-paren line (params wrapped above) with modifiers packed before the `{`/`;`.
    const m = lines[i].match(/^(\s*)\)\s*(\S.*?)\s*([{;])\s*$/);
    if (!m) continue;
    const [, indent, tail, end] = m;
    const parsed = _parseFuncRest(`${tail} ${end}`);
    if (!parsed) continue;
    const { modifiers, returnsType } = parsed;
    if (modifiers.length === 0 && returnsType === null) continue;
    // Skip when the "modifiers" are actually a statement after a wrapped condition, e.g. a multi-line
    // `if (…)` whose close line is `) return …;` / `) revert …;` — those are not function signatures.
    if (modifiers.some(mod => STMT_KEYWORDS.has(mod.replace(/\(.*$/, '')))) continue;
    const isComplex = modifiers.some(mod => !PLAIN_MODIFIERS.has(mod.replace(/\(.*$/, '')));
    if (!isComplex) continue;

    const out = [`${indent})`];
    for (const mod of modifiers) out.push(`${indent}    ${mod}`);
    if (returnsType !== null) out.push(`${indent}    returns (${returnsType})`);
    out.push(`${indent}${end}`);
    lines.splice(i, 1, ...out);
    changed = true;
    i += out.length - 1;
  }
  if (changed) fixes.push('Stacked complex function modifiers');
  return lines.join('\n');
}

function normalizeFunctionDecls(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Only touch single-line declarations that are over the limit.
    // A single-line decl: starts with 'function', ends with '{' or ';', has balanced parens.
    if (
      line.length > cfg.lineLength &&
      /^\s+function\s+\w+\(/.test(line) &&
      /[{;]\s*$/.test(line)
    ) {
      const split = _splitFuncDecl(line);
      if (split && split.length > 1) {
        lines.splice(i, 1, ...split);
        changed = true;
        i += split.length;
        continue;
      }
    }

    i++;
  }

  if (changed) fixes.push('Split long function declarations');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 10. Normalize event/error declarations: enforce single-line ↔ multi-line
//    Rule: if the declaration fits in MAX_DECL_LINE_LEN chars → single-line
//          otherwise → multi-line, one param per line at indent+4, ');' on own line
//    Must run BEFORE alignTypeNameGroups so wrapped params get aligned.
// ---------------------------------------------------------------------------

// Code lines WRAP (single-line → multi-line) when they exceed `cfg.lineLength` (default 120;
// canonical limit — longest canonical line is 116). NOTE: section-header banners are separate
// (cfg.sectionHeaderLength, default 100).
//
// COLLAPSE (multi-line → single-line) only when the result is short (≤ cfg.collapseLength,
// default 100). Canonical keeps many declarations multi-line even when they would fit in 120
// (e.g. multi-param events with indexed fields), so the collapse threshold is intentionally
// stricter than the wrap threshold — the band between them is a no-reflow zone that preserves
// the author's wrapping choice.

// Opening line of a multi-line event/error: "  event/error Name("  (ends with '(' only)
const MULTI_LINE_DECL_OPEN_RE = /^(\s+)(event|error)\s+(\w+)\($/;

function normalizeEventErrorDecls(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // --- Try to COLLAPSE a multi-line block to single-line ---
    const openM = line.match(MULTI_LINE_DECL_OPEN_RE);
    if (openM) {
      const collapse = _tryCollapse(lines, i, openM);
      if (collapse) {
        lines.splice(i, collapse.linesConsumed, collapse.singleLine);
        changed = true;
        continue; // re-examine same index (now single-line)
      }
      // Can't collapse (too long) — if params are packed on fewer lines than there are params,
      // explode to one parameter per line (alignTypeNameGroups then aligns the columns).
      const explode = _tryExplode(lines, i, openM);
      if (explode) {
        lines.splice(i, explode.linesConsumed, ...explode.multiLines);
        changed = true;
        i += explode.multiLines.length;
        continue;
      }
    }

    // --- Try to WRAP a single-line declaration to multi-line ---
    if (line.length > cfg.lineLength && /^\s+(event|error)\s+\w+\(/.test(line)) {
      const wrap = _tryWrap(line);
      if (wrap) {
        lines.splice(i, 1, ...wrap.multiLines);
        changed = true;
        i += wrap.multiLines.length;
        continue;
      }
    }

    i++;
  }

  if (changed) fixes.push('Normalized event/error declaration format');
  return lines.join('\n');
}

// Explode a multi-line event/error whose parameters are packed onto fewer lines than there are
// params → one parameter per line. Returns null if already one-per-line, or on comments/odd shape.
function _tryExplode(
  lines: string[],
  start: number,
  openM: RegExpMatchArray,
): { multiLines: string[]; linesConsumed: number } | null {
  const indent = openM[1];
  const paramIndent = indent + '    ';
  const closeToken = indent + ');';

  const innerLines: string[] = [];
  let j = start + 1;
  while (j < lines.length) {
    const ln = lines[j].trimEnd();
    if (ln === closeToken) break;
    if (!ln.startsWith(paramIndent)) return null;
    const t = ln.trimStart();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return null; // comments → leave
    innerLines.push(ln.slice(paramIndent.length));
    j++;
  }
  if (j >= lines.length || lines[j].trimEnd() !== closeToken) return null;

  const joined = innerLines.join(' ').replace(/,\s*$/, '');
  const params = _splitTopLevelCommas(joined).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (params.length <= innerLines.length) return null; // already one-per-line

  const out = [
    lines[start],
    ...params.map((p, k) => paramIndent + p + (k < params.length - 1 ? ',' : '')),
    closeToken,
  ];
  return { multiLines: out, linesConsumed: j - start + 1 };
}

// Split a string by top-level commas (not inside nested parens/brackets).
function _splitTopLevelCommas(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, k).trim());
      start = k + 1;
    }
  }
  const last = s.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function _tryCollapse(
  lines: string[],
  start: number,
  openM: RegExpMatchArray
): { singleLine: string; linesConsumed: number } | null {
  const indent = openM[1];
  const keyword = openM[2];
  const name = openM[3];
  const paramIndent = indent + '    ';
  const closeToken = indent + ');';

  const params: string[] = [];
  let j = start + 1;

  while (j < lines.length) {
    const ln = lines[j].trimEnd();
    if (ln === closeToken) break;
    // Anything not at the expected indent level → give up
    if (!ln.startsWith(paramIndent)) return null;
    // Comment lines inside param list → give up (preserve as-is)
    if (ln.trimStart().startsWith('//') || ln.trimStart().startsWith('*')) return null;
    // Extract param, strip trailing comma, normalise internal whitespace
    let param = ln.slice(paramIndent.length).trimEnd();
    if (param.endsWith(',')) param = param.slice(0, -1).trimEnd();
    param = param.replace(/\s+/g, ' ').trim();
    params.push(param);
    j++;
  }

  if (j >= lines.length || lines[j].trimEnd() !== closeToken) return null;

  const singleLine = `${indent}${keyword} ${name}(${params.join(', ')});`;
  if (singleLine.length > cfg.collapseLength) return null;

  return { singleLine, linesConsumed: j - start + 1 };
}

function _tryWrap(line: string): { multiLines: string[] } | null {
  // Parse: INDENT keyword Name(paramsStr);
  const m = line.match(/^(\s+)(event|error)\s+(\w+)\(/);
  if (!m) return null;

  const indent = m[1];
  const keyword = m[2];
  const name = m[3];
  const openPos = m[0].length - 1; // position of '('

  // Find matching ')' via paren-depth tracking
  let depth = 0;
  let closePos = -1;
  for (let k = openPos; k < line.length; k++) {
    if (line[k] === '(') depth++;
    else if (line[k] === ')') { if (--depth === 0) { closePos = k; break; } }
  }
  if (closePos === -1) return null;
  if (line.slice(closePos + 1).trim() !== ';') return null; // trailing content after ')'

  const paramsStr = line.slice(openPos + 1, closePos).trim();
  if (!paramsStr) return null; // no params — keep single-line

  const params = _splitTopLevelCommas(paramsStr);
  if (params.length < 2) return null; // single param — keep single-line even if long

  const paramIndent = indent + '    ';
  return {
    multiLines: [
      `${indent}${keyword} ${name}(`,
      ...params.map((p, idx) => `${paramIndent}${p}${idx < params.length - 1 ? ',' : ''}`),
      `${indent});`,
    ],
  };
}

// ---------------------------------------------------------------------------
// 10. Fix modifier order: visibility pure/view/payable virtual override custom
//    Fixes: override view → view override
//           override pure → pure override
//           override constant → constant override (state variable)
// ---------------------------------------------------------------------------

// Applies to function-signature tokens: swap 'override' before view/pure/payable/constant
const MODIFIER_ORDER_RE = /\boverride\s+(view|pure|payable|constant)\b/g;
// Canonical order places nonReentrant before onlyRole (§8): swap `onlyRole(...) nonReentrant`.
const REENTRANCY_ORDER_RE = /\b(onlyRole\([^)]*\))\s+(nonReentrant)\b/g;

function fixModifierOrder(src: string, fixes: string[]): string {
  let fixed = src.replace(MODIFIER_ORDER_RE, (_match, mod) => `${mod} override`);
  fixed = fixed.replace(REENTRANCY_ORDER_RE, (_match, role, nr) => `${nr} ${role}`);
  if (fixed !== src) fixes.push('Fixed modifier order');
  return fixed;
}

// ---------------------------------------------------------------------------
// 10. Fix double-space before inline // comments → single space
//     e.g.  value;  // comment  →  value; // comment
// ---------------------------------------------------------------------------
function fixInlineCommentSpacing(src: string, fixes: string[]): string {
  // Fix exactly-2-space gaps before // that are clearly accidental.
  // Excludes ';', ')', ',' as preceding chars — those appear in intentional
  // column-aligned inline comment blocks on statements and argument lists.
  const fixed = src.replace(/([^;),\s])  (\/\/)/g, '$1 $2');
  if (fixed !== src) fixes.push('Fixed double-space before inline // comments');
  return fixed;
}

// ---------------------------------------------------------------------------
// 11. Align type-name columns in consecutive typed declarations
//    Handles: struct fields, event params, function params (multi-line)
//    Pattern per line: INDENT TYPE [data-location|indexed] NAME [;|,]
// ---------------------------------------------------------------------------

// Statement-context keywords that should never appear as a "type" in a declaration
const STMT_KEYWORDS = new Set([
  'return', 'emit', 'delete', 'revert', 'assembly', 'using',
  'import', 'pragma', 'require', 'try', 'catch',
]);

function alignTypeNameGroups(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;

  let i = 0;
  while (i < lines.length) {
    const m0 = parseTypedNameLine(lines[i]);
    if (!m0) { i++; continue; }

    const indent = m0.indent;
    // Collect consecutive lines at same indent that all parse correctly
    let j = i;
    while (j < lines.length) {
      const mj = parseTypedNameLine(lines[j]);
      if (!mj || mj.indent !== indent) break;
      j++;
    }

    if (j - i >= 2) {
      const group = lines.slice(i, j);
      const aligned = alignTypeNameGroup(group);
      if (aligned.join('\n') !== group.join('\n')) {
        lines.splice(i, group.length, ...aligned);
        changed = true;
      }
    }
    i = j;
  }

  if (changed) fixes.push('Aligned type-name columns');
  return lines.join('\n');
}

interface TypedNameLine {
  indent: string;
  baseType: string;    // the Solidity type token only (e.g. 'uint256', 'IERC20')
  modifier: string;    // optional modifier token (e.g. 'internal', 'memory') — '' if absent
  type: string;        // baseType + ' ' + modifier (or just baseType), for backwards compat
  name: string;
  suffix: string;      // ';' | ',' | ''
  comment: string;     // trailing '// ...' line comment (incl. '//'), or '' if none
  gap: string;         // original whitespace between the code and the comment (preserved when not column-aligning)
  raw: string;
}

function parseTypedNameLine(line: string): TypedNameLine | null {
  // Must be indented at least 4 spaces
  const indentMatch = line.match(/^(\s{4,})/);
  if (!indentMatch) return null;

  const indent = indentMatch[1];
  let rest = line.slice(indent.length).trimEnd();

  // Full-line comments are not declarations.
  if (rest.startsWith('//') || rest.startsWith('*') || rest.startsWith('/*')) return null;

  // Peel off a trailing line comment FIRST, so parens/`=`/etc. inside the comment text don't
  // disqualify an otherwise-alignable declaration (e.g. `address admin; // use address(0) to skip`).
  // (A type/name declaration never contains '//' except as a comment.)
  let comment = '';
  let gap = '';
  const ci = rest.indexOf('//');
  if (ci >= 0) {
    comment = rest.slice(ci);
    const beforeComment = rest.slice(0, ci);
    rest = beforeComment.trimEnd();
    gap = beforeComment.slice(rest.length) || '  '; // preserve original spacing (default 2)
  }

  // Quick rejections — don't touch these lines
  if (rest === '') return null;
  if (rest.includes('=')) return null;           // handled by alignVariableDeclarations
  if (rest.startsWith('mapping(') || rest.startsWith('mapping (')) return null;
  if (rest.includes('(') || rest.includes(')')) return null;  // function calls / signatures
  if (rest.startsWith('{') || rest.startsWith('}')) return null;

  // Extract optional trailing ; or ,
  let body = rest;
  let suffix = '';
  if (body.endsWith(';') || body.endsWith(',')) {
    suffix = body.slice(-1);
    body = body.slice(0, -1).trimEnd();
  }

  // body should now be: TYPE [modifier] NAME
  // Split into tokens — last token is the name, the rest is the type
  const tokens = body.split(/\s+/);
  if (tokens.length < 2) return null;    // need at least type + name
  if (tokens.length > 3) return null;    // more than type + modifier + name → skip

  const name = tokens[tokens.length - 1];
  const typeParts = tokens.slice(0, tokens.length - 1);

  // Name must look like an identifier
  if (!/^[A-Za-z_$]\w*$/.test(name)) return null;

  // First token must look like a type (starts with letter, may include . [ ])
  if (!/^[A-Za-z][\w.<>\[\]]*$/.test(typeParts[0])) return null;

  // Skip if first token is a statement keyword
  if (STMT_KEYWORDS.has(typeParts[0])) return null;

  // If there's a second token (modifier), validate it
  if (typeParts.length === 2) {
    const VALID_MODIFIERS = new Set([
      'calldata', 'memory', 'storage', 'indexed',      // data locations / event
      'public', 'private', 'internal', 'external',     // visibility (state vars)
      'immutable',                                      // state var storage class
    ]);
    if (!VALID_MODIFIERS.has(typeParts[1])) return null;
  }

  const baseType = typeParts[0];
  const modifier = typeParts.length === 2 ? typeParts[1] : '';
  const type = typeParts.join(' ');   // normalised: single space between type and modifier

  return { indent, baseType, modifier, type, name, suffix, comment, gap, raw: line };
}

function alignTypeNameGroup(lines: string[]): string[] {
  const parsed = lines.map(parseTypedNameLine);
  if (parsed.some(p => !p)) return lines;

  // Two independent columns: base type and modifier. The base type is padded to the widest
  // base type, and the modifier slot is padded to the widest modifier (blank when absent).
  // This keeps the modifier keyword (e.g. `indexed`) and the name in fixed columns regardless
  // of whether each row has a modifier:
  //
  //     uint32  indexed destinationDomain
  //     bytes32 indexed mintRecipient
  //     uint32          minFeeCapRate     ← no modifier: modifier slot is blank-padded
  //
  //   Same base type, different modifiers also fall out naturally:
  //     uint256[] calldata depositAmounts
  //     uint256[] memory   rates
  const maxBase = Math.max(...parsed.map(p => p!.baseType.length));
  const hasModifier = parsed.some(p => p!.modifier);
  const maxMod = hasModifier ? Math.max(...parsed.map(p => p!.modifier.length)) : 0;

  const codeParts = parsed.map(p => {
    const basePad = ' '.repeat(maxBase - p!.baseType.length);
    if (!hasModifier) {
      return p!.indent + p!.baseType + basePad + ' ' + p!.name + p!.suffix;
    }
    const modCol = p!.modifier
      ? p!.modifier + ' '.repeat(maxMod - p!.modifier.length)
      : ' '.repeat(maxMod);
    return p!.indent + p!.baseType + basePad + ' ' + modCol + ' ' + p!.name + p!.suffix;
  });

  // Trailing comments: column-align them only when 2+ fields have one (then a column is meaningful).
  // With a single comment there is no column to align to, so preserve its original spacing — this
  // matches canonical, which uses a plain 2-space gap for lone field comments rather than padding to
  // a commentless sibling.
  const commentCount = parsed.filter(p => p!.comment).length;
  let rebuilt: string[];
  if (commentCount >= 2) {
    const maxCodeLen = Math.max(...codeParts.map(c => c.length));
    rebuilt = codeParts.map((code, i) =>
      parsed[i]!.comment ? code.padEnd(maxCodeLen) + '  ' + parsed[i]!.comment : code,
    );
  } else {
    rebuilt = codeParts.map((code, i) =>
      parsed[i]!.comment ? code + parsed[i]!.gap + parsed[i]!.comment : code,
    );
  }

  if (rebuilt.join('\n') === lines.join('\n')) return lines;
  return rebuilt;
}

// ---------------------------------------------------------------------------
// 5b. Align named argument / struct literal blocks
//     Style enforced: key right-padded to max key length, then ' : ' then value
//     Handles both "key : value" (already style-A) and "key:   value" (style-B)
//     Example output:
//       poolKey    : poolKey,
//       tickLower  : tickLower,
//       amount0Max : amount0Max,
// ---------------------------------------------------------------------------

// Matches a named-arg line: INDENT IDENTIFIER : REST
// Requires at least 4-space indent; identifier must not be a known statement keyword
const NAMED_ARG_LINE_RE = /^(\s{4,})(\w+)\s*:(?!=)\s*(\S.*?)\s*$/;

function alignNamedArgBlocks(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;

  let i = 0;
  while (i < lines.length) {
    const m0 = lines[i].match(NAMED_ARG_LINE_RE);
    if (!m0 || STMT_KEYWORDS.has(m0[2])) { i++; continue; }

    const indent = m0[1];

    // Collect consecutive named-arg lines at same indent
    let j = i;
    while (j < lines.length) {
      const mj = lines[j].match(NAMED_ARG_LINE_RE);
      if (!mj || mj[1] !== indent || STMT_KEYWORDS.has(mj[2])) break;
      j++;
    }

    if (j - i >= 2) {
      const group = lines.slice(i, j);
      const aligned = alignNamedArgGroup(group);
      if (aligned.join('\n') !== group.join('\n')) {
        lines.splice(i, group.length, ...aligned);
        changed = true;
      }
    }
    i = j;
  }

  if (changed) fixes.push('Aligned named argument blocks');
  return lines.join('\n');
}

function alignNamedArgGroup(lines: string[]): string[] {
  const parsed = lines.map(line => {
    const m = line.match(/^(\s+)(\w+)\s*:\s*(.*?)\s*$/);
    if (!m) return null;
    return { indent: m[1], key: m[2], value: m[3] };
  });

  if (parsed.some(p => !p)) return lines;

  const maxKeyLen = Math.max(...parsed.map(p => p!.key.length));

  return parsed.map(p => {
    const pad = ' '.repeat(maxKeyLen - p!.key.length);
    return p!.indent + p!.key + pad + ' : ' + p!.value;
  });
}

// ---------------------------------------------------------------------------
// 6a. Align consecutive pure assignment statements (no type prefix)
//     e.g.  totalAccruedSoFar = expr;
//           unpaidAccrued     = expr;
// ---------------------------------------------------------------------------

// Matches: INDENT IDENTIFIER = VALUE;  where LHS is a single identifier (no spaces)
// Excludes compound operators (+=, -=, …) and comparisons (==)
const PURE_ASSIGN_RE = /^(\s+)([A-Za-z_$][\w.[\]]*)\s*=(?![=>])\s*\S/;

// A chained assignment ("a = b = c;") has a second bare '=' after the first. Aligning the first
// '=' of a chained assignment against a neighbouring simple assignment misaligns the chain, so
// such groups are left untouched (matches canonical, e.g. RateLimits `d.lastAmount = newLimit =`).
function _isChainedAssignment(line: string): boolean {
  const firstEq = line.search(/[^=!<>+\-*/%&|^]=(?!=)/);
  if (firstEq === -1) return false;
  const after = line.slice(firstEq + 2);
  return /[^=!<>+\-*/%&|^]=(?!=)/.test(after);
}

function alignPureAssignments(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;

  let i = 0;
  while (i < lines.length) {
    if (!PURE_ASSIGN_RE.test(lines[i])) { i++; continue; }

    const indent = lines[i].match(/^(\s*)/)?.[1] ?? '';

    let j = i;
    while (j < lines.length) {
      const m = lines[j].match(/^(\s*)/);
      if (!m || m[1] !== indent) break;
      if (!PURE_ASSIGN_RE.test(lines[j])) break;
      j++;
    }

    if (j - i >= 2) {
      const group = lines.slice(i, j);
      if (!group.some(_isChainedAssignment)) {
        const aligned = alignAssignmentGroup(group);
        if (aligned.join('\n') !== group.join('\n')) {
          lines.splice(i, group.length, ...aligned);
          changed = true;
        }
      }
    }
    i = j;
  }

  if (changed) fixes.push('Aligned pure assignment operators');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 6b. Align consecutive variable declaration assignments
// ---------------------------------------------------------------------------
// Matches: [indent][type] [mods] name = value;
// e.g. "    address internal admin        = makeAddr("admin");"
const VAR_DECL_RE = /^(\s+)((?:\w+\s+)+?)(\w+)(\s*=\s*)(.+;)\s*$/;

function alignVariableDeclarations(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;

  let i = 0;
  while (i < lines.length) {
    const m0 = lines[i].match(VAR_DECL_RE);
    if (!m0) { i++; continue; }

    // Gather a run of consecutive variable declarations with the same leading type
    const leadType = m0[2].trim().split(/\s+/)[0]; // e.g. "address"
    let j = i + 1;
    while (j < lines.length) {
      const mj = lines[j].match(VAR_DECL_RE);
      if (!mj) break;
      if (mj[2].trim().split(/\s+/)[0] !== leadType) break;
      j++;
    }

    if (j - i >= 2) {
      const group = lines.slice(i, j);
      const aligned = alignAssignmentGroup(group);
      if (aligned.join('\n') !== group.join('\n')) {
        lines.splice(i, group.length, ...aligned);
        changed = true;
      }
    }
    i = j;
  }

  if (changed) fixes.push('Aligned variable declaration assignments');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 12. Align require error arguments in consecutive same-indent require groups
//     require(shortCond,     Error());
//     require(longerCondition, Error());  →  longerCondition aligned
// ---------------------------------------------------------------------------

const SINGLE_LINE_REQUIRE_RE = /^(\s+)require\(.+\);\s*$/;

// Find the first ',' at top level (depth=1) inside the require(…) body.
// `s` is everything after the opening 'require(' — so depth starts at 1.
function _findTopLevelComma(s: string): number {
  let depth = 1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (--depth === 0) return -1; // closed outer paren, no comma found
    } else if (c === ',' && depth === 1) return i;
  }
  return -1;
}

function _parseRequireLine(line: string): { indent: string; condition: string; error: string } | null {
  const m = line.match(/^(\s+)require\(/);
  if (!m) return null;
  const indent = m[1];
  const afterOpen = line.slice(indent.length + 8); // skip 'require('

  const commaPos = _findTopLevelComma(afterOpen);
  if (commaPos === -1) return null; // single-arg or unparseable

  const condition = afterOpen.slice(0, commaPos).trimEnd();
  const afterComma = afterOpen.slice(commaPos + 1).trimStart();

  // afterComma ends with ');\n?' — strip the closing ');' from require(…)
  if (!afterComma.endsWith(');')) return null;
  const error = afterComma.slice(0, -2);
  if (!error.trim()) return null;

  return { indent, condition, error };
}

function alignRequireStatements(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;

  let i = 0;
  while (i < lines.length) {
    if (!SINGLE_LINE_REQUIRE_RE.test(lines[i]) || !_parseRequireLine(lines[i])) { i++; continue; }

    const indent = lines[i].match(/^(\s*)/)?.[1] ?? '';

    let j = i;
    while (j < lines.length) {
      const m = lines[j].match(/^(\s*)/);
      if (!m || m[1] !== indent) break;
      if (!SINGLE_LINE_REQUIRE_RE.test(lines[j]) || !_parseRequireLine(lines[j])) break;
      j++;
    }

    if (j - i >= 2) {
      const group = lines.slice(i, j);
      const aligned = _alignRequireGroup(group);
      if (aligned.join('\n') !== group.join('\n')) {
        lines.splice(i, group.length, ...aligned);
        changed = true;
      }
    }
    i = j;
  }

  if (changed) fixes.push('Aligned require error arguments');
  return lines.join('\n');
}

// Split a condition like "fees.interestFeeWAD <= WAD" into lhs/op/rhs.
// Only matches simple member-access / array-index LHS expressions.
function _splitCondAtOp(
  condition: string
): { lhs: string; op: string; rhs: string } | null {
  const m = condition.match(/^([A-Za-z_$][\w.$\[\]]*)\s*(<=|>=|==|!=|<|>)\s*(.+)$/);
  if (!m) return null;
  return { lhs: m[1], op: m[2], rhs: m[3] };
}

function _alignRequireGroup(lines: string[]): string[] {
  const parsed = lines.map(_parseRequireLine);
  if (parsed.some(p => !p)) return lines;

  // Align within the condition (padding the LHS before the operator) ONLY when every condition
  // splits into lhs/op/rhs AND they all share the SAME operator — that's when a clean operator
  // column is meaningful. With mixed operators (e.g. != alongside >) the canonical style leaves
  // the conditions verbatim and aligns only the error column.
  const splits = parsed.map(p => _splitCondAtOp(p!.condition));
  const allSplit = splits.every(s => s !== null);
  const sameOp = allSplit && splits.every(s => s!.op === splits[0]!.op);
  let conditions: string[];
  if (allSplit && sameOp) {
    const maxLhsLen = Math.max(...splits.map(s => s!.lhs.length));
    conditions = splits.map(s => {
      const pad = ' '.repeat(maxLhsLen - s!.lhs.length);
      return s!.lhs + pad + ' ' + s!.op + ' ' + s!.rhs;
    });
  } else {
    conditions = parsed.map(p => p!.condition);
  }

  const maxCondLen = Math.max(...conditions.map(c => c.length));

  return parsed.map((p, i) => {
    const cond = conditions[i];
    const spaces = ' '.repeat(maxCondLen - cond.length + 1);
    return p!.indent + 'require(' + cond + ',' + spaces + p!.error + ');';
  });
}

// ---------------------------------------------------------------------------
// 13. Align variable names in consecutive mapping declarations
//     mapping(address pool => uint256 maxSlippage) maxSlippages;
//     mapping(address pool => PoolParams params)   poolParams;
//     The name (everything after closing ')') is aligned at a consistent column.
// ---------------------------------------------------------------------------

// Find the index just past the outermost closing ')' of 'mapping (...)'.
// `s` must start with 'mapping' optionally followed by spaces then '('.
function _findMappingClose(s: string): number {
  const open = s.indexOf('(');
  if (open === -1) return -1;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { if (--depth === 0) return i + 1; }
  }
  return -1;
}

function _parseMappingLine(line: string): { indent: string; mappingType: string; namePart: string } | null {
  const indentMatch = line.match(/^(\s+)/);
  if (!indentMatch) return null;
  const indent = indentMatch[1];
  const rest = line.slice(indent.length).trimEnd();

  if (!/^mapping[ \t]*\(/.test(rest)) return null;

  const closePos = _findMappingClose(rest);
  if (closePos === -1) return null;

  const mappingType = rest.slice(0, closePos);
  const namePart = rest.slice(closePos).trimStart(); // 'name;' or 'private _name;'

  if (!namePart) return null;

  return { indent, mappingType, namePart };
}

function alignMappingDeclarations(src: string, fixes: string[]): string {
  const lines = src.split('\n');
  let changed = false;

  let i = 0;
  while (i < lines.length) {
    const m0 = _parseMappingLine(lines[i]);
    if (!m0) { i++; continue; }

    const indent = m0.indent;
    let j = i;
    while (j < lines.length) {
      const mj = _parseMappingLine(lines[j]);
      if (!mj || mj.indent !== indent) break;
      j++;
    }

    if (j - i >= 2) {
      const group = lines.slice(i, j);
      const aligned = _alignMappingGroup(group);
      if (aligned.join('\n') !== group.join('\n')) {
        lines.splice(i, group.length, ...aligned);
        changed = true;
      }
    }
    i = j;
  }

  if (changed) fixes.push('Aligned mapping declaration names');
  return lines.join('\n');
}

function _alignMappingGroup(lines: string[]): string[] {
  const parsed = lines.map(_parseMappingLine);
  if (parsed.some(p => !p)) return lines;

  const maxMappingLen = Math.max(...parsed.map(p => p!.mappingType.length));

  if (parsed.every(p => p!.mappingType.length === maxMappingLen)) return lines;

  return parsed.map(p => {
    const spaces = ' '.repeat(maxMappingLen - p!.mappingType.length + 1);
    return p!.indent + p!.mappingType + spaces + p!.namePart;
  });
}

// ---------------------------------------------------------------------------
// 13b. Align arguments across a run of consecutive same-callee single-line statement calls.
//   In the canonical SOURCE this is 100% consistent: a run of identical-callee calls aligns each
//   argument column (pad after the comma so the next column lines up). Example:
//       _registerSelector(address(this), updateDelay.selector,    config.minDelay);
//       _registerSelector(address(this), this.timeoutProposer.selector, config.minDelay);  ← before
//   becomes a clean table. Test files (.t.sol) are SKIPPED: there the convention is applied with
//   human judgment (disparate assertEq tables are deliberately left ragged), so auto-aligning them
//   would either fight the audited style or produce ugly gaps.
// ---------------------------------------------------------------------------

const CALL_LINE_RE = /^(\s+)([A-Za-z_][A-Za-z0-9_.[\]]*)\((.*)\);\s*$/;
// Callees handled elsewhere or that aren't plain calls.
const CALL_ALIGN_EXCLUDE = new Set(['require', 'revert', 'return', 'if', 'for', 'while', 'catch', 'emit']);

// Split a call's argument string on top-level commas, ignoring commas inside nested brackets or
// string literals. Returns null if the string is unbalanced (then we don't touch the call).
function _splitCallArgs(s: string): string[] | null {
  const out: string[] = [];
  let depth = 0, start = 0, quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote && s[i - 1] !== '\\') quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; }
  }
  if (quote || depth !== 0) return null;
  out.push(s.slice(start).trim());
  return out;
}

interface ParsedCall { indent: string; callee: string; args: string[]; }

function _parseCallLine(line: string): ParsedCall | null {
  if (line.includes('//')) return null;
  const m = line.match(CALL_LINE_RE);
  if (!m) return null;
  if (CALL_ALIGN_EXCLUDE.has(m[2])) return null;
  const args = _splitCallArgs(m[3]);
  if (!args || args.length < 2 || args.some(a => a === '')) return null;
  return { indent: m[1], callee: m[2], args };
}

function alignConsecutiveCalls(src: string, fixes: string[], isTestFile: boolean): string {
  if (isTestFile) return src;
  const lines = src.split('\n');
  let changed = false;
  let i = 0;

  while (i < lines.length) {
    const c0 = _parseCallLine(lines[i]);
    if (!c0) { i++; continue; }

    let j = i;
    const run: ParsedCall[] = [];
    while (j < lines.length) {
      const c = _parseCallLine(lines[j]);
      if (!c || c.callee !== c0.callee || c.indent !== c0.indent || c.args.length !== c0.args.length) break;
      run.push(c);
      j++;
    }

    if (run.length >= 2) {
      const n = c0.args.length;
      const maxW = Array.from({ length: n }, (_, col) => Math.max(...run.map(r => r.args[col].length)));
      // Only align if some non-final column actually varies in width (otherwise nothing to do).
      const varies = Array.from({ length: n - 1 }, (_, col) => col)
        .some(col => run.some(r => r.args[col].length !== maxW[col]));
      if (varies) {
        const rebuilt = run.map(r => {
          let s = r.indent + r.callee + '(';
          for (let col = 0; col < n; col++) {
            s += r.args[col];
            if (col < n - 1) s += ',' + ' '.repeat(maxW[col] - r.args[col].length + 1);
          }
          return s + ');';
        });
        if (rebuilt.join('\n') !== lines.slice(i, j).join('\n')) {
          lines.splice(i, run.length, ...rebuilt);
          changed = true;
        }
      }
    }
    i = Math.max(j, i + 1);
  }

  if (changed) fixes.push('Aligned consecutive call arguments');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 14. Collapse excessive blank lines
//     - Globally:           3+ consecutive blank lines → 2
//     - Inside code blocks: 2+ consecutive blank lines → 1
//       A line is "inside a block" when indented ≥ 8 spaces (contract body
//       functions sit at 4 spaces, their bodies at 8+).
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 13c. Blank line directly after a contract/interface/library opening `{` and directly before its
//      closing `}` (the body is visually padded). Top-level decls only; empty bodies are skipped.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 13d. Insert a blank line between two adjacent member declarations that are glued together.
//      Members = function/event/error/modifier/constructor/struct/enum (keywords that only appear at
//      member level — never inside a function body). State variables and struct/enum fields are left
//      grouped (they don't start with these keywords). Non-test only.
// ---------------------------------------------------------------------------
const MEMBER_DECL_RE = /^(\s{4,})(function|event|error|modifier|constructor|struct|enum)\b/;

function separateMemberDecls(src: string, fixes: string[], isTestFile: boolean): string {
  if (isTestFile) return src;
  const lines = src.split('\n');
  let changed = false;
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(MEMBER_DECL_RE);
    if (!m) continue;
    const prev = lines[i - 1];
    if (prev.trim() === '') continue; // already separated
    const prevCode = prev.replace(/\s*\/\/.*$/, '').trimEnd();
    if (!/[;}]$/.test(prevCode)) continue; // previous line must END a declaration
    if ((prev.match(/^(\s*)/)?.[1].length ?? 0) !== m[1].length) continue; // same member indent
    lines.splice(i, 0, '');
    changed = true;
    i++; // skip the blank we inserted
  }
  if (changed) fixes.push('Separated member declarations');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 13e. Blank line between adjacent function-body statements that are NOT "alignable together".
//   Two statements are alignable iff same class ∈ {VARDECL, ASSIGN, REQUIRE, CALL-of-same-arity};
//   anything else (or a SINGLETON: emit/return/revert/multi-line stmt/control block) is not. When
//   two adjacent statements aren't alignable (and aren't a tight-coupling idiom), canonical separates
//   them with a blank line. Insert-only (never removes author blanks); source files only.
// ---------------------------------------------------------------------------

const STMT_CALL_CTRL = new Set([
  'require', 'revert', 'return', 'if', 'for', 'while', 'catch', 'emit', 'else', 'do', 'try',
  'assembly', 'unchecked', 'new',
]);

interface StmtNode {
  cls: 'VARDECL' | 'ASSIGN' | 'REQUIRE' | 'CALL' | 'SINGLETON';
  key: string;
  writeIdent: string;
  firstTrim: string;
  text: string;
}

// Bracket balance of a single line's code (ignores // comments and string literals).
function _bracketDelta(line: string): number {
  let depth = 0, q = '';
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (q) { if (c === q && line[k - 1] !== '\\') q = ''; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '/' && line[k + 1] === '/') break;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
  }
  return depth;
}

// Classify a single-line statement. `multiLine` forces SINGLETON (no single-line align applies).
function _classifyStmt(line: string, multiLine: boolean): StmtNode {
  const code = line.replace(/\/\/.*$/, '').trimEnd(); // ignore any trailing line comment
  const firstTrim = code.trim();
  const text = code;
  const single = (cls: StmtNode['cls'], key: string, writeIdent = '') => ({ cls, key, writeIdent, firstTrim, text });
  if (multiLine) return { cls: 'SINGLETON', key: 'SINGLETON', writeIdent: '', firstTrim: line.trim(), text: line };

  // VARDECL (broadened: $-names, []-types, data location) — `type name = …;`
  let m = code.match(/^\s*[A-Za-z_]\w*(?:\[\])*(?:\s+(?:memory|storage|calldata))?\s+([A-Za-z_$]\w*)\s*=(?!=)\s*.+;$/);
  if (m && !_isChainedAssignment(code)) return single('VARDECL', 'VARDECL', m[1]);

  // ASSIGN — `lhs = …;` (single LHS; chained `a = b = c;` is still an assignment for grouping).
  if (PURE_ASSIGN_RE.test(code) && /;$/.test(code)) {
    const mm = code.match(/^\s*([A-Za-z_$][\w.[\]]*)\s*=/);
    return single('ASSIGN', 'ASSIGN', mm ? mm[1].split(/[.[]/)[0] : '');
  }

  if (/^\s*require\(.+\);$/.test(code)) return single('REQUIRE', 'REQUIRE');

  // delete X…;  — singleton, but record the written identifier for coupling (delete → pop idiom).
  m = code.match(/^\s*delete\s+([A-Za-z_$][\w.[\]]*)/);
  if (m) return single('SINGLETON', 'SINGLETON', m[1].split(/[.[]/)[0]);

  // CALL — `callee(args);` of any arity, callee not a control keyword.
  m = code.match(/^\s*([A-Za-z_][\w.]*)\((.*)\);$/);
  if (m && !STMT_CALL_CTRL.has(m[1].split('.').pop()!)) {
    const args = _splitCallArgs(m[2]);
    if (args) return single('CALL', 'CALL:' + (m[2].trim() === '' ? 0 : args.length));
  }

  return single('SINGLETON', 'SINGLETON');
}

function _stmtAlignable(a: StmtNode, b: StmtNode): boolean {
  return a.cls !== 'SINGLETON' && b.cls !== 'SINGLETON' && a.key === b.key;
}

function _escRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function _mentions(text: string, ident: string): boolean {
  return new RegExp(`(?<![\\w$])${_escRe(ident)}(?![\\w$])`).test(text);
}
const STMT_SUBJ_SKIP = new Set(['return', 'revert', 'delete', 'emit', 'if', 'for', 'while', 'require', 'assembly']);

// Tight-coupling idioms that canonical leaves glued (no blank), so we must not insert one.
function _stmtCoupled(prev: StmtNode, cur: StmtNode): boolean {
  const cf = cur.firstTrim;
  if (/^_\s*;/.test(cf)) return true;                                   // modifier body `_;`

  if (prev.cls === 'REQUIRE') {
    if (/^(return|revert)\b/.test(cf)) return true;                     // require → return/revert
    if (/^if\s*\(.*\)\s*(return|revert)\b/.test(cf)) return true;       // require → single-line guard
    if (cur.cls === 'ASSIGN' || cur.cls === 'VARDECL') {                // require → decl/assign consuming the checked value
      const subj = prev.text.match(/require\(\s*([A-Za-z_$][\w.[\]]*)/);
      if (subj && _mentions(cur.text, subj[1].split(/[.[]/)[0])) return true;
    }
  }

  if (prev.writeIdent && _mentions(cur.text, prev.writeIdent)) {
    if (/^emit\b/.test(cf)) return true;                               // effect → its emit
    if (/^(return|revert)\b/.test(cf)) return true;                    // value → return/revert of it
    if (cur.cls === 'ASSIGN' && new RegExp(`^${_escRe(prev.writeIdent)}[.[]`).test(cf)) return true; // element-init
  }

  // delete X[…] → X.pop() (loop cleanup idiom).
  if (/^delete\b/.test(prev.firstTrim)) {
    const curSubj = cf.match(/^([A-Za-z_$]\w*)/);
    if (curSubj && !STMT_SUBJ_SKIP.has(curSubj[1]) && _mentions(prev.text, curSubj[1])) return true;
  }
  return false;
}

// Classify what kind of body a `{` opens, from the accumulated header text.
function _braceKind(header: string): 'fn' | 'block' | 'skip' {
  if (/\b(function|constructor|modifier|fallback|receive)\b/.test(header)) return 'fn';
  if (/\b(if|else|for|while|do|try|catch|unchecked)\b/.test(header)) return 'block';
  return 'skip'; // contract/interface/library/struct/enum/assembly/struct-literal/array/etc.
}

function separateUnalignableStatements(src: string, fixes: string[], isTestFile: boolean): string {
  if (isTestFile) return src;
  const lines = src.split('\n');
  const insertAt = new Set<number>(); // physical line index BEFORE which to insert a blank

  interface Frame { run: boolean; prev: StmtNode | null; sawBlank: boolean }
  const stack: Frame[] = [{ run: false, prev: null, sawBlank: true }];
  let inStmt = false;     // a multi-line statement or declaration header is in progress
  let carry = 0;          // bracket balance within the in-progress statement/header
  let header = '';        // header text accumulated for the next `{`
  let leadStart = -1;     // first line of a pending lead-comment block
  let stmtStart = -1;     // first line of the in-progress multi-line statement

  const codeOf = (l: string) => l.replace(/\/\/.*$/, '').trimEnd();

  const consider = (node: StmtNode, startLine: number, leadLine: number) => {
    const top = stack[stack.length - 1];
    if (top.run && top.prev && !top.sawBlank && !_stmtAlignable(top.prev, node) && !_stmtCoupled(top.prev, node)) {
      insertAt.add(leadLine >= 0 ? leadLine : startLine);
    }
    if (top.run) { top.prev = node; top.sawBlank = false; }
  };

  // Open a block whose header text is `hdr`; the block itself is a singleton in the current frame.
  const openBlock = (hdr: string, startLine: number, leadLine: number) => {
    const kind = _braceKind(hdr);
    consider(_classifyStmt(lines[startLine], true), startLine, leadLine);
    stack.push({ run: kind !== 'skip', prev: null, sawBlank: true });
  };

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();
    const top = stack[stack.length - 1];

    if (t === '') { if (!inStmt) { top.sawBlank = true; leadStart = -1; } i++; continue; }

    if (!inStmt && (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*'))) {
      if (leadStart === -1) leadStart = i;
      i++; continue;
    }

    const code = codeOf(raw);
    const ct = code.trim();

    // Continuation of a multi-line statement/header. It ends only at a real terminator (`;` or `{`),
    // NOT merely when parens balance (a signature's `)` is followed by modifiers then `{`).
    if (inStmt) {
      carry += _bracketDelta(raw);
      header += ' ' + code;
      // Block opener: the trailing `{` is the only unbalanced bracket (a header's parens are closed).
      // A `{` that leaves carry > 1 is a struct/array literal inside the statement — keep absorbing.
      if (carry === 1 && ct.endsWith('{')) {
        carry = 0;
        openBlock(header, stmtStart, leadStart);
        inStmt = false; header = ''; leadStart = -1; stmtStart = -1;
      } else if (carry <= 0 && ct.endsWith(';')) {
        consider(_classifyStmt(lines[stmtStart], true), stmtStart, leadStart);
        inStmt = false; carry = 0; header = ''; leadStart = -1; stmtStart = -1;
      }
      i++; continue;
    }

    // Closing brace (possibly `} else {` / `} catch {`).
    if (ct.startsWith('}')) {
      if (stack.length > 1) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent.run) { parent.prev = _classifyStmt('} ', true); parent.sawBlank = false; } // blank after a block
      if (ct.endsWith('{')) stack.push({ run: true, prev: null, sawBlank: true }); // reopened block
      leadStart = -1; header = ''; i++; continue;
    }

    const delta = _bracketDelta(raw);

    // Single-line block / function opener: `… {` where the `{` is the only unbalanced bracket
    // (delta === 1). A trailing `{` with delta > 1 (e.g. `x = Foo({`) is a literal — handle as a stmt.
    if (delta === 1 && ct.endsWith('{')) {
      openBlock(code, i, leadStart);
      leadStart = -1; header = ''; i++; continue;
    }

    // Single-line complete statement.
    if (delta === 0 && ct.endsWith(';')) {
      consider(_classifyStmt(raw, false), i, leadStart);
      leadStart = -1; header = ''; i++; continue;
    }

    // Otherwise this begins a multi-line statement or declaration header.
    inStmt = true; carry = delta; header = code; stmtStart = i;
    i++;
  }

  if (insertAt.size === 0) return src;
  const out: string[] = [];
  for (let k = 0; k < lines.length; k++) {
    if (insertAt.has(k)) out.push('');
    out.push(lines[k]);
  }
  fixes.push('Separated non-alignable statements');
  return out.join('\n');
}

function normalizeDeclBodyBlanks(src: string, fixes: string[], isTestFile: boolean): string {
  // Test files contain terse `*Like` helper interfaces that intentionally skip the body blanks
  // (src is 100% consistent; the exceptions are all in tests) — leave test files alone.
  if (isTestFile) return src;
  const lines = src.split('\n');
  let changed = false;
  let i = 0;
  while (i < lines.length) {
    if (!/^(abstract\s+)?(contract|interface|library)\s+\w/.test(lines[i])) { i++; continue; }

    // Find the line whose trailing (non-comment) char opens the body.
    let openLine = -1;
    for (let j = i; j < lines.length; j++) {
      const code = lines[j].replace(/\/\/.*$/, '').trimEnd();
      if (code.endsWith('{')) { openLine = j; break; }
      if (code.endsWith(';')) break; // e.g. `using … for …;` — not this decl's body opener
    }
    if (openLine === -1) { i++; continue; }

    // The contract/interface/library closes at a `}` in column 0.
    let closeLine = -1;
    for (let j = openLine + 1; j < lines.length; j++) {
      if (/^\}/.test(lines[j])) { closeLine = j; break; }
    }
    if (closeLine === -1) { i = openLine + 1; continue; }

    // Skip empty bodies.
    let hasMember = false;
    for (let j = openLine + 1; j < closeLine; j++) if (lines[j].trim() !== '') { hasMember = true; break; }
    if (!hasMember) { i = closeLine + 1; continue; }

    if (lines[closeLine - 1].trim() !== '') { lines.splice(closeLine, 0, ''); changed = true; closeLine++; }
    if (lines[openLine + 1].trim() !== '') { lines.splice(openLine + 1, 0, ''); changed = true; closeLine++; }
    i = closeLine + 1;
  }
  if (changed) fixes.push('Added blank lines at declaration body braces');
  return lines.join('\n');
}

function normalizeBlankLines(src: string, fixes: string[], isTestFile: boolean): string {
  const lines = src.split('\n');
  const result: string[] = [];
  let blankRun = 0;
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      blankRun++;
      let limit: number;
      if (isTestFile) {
        // Test files: keep the looser legacy behaviour (≤1 deep inside blocks, ≤2 elsewhere).
        const prevContent = result.slice().reverse().find(l => l.trim() !== '') ?? '';
        const nextContent = lines.slice(i + 1).find(l => l.trim() !== '') ?? '';
        const insideBlock =
          (prevContent.match(/^(\s*)/)?.[1].length ?? 0) >= 8 ||
          (nextContent.match(/^(\s*)/)?.[1].length ?? 0) >= 8;
        limit = insideBlock ? 1 : 2;
      } else {
        // Source: canonical never uses more than one consecutive blank line anywhere.
        limit = 1;
      }
      if (blankRun <= limit) {
        result.push(line);
      } else {
        changed = true; // dropped this blank line
      }
    } else {
      blankRun = 0;
      result.push(line);
    }
  }

  if (changed) fixes.push('Collapsed excessive blank lines');
  return result.join('\n');
}

// ---------------------------------------------------------------------------
// 15. Ensure a blank line precedes a // comment block
//     Adds a blank line before a standalone // comment when the immediately
//     preceding line is non-blank, non-comment, and doesn't end with '{'.
//     Only applies at ≥ 4-space indent (inside a contract or function body).
// ---------------------------------------------------------------------------
function ensureBlankBeforeComments(src: string, fixes: string[], isTestFile: boolean): string {
  const lines = src.split('\n');
  const result: string[] = [];
  let changed = false;
  // Track struct/enum nesting so we don't blank-separate their fields' comments. (Non-test files use
  // the ≥4-space member-level gate; test files keep the conservative ≥8-space gate.)
  const minIndent = isTestFile ? 8 : 4;
  const structEnumStack: number[] = [];
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const inStructEnum = structEnumStack.length > 0;

    // Is this a standalone // comment at member/body level?
    // NatSpec doc comments (///) document the FOLLOWING member and stay attached to it, so we
    // exclude them — only plain // explanatory comments get a preceding blank line.
    if (!inStructEnum && trimmed.startsWith('//') && !trimmed.startsWith('///') && (line.length - trimmed.length) >= minIndent) {
      const prev = result.length > 0 ? result[result.length - 1] : '';
      const prevTrimmed = prev.trimStart();

      // Strip any trailing inline comment to get the actual statement text.
      const prevCode = prev.replace(/\s*\/\/.*$/, '').trimEnd();

      // Only add a blank line when the previous line ends a complete statement (';').
      // This avoids false positives inside tuple destructuring, argument lists, etc.
      if (
        prev.trim() !== '' &&
        !prevTrimmed.startsWith('//') &&
        !prevTrimmed.startsWith('/*') &&
        !prevCode.endsWith('{') &&
        prevCode.endsWith(';')
      ) {
        result.push('');
        changed = true;
      }
    }

    result.push(line);

    // Update struct/enum nesting (brace-counted; the opener's first `{` enters the block).
    let pending = /\b(struct|enum)\s+\w+/.test(line) && line.includes('{');
    for (const ch of line) {
      if (ch === '{') { depth++; if (pending) { structEnumStack.push(depth); pending = false; } }
      else if (ch === '}') {
        if (structEnumStack.length && structEnumStack[structEnumStack.length - 1] === depth) structEnumStack.pop();
        depth--;
      }
    }
  }

  if (changed) fixes.push('Added blank line before comment blocks');
  return result.join('\n');
}

function alignAssignmentGroup(lines: string[]): string[] {
  // Find the position of ' =' in each line (position just before = sign)
  const eqPositions = lines.map(l => {
    const idx = l.indexOf(' =');
    return idx;
  });

  const maxEq = Math.max(...eqPositions.filter(p => p > 0));

  return lines.map((line, idx) => {
    const pos = eqPositions[idx];
    if (pos < 0) return line;
    const before = line.slice(0, pos).trimEnd();
    const after = line.slice(pos).trimStart(); // starts with '= ...'
    const pad = ' '.repeat(maxEq - before.length);
    return before + pad + ' ' + after;
  });
}
