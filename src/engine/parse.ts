/**
 * Reads Excel and CSV files in the browser (or in tests) and pulls out what the
 * calculator needs. Every number keeps its sheet and cell so the UI can show where
 * it came from. Nothing is sent anywhere.
 */
import * as XLSX from 'xlsx';
import type {
  CellRef,
  FileKind,
  FormulaError,
  FoundNumber,
  FsData,
  GlTxn,
  InvoiceLine,
  ParsedFile,
  RelatedParty,
  SheetInfo,
  TBLine,
  TbData,
  TemplateText,
  VatReturnRow,
} from './types';
import { detectProfileHints } from './autofill';
import { readFieldTables, readPriorRevenueTable, sentenceEvidence, splitSentences, type Evidence } from './evidence';
import type { PdfPage } from './pdftext';
import { FILE_KIND_LABELS } from './types';
import { detectCurrency } from './currency';
import { SETTINGS } from './settings';
import { norm, parseAmount, parseSignedAmount, round2 } from './util';

// ───────────────────────── Grids ─────────────────────────

export type Cell = string | number | boolean | Date | { error: string } | null;

export interface Grid {
  name: string;
  rows: Cell[][];
  maxCol: number;
}

const MAX_ROWS = 60_000;
const MAX_COLS = 120;

const ERROR_CODES: Record<number, string> = {
  0x00: '#NULL!',
  0x07: '#DIV/0!',
  0x0f: '#VALUE!',
  0x17: '#REF!',
  0x1d: '#NAME?',
  0x24: '#NUM!',
  0x2a: '#N/A',
  0x2b: '#GETTING_DATA',
};

export function isErrorCell(c: Cell): c is { error: string } {
  return !!c && typeof c === 'object' && !(c instanceof Date) && 'error' in c;
}

export function cellText(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (isErrorCell(c)) return c.error;
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c).trim();
}

/** A cell is "text" when it is a non-empty string that is not a number. */
function isText(c: Cell): boolean {
  return typeof c === 'string' && c.trim() !== '' && parseAmount(c) === undefined;
}

export function addr(r: number, c: number): string {
  return XLSX.utils.encode_cell({ r, c });
}

/** Turn a SheetJS worksheet into a plain 2-D array (0-based rows and columns). */
export function sheetToGrid(ws: XLSX.WorkSheet, name: string): Grid {
  const rows: Cell[][] = [];
  let maxCol = -1;
  for (const key of Object.keys(ws)) {
    if (key.startsWith('!')) continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r >= MAX_ROWS || c >= MAX_COLS) continue;
    const cell = ws[key] as XLSX.CellObject;
    let value: Cell = null;
    if (cell.t === 'e') {
      value = { error: cell.w || ERROR_CODES[cell.v as number] || '#ERROR' };
    } else if (cell.t === 'n') {
      value = typeof cell.v === 'number' ? cell.v : null;
    } else if (cell.t === 's') {
      value = cell.v === undefined || cell.v === null ? null : String(cell.v);
    } else if (cell.t === 'b') {
      value = Boolean(cell.v);
    } else if (cell.t === 'd') {
      value = cell.v instanceof Date ? cell.v : null;
    }
    if (value === null) continue;
    if (!rows[r]) rows[r] = [];
    rows[r][c] = value;
    if (c > maxCol) maxCol = c;
  }
  for (let r = 0; r < rows.length; r++) {
    if (!rows[r]) rows[r] = [];
  }
  return { name, rows, maxCol };
}

export function gridsFromWorkbook(wb: XLSX.WorkBook): Grid[] {
  return wb.SheetNames.map((n) => sheetToGrid(wb.Sheets[n], n));
}

/** Read file bytes (xlsx, xls, csv) into grids. */
export function readGrids(data: ArrayBuffer | Uint8Array, fileName: string): Grid[] {
  const isCsv = /\.(csv|txt)$/i.test(fileName);
  if (isCsv) {
    const text = new TextDecoder('utf-8').decode(data instanceof Uint8Array ? data : new Uint8Array(data));
    const wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', cellDates: true, raw: false });
    return gridsFromWorkbook(wb);
  }
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  return gridsFromWorkbook(wb);
}

function get(g: Grid, r: number, c: number): Cell {
  return g.rows[r]?.[c] ?? null;
}

function ref(g: Grid, r: number, c: number): CellRef {
  return { sheet: g.name, cell: addr(r, c) };
}

// ───────────────────────── Formula errors and text ─────────────────────────

export function findFormulaErrors(grids: Grid[]): FormulaError[] {
  const out: FormulaError[] = [];
  for (const g of grids) {
    g.rows.forEach((row, r) =>
      row.forEach((c, col) => {
        if (isErrorCell(c)) out.push({ sheet: g.name, cell: addr(r, col), error: c.error });
      }),
    );
  }
  return out;
}

// ───────────────────────── Financial statements ─────────────────────────

const PBT_RE = /\b(profit|loss|income|earnings|surplus|deficit)\b.*\bbefore\b.*\b(tax|taxation|taxes|zakat)\b/;
const REVENUE_RE = /^(total )?(revenue|revenues|sales|turnover|net sales|net revenue|net revenues|net turnover|total sales)( from contracts? with customers)?$/;
const LOSS_YEAR_RE = /^tax loss(es)? for the (year|period)$/;
const LOSS_BF_RE = /^(tax )?loss(es)? brought forward$|^tax losses? b f$|^opening tax loss(es)?$/;
const TOTAL_ASSETS_RE = /^total assets$/;
const TOTAL_EL_RE =
  /^total (equity and liabilities|liabilities and equity|equity and liability|liabilities and shareholders equity|shareholders equity and liabilities|liabilities and owners equity|equity and liabilities and)$/;

/** Is this a note number (small positive integer) rather than an amount? */
function isNoteNumber(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 50;
}

