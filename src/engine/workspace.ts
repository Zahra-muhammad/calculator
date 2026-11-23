/**
 * Ties the engine together for one client and one period:
 * parsed files → workspace → classified lines → computation → flags → deadlines.
 * Pure: no React, no DOM.
 */
import { applyAutoFill, profileFields, summariseFields, type FieldState, type FieldSummary } from './autofill';
import { classifyLines, detectHiddenVat } from './classify';
import { compute, ctRevenueBreakdown } from './compute';
import { computeVat, type VatResult } from './vat';
import { conversion, convertFile, currencyInfo, type CurrencyChoice } from './currency';
import { deadlines } from './deadlines';
import { allFlags, sortFlags } from './flags';
import { scanGl, type GlSuggestion } from './gl';
import type {
  ClassifiedLine,
  ComputeInput,
  ComputeResult,
  DeadlineResult,
  Flag,
  FsFacts,
  GlTxn,
  ParsedFile,
  Profile,
  SubLine,
  TaxLine,
  Workspace,
} from './types';
import { SETTINGS } from './settings';
import { refText } from './types';
import { aed, round2, sum } from './util';

export function emptyProfile(): Profile {
  return { qfzp: {} };
}

export function emptyWorkspace(): Workspace {
  return {
    clientName: '',
    trn: '',
    profile: emptyProfile(),
    headline: {
      pbt: {},
      revenue: {},
      totalIncome: {},
      sharedOverheads: {},
      otherDeductions: {},
      lossesBF: [],
      interestCF: [],
    },
    tbLines: [],
    mappings: {},
    answers: {},
    subLines: [],
    glDecisions: {},
    vatReturns: [],
    relatedParties: [],
    salesInvoices: [],
    purchaseInvoices: [],
    importInvoices: [],
    vatChoices: {},
    resolved: {},
    cautious: true,
    deadlines: {},
    fsFacts: { auditedText: false, templateTexts: [], formulaErrors: [] },
    autoFill: {},
    userSet: {},
    autoNotes: {},
  };
}

/**
 * Which parts of a parsed file are in use. With the detected type, every sheet is used for what it
 * holds (a test pack with a trial balance, a ledger, a related-parties list and invoice registers uses
 * all of them). When a person picks another type, only that type is used.
 */
export function usedParts(f: ParsedFile) {
  const k = f.kind;
  // VAT: only the VAT parts of the file (registers, imports, filed VAT returns).
  if (k === 'vatdata') return { fs: undefined, tb: undefined, gl: undefined, vat: f.vat, rp: undefined, sales: f.sales, purchases: f.purchases, imports: f.imports };
  const all = k !== 'ignore' && k === f.detected;
  return {
    fs: k === 'fs' || k === 'fs_tb' ? f.fs : undefined,
    tb: k === 'tb' || k === 'fs_tb' ? f.tb : undefined,
    gl: k === 'gl' || all ? f.gl : undefined,
    vat: k === 'vat' || all ? f.vat : undefined,
    rp: k === 'rp' || all ? f.rp : undefined,
    sales: k === 'sales' || all ? f.sales : undefined,
    purchases: k === 'purchases' || all ? f.purchases : undefined,
    imports: k === 'imports' || all ? f.imports : undefined,
  };
}

export function factsFromFiles(files: ParsedFile[]): FsFacts {
  const facts: FsFacts = { auditedText: false, templateTexts: [], formulaErrors: [] };
  for (const f of files) {
    if (f.kind === 'ignore') continue;
    facts.formulaErrors.push(...f.errors);
    const { fs, tb } = usedParts(f);
    if (fs) {
      facts.auditedText ||= fs.auditedText;
      facts.templateTexts.push(...fs.templateTexts);
      facts.totalAssets ??= fs.totalAssets;
      facts.totalEquityLiabilities ??= fs.totalEquityLiabilities;
      facts.foreignText ??= fs.foreignText;
      facts.ociText ??= fs.ociText;
      facts.lossSuggestion ??= fs.lossSuggestion;
      if (facts.pbtPrior === undefined && fs.pbt?.prior !== undefined) facts.pbtPrior = fs.pbt.prior;
      if (fs.revenueWasNegative && fs.revenue) facts.revenueSignFixed ??= fs.revenue.ref;
    }
    if (tb && !facts.tbTotals) facts.tbTotals = { debit: tb.totalDebit, credit: tb.totalCredit, sheet: tb.sheet };
  }
  return facts;
}

