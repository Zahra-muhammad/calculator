/**
 * Evidence for the client profile, read from every uploaded document and cross-checked.
 *
 *  1. Field tables: a label cell and the ANSWER in the cell next to it ("Tax group status | Not a
 *     member of a Corporate Tax group"), or a "Label: answer" line in a PDF. The label itself is
 *     never read as an answer.
 *  2. Statements in sentences ("It was not a member of a Corporate Tax group … and had no foreign
 *     branch."), with the negation read inside the same clause.
 *  3. resolveEvidence() combines the evidence of all files: answers that agree are filled in with
 *     every source; answers that disagree are NOT filled in and are flagged for a person.
 *
 * Pure: no React, no DOM.
 */
import * as XLSX from 'xlsx';
import type { Cell, Grid } from './parse';
import type { CellRef, LegalForm } from './types';
import { SETTINGS } from './settings';
import { isIsoDate, norm, parseAmount } from './util';

const SBR_LIMIT = SETTINGS.sbr.revenueLimit;

export type FactKey =
  | 'clientName'
  | 'trn'
  | 'periodStart'
  | 'periodEnd'
  | 'accountingStandard'
  | 'audited'
  | 'auditor'
  | 'auditReportDate'
  | 'taxGroup'
  | 'mneGroup'
  | 'freeZone'
  | 'qfzp'
  | 'groupRevenue'
  | 'electSBR'
  | 'priorPeriodsUnder3M'
  | 'electRealisation'
  | 'realisationItems'
  | 'foreign'
  | 'ownershipChange'
  | 'taxCertificates'
  | 'vatDifferenceNote';

export type FactValue = string | number | boolean;

/**
 * stated   = an answer next to a label, or an explicit sentence ("There was no change in ownership").
 * text     = found in titles, notes or account names by the older keyword rules.
 * inferred = a guess from indirect signs (e.g. "LLC" in the name and no free zone words). Used only
 *            when nothing better exists, and never causes a conflict.
 */
export type Strength = 'stated' | 'text' | 'inferred';

export interface Evidence {
  key: FactKey;
  value: FactValue;
  file: string;
  ref?: CellRef;
  /** The words the answer was read from. */
  text: string;
  /** For a field table: the label next to the answer. */
  label?: string;
  strength: Strength;
  why?: string;
}

// ───────────────────────── Small parsers ─────────────────────────

export const COMPANY_SUFFIX = /(?<![a-z])(l\.?\s?l\.?\s?c\.?|fze|fzco|fz-?\s?llc|pjsc|psc|ltd\.?|limited|dmcc|co\.)(?![a-z])/i;

/** "Desert Star Office Supplies LLC – fictional UAE mainland resident company." → "Desert Star Office Supplies LLC". */
export function cleanCompanyName(s: string): string {
  let t = s.replace(/\s+/g, ' ').trim();
  // Stop at the dash or full stop that follows the legal ending (LLC, FZE, Ltd …).
  const suffix = COMPANY_SUFFIX.exec(t);
  if (suffix) {
    const after = suffix.index + suffix[0].length;
    const sep = /\s+[–—-]\s+|[;:]\s|\.\s+(?=[A-Za-z])|,\s+(?![^,]*(?:l\.?\s?l\.?\s?c|fze|fzco|ltd|limited|dmcc|pjsc)\b)/i.exec(t.slice(after));
    if (sep) t = t.slice(0, after + sep.index).trim();
  }
  for (;;) {
    const m = /\s*\(([^()]*)\)\s*$/.exec(t);
    if (!m || COMPANY_SUFFIX.test(m[1])) break; // keep "(L.L.C.)", drop "(FICTIONAL TEST COMPANY)"
    t = t.slice(0, m.index).trim();
  }
  return t.replace(/[\s,;:–-]+$/, '');
}

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
export const DATE_RE_SRC =
  '(\\d{1,2}(?:st|nd|rd|th)?\\s+' + MONTH + '\\.?,?\\s+\\d{4}|' + MONTH + '\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{4}|\\d{4}-\\d{2}-\\d{2})';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "31 December 2025", "December 31, 2025", "31/12/2025" (day first), "2025-12-31" → "2025-12-31". */
export function parseDateText(s: string): string | undefined {
  const t = s.trim().toLowerCase();
  let y: number, m: number, d: number;
  let x: RegExpExecArray | null;
  if ((x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t))) [y, m, d] = [+x[1], +x[2], +x[3]];
  else if ((x = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) [d, m, y] = [+x[1], +x[2], +x[3]];
  else {
    const w = t.replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
    if ((x = /^(\d{1,2}) ([a-z]+) (\d{4})$/.exec(w))) [d, m, y] = [+x[1], MONTHS.indexOf(x[2].slice(0, 3)) + 1, +x[3]];
    else if ((x = /^([a-z]+) (\d{1,2}) (\d{4})$/.exec(w))) [m, d, y] = [MONTHS.indexOf(x[1].slice(0, 3)) + 1, +x[2], +x[3]];
    else return undefined;
  }
  if (m < 1 || m > 12 || d < 1) return undefined;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (!isIsoDate(iso) || new Date(`${iso}T00:00:00Z`).getUTCDate() !== d) return undefined;
  return iso;
}

