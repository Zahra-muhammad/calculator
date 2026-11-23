/**
 * Currency of the uploaded files: amounts in another currency are converted to AED (UAE CT and VAT are
 * filed in AED), staff can change the currency and the rate, and a missing rate is a HIGH flag.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { conversion, convertFile, currencyText, detectCurrency } from '../src/engine/currency';
import { workingPaper } from '../src/engine/export';
import { parseFile } from '../src/engine/parse';
import { applyParsedFiles, emptyWorkspace, evaluate } from '../src/engine/workspace';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));

/** A small trial balance workbook with a title naming the currency. */
function tbBook(title: string) {
  const rows: unknown[][] = [
    [title],
    [],
    ['Account', 'Debit', 'Credit'],
    ['Sales revenue', 0, 1_000_000],
    ['Cost of sales', 400_000, 0],
    ['Salaries', 100_000, 0],
    ['Cash at bank', 500_000, 0],
    ['Total', 1_000_000, 1_000_000],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Trial Balance');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

describe('detectCurrency', () => {
  it('finds the currency named in a title or header', () => {
    expect(detectCurrency([{ name: 'TB', rows: [['Trial balance (amounts in USD)']] }])?.code).toBe('USD');
    expect(detectCurrency([{ name: 'TB', rows: [['Account', 'Net AED', 'VAT AED']] }])?.code).toBe('AED');
    expect(detectCurrency([{ name: 'TB', rows: [['Amounts in EUR']] }])).toEqual({ code: 'EUR', ref: 'TB!A1' });
    expect(detectCurrency([{ name: 'TB', rows: [['Account', 'Debit', 'Credit']] }])).toBeUndefined();
  });

  it('every test file in the project is in AED (or names no currency), so no figure there changes', () => {
    for (const name of readdirSync(join(__dirname, 'fixtures')).filter((n) => /\.xlsx$/.test(n) && !/^(CT|VAT)-/.test(n))) {
      let parsed;
      try {
        parsed = parseFile(fixture(name), name).parsed;
      } catch {
        continue; // refused files (exports)
      }
      expect([undefined, 'AED'], name).toContain(parsed.currency?.code);
    }
  });
});

describe('conversion', () => {
  it('AED is never converted; a missing rate is reported', () => {
    expect(conversion({ code: 'AED', rate: 1 })).toEqual({ convert: false, missingRate: false });
    expect(conversion({ code: 'USD', rate: 3.6725 })).toEqual({ convert: true, rate: 3.6725, missingRate: false });
    expect(conversion({ code: 'EUR' }).missingRate).toBe(true);
    expect(currencyText({ code: 'USD', rate: 3.6725 })).toBe('Files in USD, converted to AED at 3.6725 AED per 1 USD');
  });
});

describe('a trial balance in US dollars', () => {
  const parsed = parseFile(tbBook('Trial balance FY2025 – amounts in USD'), 'tb-usd.xlsx').parsed;

  it('is detected as USD with the peg rate 3.6725', () => {
    expect(parsed.currency?.code).toBe('USD');
    const ws = applyParsedFiles(emptyWorkspace(), [parsed]);
    expect(ws.currency).toMatchObject({ code: 'USD', rate: 3.6725 });
  });

  it('every trial balance amount is converted to AED, so tax is worked out in AED', () => {
    const ws = applyParsedFiles(emptyWorkspace(), [parsed]);
    const sales = ws.tbLines.find((l) => /sales revenue/i.test(l.account))!;
    expect(sales.credit).toBe(3_672_500);
    const ev = evaluate(ws);
    // Profit USD 500,000 = AED 1,836,250. Tax 9% above AED 375,000.
    expect(ev.result.pbt).toBe(1_836_250);
    expect(ev.result.tax).toBeCloseTo((1_836_250 - 375_000) * 0.09, 0);
    expect(ev.flags.find((f) => f.key === 'CUR:converted')?.level).toBe('INFO');
  });

  it('"Change to AED" uses the amounts as they are', () => {
    const ws0 = applyParsedFiles(emptyWorkspace(), [parsed]);
    const ws = applyParsedFiles({ ...ws0, currency: { code: 'AED', rate: 1, byUser: true } }, [parsed]);
    expect(ws.tbLines.find((l) => /sales revenue/i.test(l.account))!.credit).toBe(1_000_000);
    expect(evaluate(ws).flags.some((f) => f.id === 'CUR')).toBe(false);
  });

  it('a rate staff typed is kept when more files are added', () => {
    const ws0 = applyParsedFiles(emptyWorkspace(), [parsed]);
    const ws = applyParsedFiles({ ...ws0, currency: { code: 'USD', rate: 3.67, byUser: true } }, [parsed]);
    expect(ws.currency?.rate).toBe(3.67);
    expect(ws.tbLines.find((l) => /sales revenue/i.test(l.account))!.credit).toBe(3_670_000);
  });

  it('the export states the currency and rate', () => {
    const ws = applyParsedFiles(emptyWorkspace(), [parsed]);
    const wb = XLSX.read(workingPaper(ws, evaluate(ws)), { type: "array" });
    const text = JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }));
    expect(text).toContain('converted to AED at 3.6725');
  });
});

describe('a trial balance in euros (no fixed rate)', () => {
  const parsed = parseFile(tbBook('Trial balance – amounts in EUR'), 'tb-eur.xlsx').parsed;

  it('asks for the rate with a HIGH flag and converts nothing until then', () => {
    const ws = applyParsedFiles(emptyWorkspace(), [parsed]);
    expect(ws.currency).toMatchObject({ code: 'EUR', rate: undefined });
    expect(ws.tbLines.find((l) => /sales revenue/i.test(l.account))!.credit).toBe(1_000_000);
    expect(evaluate(ws).flags.find((f) => f.key === 'CUR:rate')?.level).toBe('HIGH');
  });

  it('converts once the rate is entered', () => {
    const ws0 = applyParsedFiles(emptyWorkspace(), [parsed]);
    const ws = applyParsedFiles({ ...ws0, currency: { code: 'EUR', rate: 4.2, byUser: true } }, [parsed]);
    expect(ws.tbLines.find((l) => /sales revenue/i.test(l.account))!.credit).toBe(4_200_000);
    expect(evaluate(ws).flags.some((f) => f.key === 'CUR:rate')).toBe(false);
  });

  it('convertFile keeps cell references', () => {
    const c = convertFile(parsed, 2);
    expect([c.tb?.lines[0].sheet, c.tb?.lines[0].row]).toEqual([parsed.tb?.lines[0].sheet, parsed.tb?.lines[0].row]);
    expect(c.tb?.totalDebit).toBe((parsed.tb?.totalDebit ?? 0) * 2);
  });
});