/**
 * Put the data from the uploaded files into the workspace. Values a person typed by hand
 * are kept; values read from files are replaced.
 *
 * mode "replace" (default): everything file-based is rebuilt from `files` (used after a
 * file is removed or its type changed). mode "merge": only the parts the files provide are
 * replaced, so adding a VAT file to a reopened client keeps its saved trial balance.
 */
/** The currency to use: a person's choice, otherwise the first currency other than AED named in the files. */
export function currencyFromFiles(ws: Workspace, files: ParsedFile[]): CurrencyChoice {
  if (ws.currency?.byUser) return ws.currency;
  const used = files.filter((f) => f.kind !== 'ignore');
  const found = used.map((f) => f.currency).find((c) => c && c.code !== 'AED') ?? used.map((f) => f.currency).find(Boolean);
  if (!found) return { code: 'AED', rate: 1 };
  return { code: found.code, rate: currencyInfo(found.code)?.pegRate, foundAt: found.ref };
}

/** Files with every amount in AED (unchanged when the files are already in AED or no rate is entered yet). */
export function filesInAed(files: ParsedFile[], currency: CurrencyChoice | undefined): ParsedFile[] {
  const c = conversion(currency);
  return c.convert && c.rate ? files.map((f) => convertFile(f, c.rate!)) : files;
}

export function applyParsedFiles(ws: Workspace, filesIn: ParsedFile[], mode: 'replace' | 'merge' = 'replace'): Workspace {
  const currency = currencyFromFiles(ws, filesIn);
  const files = filesInAed(filesIn, currency);
  const next: Workspace = { ...ws, currency, headline: { ...ws.headline }, profile: { ...ws.profile } };
  const active = files.filter((f) => f.kind !== 'ignore');
  const fs = active.map((f) => usedParts(f).fs).find((x) => x?.pbt) ?? active.map((f) => usedParts(f).fs).find(Boolean);
  const tb = active.map((f) => usedParts(f).tb).find(Boolean);
  const replace = mode === 'replace';

  if (replace || fs || tb) next.fsFacts = factsFromFiles(files);
  if (fs?.pbt && !next.headline.pbt.byHand) next.headline.pbt = { value: fs.pbt.value, ref: { ...fs.pbt.ref, file: fileOf(files, fs) } };
  else if (replace && !fs?.pbt && !next.headline.pbt.byHand) next.headline.pbt = {};
  if (fs?.revenue && !next.headline.revenue.byHand) next.headline.revenue = { value: fs.revenue.value, ref: { ...fs.revenue.ref, file: fileOf(files, fs) } };
  else if (replace && !fs?.revenue && !next.headline.revenue.byHand) next.headline.revenue = {};

  if (tb || replace) next.tbLines = tb?.lines ?? [];
  const vat = active.flatMap((f) => usedParts(f).vat ?? []);
  if (vat.length || replace) next.vatReturns = vat;
  const rp = active.flatMap((f) => usedParts(f).rp ?? []);
  if (rp.length) next.relatedParties = rp;
  const sales = active.flatMap((f) => usedParts(f).sales ?? []);
  if (sales.length || replace) next.salesInvoices = sales;
  const purchases = active.flatMap((f) => usedParts(f).purchases ?? []);
  if (purchases.length || replace) next.purchaseInvoices = purchases;
  const imports = active.flatMap((f) => usedParts(f).imports ?? []);
  if (imports.length || replace) next.importInvoices = imports;
  // Company profile answers found in the files (a person's own answers are kept).
  return applyAutoFill(next, active, mode);
}

function fileOf(files: ParsedFile[], fs: unknown): string | undefined {
  return files.find((f) => f.fs === fs)?.name;
}

export function glFromFiles(filesIn: ParsedFile[], currency?: CurrencyChoice): GlTxn[] {
  const files = filesInAed(filesIn, currency);
  return files.filter((f) => f.kind !== 'ignore').flatMap((f) => usedParts(f).gl ?? []);
}