/** A date from a cell: a real Excel date, a date serial number, or text. */
export function dateFromCell(v: Cell | unknown): string | undefined {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // SheetJS dates can sit a few seconds before midnight; round to the nearest day.
    const t = new Date(v.getTime() + 12 * 3600 * 1000);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const p = XLSX.SSF.parse_date_code(v);
    if (p) return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  }
  if (typeof v === 'string') {
    const m = new RegExp(DATE_RE_SRC, 'i').exec(v);
    return m ? parseDateText(m[1]) : undefined;
  }
  return undefined;
}

/** A 15-digit UAE TRN (starts with 1). */
export function trnFrom(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const s = Math.round(v).toString();
    return /^1\d{14}$/.test(s) ? s : undefined;
  }
  if (typeof v === 'string') {
    const m = /(?<!\d)1(?:[\s-]?\d){14}(?![\d])/.exec(v);
    if (m) {
      const d = m[0].replace(/\D/g, '');
      return d.length === 15 ? d : undefined;
    }
  }
  return undefined;
}

const NEG_WORD = /\b(?:no|not|none|never|nil|neither|nor|without|did not|does not|do not|has not|had not|have not|was not|were not|is not|n't)\b|n't\b/i;

/**
 * Yes / No from an answer cell: "Yes", "No", "Not a member of a Corporate Tax group" (no),
 * "None identified" (no), "Not applicable" (no). Undefined when the answer is neither.
 */
export function yesNo(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toLowerCase();
  if (!s) return undefined;
  if (/^(?:yes|y|true|elected|applies|applicable|confirmed|audited|member|changed)\b/.test(s)) return true;
  if (/^(?:no|n|false|none|nil|not applicable|n\/a|na|unaudited|not audited|not elected|no change)\b/.test(s)) return false;
  if (NEG_WORD.test(s)) return false;
  if (/\b(?:is a member|part of|has a|holds|elected|was audited|were audited|changed|transferred)\b/.test(s)) return true;
  return undefined;
}

// ───────────────────────── Clauses and negation ─────────────────────────

/** Cut a sentence before a word that starts a new statement ("but", "however", "; ", ", and had …"). */
const CLAUSE_START = /\b(?:but|however|although|though|whereas|while|except|apart from)\b|[;.!?]|,\s*and\b|\band\s+(?:has|had|have|is|was|were|did|does|holds?|held|operates?|operated)\b/gi;

/** Start of the clause that contains position `at`. */
function clauseStart(low: string, at: number): number {
  let start = 0;
  CLAUSE_START.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAUSE_START.exec(low)) && m.index < at) {
    // ", and had no foreign branch": the new clause starts after the joining word.
    start = Math.min(at, m.index + m[0].length);
  }
  return start;
}

/** True when the words before `at`, in the same clause, deny it ("not a member of a Corporate Tax group"). */
export function negatedAt(low: string, at: number): boolean {
  const before = low.slice(clauseStart(low, at), at);
  return NEG_WORD.test(before);
}

/** First match of `re` and whether it is denied in its clause. */
function find(low: string, re: RegExp): { neg: boolean; index: number } | undefined {
  const m = new RegExp(re.source, re.flags.replace('g', '')).exec(low);
  if (!m) return undefined;
  return { neg: negatedAt(low, m.index), index: m.index };
}

// ───────────────────────── Field tables ─────────────────────────

type LabelRule = {
  key: FactKey;
  re: RegExp;
  /** Labels that look like this one but are something else. */
  not?: RegExp;
  read: (v: Cell, text: string) => { value: FactValue; why?: string } | undefined;
};

const bool = (v: Cell, text: string) => {
  const b = yesNo(typeof v === 'boolean' ? v : text);
  return b === undefined ? undefined : { value: b };
};

/** An amount next to the label ("Unrealised gain on investments | 20,000") means the item exists. */
const boolOrAmount = (v: Cell, text: string) => {
  const n = typeof v === 'number' ? v : parseAmount(text);
  if (n !== undefined && !/^(?:yes|no)$/i.test(text)) return n !== 0 ? { value: true, why: 'An amount is shown' } : undefined;
  return bool(v, text);
};

/**
 * Tax residence / foreign tax certificates: "certificate not included in this pack" = No,
 * "certificates held" = Yes. When the label itself is about certificates, a plain Yes / No answers it.
 */
function certificateAnswer(text: string): { value: boolean } | undefined {
  const low = text.toLowerCase();
  const c = low.search(/certificates?\b/);
  if (c >= 0) {
    if (negatedAt(low, c) || /certificates?[^.;]{0,30}\b(?:not|never)\b[^.;]{0,15}(?:included|attached|provided|available|received|held|obtained)|\b(?:missing|outstanding|pending|awaited|to follow)\b/.test(low)) return { value: false };
    if (/certificates?[^.;]{0,30}\b(?:included|attached|provided|available|received|held|obtained|on file)\b|\b(?:holds?|held|received|obtained|attached|enclosed)\b[^.;]{0,30}certificates?/.test(low)) return { value: true };
    return undefined;
  }
  const b = yesNo(text);
  return b === undefined || /\bpaid\b/.test(low) ? undefined : { value: b };
}