/** Numbers to the right of a label, skipping a leading note number. */
function numbersRight(g: Grid, r: number, c: number): { value: number; col: number }[] {
  const out: { value: number; col: number }[] = [];
  for (let col = c + 1; col <= g.maxCol; col++) {
    const cell = get(g, r, col);
    if (cell === null || isErrorCell(cell)) continue;
    const n = parseAmount(cell);
    if (n === undefined) continue;
    out.push({ value: n, col });
  }
  if (out.length >= 2 && isNoteNumber(out[0].value)) out.shift();
  return out;
}

function findLabel(grids: Grid[], test: (t: string) => boolean, pick: 'first' | 'second' = 'first'): FoundNumber | undefined {
  for (const g of grids) {
    for (let r = 0; r < g.rows.length; r++) {
      const row = g.rows[r];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (!isText(cell)) continue;
        const t = norm(cell);
        if (t.length > 90 || !test(t)) continue;
        const nums = numbersRight(g, r, c);
        const idx = pick === 'first' ? 0 : 1;
        if (nums.length <= idx) continue;
        const hit = nums[idx];
        const next = nums[idx + 1];
        return {
          value: hit.value,
          ref: ref(g, r, hit.col),
          label: cellText(cell),
          prior: next?.value,
          priorRef: next ? ref(g, r, next.col) : undefined,
        };
      }
    }
  }
  return undefined;
}

const PL_SHEET_RE = /(profit|loss|p\s*&\s*l|\bpl\b|income|comprehensive|performance)/i;
const BS_SHEET_RE = /(balance|financial position|\bbs\b|sofp)/i;
/** A P&L heading inside a sheet (a short cell that starts with it), e.g. "Statement of profit or loss for the year…". */
const PL_TITLE_RE = /^(statement of (profit or loss|profit and loss|comprehensive income|income)|income statement|profit and loss( account| statement)?)\b/;

function preferSheets(grids: Grid[], re: RegExp): Grid[] {
  return [...grids.filter((g) => re.test(g.name)), ...grids.filter((g) => !re.test(g.name))];
}

/** A profit and loss sheet: named like one, or with a P&L heading in it. */
function isPlSheet(g: Grid): boolean {
  if (PL_SHEET_RE.test(g.name)) return true;
  return g.rows.some((row) => row.some((cell) => isText(cell) && cellText(cell).length <= 120 && PL_TITLE_RE.test(norm(cell))));
}

/**
 * Sheets that hold someone's expected answers ("Expected Results", "Answers", "Answer key"). Nothing is
 * ever read from them: not numbers, not profile facts, not formula errors.
 */
export function isAnswerSheet(name: string): boolean {
  return /\b(expected|answers?|answer key)\b/.test(norm(name));
}

/** Sheet names of this calculator's own Excel export (export.ts). */
const EXPORT_SHEETS = ['computation', 'add backs detail', 'settings used'];

export const EXPORT_REFUSED_MESSAGE = 'This is a calculator export, not client accounts. Upload the original trial balance.';

/** Thrown when a file must not be read (for example this calculator's own export). */
export class RefusedFileError extends Error {}

/** True when the workbook is this calculator's own export (two or more of its sheet names). */
export function isCalculatorExport(sheetNames: string[]): boolean {
  const names = new Set(sheetNames.map((n) => norm(n)));
  return EXPORT_SHEETS.filter((s) => names.has(s)).length >= 2;
}

export function extractFs(grids: Grid[]): FsData {
  const pl = preferSheets(grids, PL_SHEET_RE);
  const bs = preferSheets(grids, BS_SHEET_RE);
  // Profit before tax only ever comes from a P&L sheet. Without one, it is worked out from the trial balance.
  const pbt = findLabel(pl.filter(isPlSheet), (t) => PBT_RE.test(t) && !/\bafter\b/.test(t));
  let revenue = findLabel(pl, (t) => REVENUE_RE.test(t) || t === 'revenue from contracts with customers');
  // Revenue is never negative: some statements show it in brackets. Use the absolute value and say so.
  let revenueWasNegative = false;
  if (revenue && revenue.value < 0) {
    revenueWasNegative = true;
    revenue = { ...revenue, value: Math.abs(revenue.value), prior: revenue.prior === undefined ? undefined : Math.abs(revenue.prior) };
  }
  const lossFromYear = findLabel(grids, (t) => LOSS_YEAR_RE.test(t), 'second');
  const lossBf = findLabel(grids, (t) => LOSS_BF_RE.test(t));
  const totalAssets = findLabel(bs, (t) => TOTAL_ASSETS_RE.test(t));
  const totalEquityLiabilities = findLabel(bs, (t) => TOTAL_EL_RE.test(t));

  let auditedText = false;
  const templateTexts: TemplateText[] = [];
  let foreignText: CellRef | undefined;
  let ociText: CellRef | undefined;
  for (const g of grids) {
    g.rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (typeof cell !== 'string') return;
        const t = norm(cell);
        if (!t) return;
        if (/independent auditors? report/.test(t)) auditedText = true;
        if (/small business relief/.test(t)) templateTexts.push({ topic: 'sbr', text: cellText(cell).slice(0, 200), ref: ref(g, r, c) });
        if (/qualifying free zone person/.test(t)) templateTexts.push({ topic: 'qfzp', text: cellText(cell).slice(0, 200), ref: ref(g, r, c) });
        if (!foreignText && /\b(foreign|overseas) (branch|income|dividends?|subsidiary)\b|branch outside the uae/.test(t)) foreignText = ref(g, r, c);
        if (!ociText && /^(items of )?other comprehensive (income|loss)\b/.test(t) && !/total/.test(t)) {
          const nums = numbersRight(g, r, c);
          if (nums.some((n) => n.value !== 0)) ociText = ref(g, r, c);
        }
      }),
    );
  }

  let lossSuggestion: FoundNumber | undefined;
  if (lossBf && lossBf.value !== 0) lossSuggestion = { ...lossBf, value: Math.abs(lossBf.value) };
  else if (lossFromYear && lossFromYear.value !== 0) lossSuggestion = { ...lossFromYear, value: Math.abs(lossFromYear.value) };

  return { pbt, revenue, revenueWasNegative, lossSuggestion, totalAssets, totalEquityLiabilities, auditedText, templateTexts, foreignText, ociText };
}

