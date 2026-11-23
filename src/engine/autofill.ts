/**
 * Fills the Company profile from the uploaded files.
 *
 *  detectProfileHints  reads every text cell of a statements / trial balance file and keeps
 *                      each fact with the cell it came from (runs when a file is read).
 *  applyAutoFill       writes the facts into the workspace, marking each answer "auto".
 *                      A person's own answer (userSet) is never overwritten, also on re-upload.
 *  setProfileByUser    the only way the UI changes a profile answer: marks it as the user's.
 *  profileFields       status of every profile answer for the badges and the summary line.
 *
 * Pure: no React, no DOM. Thresholds come from settings.ts.
 */
import * as XLSX from 'xlsx';
import type { Grid } from './parse';
import { SETTINGS } from './settings';
import type { AutoMark, CellRef, Hint, LegalForm, ParsedFile, Profile, ProfileField, ProfileHints, TbData, Workspace } from './types';
export { cleanCompanyName, companyKey };
import { refText } from './types';
import { addDays, addMonths, aed, norm, parseAmount, sum } from './util';
import {
  cleanCompanyName,
  COMPANY_SUFFIX,
  companyKey,
  displayValue,
  evidenceSource,
  negatedAt,
  parseDateText,
  resolveFact,
  resolveLegalForm,
  type Evidence,
  type FactKey,
  type Resolved,
} from './evidence';

// ───────────────────────── Text cells ─────────────────────────

interface TextCell {
  text: string;
  low: string;
  r: number;
  c: number;
  g: Grid;
  /** True for trial balance data rows (account names and comments), which name other parties. */
  tbData: boolean;
}

function textCells(grids: Grid[], tb?: TbData, skip?: Set<string>): TextCell[] {
  const out: TextCell[] = [];
  for (const g of grids) {
    const tbHere = !!tb && tb.sheet === g.name;
    g.rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (typeof cell !== 'string') return;
        const text = cell.replace(/\s+/g, ' ').trim();
        if (!text || parseAmount(text) !== undefined || skip?.has(`${g.name}!${r}:${c}`)) return;
        out.push({ text, low: text.toLowerCase(), r, c, g, tbData: tbHere && r >= tb!.headerRow });
      }),
    );
  }
  return out;
}

const refOf = (t: TextCell): CellRef => ({ sheet: t.g.name, cell: XLSX.utils.encode_cell({ r: t.r, c: t.c }) });
const hint = <T,>(value: T, t: TextCell, text = t.text): Hint<T> => ({ value, ref: refOf(t), text: text.slice(0, 160) });

// ───────────────────────── Dates ─────────────────────────

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE =
  '(\\d{1,2}(?:st|nd|rd|th)?\\s+' + MONTH + '\\.?,?\\s+\\d{4}|' + MONTH + '\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{4}|\\d{4}-\\d{2}-\\d{2})';
const FROM_TO_RE = new RegExp('period\\s+from\\s+' + DATE + '\\s+(?:to|until|till|-|–)\\s+' + DATE);
const ENDED_RE = new RegExp('\\b(year|period)\\s+end(?:ed|ing)\\s+(?:on\\s+)?' + DATE);
const AS_AT_RE = new RegExp('\\bas\\s+(?:at|of|on)\\s+' + DATE);

export { parseDateText };

// ───────────────────────── Patterns ─────────────────────────