/** "Mainland UAE entity; not a Free Zone Person" = not in a free zone. "DMCC free zone" = free zone. */
function freeZoneAnswer(text: string): { value: boolean } | undefined {
  const low = text.toLowerCase();
  if (/\bmainland\b/.test(low) && !negatedAt(low, low.indexOf('mainland'))) return { value: false };
  const fz = find(low, FREE_ZONE_WORDS);
  if (fz) return { value: !fz.neg };
  const b = yesNo(text);
  return b === undefined ? undefined : { value: b };
}

const FREE_ZONE_WORDS = /\bfree[\s-]?zones?\b|\bfreezone\b|(?<![a-z])(?:fze|fzco|fz-?llc|dmcc|jafza|dafza|difc|adgm|rakez|saif|hamriyah|kezad|ifza|dso|dic|dmc|twofour54)(?![a-z])/i;

const PERIOD_LABEL = /^(?:(?:tax|financial|fiscal|accounting|reporting|corporate tax)\s+)?(?:period|year)(?: covered)?$|^period of (?:the )?(?:financial statements|return)$/;

/** "1 January 2025 to 31 December 2025" → [start, end]. */
function rangeOf(t: string): [string, string] | undefined {
  const m = new RegExp(DATE_RE_SRC + '\\s+(?:to|until|till|-|–)\\s+' + DATE_RE_SRC, 'i').exec(t);
  if (!m) return undefined;
  const a = parseDateText(m[1]);
  const b = parseDateText(m[2]);
  return a && b && a < b ? [a, b] : undefined;
}