// ───────────────────────── Trial balance ─────────────────────────

const DEBIT_RE = /^(debit|debits|dr)( aed| amount| balance| bal)?$|^debit\b/;
const CREDIT_RE = /^(credit|credits|cr)( aed| amount| balance| bal)?$|^credit\b/;

interface HeaderInfo {
  row: number;
  pairs: number[]; // debit column of each pair
}

function findDebitCreditHeader(g: Grid, maxScan = 60): HeaderInfo | undefined {
  for (let r = 0; r < Math.min(g.rows.length, maxScan); r++) {
    const row = g.rows[r];
    const pairs: number[] = [];
    for (let c = 0; c < row.length; c++) {
      if (DEBIT_RE.test(norm(row[c])) && CREDIT_RE.test(norm(row[c + 1]))) pairs.push(c);
    }
    if (pairs.length) return { row: r, pairs };
  }
  return undefined;
}

function pairLabel(g: Grid, header: number, col: number): string {
  const parts: string[] = [];
  for (const r of [header - 2, header - 1]) {
    if (r < 0) continue;
    for (const c of [col, col + 1, col - 1]) {
      const t = cellText(get(g, r, c));
      if (t && isText(get(g, r, c))) {
        parts.push(t);
        break;
      }
    }
  }
  parts.push(cellText(get(g, header, col)));
  return parts.join(' ').trim();
}

export function lineKey(account: string): string {
  return norm(account) || 'line';
}

// One signed column ("Balance", "Closing Balance", "Net", "Amount", "Net Balance") instead of Debit/Credit.
const BALANCE_HEAD_RE = /^(balance|closing balance|net|amount|net balance|closing|net amount)( aed)?$/;
const ACCOUNT_HEAD_RE = /^(account|accounts|account name|account title|account description|particulars|description|ledger|ledger account|ledger name|gl account|name|account head|head of account)$/;

interface SingleHeader {
  row: number;
  nameCol: number;
  amountCol: number;
}

function findSingleColumnHeader(g: Grid, maxScan = 60): SingleHeader | undefined {
  // Statements contain "Profit before tax" or "Total assets"; a trial balance does not.
  const statements = g.rows.some((row) => row.some((c) => typeof c === 'string' && (PBT_RE.test(norm(c)) || TOTAL_ASSETS_RE.test(norm(c)))));
  if (statements) return undefined;
  for (let r = 0; r < Math.min(g.rows.length, maxScan); r++) {
    const row = g.rows[r];
    const amountCols = row.map((c, i) => (BALANCE_HEAD_RE.test(norm(c)) ? i : -1)).filter((i) => i >= 0);
    if (amountCols.length !== 1) continue;
    const amountCol = amountCols[0];
    const nameCols = row.map((c, i) => (i < amountCol && ACCOUNT_HEAD_RE.test(norm(c)) ? i : -1)).filter((i) => i >= 0);
    if (!nameCols.length) continue;
    // The account column with the most text under it wins (names beat codes).
    let nameCol = nameCols[0];
    let best = -1;
    for (const c of nameCols) {
      let chars = 0;
      for (let i = r + 1; i < g.rows.length; i++) {
        const cell = get(g, i, c);
        if (isText(cell)) chars += cellText(cell).length;
      }
      if (chars > best) {
        best = chars;
        nameCol = c;
      }
    }
    return { row: r, nameCol, amountCol };
  }
  return undefined;
}

const TOTAL_ROW_RE = /^(grand )?total\b|^totals?$|^net (profit|loss)\b|^difference$/;

function uniqueKey(seen: Map<string, number>, account: string, row: number): string {
  let key = lineKey(account);
  const count = seen.get(key) ?? 0;
  seen.set(key, count + 1);
  if (count > 0) key = `${key}#${row}`;
  return key;
}

/** Trial balance with one signed column: positive (or "Dr") = debit, negative (or "Cr") = credit. */
function extractSingleColumnTb(g: Grid): TbData | undefined {
  const h = findSingleColumnHeader(g);
  if (!h) return undefined;
  const lines: TBLine[] = [];
  const seen = new Map<string, number>();
  let totalDebit = 0;
  let totalCredit = 0;
  for (let r = h.row + 1; r < g.rows.length; r++) {
    const account = cellText(get(g, r, h.nameCol));
    if (!account || !isText(get(g, r, h.nameCol))) continue;
    if (TOTAL_ROW_RE.test(norm(account))) continue;
    const v = parseSignedAmount(get(g, r, h.amountCol));
    if (v === undefined || v === 0) continue;
    const debit = v > 0 ? v : 0;
    const credit = v < 0 ? -v : 0;
    totalDebit += debit;
    totalCredit += credit;
    lines.push({ key: uniqueKey(seen, account, r + 1), row: r + 1, sheet: g.name, account, debit, credit, balance: v, comment: cellText(get(g, r, h.amountCol + 1)) });
  }
  if (!lines.length) return undefined;
  return {
    sheet: g.name,
    headerRow: h.row + 1,
    nameCol: h.nameCol,
    debitCol: h.amountCol,
    creditCol: h.amountCol,
    commentCol: h.amountCol + 1,
    pairLabels: ['Balance (one signed column)'],
    hasAdjustments: false,
    singleColumn: true,
    lines,
    totalDebit,
    totalCredit,
  };
}

