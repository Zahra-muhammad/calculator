/**
 * Currency of the uploaded files. UAE corporate tax and VAT are worked out and filed in AED (dirhams), so
 * amounts in another currency are converted to AED with an exchange rate staff can change. The FTA expects
 * the UAE Central Bank rate. Pegged currencies get a default rate; floating ones (EUR, GBP …) must be entered.
 *
 * Pure: no React, no DOM.
 */
import type { CellRef, FoundNumber, ParsedFile } from './types';
import { norm, round2 } from './util';

export interface CurrencyInfo {
  code: string;
  name: string;
  /** AED for 1 unit, when the currency is pegged to the US dollar. */
  pegRate?: number;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'AED', name: 'UAE dirham', pegRate: 1 },
  { code: 'USD', name: 'US dollar', pegRate: 3.6725 },
  { code: 'SAR', name: 'Saudi riyal', pegRate: 0.9793 },
  { code: 'QAR', name: 'Qatari riyal', pegRate: 1.0089 },
  { code: 'OMR', name: 'Omani rial', pegRate: 9.5514 },
  { code: 'BHD', name: 'Bahraini dinar', pegRate: 9.7673 },
  { code: 'KWD', name: 'Kuwaiti dinar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British pound' },
  { code: 'INR', name: 'Indian rupee' },
  { code: 'PKR', name: 'Pakistani rupee' },
  { code: 'CNY', name: 'Chinese yuan' },
];

export const currencyInfo = (code: string) => CURRENCIES.find((c) => c.code === code);

/** The currency choice for the client: the currency of the amounts in the files, and AED per 1 unit. */
export interface CurrencyChoice {
  code: string;
  /** AED for 1 unit. Undefined = not entered yet (amounts are not converted). */
  rate?: number;
  /** Set when a person chose the currency or the rate. */
  byUser?: boolean;
  /** Where the currency was found, e.g. "TB!C4". */
  foundAt?: string;
}

/** True when amounts must be converted, and the rate needed to do it. */
export function conversion(c: CurrencyChoice | undefined): { convert: boolean; rate?: number; missingRate: boolean } {
  if (!c || c.code === 'AED') return { convert: false, missingRate: false };
  const rate = c.rate && c.rate > 0 ? c.rate : undefined;
  return { convert: rate !== undefined && rate !== 1, rate, missingRate: rate === undefined };
}

const TOKENS: [string, RegExp][] = [
  ['AED', /\b(aed|dhs?|dirhams?|uae dirham)\b|د\.إ/],
  ['USD', /\b(usd|us dollars?)\b|us\$|\(\$\)|\$\s?\d|^\$/],
  ['SAR', /\b(sar|saudi riyals?)\b/],
  ['QAR', /\b(qar|qatari riyals?)\b/],
  ['OMR', /\b(omr|omani rials?)\b/],
  ['BHD', /\b(bhd|bahraini dinars?)\b/],
  ['KWD', /\b(kwd|kuwaiti dinars?)\b/],
  ['EUR', /\b(eur|euros?)\b|€/],
  ['GBP', /\b(gbp|pounds? sterling)\b|£/],
  ['INR', /\b(inr|indian rupees?)\b|₹/],
  ['PKR', /\b(pkr|pakistani rupees?)\b/],
  ['CNY', /\b(cny|rmb|chinese yuan|renminbi)\b|¥/],
];

/**
 * The currency named in the files: in titles ("Amounts in USD"), column headers ("Net AED") or amounts
 * ("$ 1,200"). Only text cells near the top of each sheet, and currency-formatted cells, are looked at.
 */
export function detectCurrency(grids: { name: string; rows: unknown[][]; formats?: (string | undefined)[][] }[]): { code: string; ref: string } | undefined {
  const counts = new Map<string, { n: number; ref: string }>();
  const hit = (code: string, ref: string) => {
    const c = counts.get(code);
    counts.set(code, { n: (c?.n ?? 0) + 1, ref: c?.ref ?? ref });
  };
  for (const g of grids) {
    g.rows.slice(0, 15).forEach((row, r) =>
      row.forEach((cell, c) => {
        if (typeof cell !== 'string' || cell.length > 160) return;
        const raw = cell.toLowerCase();
        const t = `${norm(cell)} ${raw}`;
        for (const [code, re] of TOKENS) {
          if (re.test(t)) hit(code, `${g.name}!${String.fromCharCode(65 + Math.min(c, 25))}${r + 1}`);
        }
      }),
    );
  }
  if (!counts.size) return undefined;
  // A foreign currency named in the file wins over a stray "AED" (e.g. "converted to AED" in a note).
  const foreign = [...counts.entries()].filter(([k]) => k !== 'AED').sort((a, b) => b[1].n - a[1].n);
  const aed = counts.get('AED');
  if (foreign.length && (!aed || foreign[0][1].n >= aed.n)) return { code: foreign[0][0], ref: foreign[0][1].ref };
  return aed ? { code: 'AED', ref: aed.ref } : { code: foreign[0][0], ref: foreign[0][1].ref };
}

const x = (n: number, rate: number) => round2(n * rate);
const xo = (n: number | undefined, rate: number) => (n === undefined ? undefined : x(n, rate));
const found = (f: FoundNumber | undefined, rate: number): FoundNumber | undefined => (f ? { ...f, value: x(f.value, rate), prior: xo(f.prior, rate) } : undefined);

/** A copy of the parsed file with every amount converted to AED at `rate`. Cell references are kept. */
export function convertFile(f: ParsedFile, rate: number): ParsedFile {
  const lines = <T extends { net: number; vat: number; gross?: number }>(ls: T[] | undefined) => ls?.map((l) => ({ ...l, net: x(l.net, rate), vat: x(l.vat, rate), gross: xo(l.gross, rate) }));
  return {
    ...f,
    fs: f.fs
      ? { ...f.fs, pbt: found(f.fs.pbt, rate), revenue: found(f.fs.revenue, rate), lossSuggestion: found(f.fs.lossSuggestion, rate), totalAssets: found(f.fs.totalAssets, rate), totalEquityLiabilities: found(f.fs.totalEquityLiabilities, rate) }
      : undefined,
    tb: f.tb
      ? {
          ...f.tb,
          totalDebit: x(f.tb.totalDebit, rate),
          totalCredit: x(f.tb.totalCredit, rate),
          lines: f.tb.lines.map((l) => ({ ...l, debit: x(l.debit, rate), credit: x(l.credit, rate), balance: x(l.balance, rate), adjDebit: xo(l.adjDebit, rate), adjCredit: xo(l.adjCredit, rate) })),
        }
      : undefined,
    gl: f.gl?.map((t) => ({ ...t, debit: x(t.debit, rate), credit: x(t.credit, rate), amount: x(t.amount, rate) })),
    vat: f.vat?.map((v) => ({ ...v, standardRated: x(v.standardRated, rate), zeroRated: x(v.zeroRated, rate), exempt: x(v.exempt, rate), inputTax: x(v.inputTax, rate) })),
    sales: lines(f.sales),
    purchases: lines(f.purchases),
    imports: lines(f.imports),
  };
}

/** "AED", or "Files in USD, converted to AED at 3.6725 AED per 1 USD". */
export function currencyText(c: CurrencyChoice | undefined): string {
  if (!c || c.code === 'AED') return 'AED';
  return c.rate ? `Files in ${c.code}, converted to AED at ${c.rate} AED per 1 ${c.code}` : `Files in ${c.code}: NO RATE ENTERED, amounts not converted`;
}

export type { CellRef };