export function toTaxLines(classified: ClassifiedLine[], subLines: SubLine[]): TaxLine[] {
  const parents = new Map(classified.map((l) => [l.key, l]));
  const main: TaxLine[] = classified.map((l) => ({
    key: l.key,
    account: l.account,
    category: l.category,
    balance: l.balance,
    source: `TB row ${l.row}`,
    relatedParty: l.relatedParty,
    relatedPartyType: l.relatedPartyType,
  }));
  const subs: TaxLine[] = subLines
    .filter((s) => parents.has(s.parentKey))
    .map((s) => ({
      key: s.key,
      account: s.label,
      category: s.category,
      balance: s.amount,
      parentKey: s.parentKey,
      source: s.source === 'gl' ? `GL: ${s.evidence.length} transaction(s) in TB row ${parents.get(s.parentKey)!.row}` : `TB row ${parents.get(s.parentKey)!.row} adjustments`,
    }));
  return [...main, ...subs];
}

/** Profit from the trial balance P&L lines (credit = profit), excluding tax lines below PBT. */
export function tbProfit(classified: ClassifiedLine[]): number {
  return -sum(classified.filter((l) => l.category !== 'balance_sheet' && l.category !== 'below_pbt').map((l) => l.balance));
}

export interface Evaluation {
  classified: ClassifiedLine[];
  hiddenVat: SubLine[];
  subLines: SubLine[];
  taxLines: TaxLine[];
  input: ComputeInput;
  result: ComputeResult;
  flags: Flag[];
  deadlines: DeadlineResult;
  glSuggestions: GlSuggestion[];
  /** VAT from the sales and purchase registers. */
  vat: VatResult;
  pbtSource: string;
  /** The profile the computation used (SBR forced to "No" when revenue is above the limit). */
  profile: Profile;
  sbrLocked: boolean;
  /** Status of every profile answer, for the badges and the summary line. */
  fields: FieldState[];
  fieldSummary: FieldSummary;
}