export function extractTb(g: Grid): TbData | undefined {
  const header = findDebitCreditHeader(g);
  if (!header) return extractSingleColumnTb(g);
  const first = header.pairs[0];
  const last = header.pairs[header.pairs.length - 1];
  const dataStart = header.row + 1;

  // Account name: the text column left of the first pair with the most text.
  let nameCol = -1;
  let best = 0;
  for (let c = 0; c < first; c++) {
    let chars = 0;
    for (let r = dataStart; r < g.rows.length; r++) {
      const cell = get(g, r, c);
      if (isText(cell)) chars += cellText(cell).length;
    }
    if (chars > best) {
      best = chars;
      nameCol = c;
    }
  }
  if (nameCol < 0) return undefined;

  const commentCol = last + 2;
  const pairLabels = header.pairs.map((c) => pairLabel(g, header.row, c));
  const adjIdx = header.pairs.findIndex((_, i) => i < header.pairs.length - 1 && /adj/i.test(pairLabels[i]));
  const adjCol = adjIdx >= 0 ? header.pairs[adjIdx] : undefined;

  const lines: TBLine[] = [];
  const seen = new Map<string, number>();
  let totalDebit = 0;
  let totalCredit = 0;
  for (let r = dataStart; r < g.rows.length; r++) {
    const account = cellText(get(g, r, nameCol));
    if (!account || !isText(get(g, r, nameCol))) continue;
    if (TOTAL_ROW_RE.test(norm(account))) continue;
    const debit = parseAmount(get(g, r, last)) ?? 0;
    const credit = parseAmount(get(g, r, last + 1)) ?? 0;
    if (debit === 0 && credit === 0) continue;
    totalDebit += debit;
    totalCredit += credit;
    const key = uniqueKey(seen, account, r + 1);
    const line: TBLine = {
      key,
      row: r + 1,
      sheet: g.name,
      account,
      debit,
      credit,
      balance: debit - credit,
      comment: cellText(get(g, r, commentCol)),
    };
    if (adjCol !== undefined) {
      line.adjDebit = parseAmount(get(g, r, adjCol)) ?? 0;
      line.adjCredit = parseAmount(get(g, r, adjCol + 1)) ?? 0;
    }
    lines.push(line);
  }
  if (!lines.length) return undefined;
  return {
    sheet: g.name,
    headerRow: header.row + 1,
    nameCol,
    debitCol: last,
    creditCol: last + 1,
    commentCol,
    pairLabels,
    hasAdjustments: adjCol !== undefined,
    lines,
    totalDebit,
    totalCredit,
  };
}

// ───────────────────────── General ledger ─────────────────────────

function findCols(row: Cell[], tests: Record<string, RegExp>): Record<string, number> {
  const out: Record<string, number> = {};
  row.forEach((cell, c) => {
    const t = norm(cell);
    if (!t) return;
    for (const [k, re] of Object.entries(tests)) {
      if (out[k] === undefined && re.test(t)) {
        out[k] = c;
        break;
      }
    }
  });
  return out;
}

const GL_TESTS = {
  date: /^(date|txn date|transaction date|posting date|voucher date|entry date|doc date)$/,
  account: /^(account|account name|ledger|ledger account|gl account|account title|account description)$/,
  description: /^(description|narration|details|particulars|memo|remarks|transaction description|narrative)$/,
  debit: DEBIT_RE,
  credit: CREDIT_RE,
  amount: /^(amount|amount aed|net amount|value)$/,
};