const NOT_A_NAME = /^(statement|notes?\b|trial balance|balance sheet|profit|income|for the|as at|independent|report|general ledger|vat return|limited liability compan|l\.?l\.?c\.?$|sole establishment|public joint stock|private joint stock|free zone (?:company|establishment))/i;
const TRN_LABEL = /\btrn\b|tax registration (?:number|no)/i;
const SME_RE = /ifrs for smes|ifrs for small and medium|international financial reporting standard for small and medium/i;
const IFRS_RE = /international financial reporting standards?|\bifrs\b/i;
const QFZP_RE = /qualifying free zone person/i;
const QFZP_NEG = /\bnot\s+(?:a\s+|an\s+)?qualifying free zone person/i;
const TAX_GROUP_RE = /\btax group\b/i;
const TAX_GROUP_NEG = /\bnot\s+(?:a\s+)?(?:member of|part of|in)\s+(?:a\s+|any\s+)?tax group/i;
const FREE_ZONE_RE = /\bfree\s?zones?\b|\bfreezone\b|(?<![a-z])(?:fze|fzco|fz-?llc|dmcc|jafza|dafza|difc|adgm|rakez|saif|hamriyah|kezad)(?![a-z])/i;
const MAINLAND_RE = /department of econom(?:y|ic development)|(?<![a-z])ded(?![a-z])/i;
const LLC_RE = /(?<![a-z-])l\.?\s?l\.?\s?c(?![a-z])/i;
const OWNERSHIP_RE = /transfer of (?:the )?shares|change (?:in|of) (?:the )?(?:ownership|shareholding)|new shareholders?/i;
const NEGATION_BEFORE = /\b(?:no|not|nor|without|neither)\b[^.]{0,25}$/i;
const FOREIGN_NOTE_RE = /\bbranch(?:es)?\b|permanent establishment|withholding tax|foreign tax/i;
const FOREIGN_TB_RE = /permanent establishment|withholding tax|foreign tax/i;
const INCOME_RE = /\b(?:income|revenue|sales|dividends?|royalt(?:y|ies)|interest received|fees earned|commission earned)\b/i;
const COUNTRIES = [
  'saudi arabia', 'saudi', 'ksa', 'oman', 'qatar', 'bahrain', 'kuwait', 'egypt', 'jordan', 'lebanon', 'iraq', 'iran', 'yemen', 'syria',
  'india', 'pakistan', 'bangladesh', 'sri lanka', 'nepal', 'philippines', 'china', 'hong kong', 'singapore', 'malaysia', 'indonesia',
  'thailand', 'vietnam', 'japan', 'korea', 'turkiye', 'cyprus', 'greece', 'germany', 'france', 'italy', 'spain', 'portugal', 'netherlands',
  'belgium', 'luxembourg', 'switzerland', 'austria', 'sweden', 'norway', 'denmark', 'finland', 'poland', 'ireland', 'united kingdom', 'uk',
  'england', 'scotland', 'united states', 'usa', 'canada', 'mexico', 'brazil', 'australia', 'new zealand', 'south africa', 'kenya',
  'nigeria', 'ethiopia', 'tanzania', 'uganda', 'ghana', 'morocco', 'tunisia', 'algeria', 'sudan', 'russia', 'ukraine', 'cayman islands',
  'british virgin islands', 'bvi', 'mauritius', 'seychelles',
];
const COUNTRY_RE = new RegExp(`\\b(?:${COUNTRIES.join('|')})\\b`, 'i');
const REALISATION_RE = /unreali[sz]|fair value|revaluation|\boci\b|other comprehensive (?:income|loss)/i;
const SHAREHOLDER_HEAD = /^(?:shareholders?|shareholder name|name of shareholders?|shareholding|owners?|partners?|name of partners?)$/;

/** True when the match is preceded by "no", "not", "without" … in the same sentence. */
/** True when at least one match of `re` is not denied in its clause. */
function anyPositive(low: string, re: RegExp): boolean {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  for (const m of low.matchAll(g)) if (!negatedAt(low, m.index ?? 0) && !NEGATION_BEFORE.test(low.slice(Math.max(0, (m.index ?? 0) - 12), m.index))) return true;
  return false;
}

function negated(low: string, re: RegExp): boolean {
  const m = re.exec(low);
  return !!m && (NEGATION_BEFORE.test(low.slice(0, m.index)) || negatedAt(low, m.index));
}


