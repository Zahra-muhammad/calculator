/**
 * General-ledger scan: looks inside normal expense accounts for transactions whose
 * description suggests a hidden add-back (fines, gifts, donations, personal costs,
 * entertainment, payments to related parties). Each finding is a suggestion; a person
 * accepts or rejects it. Accepted suggestions become add-back sub-lines with the
 * transactions as evidence.
 */
import { COMMERCIAL, GOVERNMENT } from './classify';
import type { Category, ClassifiedLine, GlTxn, RelatedParty, SubLine } from './types';
import { CATEGORY_MAP } from './types';
import { aed, norm, num, slug } from './util';

interface GlPattern {
  id: string;
  re: RegExp;
  /** The pattern applies only when this ALSO matches. */
  also?: RegExp;
  /** The pattern does not apply when this matches. */
  not?: RegExp;
  category: Category;
  what: string;
}

export const GL_PATTERNS: GlPattern[] = [
  // Same rules as the account names: fines and government penalties are added back; contract penalties are allowed
  // (no suggestion); any other penalty needs a person to decide.
  { id: 'fines', re: /\bfines?\b|\bviolations?\b/, category: 'fines', what: 'fines or penalties' },
  { id: 'fines', re: /\bpenalt\w*/, also: GOVERNMENT, category: 'fines', what: 'fines or penalties' },
  { id: 'penalties', re: /\bpenalt\w*/, not: COMMERCIAL, category: 'penalty_review', what: 'penalties that need review (government or contract?)' },
  { id: 'donations', re: /\b(donations?|charit(y|ies|able)|zakat)\b/, category: 'donation_unlisted', what: 'donations' },
  { id: 'personal', re: /\b(personal|family|holidays?|vacations?|school fees?|tuition)\b/, category: 'personal', what: 'personal costs' },
  { id: 'client-ent', re: /\bclient (dinners?|lunch(es)?|entertainment|meals?)\b|\bgifts?\b/, category: 'entertainment_client', what: 'client entertainment or gifts' },
  { id: 'entertainment', re: /\b(entertainment|hospitality)\b/, category: 'entertainment_unsplit', what: 'entertainment' },
];

export interface GlSuggestion {
  id: string;
  parentKey: string;
  account: string;
  category: Category;
  ruleId: string;
  what: string;
  count: number;
  total: number;
  txns: GlTxn[];
  message: string;
}

function findLine(account: string, lines: ClassifiedLine[]): ClassifiedLine | undefined {
  const a = norm(account);
  if (!a) return undefined;
  return lines.find((l) => norm(l.account) === a) ?? lines.find((l) => {
    const n = norm(l.account);
    return n.length > 3 && (a.includes(n) || n.includes(a));
  });
}

export function scanGl(gl: GlTxn[], lines: ClassifiedLine[], parties: RelatedParty[] = []): GlSuggestion[] {
  const groups = new Map<string, GlSuggestion>();
  const partyPatterns = parties
    .filter((p) => norm(p.name).length >= 3)
    .map((p): GlPattern => ({
      id: `rp-${slug(p.name)}`,
      re: new RegExp(`\\b${norm(p.name).replace(/ /g, '\\s+')}\\b`),
      category: (p.type === 'person' ? 'connected_person_payment' : 'related_party_expense') as Category,
      what: `payments to ${p.name}`,
    }));
  const patterns = [...GL_PATTERNS, ...partyPatterns];

  for (const t of gl) {
    const line = findLine(t.account, lines);
    if (!line || line.category !== 'normal_expense') continue;
    const d = norm(t.description);
    if (!d) continue;
    const p = patterns.find((x) => x.re.test(d) && (!x.also || x.also.test(d)) && (!x.not || !x.not.test(d)));
    if (!p) continue;
    const id = `${line.key}::gl::${p.id}`;
    const g =
      groups.get(id) ??
      ({ id, parentKey: line.key, account: line.account, category: p.category, ruleId: CATEGORY_MAP[p.category].rule, what: p.what, count: 0, total: 0, txns: [], message: '' } as GlSuggestion);
    g.count++;
    g.total += t.amount;
    g.txns.push(t);
    groups.set(id, g);
  }
  return [...groups.values()]
    .filter((g) => g.total > 0)
    .map((g) => ({
      ...g,
      message: `${g.count} transaction${g.count === 1 ? '' : 's'}, ${aed(g.total)}, look like ${g.what} inside ${g.account}.`,
    }))
    .sort((a, b) => b.total - a.total);
}

export function suggestionToSubLine(s: GlSuggestion): SubLine {
  return {
    key: s.id,
    parentKey: s.parentKey,
    category: s.category,
    amount: Math.round(s.total * 100) / 100,
    label: `${CATEGORY_MAP[s.category].label} inside ${s.account} (from the ledger)`,
    source: 'gl',
    evidence: s.txns.map((t) => `GL row ${t.row}${t.date ? ` · ${t.date}` : ''} · ${t.description} · ${num(t.amount, 2)}`),
  };
}