function toIsoDate(c: Cell): string | undefined {
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  if (typeof c === 'number' && c > 20000 && c < 80000) {
    const d = XLSX.SSF.parse_date_code(c);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const t = cellText(c);
  return t || undefined;
}

export function extractGl(g: Grid): GlTxn[] | undefined {
  for (let r = 0; r < Math.min(g.rows.length, 40); r++) {
    const cols = findCols(g.rows[r], GL_TESTS);
    const hasMoney = (cols.debit !== undefined && cols.credit !== undefined) || cols.amount !== undefined;
    if (cols.date === undefined || cols.description === undefined || !hasMoney) continue;
    const out: GlTxn[] = [];
    let currentAccount = '';
    for (let i = r + 1; i < g.rows.length; i++) {
      const row = g.rows[i];
      if (!row || !row.length) continue;
      const acc = cols.account !== undefined ? cellText(get(g, i, cols.account)) : '';
      if (acc) currentAccount = acc;
      const description = cellText(get(g, i, cols.description));
      let debit = 0;
      let credit = 0;
      if (cols.debit !== undefined) {
        debit = parseAmount(get(g, i, cols.debit)) ?? 0;
        credit = parseAmount(get(g, i, cols.credit)) ?? 0;
      } else {
        const a = parseAmount(get(g, i, cols.amount)) ?? 0;
        if (a >= 0) debit = a;
        else credit = -a;
      }
      if (debit === 0 && credit === 0) continue;
      if (/^(total|opening balance|closing balance|balance b f|balance c f)\b/.test(norm(description)) && !acc) continue;
      out.push({
        row: i + 1,
        date: toIsoDate(get(g, i, cols.date)),
        account: acc || currentAccount,
        description,
        debit,
        credit,
        amount: debit - credit,
      });
    }
    return out.length ? out : undefined;
  }
  return undefined;
}

// ───────────────────────── VAT returns ─────────────────────────

const VAT_TESTS = {
  period: /^(tax )?(period|return period|month|quarter|vat period|period ending|period end)\b/,
  zero: /zero rated/,
  exempt: /\bexempt\b/,
  input: /recoverable|input tax|input vat|vat on (purchases|expenses)/,
};

export function extractVat(g: Grid): VatReturnRow[] | undefined {
  for (let r = 0; r < Math.min(g.rows.length, 40); r++) {
    const row = g.rows[r];
    const cols = findCols(row, VAT_TESTS);
    const standardCols: number[] = [];
    row.forEach((cell, c) => {
      const t = norm(cell);
      if (/standard rated/.test(t) && !/(vat|tax) amount|output tax|expense|purchase|input|recoverable/.test(t)) standardCols.push(c);
    });
    // A summary without a "standard rated" column: "Sales excl VAT", "Taxable supplies (net)" is the sales figure.
    const salesCols: number[] = [];
    row.forEach((cell, c) => {
      const t = norm(cell);
      if (/^(?:net )?(?:sales|supplies|taxable (?:sales|supplies)|outputs?)\b/.test(t) && /excl|exclusive|net|before vat|value/.test(t) && !/zero|exempt|input|purchase|vat amount|output vat|output tax/.test(t)) salesCols.push(c);
    });
    if (!standardCols.length && salesCols.length) standardCols.push(salesCols[0]);
    const outputCol = row.findIndex((cell) => /^output (?:vat|tax)\b/.test(norm(cell)));
    const found = [standardCols.length > 0, cols.zero !== undefined, cols.exempt !== undefined, cols.input !== undefined, outputCol >= 0 && cols.period !== undefined].filter(Boolean).length;
    if (found < 2) continue;
    const periodCol = cols.period ?? 0;
    const out: VatReturnRow[] = [];
    for (let i = r + 1; i < g.rows.length; i++) {
      const period = cellText(get(g, i, periodCol));
      if (!period || /^total/.test(norm(period))) continue;
      const read = (c?: number) => (c === undefined ? 0 : parseAmount(get(g, i, c)) ?? 0);
      const v: VatReturnRow = {
        row: i + 1,
        period: toIsoDate(get(g, i, periodCol)) ?? period,
        standardRated: standardCols.reduce((a, c) => a + read(c), 0),
        zeroRated: read(cols.zero),
        exempt: read(cols.exempt),
        inputTax: read(cols.input),
      };
      if (v.standardRated || v.zeroRated || v.exempt || v.inputTax) out.push(v);
    }
    return out.length ? out : undefined;
  }
  return undefined;
}

// ───────────────────────── Related parties ─────────────────────────

const RP_TESTS = {
  name: /^(name|party|party name|related party|full name|entity|entity name)$/,
  type: /^(type|party type|entity type|company person|person company)$/,
  relationship: /^(relationship|relation|nature of relationship|relationship type)$/,
  connectedTo: /^(connected to|related to|belongs to|owner|connected person|linked to)$/,
};

const PERSON_REL_RE = /director|owner|shareholder|partner|wife|husband|spouse|brother|sister|son|daughter|father|mother|relative|cousin|uncle|aunt|nephew|niece|manager|proprietor/;
const COMPANY_NAME_RE = /\b(llc|l l c|fze|fzco|fz llc|ltd|limited|co|company|trading|group|holding|holdings|inc|plc|est|establishment|dmcc|bv|gmbh|sa)\b/;

export function extractRelatedParties(g: Grid): RelatedParty[] | undefined {
  for (let r = 0; r < Math.min(g.rows.length, 40); r++) {
    const cols = findCols(g.rows[r], RP_TESTS);
    if (cols.name === undefined || cols.relationship === undefined) continue;
    const out: RelatedParty[] = [];
    for (let i = r + 1; i < g.rows.length; i++) {
      const name = cellText(get(g, i, cols.name));
      if (!name) continue;
      const relationship = cellText(get(g, i, cols.relationship));
      const typeText = norm(cols.type !== undefined ? cellText(get(g, i, cols.type)) : '');
      let type: RelatedParty['type'];
      if (/person|individual|natural/.test(typeText)) type = 'person';
      else if (/company|entity|corporate|business/.test(typeText)) type = 'company';
      else type = PERSON_REL_RE.test(norm(relationship)) && !COMPANY_NAME_RE.test(norm(name)) ? 'person' : 'company';
      const connectedTo = cols.connectedTo !== undefined ? cellText(get(g, i, cols.connectedTo)) || undefined : undefined;
      out.push({ name, type, relationship, connectedTo });
    }
    return out.length ? out : undefined;
  }
  return undefined;
}

// ───────────────────────── Sales and purchase registers ─────────────────────────

const REG_TESTS = {
  number: /^(tax )?(invoice|receipt|bill|document|doc|voucher|credit note)( no| number| num| ref| reference)?$|^(inv|rcpt) no$/,
  date: /^((invoice|receipt|document|doc|transaction|txn|supply) )?date$/,
  customer: /^(customer|client|buyer|customer name|client name|sold to|bill to)$/,
  supplier: /^(supplier|vendor|seller|payee|supplier name|vendor name|merchant)$/,
  trn: /\btrn\b|\btax registration (number|no)\b/,
  description: /^(description|details|particulars|item|items|narration|memo)$/,
  category: /^(business purpose|purpose|category|expense category|nature)$/,
  net: /^(net|net amount|taxable amount|taxable value|amount (excl|excluding) vat|amount before vat|value (excl|excluding) vat)( aed)?$/,
  rate: /^((vat|tax) )?rate( %)?$/,
  vat: /^(vat|vat amount|tax amount|output vat|input vat)( aed)?$|^tax aed$/,
  gross: /^(gross|gross amount|total|total amount|amount (incl|including) vat|total (incl|including) vat|invoice total)( aed)?$/,
  status: /^(input vat|vat) (status|treatment)$|^recoverability$/,
  emirate: /^(emirate|emirate of supply|place of supply|location of supply)$/,
  supplyType: /^(supply type|type of supply|supply category|vat category|tax category|output vat treatment|sales type)$/,
};

const SALES_NAME_RE = /\b(sales|output|customers?|revenue)\b/;
const PURCHASE_NAME_RE = /\b(purchases?|receipts?|expenses?|suppliers?|vendors?|input|bills?)\b/;

/** "5%", 5, 0.05 → 0.05. */
function parseRate(c: Cell): number | undefined {
  if (c === null || isErrorCell(c)) return undefined;
  const pctText = typeof c === 'string' && c.includes('%');
  const n = parseAmount(typeof c === 'string' ? c.replace('%', '') : c);
  if (n === undefined) return undefined;
  return pctText || n > 1 ? n / 100 : n;
}

/**
 * A sales or purchase register: a sheet with an invoice/receipt number, net and VAT columns, and a
 * gross or rate column. A customer column (or a sales-like sheet name) makes it sales; a supplier
 * column, an input VAT status column or a purchase-like sheet name makes it purchases.
 */
export function extractRegister(g: Grid, as?: 'sales' | 'purchases'): { kind: 'sales' | 'purchases'; lines: InvoiceLine[] } | undefined {
  for (let r = 0; r < Math.min(g.rows.length, 40); r++) {
    const cols = findCols(g.rows[r], REG_TESTS);
    if (cols.number === undefined || cols.net === undefined || cols.vat === undefined) continue;
    if (cols.gross === undefined && cols.rate === undefined) continue;
    const name = norm(g.name);
    const kind: 'sales' | 'purchases' | undefined =
      as ??
      (cols.customer !== undefined
        ? 'sales'
        : cols.supplier !== undefined || cols.status !== undefined
          ? 'purchases'
          : SALES_NAME_RE.test(name)
            ? 'sales'
            : PURCHASE_NAME_RE.test(name)
              ? 'purchases'
              : undefined);
    if (!kind) continue;
    const partyCol = cols.customer ?? cols.supplier;
    const lines: InvoiceLine[] = [];
    for (let i = r + 1; i < g.rows.length; i++) {
      const number = cellText(get(g, i, cols.number));
      if (!number || /^(total|totals|grand total)\b/.test(norm(number))) continue;
      const net = parseAmount(get(g, i, cols.net));
      const vat = parseAmount(get(g, i, cols.vat)) ?? 0;
      if (net === undefined && !vat) continue;
      const trn = cols.trn !== undefined ? cellText(get(g, i, cols.trn)) : '';
      lines.push({
        key: `${g.name}!${i + 1}`,
        sheet: g.name,
        row: i + 1,
        number,
        date: cols.date !== undefined ? toIsoDate(get(g, i, cols.date)) : undefined,
        party: partyCol !== undefined ? cellText(get(g, i, partyCol)) : '',
        trn: trn || undefined,
        trnColumn: cols.trn !== undefined,
        description: cols.description !== undefined ? cellText(get(g, i, cols.description)) : '',
        category: cols.category !== undefined ? cellText(get(g, i, cols.category)) || undefined : undefined,
        net: net ?? 0,
        rate: cols.rate !== undefined ? parseRate(get(g, i, cols.rate)) : undefined,
        vat,
        gross: cols.gross !== undefined ? parseAmount(get(g, i, cols.gross)) : undefined,
        status: cols.status !== undefined ? cellText(get(g, i, cols.status)) || undefined : undefined,
        emirate: cols.emirate !== undefined ? cellText(get(g, i, cols.emirate)) || undefined : undefined,
        supplyType: cols.supplyType !== undefined ? cellText(get(g, i, cols.supplyType)) || undefined : undefined,
      });
    }
    return lines.length ? { kind, lines } : undefined;
  }
  return undefined;
}

// ───────────────────────── Imports (reverse charge and customs) ─────────────────────────

const IMPORT_TESTS = {
  number: /^(ref|reference|ref no|import ref|invoice|invoice no|invoice number|document no|doc no|bill no)$/,
  date: /^((invoice|import|document|doc|clearance|supply) )?date$/,
  supplier: /^(supplier|vendor|seller|supplier name|vendor name|exporter)$/,
  country: /^(country|country of origin|origin|supplier country)$/,
  description: /^(description|details|particulars|item|items|narration|memo)$/,
  type: /^(type|import type|type of import|nature|category|vat treatment)$/,
  customs: /\b(customs|declaration|bill of entry)\b/,
  net: /^(value|value aed|customs value|net|net amount|net aed|amount|amount aed|taxable value|taxable amount)$/,
  rate: /^((vat|tax) )?rate( %)?$/,
  vat: /^(vat|vat amount|vat aed|import vat|vat due|tax amount)$/,
};

const IMPORT_NAME_RE = /\bimports?\b|\breverse charge\b|\bcustoms\b/;

/** "Import of services – reverse charge" → services; "Import of goods – customs" (or a customs number) → goods. */
function importTypeOf(text: string, customsNo: string): 'services' | 'goods' | undefined {
  const t = norm(text);
  if (/\bservices?\b|\breverse charge\b|\bsubscription\b|\bsoftware\b|\bconsult/.test(t)) return 'services';
  if (/\bgoods?\b|\bcustoms\b|\bshipment\b|\bcargo\b/.test(t) || customsNo) return 'goods';
  return undefined;
}

/**
 * Imports on which the company accounts for VAT itself: services from abroad (reverse charge, VAT return
 * Box 3) and goods cleared through UAE customs (Box 6). The same VAT is also input VAT (Box 10).
 * A sheet counts when it is named like imports, or has a customs column, or its type column says import.
 */
export function extractImports(g: Grid): InvoiceLine[] | undefined {
  for (let r = 0; r < Math.min(g.rows.length, 40); r++) {
    const cols = findCols(g.rows[r], IMPORT_TESTS);
    if (cols.net === undefined || cols.vat === undefined || cols.number === undefined) continue;
    const typeTexts = cols.type !== undefined ? g.rows.slice(r + 1).map((row) => norm(row[cols.type!])) : [];
    const looksImport =
      IMPORT_NAME_RE.test(norm(g.name)) || cols.customs !== undefined || typeTexts.some((t) => /\bimport|\breverse charge\b/.test(t));
    if (!looksImport) continue;
    const lines: InvoiceLine[] = [];
    for (let i = r + 1; i < g.rows.length; i++) {
      const number = cellText(get(g, i, cols.number));
      if (!number || /^(total|totals|grand total)\b/.test(norm(number))) continue;
      const net = parseAmount(get(g, i, cols.net));
      let vat = parseAmount(get(g, i, cols.vat));
      if (net === undefined && !vat) continue;
      const rate = cols.rate !== undefined ? parseRate(get(g, i, cols.rate)) : undefined;
      if (vat === undefined) vat = round2((net ?? 0) * (rate ?? SETTINGS.vatRate));
      const customsNo = cols.customs !== undefined ? cellText(get(g, i, cols.customs)) : '';
      const typeText = cols.type !== undefined ? cellText(get(g, i, cols.type)) : '';
      const description = cols.description !== undefined ? cellText(get(g, i, cols.description)) : '';
      lines.push({
        key: `${g.name}!${i + 1}`,
        sheet: g.name,
        row: i + 1,
        number,
        date: cols.date !== undefined ? toIsoDate(get(g, i, cols.date)) : undefined,
        party: cols.supplier !== undefined ? cellText(get(g, i, cols.supplier)) : '',
        trnColumn: false,
        description,
        category: cols.country !== undefined ? cellText(get(g, i, cols.country)) || undefined : undefined,
        net: net ?? 0,
        rate,
        vat,
        supplyType: typeText || undefined,
        importType: importTypeOf(typeText || description, customsNo),
        customsNo: customsNo || undefined,
      });
    }
    return lines.length ? lines : undefined;
  }
  return undefined;
}

// ───────────────────────── Whole file ─────────────────────────

type SheetKind = 'rp' | 'vat' | 'sales' | 'purchases' | 'imports' | 'gl' | 'tb' | 'other';

/** What one sheet holds. Registers come before the ledger test, which would also accept their date and amount columns. */
function sheetKind(g: Grid): SheetKind {
  if (extractRelatedParties(g)) return 'rp';
  if (extractImports(g)) return 'imports';
  const reg = extractRegister(g);
  if (reg) return reg.kind;
  if (extractVat(g)) return 'vat';
  if (extractGl(g)) return 'gl';
  if (findDebitCreditHeader(g) || findSingleColumnHeader(g)) return 'tb';
  return 'other';
}

/**
 * Pull everything out of a workbook. With `forced`, the person has told us the file type,
 * so every sheet is tried for that type.
 */
export function extractFromGrids(allGrids: Grid[], fileName: string, forced?: FileKind): ParsedFile {
  if (isCalculatorExport(allGrids.map((g) => g.name))) throw new RefusedFileError(EXPORT_REFUSED_MESSAGE);
  // Never read anything from an "Expected Results" or "Answers" sheet.
  const skipped = allGrids.filter((g) => isAnswerSheet(g.name));
  const grids = allGrids.filter((g) => !isAnswerSheet(g.name));
  const kinds = grids.map(sheetKind);
  const warnings: string[] = [];
  if (skipped.length) {
    warnings.push(`Not read: ${skipped.map((g) => `"${g.name}"`).join(', ')}. Numbers are never taken from an expected-results or answers sheet.`);
  }
  const errors = findFormulaErrors(grids).map((e) => ({ ...e, file: fileName }));
  const want = (k: FileKind) =>
    !forced || forced === k || (forced === 'fs_tb' && (k === 'fs' || k === 'tb')) || (forced === 'vatdata' && (k === 'sales' || k === 'purchases' || k === 'imports' || k === 'vat'));
  // A type picked by hand makes every sheet count as that type, except "VAT", which keeps each sheet's own kind.
  const anySheet = !!forced && forced !== 'vatdata';
  const pick = (k: SheetKind) => grids.filter((_, i) => (anySheet ? true : kinds[i] === k));

  let tb: TbData | undefined;
  if (want('tb')) {
    for (const g of pick('tb')) {
      tb = extractTb(g);
      if (tb) break;
    }
  }
  let gl: GlTxn[] | undefined;
  if (want('gl')) {
    for (const g of pick('gl')) {
      gl = extractGl(g);
      if (gl) break;
    }
  }
  let vat: VatReturnRow[] | undefined;
  if (want('vat')) {
    for (const g of pick('vat')) {
      vat = extractVat(g);
      if (vat) break;
    }
  }
  let rp: RelatedParty[] | undefined;
  if (want('rp')) {
    for (const g of pick('rp')) {
      rp = extractRelatedParties(g);
      if (rp) break;
    }
  }
  // Sales and purchase registers: every sheet of that kind (a person forcing the type reads all sheets as that kind).
  const registers = (kind: 'sales' | 'purchases'): InvoiceLine[] | undefined => {
    if (!want(kind)) return undefined;
    const lines = grids
      .filter((_, i) => (anySheet ? true : kinds[i] === kind))
      .flatMap((g) => extractRegister(g, anySheet ? kind : undefined)?.lines ?? [])
      .map((l) => ({ ...l, file: fileName }));
    return lines.length ? lines : undefined;
  };
  const sales = registers('sales');
  const purchases = registers('purchases');
  let imports: InvoiceLine[] | undefined;
  if (want('imports')) {
    const found = grids
      .filter((_, i) => (anySheet ? true : kinds[i] === 'imports'))
      .flatMap((g) => extractImports(g) ?? [])
      .map((l) => ({ ...l, file: fileName }));
    imports = found.length ? found : undefined;
  }
  let fs: FsData | undefined;
  if (want('fs')) {
    const fsGrids = forced ? grids : grids.filter((_, i) => kinds[i] === 'other');
    const found = extractFs(fsGrids);
    if (found.pbt || found.revenue || found.totalAssets || forced) fs = found;
  }

  // A trial balance always makes the workbook at least "Trial balance"; its other sheets are used too.
  let detected: FileKind = 'unknown';
  if (fs && tb) detected = 'fs_tb';
  else if (tb) detected = 'tb';
  else if (fs?.pbt) detected = 'fs';
  else if (sales || purchases || imports) detected = 'vatdata';
  else if (gl) detected = 'gl';
  else if (vat) detected = 'vat';
  else if (rp) detected = 'rp';
  else if (fs) detected = 'fs';

  // What each sheet was read as.
  const fsSheets = new Set([fs?.pbt?.ref.sheet, fs?.revenue?.ref.sheet, fs?.totalAssets?.ref.sheet, fs?.totalEquityLiabilities?.ref.sheet]);
  const sheets: SheetInfo[] = allGrids.map((g) => {
    if (isAnswerSheet(g.name)) return { name: g.name, role: 'answers' };
    const k = kinds[grids.indexOf(g)];
    return { name: g.name, role: k === 'other' ? (fsSheets.has(g.name) ? 'fs' : 'other') : k };
  });

  if (fs && !fs.pbt && (detected === 'fs' || detected === 'fs_tb')) warnings.push('Profit before tax was not found. Enter it by hand under Headline numbers.');
  if (tb && Math.abs(tb.totalDebit - tb.totalCredit) > 1) warnings.push('Trial balance debits and credits do not agree.');
  if (fs?.revenueWasNegative) warnings.push('Revenue is shown as a negative number. The calculator uses its absolute value.');
  if (errors.length) warnings.push(`${errors.length} cell(s) show a formula error such as #REF!.`);
  if (detected === 'unknown') {
    // A type picked by hand that the file does not hold is not the same as an unrecognised file.
    warnings.push(forced ? `Nothing of the type you chose (“${FILE_KIND_LABELS[forced]}”) was found in this file.` : 'File type not recognised. Pick the type from the list.');
  }

  return {
    id: `${fileName}-${Math.random().toString(36).slice(2, 8)}`,
    name: fileName,
    size: 0,
    detected: forced ?? detected,
    kind: forced ?? detected,
    fs,
    tb: tb ? { ...tb, lines: tb.lines.map((l) => ({ ...l, file: fileName })) } : undefined,
    gl,
    vat,
    rp,
    sales,
    purchases,
    imports,
    sheets,
    currency: detectCurrency(grids),
    // Profile facts: answers next to labels and statements in sentences, from the sheets that are not
    // data (cover, company record, notes). Keyword hints only from statements and trial balances,
    // never from ledgers or lists, which name other parties.
    ...profileFacts(grids, kinds, fileName, tb, !!(fs || tb)),
    errors,
    warnings,
  };
}

const cellRef = (g: Grid, r: number, c: number): CellRef => ({ sheet: g.name, cell: XLSX.utils.encode_cell({ r, c }) });

/** Evidence from the sheets that hold no data (cover, company record, notes, READ ME). */
function profileFacts(grids: Grid[], kinds: SheetKind[], fileName: string, tb: TbData | undefined, statements: boolean): { hints?: ParsedFile['hints']; evidence: Evidence[] } {
  const factGrids = grids.filter((_, i) => kinds[i] === 'other');
  const { evidence, used } = readFieldTables(factGrids, fileName, cellRef);
  for (const g of factGrids) {
    g.rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (typeof cell !== 'string' || cell.length < 12 || used.has(`${g.name}!${r}:${c}`)) return;
        for (const s of splitSentences(cell)) evidence.push(...sentenceEvidence(s, fileName, cellRef(g, r, c)));
      }),
    );
  }
  evidence.push(...readPriorRevenueTable(factGrids, fileName, cellRef));
  // Keyword hints never read registers, ledgers or lists: their text names customers and suppliers.
  const hintGrids = grids.filter((_, i) => kinds[i] === 'other' || kinds[i] === 'tb');
  return { hints: statements ? detectProfileHints(hintGrids, tb, used) : undefined, evidence };
}