function trnFrom(v: unknown): string | undefined {
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

function isYearCell(v: unknown): boolean {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*(?:19|20)\d{2}\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1990 && n <= 2100;
}

function pctOrNumber(v: unknown): number | undefined {
  if (typeof v === 'string' && /%\s*$/.test(v)) {
    const n = parseAmount(v.replace('%', ''));
    return n === undefined ? undefined : n / 100;
  }
  return parseAmount(v);
}

/** A shareholder table whose two year columns differ (someone's share changed). */
function shareholderChange(grids: Grid[], tb?: TbData): Hint<true> | undefined {
  for (const g of grids) {
    if (tb && tb.sheet === g.name) continue;
    for (let r = 0; r < g.rows.length; r++) {
      const row = g.rows[r];
      for (let c = 0; c < row.length; c++) {
        if (typeof row[c] !== 'string' || !SHAREHOLDER_HEAD.test(norm(row[c]))) continue;
        const yearCols: number[] = [];
        for (const rr of [r, r - 1]) {
          (g.rows[rr] ?? []).forEach((v, cc) => {
            if (cc > c && isYearCell(v) && !yearCols.includes(cc)) yearCols.push(cc);
          });
          if (yearCols.length >= 2) break;
        }
        if (yearCols.length < 2) continue;
        const [y1, y2] = yearCols;
        for (let i = r + 1; i < Math.min(g.rows.length, r + 40); i++) {
          const name = g.rows[i]?.[c];
          if (typeof name !== 'string' || !name.trim()) break;
          if (/^total/i.test(name.trim())) continue;
          const a = pctOrNumber(g.rows[i][y1]) ?? 0;
          const b = pctOrNumber(g.rows[i][y2]) ?? 0;
          if (Math.abs(a - b) > 1e-9) {
            return { value: true, ref: { sheet: g.name, cell: XLSX.utils.encode_cell({ r: i, c }) }, text: name.trim(), why: 'Shareholding differs between the two years' };
          }
        }
      }
    }
  }
  return undefined;
}

// ───────────────────────── Detection ─────────────────────────

/**
 * Keyword rules over titles and notes. `skip`: label and answer cells of field tables, which are read
 * by evidence.ts (a label such as "Tax group status" is never itself an answer).
 */
export function detectProfileHints(grids: Grid[], tb?: TbData, skip?: Set<string>): ProfileHints {
  const cells = textCells(grids, tb, skip);
  const own = cells.filter((t) => !t.tbData); // titles and notes: about the company itself
  const h: ProfileHints = {};

  // Client name: the first title line with a company suffix.
  const title = own.find((t) => t.r < 6 && t.c < 4 && t.text.length <= 120 && COMPANY_SUFFIX.test(t.text) && !NOT_A_NAME.test(t.text));
  if (title) h.clientName = hint(cleanCompanyName(title.text), title);

  // TRN: 15 digits starting with 1, in the label cell, the same row, or the cell below.
  for (const t of own) {
    if (!TRN_LABEL.test(t.text)) continue;
    const row = t.g.rows[t.r] ?? [];
    const order = [t.c, ...row.map((_, i) => i).filter((i) => i > t.c), ...row.map((_, i) => i).filter((i) => i < t.c)];
    let found: string | undefined;
    let at = t;
    for (const c of order) {
      found = trnFrom(c === t.c ? t.text.replace(TRN_LABEL, ' ') : row[c]);
      if (found) {
        at = { ...t, c };
        break;
      }
    }
    for (const [dr, dc] of [
      [1, 0],
      [1, 1],
    ]) {
      if (found) break;
      found = trnFrom(t.g.rows[t.r + dr]?.[t.c + dc]);
      if (found) at = { ...t, r: t.r + dr, c: t.c + dc };
    }
    if (found) {
      h.trn = { value: found, ref: refOf(at), text: t.text.slice(0, 160) };
      break;
    }
  }

  // Period: "period from X to Y" beats "year/period ended X", which beats "as at X".
  let fromTo: { start: string; end: string; t: TextCell } | undefined;
  let ended: { end: string; t: TextCell } | undefined;
  let asAt: { end: string; t: TextCell } | undefined;
  for (const t of own) {
    let m: RegExpExecArray | null;
    if (!fromTo && (m = FROM_TO_RE.exec(t.low))) {
      const start = parseDateText(m[1]);
      const end = parseDateText(m[2]);
      if (start && end && start < end) fromTo = { start, end, t };
    }
    if (!ended && (m = ENDED_RE.exec(t.low))) {
      const end = parseDateText(m[2]);
      if (end) ended = { end, t };
    }
    if (!asAt && (m = AS_AT_RE.exec(t.low))) {
      const end = parseDateText(m[1]);
      if (end) asAt = { end, t };
    }
  }
  if (fromTo) {
    h.periodStart = hint(fromTo.start, fromTo.t);
    h.periodEnd = hint(fromTo.end, fromTo.t);
  } else if (ended ?? asAt) {
    const e = (ended ?? asAt)!;
    h.periodEnd = hint(e.end, e.t);
  }

  // Accounting standard.
  const sme = own.find((t) => SME_RE.test(t.text));
  const ifrs = sme ? undefined : own.find((t) => IFRS_RE.test(t.text));
  if (sme) h.accountingStandard = hint('IFRS for SMEs' as const, sme);
  else if (ifrs) h.accountingStandard = hint('IFRS' as const, ifrs);

  // Legal form: QFZP, then tax group, then free zone, then mainland.
  const qfzp = own.find((t) => QFZP_RE.test(t.text) && !QFZP_NEG.test(t.text) && !negated(t.low, QFZP_RE));
  const group = own.find((t) => TAX_GROUP_RE.test(t.text) && !TAX_GROUP_NEG.test(t.text) && !negated(t.low, TAX_GROUP_RE));
  const fz = own.find((t) => FREE_ZONE_RE.test(t.text) && anyPositive(t.low, FREE_ZONE_RE) && !/\bmainland\b/.test(t.low));
  const ded = own.find((t) => MAINLAND_RE.test(t.text));
  let form: Hint<LegalForm> | undefined;
  if (qfzp) form = hint<LegalForm>('qfzp', qfzp);
  else if (group) form = hint<LegalForm>('tax_group', group);
  else if (fz) form = hint<LegalForm>('free_zone', fz);
  else if (ded) form = hint<LegalForm>('mainland', ded);
  else if (title && LLC_RE.test(title.text)) form = { ...hint<LegalForm>('mainland', title), why: 'LLC in the name and no free zone words in the files' };
  if (form) h.legalForm = form;

  // Audited.
  const audit = own.find((t) => /independent auditors? report/.test(norm(t.text)));
  if (audit) h.audited = hint(true as const, audit);

  // Ownership change.
  const ownText = own.find((t) => OWNERSHIP_RE.test(t.low) && !negated(t.low, OWNERSHIP_RE));
  const ownTable = ownText ? undefined : shareholderChange(grids, tb);
  if (ownText) h.ownershipChange = hint(true as const, ownText);
  else if (ownTable) h.ownershipChange = ownTable;

  // Foreign income or branch.
  const fNote = own.find((t) => FOREIGN_NOTE_RE.test(t.low) && !negated(t.low, FOREIGN_NOTE_RE));
  const fTb = fNote ? undefined : cells.find((t) => t.tbData && FOREIGN_TB_RE.test(t.low));
  const fIncomeNote = fNote || fTb ? undefined : own.find((t) => INCOME_RE.test(t.low) && COUNTRY_RE.test(t.low));
  const fIncomeTb = fNote || fTb || fIncomeNote ? undefined : tb?.lines.find((l) => l.balance < 0 && COUNTRY_RE.test(l.account.toLowerCase()));
  const f = fNote ?? fTb ?? fIncomeNote;
  if (f) h.foreign = hint(true as const, f);
  else if (fIncomeTb) h.foreign = { value: true, ref: { sheet: fIncomeTb.sheet, cell: `A${fIncomeTb.row}` }, text: fIncomeTb.account, why: 'Income line naming a foreign country' };

  // Unrealised / fair value / revaluation / OCI items (ignore statement titles).
  const real = cells.find((t) => REALISATION_RE.test(t.low) && !/^statements? of/.test(t.low) && !/total comprehensive/.test(t.low));
  if (real) h.realisation = hint(true as const, real);

  return h;
}

// ───────────────────────── Applying to the workspace ─────────────────────────

const PROFILE_KEYS: ProfileField[] = [
  'legalForm',
  'accountingStandard',
  'periodStart',
  'periodEnd',
  'audited',
  'groupRevenue',
  'vatRevenue',
  'electSBR',
  'priorPeriodsUnder3M',
  'electRealisation',
  'electForeignPE',
  'hasForeignIncome',
  'hasTaxCertificates',
  'ownershipChange',
  'ownershipChangeLosses',
];

function readField(ws: Workspace, f: ProfileField): unknown {
  if (f === 'clientName') return ws.clientName.trim() || undefined;
  if (f === 'trn') return ws.trn.trim() || undefined;
  return (ws.profile as unknown as Record<string, unknown>)[f];
}

function writeField(ws: Workspace, f: ProfileField, v: unknown) {
  if (f === 'clientName') ws.clientName = (v as string | undefined) ?? '';
  else if (f === 'trn') ws.trn = (v as string | undefined) ?? '';
  else (ws.profile as unknown as Record<string, unknown>)[f] = v;
}

const STATEMENT_KINDS = ['fs', 'tb', 'fs_tb'];

/** Merge the hints of several files: the first file that has a fact wins. */
export function mergeHints(list: ProfileHints[]): ProfileHints {
  const out: ProfileHints = {};
  for (const h of list) {
    for (const [k, v] of Object.entries(h) as [keyof ProfileHints, Hint<unknown>][]) {
      if (v && out[k] === undefined) (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

/**
 * Fill the profile from the files. mode "replace": answers that were auto-filled but are no
 * longer supported by the files are cleared. mode "merge": only new facts are written (used
 * when adding files to a reopened client whose statements are not loaded).
 */
export function applyAutoFill(ws: Workspace, files: ParsedFile[], mode: 'replace' | 'merge' = 'replace'): Workspace {
  const next: Workspace = {
    ...ws,
    profile: { ...ws.profile },
    autoFill: { ...(ws.autoFill ?? {}) },
    userSet: { ...(ws.userSet ?? {}) },
    autoNotes: { ...(ws.autoNotes ?? {}) },
  };
  const used = files.filter((f) => f.kind !== 'ignore');
  const statements = used.filter((f) => STATEMENT_KINDS.includes(f.kind));
  const haveStatements = statements.length > 0;
  const docs = used.filter((f) => f.kind === 'doc');
  // Every file's evidence: answers next to labels, sentences, and the keyword hints of statements and documents.
  const evidence: Evidence[] = used.flatMap((f) => [...(f.evidence ?? []), ...(STATEMENT_KINDS.includes(f.kind) || f.kind === 'doc' ? hintsToEvidence(f) : [])]);
  const revenue = statements.map((f) => (f.kind === 'tb' ? undefined : f.fs?.revenue)).find(Boolean);
  if (revenue?.prior !== undefined && revenue.priorRef) {
    evidence.push({ key: 'priorPeriodsUnder3M', value: revenue.prior <= SETTINGS.sbr.revenueLimit, file: statements.find((f) => f.fs?.revenue === revenue)?.name ?? '', ref: revenue.priorRef, text: `Prior-year revenue ${aed(revenue.prior)}`, strength: 'stated', why: revenue.prior > SETTINGS.sbr.revenueLimit ? `Prior-year revenue ${aed(revenue.prior)} is above ${aed(SETTINGS.sbr.revenueLimit)}` : undefined });
  }
  const recompute = mode === 'replace' || haveStatements || docs.length > 0;
  const conflicts: DocConflict[] = [];

  const set = (f: ProfileField, value: unknown, mark: AutoMark) => {
    delete next.autoNotes[f];
    if (next.userSet[f]) return;
    writeField(next, f, value);
    next.autoFill[f] = mark;
  };
  const clear = (f: ProfileField) => {
    if (!recompute) return;
    delete next.autoNotes[f];
    if (next.userSet[f] || !next.autoFill[f]) return;
    writeField(next, f, undefined);
    delete next.autoFill[f];
  };
  const conflict = (f: ProfileField, label: string, r: { evidence: Evidence[] }) => {
    clear(f);
    // Clear an auto answer even in merge mode: the files now disagree.
    if (!next.userSet[f] && next.autoFill[f]) {
      writeField(next, f, undefined);
      delete next.autoFill[f];
    }
    const c = conflictOf(f, label, r.evidence);
    conflicts.push(c);
    if (!next.userSet[f]) next.autoNotes[f] = `${c.text} Check the documents and choose the answer.`;
  };
  /** Fill a field from a resolved fact: agree → filled with every source; conflict → left for a person. */
  const take = (f: ProfileField, label: string, r: Resolved | ReturnType<typeof resolveLegalForm> | undefined, map: (v: never) => unknown = (v) => v, kind?: AutoMark['kind']) => {
    if (!r) return clear(f);
    if (r.status === 'conflict') return conflict(f, label, r);
    set(f, map(r.value as never), markOf(r.evidence, kind));
  };

  if (recompute) {
    // The client name is never filled in automatically (a name left over from another file is worse than none).
    // A name found in the files is offered as a suggestion; an older automatic name is cleared.
    if (next.autoFill.clientName && !next.userSet.clientName) {
      writeField(next, 'clientName', '');
      delete next.autoFill.clientName;
    }
    const name = resolveFact(evidence, 'clientName');
    next.suggestedClientName = name?.status === 'agree' ? String(name.value) : undefined;
    if (name?.status === 'conflict') conflicts.push(conflictOf('clientName', 'Client name', name.evidence));

    take('trn', 'TRN', resolveFact(evidence, 'trn'));
    const end = resolveFact(evidence, 'periodEnd');
    take('periodEnd', 'Period end', end);
    const start = resolveFact(evidence, 'periodStart');
    if (start) take('periodStart', 'Period start', start);
    else if (end?.status === 'agree') {
      const e = end.evidence[0];
      set('periodStart', addDays(addMonths(String(end.value), -12), 1), { ...markOf(end.evidence, 'derived'), why: 'Period end − 1 year + 1 day', text: e.text });
    } else clear('periodStart');
    take('accountingStandard', 'Accounting standard', resolveFact(evidence, 'accountingStandard'));
    take('legalForm', 'Legal form', resolveLegalForm(evidence));
    take('audited', 'Audited', resolveFact(evidence, 'audited'));

    // Group revenue: a number, or 0 = not part of a group ("standalone", "not a member of an MNE group").
    const groupEv = [
      ...evidence.filter((e) => e.key === 'groupRevenue'),
      ...evidence.filter((e) => e.key === 'mneGroup').map((e): Evidence => (e.value === false ? { ...e, key: 'groupRevenue', value: 0, why: 'Not a member of a multinational group' } : { ...e, key: 'groupRevenue', value: 'member', why: 'Member of a multinational group' })),
    ];
    const group = resolveFact(groupEv, 'groupRevenue');
    if (group?.status === 'agree' && group.value === 'member') {
      clear('groupRevenue');
      if (!next.userSet.groupRevenue) next.autoNotes.groupRevenue = `The files say the company is in a multinational group (${evidenceSource(group.evidence[0])}). Enter the group's consolidated revenue.`;
    } else take('groupRevenue', 'Group revenue', group);

    // Small Business Relief is not available above the revenue limit.
    const limit = SETTINGS.sbr.revenueLimit;
    if (revenue && revenue.value > limit) {
      set('electSBR', false, { kind: 'derived', source: refText(revenue.ref), cell: true, why: `Revenue ${aed(revenue.value)} is above ${aed(limit)}` });
    } else take('electSBR', 'Small Business Relief elected', resolveFact(evidence, 'electSBR'));
    take('priorPeriodsUnder3M', 'All earlier periods ≤ AED 3M', resolveFact(evidence, 'priorPeriodsUnder3M'));

    // Realisation basis: the election itself, or "not relevant" when there are no unrealised items.
    const realElect = resolveFact(evidence, 'electRealisation');
    const realItems = resolveFact(evidence, 'realisationItems');
    if (realElect) take('electRealisation', 'Realisation basis', realElect);
    else if (realItems?.status === 'conflict') conflict('electRealisation', 'Unrealised / fair value / OCI items', realItems);
    else if (realItems?.status === 'agree' && realItems.value === true) {
      clear('electRealisation');
      const e = realItems.evidence[0];
      if (!next.userSet.electRealisation) next.autoNotes.electRealisation = `Found at ${e.ref ? refText(e.ref) : e.file}: “${e.text.slice(0, 80)}”. Decide with the client.`;
    } else if (realItems?.status === 'agree') set('electRealisation', 'na', markOf(realItems.evidence));
    else if (haveStatements) set('electRealisation', 'na', { kind: 'derived', source: 'no unrealised, fair value, revaluation or OCI items in the files', cell: false });
    else clear('electRealisation');

    const foreign = resolveFact(evidence, 'foreign');
    if (foreign) take('hasForeignIncome', 'Foreign income or branch', foreign, (v) => v, foreign.evidence.some((e) => e.strength === 'stated') ? 'file' : 'suggested');
    else if (haveStatements || docs.length) set('hasForeignIncome', false, { kind: 'suggested', source: 'no branch, foreign tax or foreign income found in the files', cell: false });
    else clear('hasForeignIncome');

    // Foreign tax certificates: only filled when a document says so ("certificate not included" = No).
    const certs = resolveFact(evidence, 'taxCertificates');
    if (certs) take('hasTaxCertificates', 'Foreign tax certificates', certs);
    else clear('hasTaxCertificates');

    const own = resolveFact(evidence, 'ownershipChange');
    take('ownershipChange', 'Ownership change', own, (v) => v, own?.evidence.some((e) => e.strength === 'stated') ? 'file' : 'suggested');

    // Cross-checks that fill nothing: the TRN, audit firm and audit report date must agree between files.
    for (const [k, label] of [['auditor', 'Audit firm'], ['auditReportDate', 'Audit report date']] as const) {
      const r = resolveFact(evidence, k);
      if (r?.status === 'conflict') conflicts.push(conflictOf(k, label, r.evidence));
    }
    // Why the VAT returns differ from the books (only when nobody has written an explanation).
    const note = evidence.find((e) => e.key === 'vatDifferenceNote');
    if (note && !next.profile.vatDifferenceNote) next.profile.vatDifferenceNote = `${String(note.value)} (${evidenceSource(note)})`;
    next.docConflicts = conflicts;
  }

  // Revenue per VAT returns, when the returns are uploaded.
  // A VAT-returns file, or a VAT-returns sheet inside a workbook read with its detected type.
  const vatFiles = files.filter((f) => (f.kind === 'vat' || (f.kind !== 'ignore' && f.kind === f.detected)) && f.vat?.length);
  const vatRows = vatFiles.flatMap((f) => f.vat ?? []);
  if (vatRows.length) {
    set('vatRevenue', sum(vatRows.map((v) => v.standardRated + v.zeroRated + v.exempt)), {
      kind: 'file',
      source: `VAT returns: ${vatRows.length} period${vatRows.length === 1 ? '' : 's'} (${vatFiles.map((f) => f.name).join(', ')})`,
      cell: false,
    });
  } else if (mode === 'replace' && next.autoFill.vatRevenue && !next.userSet.vatRevenue) {
    writeField(next, 'vatRevenue', undefined);
    delete next.autoFill.vatRevenue;
  }
  return next;
}

/** A profile fact the files disagree on. */
export interface DocConflict {
  field: ProfileField | 'auditor' | 'auditReportDate';
  label: string;
  /** "Company Master!B7 says No; Director_Confirmation.pdf, page 1, line 4 says Yes." */
  text: string;
  items: { value: string; source: string }[];
}

function conflictOf(field: DocConflict['field'], label: string, evidence: Evidence[]): DocConflict {
  const key = evidence[0]?.key as FactKey;
  const items = evidence.map((e) => ({ value: displayValue(e.key, e.key === 'clientName' ? String(e.value) : e.value), source: evidenceSource(e) }));
  const seen = new Set<string>();
  const uniq = items.filter((i) => (seen.has(i.value + i.source) ? false : (seen.add(i.value + i.source), true)));
  const text = `The documents disagree on ${label.toLowerCase()}: ${uniq.map((i) => `${i.source} says “${i.value}”`).join('; ')}.`;
  return { field, label: key === 'freeZone' || key === 'taxGroup' || key === 'qfzp' ? 'Legal form' : label, text, items: uniq };
}

/** Where an answer came from: the clearest source first, then every other file that agrees. */
function markOf(evidence: Evidence[], kind?: AutoMark['kind']): AutoMark {
  const e = evidence[0];
  const files = new Set(evidence.map((x) => x.file));
  const also = [...new Set(evidence.slice(1).filter((x) => x.file !== e.file || x.ref?.cell !== e.ref?.cell).map(evidenceSource))].slice(0, 4);
  return {
    kind: kind ?? (e.strength === 'inferred' ? 'suggested' : 'file'),
    source: e.ref ? refText(e.ref) : e.file,
    cell: !!e.ref,
    text: e.label ? `${e.label}: ${e.text}` : e.text,
    why: e.why,
    file: e.file,
    also: also.length ? also : undefined,
    confirmedBy: files.size > 1 ? files.size : undefined,
  };
}

/** The keyword hints of a file as evidence ("text"; a guess such as "LLC, so mainland" is "inferred"). */
export function hintsToEvidence(f: ParsedFile): Evidence[] {
  const h = f.hints ?? {};
  const out: Evidence[] = [];
  const add = (key: FactKey, value: Evidence['value'], x: { ref?: Hint<unknown>['ref']; text: string; why?: string }) =>
    out.push({ key, value, file: f.name, ref: x.ref, text: x.text, strength: x.why ? 'inferred' : 'text', why: x.why });
  if (h.clientName) add('clientName', cleanCompanyName(h.clientName.value), h.clientName);
  if (h.trn) add('trn', h.trn.value, h.trn);
  if (h.periodStart) add('periodStart', h.periodStart.value, h.periodStart);
  if (h.periodEnd) add('periodEnd', h.periodEnd.value, h.periodEnd);
  if (h.accountingStandard) add('accountingStandard', h.accountingStandard.value, h.accountingStandard);
  if (h.legalForm) {
    const v = h.legalForm.value;
    if (v === 'tax_group') add('taxGroup', true, h.legalForm);
    else if (v === 'qfzp') add('qfzp', true, h.legalForm);
    else if (v === 'free_zone') add('freeZone', true, h.legalForm);
    else add('freeZone', false, h.legalForm);
  }
  if (h.audited) add('audited', true, h.audited);
  if (h.ownershipChange) add('ownershipChange', true, h.ownershipChange);
  if (h.foreign) add('foreign', true, h.foreign);
  if (h.realisation) add('realisationItems', true, h.realisation);
  return out;
}

/** A person changed profile answers: they win from now on, also when files are re-uploaded. */
export function setProfileByUser(ws: Workspace, patch: Partial<Profile> & { clientName?: string; trn?: string }): Workspace {
  const next: Workspace = { ...ws, profile: { ...ws.profile }, autoFill: { ...(ws.autoFill ?? {}) }, userSet: { ...(ws.userSet ?? {}) }, autoNotes: { ...(ws.autoNotes ?? {}) } };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'clientName' || k === 'trn' || (PROFILE_KEYS as string[]).includes(k)) {
      const f = k as ProfileField;
      next.userSet[f] = true;
      delete next.autoFill[f];
      delete next.autoNotes[f];
      writeField(next, f, v);
    } else {
      (next.profile as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return next;
}

// ───────────────────────── Field status (badges and the summary line) ─────────────────────────

export interface FieldState {
  key: string;
  label: string;
  visible: boolean;
  answered: boolean;
  /** Filled from the files and not changed since. */
  auto?: AutoMark;
  /** Set when the answer cannot be changed (with the reason). */
  locked?: string;
  /** Why it is left for a person. */
  reason?: string;
}

const REASONS: Partial<Record<string, string>> = {
  clientName: 'Type the client name. It is never filled in from the files.',
  trn: 'No TRN found in the files.',
  legalForm: 'The files do not show the legal form.',
  accountingStandard: 'The files do not name the accounting standard.',
  periodStart: 'No period dates found in the titles.',
  periodEnd: 'No period dates found in the titles.',
  audited: "No auditor's report found in the files.",
  groupRevenue: 'Not in the financial statements. Tick "Not part of a group" if it is not in one. SBR is not applied until this is answered.',
  vatRevenue: 'Not in the financial statements. Upload the VAT returns or enter the total.',
  electSBR: 'Ask the client whether they elected Small Business Relief.',
  priorPeriodsUnder3M: 'Check the revenue of earlier periods. SBR is not applied until this is answered.',
  electRealisation: 'Decide with the client.',
  electForeignPE: 'Decide with the client.',
  hasForeignIncome: 'Upload the statements, or answer here.',
  hasTaxCertificates: 'Certificates are not part of the financial statements.',
  ownershipChange: 'Nothing in the files mentions a change of ownership. Confirm with the client.',
  ownershipChangeLosses: 'Decide whether the losses can still be used.',
};

export function sbrLockText(): string {
  return `Not available: revenue is above AED ${SETTINGS.sbr.revenueLimit / 1_000_000}M`;
}

/**
 * Status of every profile answer. `profile` is the effective profile (with the SBR lock applied);
 * `sbrLocked` is true when revenue is above the SBR limit.
 */
/** Losses brought forward have been entered. */
export function hasLossesBF(ws: Workspace): boolean {
  return (ws.headline?.lossesBF ?? []).some((r) => r.amount > 0);
}

export function profileFields(ws: Workspace, profile: Profile, sbrLocked: boolean): FieldState[] {
  const p = profile;
  const showForeign = p.hasForeignIncome !== false;
  const isQfzp = p.legalForm === 'qfzp';
  const defs: [string, string, boolean][] = [
    ['clientName', 'Client name', true],
    ['trn', 'TRN', true],
    ['legalForm', 'Legal form', true],
    ['accountingStandard', 'Accounting standard', true],
    ['periodStart', 'Period start', true],
    ['periodEnd', 'Period end', true],
    ['audited', 'Audited', true],
    ['groupRevenue', 'Group revenue', true],
    ['vatRevenue', 'Revenue per VAT returns', true],
    ['electSBR', 'Small Business Relief elected', true],
    ['priorPeriodsUnder3M', 'All earlier periods ≤ AED 3M', true],
    ['electRealisation', 'Realisation basis', true],
    ['hasForeignIncome', 'Foreign income or branch', true],
    ['hasTaxCertificates', 'Foreign tax certificates', showForeign],
    ['electForeignPE', 'Foreign PE exemption elected', showForeign],
    ['ownershipChange', 'Ownership change', true],
    // Only asked when there ARE losses brought forward: with none, the ownership change changes nothing.
    ['ownershipChangeLosses', 'Losses after the ownership change', p.ownershipChange === true && hasLossesBF(ws)],
    ['qfzp.qualifyingIncome', 'Qualifying income (after its share of costs)', isQfzp],
    ['qfzp.nonQualifyingRevenue', 'Non-qualifying revenue', isQfzp],
    ['qfzp.qualifyingActivity', 'Qualifying activity', isQfzp],
    ['qfzp.substance', 'Substance', isQfzp],
    ['qfzp.auditedFS', 'Audited statements (QFZP)', isQfzp],
    ['qfzp.tpCompliance', 'Transfer pricing compliance', isQfzp],
    ['qfzp.noElection', 'No election to be taxed at 9%', isQfzp],
  ];
  const effective: Workspace = { ...ws, profile: p };
  return defs.map(([key, label, visible]) => {
    const value = key.startsWith('qfzp.') ? (p.qfzp as Record<string, unknown>)[key.slice(5)] : readField(effective, key as ProfileField);
    let auto = ws.autoFill?.[key as ProfileField];
    let locked: string | undefined;
    if (key === 'electSBR' && sbrLocked) {
      locked = sbrLockText();
      auto = auto ?? { kind: 'derived', source: 'revenue', cell: false };
    }
    const answered = value !== undefined && value !== '';
    const reason = answered
      ? undefined
      : key === 'clientName' && ws.suggestedClientName
        ? 'Type the client name, or use the name found in the file.'
        : ws.autoNotes?.[key as ProfileField] ?? REASONS[key] ?? 'Not in the files.';
    return { key, label, visible, answered, auto: answered ? auto : undefined, locked, reason };
  });
}

export interface FieldSummary {
  total: number;
  auto: number;
  user: number;
  need: number;
}

export function summariseFields(fields: FieldState[]): FieldSummary {
  const v = fields.filter((f) => f.visible);
  const auto = v.filter((f) => f.answered && f.auto).length;
  const need = v.filter((f) => !f.answered).length;
  return { total: v.length, auto, user: v.length - auto - need, need };
}

/** "12 of 15 answers filled from the file. 3 need you." */
export function summaryText(s: FieldSummary): string {
  const parts = [`${s.auto} of ${s.total} answers filled from the file.`];
  if (s.user) parts.push(`${s.user} answered by you.`);
  parts.push(s.need === 0 ? 'Nothing needs you.' : `${s.need} need${s.need === 1 ? 's' : ''} you.`);
  return parts.join(' ');
}