export function evaluate(ws: Workspace, gl: GlTxn[] = []): Evaluation {
  const classified = classifyLines(ws.tbLines, { mappings: ws.mappings, relatedParties: ws.relatedParties });
  const hiddenVat = detectHiddenVat(classified);
  const subLines = [...hiddenVat, ...ws.subLines.filter((s) => !hiddenVat.some((h) => h.key === s.key))];
  const taxLines = toTaxLines(classified, subLines);

  // Small Business Relief is not available above the revenue limit, whatever was answered. The test uses
  // total revenue for SBR / QFZP tests (revenue, other income, gains, exempt income; never VAT).
  const sbrLocked = ctRevenueBreakdown(taxLines, ws.answers, ws.headline.revenue.value).total > SETTINGS.sbr.revenueLimit;
  const profile: Profile = sbrLocked ? { ...ws.profile, electSBR: false } : ws.profile;
  const fields = profileFields(ws, profile, sbrLocked);

  let pbt = ws.headline.pbt.value;
  let pbtSource = ws.headline.pbt.byHand ? 'Entered by hand' : ws.headline.pbt.ref ? refText(ws.headline.pbt.ref) : '';
  const extraFlags: Flag[] = [];
  if (pbt === undefined && classified.length) {
    pbt = tbProfit(classified);
    pbtSource = 'Trial balance (sum of P&L lines)';
    extraFlags.push({
      id: 'DATA',
      key: 'DATA:pbt-from-tb',
      level: 'DATA',
      message: `PBT taken from the trial balance: no P&L sheet gave profit before tax, so it is the total of the trial balance P&L lines, ${aed(pbt)}.`,
      amount: pbt,
      action: 'Check it against the signed financial statements, or enter PBT by hand.',
    });
  }
  if (pbt === undefined) {
    pbt = 0;
    pbtSource = 'Not found';
  }

  const input: ComputeInput = {
    pbt,
    revenue: ws.headline.revenue.value,
    totalIncome: ws.headline.totalIncome.value,
    sharedOverheads: ws.headline.sharedOverheads.value,
    otherDeductions: ws.headline.otherDeductions.value,
    lines: taxLines,
    answers: ws.answers,
    lossesBF: ws.headline.lossesBF,
    interestCF: ws.headline.interestCF,
    foreignTax: ws.headline.foreignTax,
    profile,
    cautious: ws.cautious,
    registrantType: ws.deadlines.registrantType,
  };
  const result = compute(input);
  // VAT from the sales and purchase registers, checked against revenue in the trial balance.
  const revenueLines = classified.filter((l) => l.category === 'revenue');
  const tbRevenue = revenueLines.length ? -sum(revenueLines.map((l) => l.balance)) : ws.headline.revenue.value;
  const vat = computeVat(ws.salesInvoices ?? [], ws.purchaseInvoices ?? [], ws.vatChoices ?? {}, tbRevenue, ws.importInvoices ?? []);
  const counted = vat.sales.filter((l) => !l.excluded);
  const salesRegisterRevenue = counted.length ? round2(sum(counted.map((l) => l.net))) : undefined;
  // Hidden VAT sub-lines get their one AB-07 flag from compute.ts (vat_expensed), not here.
  let flags = allFlags(input, result, { profile, fsFacts: ws.fsFacts, relatedParties: ws.relatedParties, vatReturns: ws.vatReturns, salesRegisterRevenue });
  flags.push(...extraFlags);
  // Only VAT data (no trial balance, no profit figure): corporate tax checks do not apply yet.
  const ctData = ws.tbLines.length > 0 || ws.headline.pbt.value !== undefined;
  if (!ctData) flags = flags.filter((f) => f.id === 'VAT');
  flags.push(...vat.flags);
  // The uploaded documents disagree: nothing was filled in for that answer; a person decides.
  for (const c of ws.docConflicts ?? []) {
    const decided = c.field !== 'clientName' && c.field !== 'auditor' && c.field !== 'auditReportDate' && ws.userSet?.[c.field];
    if (decided) continue;
    const identity = c.field === 'clientName' || c.field === 'trn';
    flags.push({
      id: 'DOC',
      key: `DOC:${c.field}`,
      level: identity || c.field !== 'auditor' ? 'HIGH' : 'MEDIUM',
      message: identity ? `${c.text} The files may belong to different clients.` : `${c.text} Nothing was filled in for ${c.label.toLowerCase()}.`,
      action: identity ? 'Check that every uploaded file is for this client. Remove the wrong file, or resolve this flag with a note.' : `Check the documents and choose the answer under Profile → ${c.label}.`,
    });
  }
  // Amounts in another currency and no exchange rate yet: nothing is in AED, so nothing is final.
  const cur = conversion(ws.currency);
  if (cur.missingRate) {
    flags.push({
      id: 'CUR',
      key: 'CUR:rate',
      level: 'HIGH',
      message: `The amounts in the files are in ${ws.currency!.code}${ws.currency!.foundAt ? ` (found at ${ws.currency!.foundAt})` : ''}, and no exchange rate to AED is entered. Corporate tax and VAT are worked out in AED, so every figure is wrong until the rate is entered.`,
      action: `Enter the AED rate for 1 ${ws.currency!.code} under Upload files (use the UAE Central Bank rate), or choose AED if the amounts are already in dirhams.`,
    });
  } else if (cur.convert) {
    flags.push({
      id: 'CUR',
      key: 'CUR:converted',
      level: 'INFO',
      message: `Amounts in the files are in ${ws.currency!.code} and were converted to AED at ${cur.rate} AED per 1 ${ws.currency!.code}.`,
      action: 'Check the rate against the UAE Central Bank rate for the period.',
    });
  }
  const sorted = sortFlags(flags);

  const dl = deadlines({
    ...ws.deadlines,
    registrantType: ws.deadlines.registrantType ?? (ws.profile.businessType === 'natural_person' ? 'natural_person' : undefined),
    periodEnd: ws.deadlines.periodEnd ?? ws.profile.periodEnd,
    taxAmount: ws.deadlines.taxAmount ?? result.tax,
  });
  const glSuggestions = gl.length ? scanGl(gl, classified, ws.relatedParties) : [];

  return {
    classified,
    hiddenVat,
    subLines,
    taxLines,
    input,
    result,
    flags: sorted,
    deadlines: dl,
    glSuggestions,
    vat,
    pbtSource,
    profile,
    sbrLocked,
    fields,
    fieldSummary: summariseFields(fields),
  };
}