const LABELS: LabelRule[] = [
  { key: 'clientName', re: /^(?:client|company|entity|legal|registered|taxpayer|business)(?:'s)? name$|^name of (?:the )?(?:company|entity|client|taxpayer)$|^(?:client|company|entity)$/, read: (_v, t) => { const n = cleanCompanyName(t); return n.length > 2 ? { value: n } : undefined; } },
  { key: 'trn', re: /\btrn\b|tax registration (?:number|no)|corporate tax (?:registration )?number/, read: (v, t) => { const x = trnFrom(v) ?? trnFrom(t); return x ? { value: x } : undefined; } },
  {
    key: 'periodStart',
    re: /^(?:financial|fiscal|tax|accounting|reporting)?\s*(?:year|period|fy)\s*(?:start|starts|starting|begin|begins|beginning|commencement|commences|from)(?: date| on)?$|^(?:period|year) from$|^start (?:date|of (?:the )?(?:financial )?(?:year|period))$/,
    read: (v) => { const d = dateFromCell(v); return d ? { value: d } : undefined; },
  },
  {
    key: 'periodEnd',
    re: /^(?:financial|fiscal|tax|accounting|reporting)?\s*(?:year|period|fy)\s*(?:end|ends|ending|ended|to|end date)(?: date| on)?$|^year[\s-]?end$|^(?:period|year) to$|^end (?:date|of (?:the )?(?:financial )?(?:year|period))$|^balance sheet date$|^reporting date$/,
    read: (v) => { const d = dateFromCell(v); return d ? { value: d } : undefined; },
  },
  { key: 'periodStart', re: PERIOD_LABEL, read: (_v, t) => { const r = rangeOf(t); return r ? { value: r[0] } : undefined; } },
  { key: 'periodEnd', re: PERIOD_LABEL, read: (_v, t) => { const r = rangeOf(t); return r ? { value: r[1] } : undefined; } },
  {
    key: 'accountingStandard',
    re: /accounting (?:standard|framework)|financial reporting (?:framework|standard)|reporting framework|basis of preparation/,
    read: (_v, t) => (/ifrs for sme|small and medium/i.test(t) ? { value: 'IFRS for SMEs' } : /\bifrs\b|international financial reporting/i.test(t) ? { value: 'IFRS' } : undefined),
  },
  { key: 'audited', re: /\baudited\b|^audit(?:ed)? status$|^audit required$|^statutory audit$/, not: /audit (?:firm|report date|date|fee)|auditor/, read: bool },
  { key: 'auditor', re: /^(?:audit firm|auditors?|name of (?:the )?auditors?|external auditors?|statutory auditors?)$/, read: (_v, t) => (t.length > 2 ? { value: t } : undefined) },
  { key: 'auditReportDate', re: /audit (?:report|opinion) date|date of (?:the )?(?:audit(?:or'?s)? )?report|^report date$|auditor'?s? report date/, read: (v) => { const d = dateFromCell(v); return d ? { value: d } : undefined; } },
  { key: 'taxGroup', re: /\b(?:corporate )?tax group\b/, not: /\bvat\b/, read: bool },
  { key: 'mneGroup', re: /\bmne\b|multinational|multi-national/, read: bool },
  { key: 'qfzp', re: /qualifying free[\s-]?zone|\bqfzp\b/, read: bool },
  { key: 'freeZone', re: /free[\s-]?zone|\bfreezone\b|mainland|jurisdiction|licensing authority|licen[cs]e authority|place of (?:registration|incorporation)/, not: /qualifying free[\s-]?zone|\bqfzp\b/, read: (_v, t) => freeZoneAnswer(t) },
  {
    key: 'freeZone',
    re: /^legal (?:form|status|type|structure)$|^(?:company|entity|business) (?:type|form)$|^type of (?:entity|company|business)$|^constitution$/,
    read: (_v, t) => {
      const low = t.toLowerCase();
      if (FREE_ZONE_WORDS.test(low) || /\bmainland\b/.test(low)) return freeZoneAnswer(t);
      return undefined; // "Limited Liability Company (LLC)" says nothing about mainland or free zone
    },
  },
  {
    key: 'groupRevenue',
    re: /group revenue|consolidated (?:group )?revenue|revenue of the group/,
    read: (v, t) => {
      const n = typeof v === 'number' ? v : parseAmount(t);
      if (n !== undefined && n >= 0) return { value: n };
      if (/not applicable|n\/a|standalone|stand-alone|not (?:a )?(?:member|part)|none|no group/i.test(t)) return { value: 0, why: 'Not part of a group' };
      return undefined;
    },
  },
  { key: 'electSBR', re: /small business relief|\bsbr\b/, not: /eligib|revenue|threshold|limit/, read: bool },
  {
    key: 'priorPeriodsUnder3M',
    re: /(?:earlier|prior|previous|past)[^.]{0,40}(?:revenue|turnover)[^.]{0,40}(?:3 ?(?:million|m\b)|3,0{3},0{3})|(?:revenue|turnover)[^.]{0,40}(?:earlier|prior|previous)[^.]{0,40}(?:3 ?(?:million|m\b)|3,0{3},0{3})/,
    read: bool,
  },
  {
    key: 'priorPeriodsUnder3M',
    re: /^(?:prior|previous|earlier|past) (?:tax )?(?:periods?|years?)(?:'s)? (?:revenue|turnover)$|^(?:revenue|turnover) (?:of|for|in) (?:prior|previous|earlier) (?:tax )?(?:periods?|years?)$/,
    read: (_v, t) => {
      const amounts = [...t.matchAll(/(?:aed\s*)?(\d{1,3}(?:,\d{3})+|\d{4,})(?!\s*%)/gi)].map((m) => Number(m[1].replace(/,/g, ''))).filter((n) => n >= 10_000);
      if (!amounts.length) return undefined;
      const over = amounts.filter((n) => n > SBR_LIMIT);
      return over.length ? { value: false, why: `An earlier period's revenue is above AED 3M (${over.map((n) => n.toLocaleString('en-US')).join(', ')})` } : { value: true, why: `Earlier revenue ${amounts.map((n) => `AED ${n.toLocaleString('en-US')}`).join(', ')}: all at or below AED 3M` };
    },
  },
  { key: 'electRealisation', re: /reali[sz]ation(?: basis)?(?: election)?|reali[sz]ation basis/, read: bool },
  { key: 'realisationItems', re: /unreali[sz]ed|fair value|revaluation|\boci\b|other comprehensive/, read: boolOrAmount },
  // "Foreign income / foreign branch | Yes – branch in Oman". Only a label that asks whether there IS foreign
  // income or a branch; "Foreign branch tax paid" or "Certificate included" answer other questions.
  {
    key: 'foreign',
    re: /foreign (?:income|branch|branches|operations|permanent establishment|pe)\b|overseas (?:income|branch)|permanent establishment|foreign source/,
    not: /tax paid|tax credit|taxes paid|certificate|withholding|\bwht\b|country|jurisdiction|exemption|elect/,
    read: boolOrAmount,
  },
  // "Foreign branch tax paid | Omani tax paid; certificate not included in this pack": foreign tax WAS paid
  // (so there is foreign income), and the certificate answer is read on its own.
  {
    key: 'foreign',
    re: /(?:foreign|overseas|branch|omani?|saudi|ksa|qatar|bahrain|kuwait|india|uk|withholding)[^.]{0,30}\btax(?:es)? paid\b|\bforeign tax(?:es)?\b(?! certificate)|\bwithholding tax\b/,
    not: /certificate/,
    read: (v, t) => {
      const n = typeof v === 'number' ? v : parseAmount(t);
      if (n !== undefined && !/^(?:yes|no)$/i.test(t)) return n > 0 ? { value: true, why: 'Foreign tax was paid' } : undefined;
      const low = t.toLowerCase();
      const paid = find(low, /\bpaid\b|\bwithheld\b|^yes\b/);
      if (paid) return paid.neg ? undefined : { value: true, why: 'Foreign tax was paid' };
      return yesNo(t) === true ? { value: true, why: 'Foreign tax was paid' } : undefined;
    },
  },
  { key: 'taxCertificates', re: /certificate|foreign tax paid|tax paid|withholding tax/, read: (_v, t) => certificateAnswer(t) },
  { key: 'ownershipChange', re: /(?:ownership|shareholding|shareholders?)\s*(?:change|changes|changed)|change (?:in|of) (?:the )?(?:ownership|shareholding|shareholders?)|transfer of shares/, read: bool },
];

/** Match a label to a rule. A label is short, and is not itself an answer. */
function ruleFor(label: string): LabelRule[] {
  const low = label.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').replace(/[:?*]+$/, '').trim();
  if (!low || low.length > 90) return [];
  return LABELS.filter((r) => r.re.test(low) && !(r.not && r.not.test(low)));
}

/** "Foreign income / foreign branch" is a label; "There was a transfer of shares." is a sentence. */
function looksLikeLabel(s: string): boolean {
  const t = s.trim();
  return t.length <= 70 && !/[.!]$/.test(t) && t.split(/\s+/).length <= 12;
}

const cellString = (v: Cell): string => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' ? '' : String(v).replace(/\s+/g, ' ').trim());

export interface FieldTableResult {
  evidence: Evidence[];
  /** "Sheet!A1" of every label and answer cell used, so other rules skip them. */
  used: Set<string>;
}

const key = (sheet: string, r: number, c: number) => `${sheet}!${r}:${c}`;

/**
 * Read "label | answer" pairs from a sheet: the answer is the first filled cell to the right of
 * the label in the same row. Labels in a header row ("Field | Record") are skipped.
 */
export function readFieldTables(grids: Grid[], file: string, refFor: (g: Grid, r: number, c: number) => CellRef, opts: { pairsOnly?: boolean } = {}): FieldTableResult {
  const evidence: Evidence[] = [];
  const used = new Set<string>();
  for (const g of grids) {
    g.rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        const label = row[c];
        if (typeof label !== 'string') continue;
        const rules = ruleFor(label);
        if (!rules.length) continue;
        // The answer: the next filled cell to the right (within 3 columns).
        let vc = -1;
        for (let k = c + 1; k <= Math.min(row.length - 1, c + 3); k++) {
          if (cellString(row[k]) !== '') {
            vc = k;
            break;
          }
        }
        // In a sheet a label is never an answer, even with nothing next to it. In a PDF a line on its own is a
        // sentence, not a label.
        if (vc < 0) {
          if (!opts.pairsOnly && looksLikeLabel(label)) used.add(key(g.name, r, c));
          continue;
        }
        used.add(key(g.name, r, c));
        // The answer cell belongs to this label, even when it is not understood ("Legal form | Limited Liability Company").
        used.add(key(g.name, r, vc));
        const v = row[vc];
        const text = cellString(v);
        const keys = new Set<FactKey>();
        for (const rule of rules) {
          if (keys.has(rule.key)) continue;
          const got = rule.read(v, text);
          if (!got) continue;
          keys.add(rule.key);
          used.add(key(g.name, r, vc));
          // An amount is the line itself ("Unrealised gain | 20,000"): point at the label.
          const at = got.why === 'An amount is shown' ? c : vc;
          evidence.push({ key: rule.key, value: got.value, file, ref: refFor(g, r, at), text: at === c ? label.trim() : text, label: at === c ? undefined : label.trim(), strength: 'stated', why: got.why });
        }
        c = vc; // do not read the answer as a label
      }
    });
  }
  return { evidence, used };
}

/** A table of revenue by year ("FY2023 | 1,840,000"): earlier years above AED 3M, or all at or below. */
export function readPriorRevenueTable(grids: Grid[], file: string, refFor: (g: Grid, r: number, c: number) => CellRef, periodYear?: number): Evidence[] {
  const out: Evidence[] = [];
  for (const g of grids) {
    const head = g.rows.slice(0, 3).flat().map(cellString).join(' ').toLowerCase();
    if (!/revenue|turnover/.test(head + ' ' + g.name.toLowerCase())) continue;
    const years: { year: number; amount: number; r: number; c: number }[] = [];
    g.rows.forEach((row, r) => {
      const label = cellString(row[0]);
      const m = /^(?:fy\s?|year\s)?((?:19|20)\d{2})$/i.exec(label);
      if (!m) return;
      for (let c = 1; c < row.length; c++) {
        const n = typeof row[c] === 'number' ? (row[c] as number) : parseAmount(row[c]);
        if (n !== undefined) {
          years.push({ year: +m[1], amount: n, r, c });
          break;
        }
      }
    });
    if (years.length < 2) continue;
    const thisYear = periodYear ?? Math.max(...years.map((y) => y.year));
    const earlier = years.filter((y) => y.year < thisYear);
    if (!earlier.length) continue;
    const over = earlier.find((y) => y.amount > SBR_LIMIT);
    const at = over ?? earlier[earlier.length - 1];
    const list = earlier.map((y) => `FY${y.year} AED ${y.amount.toLocaleString('en-US')}`).join(', ');
    out.push({
      key: 'priorPeriodsUnder3M',
      value: !over,
      file,
      ref: refFor(g, at.r, at.c),
      text: list,
      strength: 'text',
      why: over ? `FY${over.year} revenue is above AED 3M` : `${list}: all at or below AED 3M`,
    });
  }
  return out;
}

// ───────────────────────── Sentences ─────────────────────────

type SentenceRule = { key: FactKey; test: (low: string) => FactValue | undefined };


const SENTENCES: SentenceRule[] = [
  {
    key: 'taxGroup',
    test: (low) => {
      const f = find(low, /\b(?:corporate )?tax group\b/);
      if (!f) return undefined;
      if (f.neg) return false;
      return /\b(?:is|was|are|were|became|becomes|joined|forms?|formed)\b[^.]{0,30}(?:member|part|head|parent|representative)\b[^.]{0,30}tax group|(?:member|part) of (?:a |the |an )?(?:corporate )?tax group/.test(low) ? true : undefined;
    },
  },
  {
    key: 'mneGroup',
    test: (low) => {
      const f = find(low, /\bmultinational(?: enterprise)?(?: group)?\b|\bmne group\b|\bmne\b/);
      if (!f) return undefined;
      if (f.neg) return false;
      return /(?:member|part) of (?:a |the |an )?(?:multinational|mne)/.test(low) ? true : undefined;
    },
  },
  {
    key: 'qfzp',
    test: (low) => {
      const f = find(low, /qualifying free[\s-]?zone person|\bqfzp\b/);
      if (!f) return undefined;
      if (f.neg) return false;
      return /\b(?:is|was|qualifies as|qualified as|treated as)\b[^.]{0,15}(?:a )?(?:qualifying free[\s-]?zone person|qfzp)/.test(low) ? true : undefined;
    },
  },
  {
    key: 'freeZone',
    test: (low) => {
      const mainland = find(low, /\bmainland\b/);
      if (mainland && !mainland.neg) return false;
      const fz = find(low, /\b(?:registered|incorporated|licensed|established|located|operates?|operated|situated)\b[^.]{0,40}(?:free[\s-]?zone|jafza|dafza|dmcc|difc|adgm|rakez|saif|hamriyah|kezad|ifza)|(?<!qualifying )\bfree[\s-]?zone (?:company|entity|establishment|person)\b/);
      if (fz) return !fz.neg;
      const status = find(low, /\bfree[\s-]?zone status\b/);
      return status?.neg ? false : undefined;
    },
  },
  {
    key: 'foreign',
    test: (low) => {
      // "The Company operated a branch in Oman during FY2025."
      const branch = find(low, /\b(?:operated|operates|operating|has|had|have|maintains?|maintained|opened|runs?|ran)\b[^.]{0,20}\bbranch(?:es)? (?:in|outside|abroad)\b/);
      if (branch) return !branch.neg;
      const f = find(low, /\bforeign (?:branch|branches|permanent establishment|operations|source income|income)\b|\boverseas (?:branch|income|operations)\b|\bpermanent establishment (?:outside|abroad|in)\b/);
      if (!f) return undefined;
      if (f.neg) return false;
      return /\b(?:has|had|have|operates?|operated|maintains?|maintained|earned|earns|received|receives|derived|derives|opened)\b/.test(low.slice(Math.max(0, f.index - 40), f.index + 5)) ? true : undefined;
    },
  },
  {
    key: 'ownershipChange',
    test: (low) => {
      const neg =
        /\bno (?:change|changes) (?:in|of|to) (?:the )?(?:direct (?:or|and) indirect |direct |indirect |legal (?:or|and) beneficial )?(?:ownership|shareholding|shareholders?|owners?)\b|\b(?:ownership|shareholding) (?:did not|has not|had not) change|\bno shares? (?:were |was )?(?:transferred|issued|sold|redeemed)|\bnot (?:been )?(?:transferred|sold)\b[^.]{0,20}shares/.test(low);
      if (neg) return false;
      const pos = find(low, /\b(?:transfer of (?:\d{1,3}(?:\.\d+)?% of )?(?:the )?(?:company'?s? )?shares|shares were (?:transferred|sold|acquired)|change (?:in|of) (?:the )?(?:direct |indirect )?(?:ownership|shareholding|shareholders?)|new shareholders?|acquired \d{1,3}(?:\.\d+)?% of)\b/);
      if (pos) return !pos.neg;
      return undefined;
    },
  },
  {
    key: 'electSBR',
    test: (low) => {
      const f = find(low, /small business relief|\bsbr\b/);
      if (!f) return undefined;
      if (/\b(?:eligib|threshold|limit)/.test(low) && !/\belect/.test(low)) return undefined;
      if (/(?:did not|does not|has not|have not|will not|not|never)\s+(?:to\s+)?(?:elect|apply|claim)\w*[^.]{0,30}(?:small business relief|\bsbr\b)|(?:small business relief|\bsbr\b)[^.]{0,20}\b(?:is|was|has|have)?\s*not (?:been )?(?:elected|applied|claimed)/.test(low)) return false;
      if (/\b(?:elected|elects|elect to apply|chose|chosen|opted|applied for|claimed|claims|will elect)\b[^.]{0,30}(?:small business relief|\bsbr\b)|(?:small business relief|\bsbr\b)[^.]{0,20}\b(?:is|was|has been|have been)\s+(?:elected|claimed|applied)/.test(low)) return true;
      return undefined;
    },
  },
  {
    key: 'priorPeriodsUnder3M',
    test: (low) => {
      if (!/(?:3 ?(?:million|m)\b|3,0{3},0{3})/.test(low)) return undefined;
      if (/\bno (?:earlier|prior|previous|past) (?:tax )?(?:periods?|years?)\b[^.]{0,40}\b(?:exceeded|was above|were above|had revenue above|more than|over)\b|(?:earlier|prior|previous|past) (?:tax )?(?:periods?|years?)\b[^.]{0,60}\b(?:at or below|below|under|not more than|did not exceed|never exceeded|less than)\b/.test(low)) return true;
      const f = find(low, /(?:earlier|prior|previous|past) (?:tax )?(?:periods?|years?)\b[^.]{0,60}\b(?:exceeded|above|more than|over)\b/);
      if (f) return f.neg;
      return undefined;
    },
  },
  {
    key: 'electRealisation',
    test: (low) => {
      if (!/reali[sz]ation (?:basis|election)|reali[sz]ation basis/.test(low)) return undefined;
      if (/(?:did not|does not|has not|have not|not|never)\s+(?:to\s+)?(?:elect|appl)\w*[^.]{0,20}reali[sz]ation/.test(low)) return false;
      if (/\b(?:elected|elects|applied|applies|opted)\b[^.]{0,20}reali[sz]ation/.test(low)) return true;
      return undefined;
    },
  },
  {
    key: 'realisationItems',
    test: (low) => {
      const f = find(low, /\bunreali[sz]ed\b|\bfair value (?:movements?|gains?|losses?)\b|\brevaluation (?:gains?|losses?|surplus|reserve)\b|\boci items?\b/);
      if (!f) return undefined;
      return f.neg ? false : undefined; // a mention without "no" is left to the keyword rules
    },
  },
  {
    key: 'taxCertificates',
    test: (low) => (/\b(?:tax|residence|residency|withholding)\b[^.]{0,30}certificates?|certificates? of (?:tax )?residen/.test(low) ? certificateAnswer(low)?.value : undefined),
  },
  {
    key: 'audited',
    test: (low) => {
      if (/\bindependent auditors?'?s?'? report\b/.test(low)) return true;
      if (/\bwe (?:have )?audited the (?:accompanying )?(?:financial statements|balance sheet)/.test(low)) return true;
      if (/\b(?:unaudited|not (?:been )?audited)\b/.test(low)) return false;
      return undefined;
    },
  },
];

/** "For the year ended 31 December 2025", "Tax period: 1 January 2025 to 31 December 2025". */
const ENDED_RE = new RegExp('\\b(?:year|period)\\s+end(?:ed|ing)\\s+(?:on\\s+)?' + DATE_RE_SRC, 'i');
const RANGE_RE = new RegExp('\\b(?:period|year|fy\\d{0,4})\\b[^.]{0,30}?(?:from\\s+)?' + DATE_RE_SRC + '\\s+(?:to|until|till|-|–)\\s+' + DATE_RE_SRC, 'i');

export function sentenceEvidence(text: string, file: string, ref: CellRef | undefined): Evidence[] {
  const clean = text.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  if (clean.length < 8) return [];
  const low = clean.toLowerCase();
  const out: Evidence[] = [];
  const add = (key: FactKey, value: FactValue, why?: string) => out.push({ key, value, file, ref, text: clean.slice(0, 200), strength: 'stated', why });
  for (const rule of SENTENCES) {
    const v = rule.test(low);
    if (v !== undefined) add(rule.key, v);
  }
  // Periods.
  const range = RANGE_RE.exec(low);
  if (range) {
    const a = parseDateText(range[1]);
    const b = parseDateText(range[2]);
    if (a && b && a < b) {
      add('periodStart', a);
      add('periodEnd', b);
    }
  } else {
    const ended = ENDED_RE.exec(low);
    if (ended) {
      const d = parseDateText(ended[1]);
      if (d) add('periodEnd', d);
    }
  }
  // VAT reconciliation: why the VAT returns differ from the books.
  if (/\bvat\b/.test(low) && /\b(?:differs?|difference|does not agree|reconcil)/.test(low) && /\bbecause\b|\bdue to\b|\bas a result of\b|\bowing to\b/.test(low)) add('vatDifferenceNote', clean);
  return out;
}

/** Split text into sentences, keeping "Co." and initials ("A. Rahman") together where possible. */
export function splitSentences(text: string): string[] {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const parts = t.split(/(?<=[.!?])\s+(?=[A-Z(“"])/);
  const out: string[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    // "A." or "Co." alone belongs with what follows.
    if (prev && /(?:^|\s)(?:[A-Z]|Co|Ltd|Mr|Mrs|Ms|Dr|No|St)\.$/.test(prev)) out[out.length - 1] = `${prev} ${p}`;
    else out.push(p);
  }
  return out;
}

// ───────────────────────── Combining all files ─────────────────────────

export type Resolved =
  | { status: 'agree'; value: FactValue; evidence: Evidence[] }
  | { status: 'conflict'; evidence: Evidence[] };

const normValue = (k: FactKey, v: FactValue): string => {
  if (typeof v === 'string' && (k === 'clientName' || k === 'auditor')) return companyKey(v);
  return String(v);
};

/** "Desert Star Office Supplies L.L.C." and "DESERT STAR OFFICE SUPPLIES LLC" are the same name. */
export function companyKey(s: string): string {
  return norm(s)
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/\bl\.?\s?l\.?\s?c\.?/g, 'llc')
    .replace(/\b(?:the|and|&)\b/g, ' ')
    .replace(/chartered accountants?|accountants?|auditors?|\bco\b\.?|company|limited|ltd\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * One answer for a fact from the evidence of every file.
 * Stated and text evidence decide; inferred evidence is used only when nothing else exists.
 * Two different answers = conflict (nothing is filled in).
 */
export function resolveFact(all: Evidence[], k: FactKey): Resolved | undefined {
  const list = all.filter((e) => e.key === k);
  if (!list.length) return undefined;
  const strong = list.filter((e) => e.strength !== 'inferred');
  const use = strong.length ? strong : list;
  const values = new Map<string, Evidence[]>();
  for (const e of use) {
    const nv = normValue(k, e.value);
    values.set(nv, [...(values.get(nv) ?? []), e]);
  }
  if (values.size > 1) return { status: 'conflict', evidence: use };
  // Stated evidence first, so the main source shown is the clearest one.
  const order: Strength[] = ['stated', 'text', 'inferred'];
  const sorted = [...use].sort((a, b) => order.indexOf(a.strength) - order.indexOf(b.strength));
  return { status: 'agree', value: sorted[0].value, evidence: sorted };
}

/** Legal form from the tax group, QFZP and free zone facts. */
export function resolveLegalForm(all: Evidence[]): { status: 'agree'; value: LegalForm; evidence: Evidence[] } | { status: 'conflict'; evidence: Evidence[] } | undefined {
  const tg = resolveFact(all, 'taxGroup');
  const q = resolveFact(all, 'qfzp');
  const fz = resolveFact(all, 'freeZone');
  const conflicts = [tg, q, fz].filter((r) => r?.status === 'conflict');
  if (conflicts.length) return { status: 'conflict', evidence: conflicts.flatMap((r) => r!.evidence) };
  const yes = (r: Resolved | undefined) => r?.status === 'agree' && r.value === true;
  const no = (r: Resolved | undefined) => r?.status === 'agree' && r.value === false;
  const ev = (r: Resolved | undefined) => (r?.status === 'agree' ? r.evidence : []);
  if (yes(tg)) return { status: 'agree', value: 'tax_group', evidence: ev(tg) };
  if (yes(q)) {
    // A QFZP is in a free zone: "mainland" elsewhere is a conflict.
    if (no(fz)) return { status: 'conflict', evidence: [...ev(q), ...ev(fz)] };
    return { status: 'agree', value: 'qfzp', evidence: ev(q) };
  }
  if (yes(fz)) return { status: 'agree', value: 'free_zone', evidence: [...ev(fz), ...ev(q)] };
  if (no(fz)) return { status: 'agree', value: 'mainland', evidence: [...ev(fz), ...ev(tg)] };
  return undefined;
}

/** "Desert_Star_Company_Records_FY2025.xlsx › 'Company Master'!B14" or "Director_Confirmation.pdf, page 1, line 4". */
export function evidenceSource(e: Evidence): string {
  if (!e.ref) return e.file;
  const r = /^line \d+$/.test(e.ref.cell) ? `${e.ref.sheet}, ${e.ref.cell}` : `${/[\s'!]/.test(e.ref.sheet) ? `'${e.ref.sheet.replace(/'/g, "''")}'` : e.ref.sheet}!${e.ref.cell}`;
  return `${e.file} › ${r}`;
}

export function displayValue(k: FactKey, v: FactValue): string {
  if (typeof v === 'boolean') {
    if (k === 'freeZone') return v ? 'Free zone' : 'Mainland';
    return v ? 'Yes' : 'No';
  }
  if (typeof v === 'number') return v === 0 && k === 'groupRevenue' ? 'Not part of a group' : `AED ${v.toLocaleString('en-US')}`;
  if (isIsoDate(v)) {
    const [y, m, d] = v.split('-');
    return `${d}/${m}/${y}`;
  }
  return v;
}
