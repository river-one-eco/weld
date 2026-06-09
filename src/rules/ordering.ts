/**
 * ordering.ts — Declaration-ordering rules:
 *   ordering/interface-members-alphabetical  Interface members alphabetical within each section
 *   ordering/constructor-args-alphabetical    Constructor parameters must be alphabetical
 *   ordering/contract-section-order           Contract preamble sections in canonical order
 *
 * House convention (per PR review): interfaces are ordered alphabetically, source is ordered
 * logically, and — because the alphabetical standard is applied to constructors — constructor
 * arguments are alphabetical too. All three rules are warnings; they reorder nothing.
 */
import { Rule, RuleContext } from '../types.js';
import type { ContractDef, FunctionDef, LocNode, SolNode } from '../sol-types.js';

interface Section {
  line: number;   // 1-based line of the section-header title
  title: string;
}

const SECTION_HEADER_RE = /^\s*\/\*\*\*\s+(.*?)\s+\*\*\*\/\s*$/;

// Scan the file for `/*** Title ***/` section-header title lines.
function findSections(lines: string[]): Section[] {
  const out: Section[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(SECTION_HEADER_RE);
    if (m) out.push({ line: i + 1, title: m[1].trim() });
  }
  return out;
}

// The section a node at `nodeLine` belongs to = the last header strictly above it.
function sectionForLine(sections: Section[], nodeLine: number): number {
  let idx = -1;
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].line < nodeLine) idx = i;
    else break;
  }
  return idx;
}

function ln(node: { loc?: { start?: { line?: number } } }): number {
  return node.loc?.start?.line ?? 0;
}
function cl(node: { loc?: { start?: { column?: number } } }): number {
  return (node.loc?.start?.column ?? 0) + 1;
}

// Case-insensitive comparison key (the house ordering is case-insensitive: AccessControls < ALMProxy).
function key(name: string): string {
  return name.replace(/_+$/, '').toLowerCase();
}

function contracts(ast: unknown, kinds: ContractDef['kind'][]): ContractDef[] {
  const root = ast as { children?: SolNode[] };
  return (root.children ?? [])
    .filter((c): c is ContractDef =>
      (c as ContractDef).type === 'ContractDefinition' && kinds.includes((c as ContractDef).kind));
}

// Conservative canonical-order rank for a contract section. Everything from the constructor onward
// (functions, getters, view/pure, internal, fallback) collapses to one rank, because the corpus
// orders those inconsistently (e.g. Controller places Fallback before Internal). We only enforce the
// stable preamble: storage → constants → declarations → structs → events → errors → modifiers →
// constructor → (members). Unrecognised titles return -1 and are skipped.
function sectionRank(title: string): number {
  const t = title.toLowerCase();
  // NOTE: check `constructor` before `struct` — "conSTRUCTor" contains "struct".
  if (/storage/.test(t))            return 10;
  if (/constant/.test(t))           return 20;
  if (/declaration/.test(t))        return 30;
  if (/constructor/.test(t))        return 80;
  if (/struct/.test(t))             return 40;
  if (/event/.test(t))              return 50;
  if (/error/.test(t))              return 60;
  if (/modifier/.test(t))           return 70;
  if (/function|getter|variable|view|pure|interactive|fallback|receive/.test(t)) return 90;
  return -1;
}

export const orderingRules: Rule[] = [
  {
    name: 'ordering/interface-members-alphabetical',
    check(ctx: RuleContext) {
      if (!ctx.parsed.ast) return;
      const sections = findSections(ctx.parsed.lines);

      for (const iface of contracts(ctx.parsed.ast, ['interface'])) {
        // Bucket named members by (section, kind), preserving source order.
        const buckets = new Map<string, { name: string; line: number; col: number }[]>();
        for (const sub of iface.subNodes ?? []) {
          const node = sub as { type: string; name?: string | null };
          const kind = node.type;
          if (!['FunctionDefinition', 'EventDefinition', 'CustomErrorDefinition', 'StructDefinition'].includes(kind))
            continue;
          const name = node.name;
          if (!name) continue; // unnamed (e.g. fallback) — interfaces shouldn't have these
          const loc = sub as unknown as LocNode;
          const line = ln(loc);
          const bucketKey = `${sectionForLine(sections, line)}|${kind}`;
          let bucket = buckets.get(bucketKey);
          if (!bucket) { bucket = []; buckets.set(bucketKey, bucket); }
          bucket.push({ name, line, col: cl(loc) });
        }

        for (const members of buckets.values()) {
          for (let i = 1; i < members.length; i++) {
            if (key(members[i].name) < key(members[i - 1].name)) {
              ctx.report({
                line: members[i].line, col: members[i].col, severity: 'warn',
                rule: 'ordering/interface-members-alphabetical',
                message: `Interface member '${members[i].name}' should come before '${members[i - 1].name}' (alphabetical within section)`,
                fixable: false,
              });
            }
          }
        }
      }
    },
  },

  {
    name: 'ordering/constructor-args-alphabetical',
    check(ctx: RuleContext) {
      if (!ctx.parsed.ast) return;
      for (const c of contracts(ctx.parsed.ast, ['contract', 'abstract'])) {
        for (const sub of c.subNodes ?? []) {
          const fn = sub as unknown as FunctionDef;
          if (fn.type !== 'FunctionDefinition' || !fn.isConstructor) continue;
          const params = (fn.parameters ?? []).map(p => p.name).filter((n): n is string => !!n);
          for (let i = 1; i < params.length; i++) {
            if (key(params[i]) < key(params[i - 1])) {
              ctx.report({
                line: ln(fn), col: cl(fn), severity: 'warn',
                rule: 'ordering/constructor-args-alphabetical',
                message: `Constructor argument '${params[i]}' should come before '${params[i - 1]}' (alphabetical)`,
                fixable: false,
              });
              break; // one report per constructor
            }
          }
        }
      }
    },
  },

  {
    name: 'ordering/contract-section-order',
    check(ctx: RuleContext) {
      if (!ctx.parsed.ast) return;
      const allSections = findSections(ctx.parsed.lines);

      for (const c of contracts(ctx.parsed.ast, ['contract', 'abstract'])) {
        const start = ln(c);
        const end = c.loc?.end?.line ?? Number.MAX_SAFE_INTEGER;
        const ranked = allSections
          .filter(s => s.line > start && s.line < end)
          .map(s => ({ ...s, rank: sectionRank(s.title) }))
          .filter(s => s.rank >= 0);

        for (let i = 1; i < ranked.length; i++) {
          if (ranked[i].rank < ranked[i - 1].rank) {
            ctx.report({
              line: ranked[i].line, col: 1, severity: 'warn',
              rule: 'ordering/contract-section-order',
              message: `Section '${ranked[i].title}' is out of canonical order (should appear before '${ranked[i - 1].title}')`,
              fixable: false,
            });
          }
        }
      }
    },
  },
];