/** A PDF document (auditor's report, director's confirmation, note): text only, no numbers are read. */
export function extractFromDocument(pages: PdfPage[], fileName: string): { parsed: ParsedFile; grids: Grid[] } {
  // One "sheet" per page; one row per "Label: answer" line or sentence, so a source reads "page 1, line 4".
  const grids: Grid[] = pages.map((p) => {
    const rows: Cell[][] = [];
    for (const para of p.paragraphs) {
      const lv = /^([^:.]{2,60}):\s*(.+)$/.exec(para);
      if (lv) rows.push([lv[1].trim(), lv[2].trim().replace(/\.$/, '')]);
      else for (const s of splitSentences(para)) rows.push([s]);
    }
    return { name: `page ${p.page}`, rows, maxCol: 2 };
  });
  const lineRef = (g: Grid, r: number): CellRef => ({ sheet: g.name, cell: `line ${r + 1}`, file: fileName });
  const { evidence, used } = readFieldTables(grids, fileName, (g, r) => lineRef(g, r), { pairsOnly: true });
  for (const g of grids) {
    g.rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (typeof cell !== 'string' || used.has(`${g.name}!${r}:${c}`)) return;
        evidence.push(...sentenceEvidence(cell, fileName, lineRef(g, r)));
      }),
    );
  }
  const hints = detectProfileHints(grids, undefined, used);
  // Hints point at "A3"; in a PDF that is line 3 of the page.
  for (const h of Object.values(hints)) {
    if (h?.ref) h.ref = { sheet: h.ref.sheet, cell: `line ${XLSX.utils.decode_cell(h.ref.cell).r + 1}`, file: fileName };
  }
  const textFound = pages.some((p) => p.paragraphs.length > 0);
  const warnings = textFound ? [] : ['No text found in this PDF (it may be a scanned image). Type the answers from it by hand.'];
  const parsed: ParsedFile = {
    id: `${fileName}-${Math.random().toString(36).slice(2, 8)}`,
    name: fileName,
    size: 0,
    detected: 'doc',
    kind: 'doc',
    sheets: grids.map((g) => ({ name: g.name, role: 'other' as const })),
    hints,
    evidence,
    errors: [],
    warnings,
  };
  return { parsed, grids };
}

/** Convenience for tests: parse an in-memory SheetJS workbook. */
export function parseWorkbook(wb: XLSX.WorkBook, fileName = 'workbook.xlsx', forced?: FileKind): ParsedFile {
  return extractFromGrids(gridsFromWorkbook(wb), fileName, forced);
}

/** Parse file bytes. */
export function parseFile(data: ArrayBuffer | Uint8Array, fileName: string, forced?: FileKind): { parsed: ParsedFile; grids: Grid[] } {
  const grids = readGrids(data, fileName);
  const parsed = extractFromGrids(grids, fileName, forced);
  parsed.size = data.byteLength;
  return { parsed, grids };
}
