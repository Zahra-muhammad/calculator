import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { classifyLines } from '../src/engine/classify';
import { workingPaper } from '../src/engine/export';
import { EXPORT_REFUSED_MESSAGE, extractFs, isCalculatorExport, parseFile, parseWorkbook, readGrids, RefusedFileError } from '../src/engine/parse';
import { parseSignedAmount } from '../src/engine/util';
import { applyParsedFiles, emptyWorkspace, evaluate } from '../src/engine/workspace';
import { sampleWorkbook, toBytes, workbook } from './helpers';

describe('test 16: parser', () => {
  it('reads PBT, revenue and the trial balance from one workbook (via file bytes)', () => {
    const { parsed } = parseFile(toBytes(sampleWorkbook()), 'abc.xlsx');
    expect(parsed.detected).toBe('fs_tb');

    // PBT: skips the note number 7, takes the current-year column.
    expect(parsed.fs?.pbt?.value).toBe(600_000);
    expect(parsed.fs?.pbt?.ref).toEqual({ sheet: 'P&L', cell: 'C8' });
    expect(parsed.fs?.pbt?.prior).toBe(-50_000);
    expect(parsed.fs?.revenue?.value).toBe(2_500_000);
    expect(parsed.fs?.revenue?.ref.cell).toBe('C4');
    expect(parsed.hints?.periodEnd?.value).toBe('2025-12-31');
    expect(parsed.hints?.clientName?.value).toBe('ABC Trading LLC');

    // TB: blank and "Total" rows skipped; source rows kept.
    const tb = parsed.tb!;
    expect(tb.lines).toHaveLength(11);
    expect(tb.lines[0]).toMatchObject({ account: 'Cash at bank', row: 2, debit: 500_000, balance: 500_000 });
    expect(tb.totalDebit).toBe(2_850_000);
    expect(tb.totalCredit).toBe(2_850_000);

    const c = classifyLines(tb.lines);
    const cat = (name: string) => c.find((l) => l.account === name)?.category;
    expect(cat('Office expenses')).toBe('no_invoice');
    expect(c.find((l) => l.account === 'Office expenses')?.evidence).toBe('comment');
    expect(cat('Cash at bank')).toBe('balance_sheet');
    expect(cat('Police fine')).toBe('fines');
    expect(cat("Director's remuneration")).toBe('connected_person_payment');
    expect(cat('Revenue')).toBe('revenue');
    expect(cat('Trade payables')).toBe('balance_sheet');
    expect(cat('Salaries')).toBe('normal_expense');
  });

  it('accepts zero as PBT and reads labels anywhere in the sheet', () => {
    const fs = extractFs(
      readGrids(
        toBytes(
          workbook({
            // PBT is only read from a P&L sheet (by name or heading).
            'Income statement': [
              [null, null, null],
              [null, null, 'Net profit before taxation', null, '-', 12_000],
              [null, null, 'Turnover', 3, 900_000, 800_000],
            ],
          }),
        ),
        'x.xlsx',
      ),
    );
    expect(fs.pbt?.value).toBe(0);
    expect(fs.pbt?.ref.cell).toBe('E2');
    expect(fs.revenue?.value).toBe(900_000);
  });

  it('uses the last debit/credit pair and finds the adjustments pair', () => {
    const wb = workbook({
      TB: [
        [null, null, 'Closing', null, 'Adjustments', null, 'Adjusted', null],
        ['Code', 'Account name', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit', 'Notes'],
        ['A1', 'Office expenses', 10_000, null, 500, null, 10_500, null, 'check'],
        ['A2', 'VAT control', null, 2_000, null, 500, null, 2_500, ''],
        ['A3', 'Sales', null, 8_000, null, null, null, 8_000, ''],
      ],
    });
    const p = parseWorkbook(wb, 'tb.xlsx');
    const tb = p.tb!;
    expect(tb.hasAdjustments).toBe(true);
    expect(tb.lines.map((l) => l.balance)).toEqual([10_500, -2_500, -8_000]);
    expect(tb.lines[0].comment).toBe('check');
    expect(tb.lines[0].adjDebit).toBe(500);
    expect(tb.lines[1].adjCredit).toBe(500);
  });

  it('reads a single signed column: Cash 100, Sales −1000, Rent 400, Traffic fines 50 → 4 lines', () => {
    const p = parseWorkbook(
      workbook({
        TB: [
          ['Account', 'Balance'],
          ['Cash', 100],
          ['Sales', -1000],
          ['Rent', 400],
          ['Traffic fines', 50],
          ['Total', -450],
        ],
      }),
      'tb.xlsx',
    );
    expect(p.detected).toBe('tb');
    expect(p.fs).toBeUndefined();
    const tb = p.tb!;
    expect(tb.singleColumn).toBe(true);
    expect(tb.lines).toHaveLength(4);
    expect(tb.lines.map((l) => [l.account, l.debit, l.credit, l.balance])).toEqual([
      ['Cash', 100, 0, 100],
      ['Sales', 0, 1000, -1000],
      ['Rent', 400, 0, 400],
      ['Traffic fines', 50, 0, 50],
    ]);
    expect(classifyLines(tb.lines).map((l) => l.category)).toEqual(['balance_sheet', 'revenue', 'normal_expense', 'fines']);

    const ev = evaluate(applyParsedFiles(emptyWorkspace(), [p]));
    expect(ev.result.revenue).toBe(1000);
    expect(ev.result.pbt).toBe(550); // from the TB: 1,000 − 400 − 50
    expect(ev.flags.some((f) => f.key === 'DATA:tb-balance')).toBe(true); // 550 debits vs 1,000 credits
  });

  it('reads Dr/Cr text in a single column (any case, before or after the number)', () => {
    const p = parseWorkbook(
      workbook({
        Sheet1: [
          ['Particulars', 'Closing Balance', 'Remarks'],
          ['Cash', '1,000.00 Dr', ''],
          ['Sales', '1,500.00 Cr', ''],
          ['Rent', 'Dr 400', 'Office'],
          ['Share capital', '100 CR', ''],
          ['Salaries', '200 dr', ''],
        ],
      }),
    );
    expect(p.detected).toBe('tb');
    expect(p.tb!.lines.map((l) => l.balance)).toEqual([1000, -1500, 400, -100, 200]);
    expect(p.tb!.lines[2].comment).toBe('Office');
    expect(p.tb!.totalDebit).toBe(1600);
    expect(p.tb!.totalCredit).toBe(1600);
  });

  it('parseSignedAmount: Dr is positive, Cr is negative', () => {
    expect(parseSignedAmount('1,000.00 Dr')).toBe(1000);
    expect(parseSignedAmount('1,000.00 Cr')).toBe(-1000);
    expect(parseSignedAmount('Dr 1,000')).toBe(1000);
    expect(parseSignedAmount('1000 CR')).toBe(-1000);
    expect(parseSignedAmount('cr. 250')).toBe(-250);
    expect(parseSignedAmount('(500) Cr')).toBe(-500);
    expect(parseSignedAmount('(500)')).toBe(-500);
    expect(parseSignedAmount(-75)).toBe(-75);
    expect(parseSignedAmount('Credit note')).toBeUndefined();
    expect(parseSignedAmount('Dr')).toBeUndefined();
  });

  it('does not mistake statements with an Amount column for a single-column TB', () => {
    const p = parseWorkbook(
      workbook({
        'P&L': [
          ['Description', 'Amount'],
          ['Revenue', 900_000],
          ['Profit before tax', 120_000],
        ],
      }),
    );
    expect(p.detected).toBe('fs');
    expect(p.tb).toBeUndefined();
  });

  it('never sets revenue to a negative number', () => {
    const p = parseWorkbook(
      workbook({
        'P&L': [
          ['Revenue', '(900,000)', '(800,000)'],
          ['Profit before tax', 120_000],
        ],
      }),
    );
    expect(p.fs?.revenue?.value).toBe(900_000);
    expect(p.fs?.revenueWasNegative).toBe(true);
    const ev = evaluate(applyParsedFiles(emptyWorkspace(), [p]));
    expect(ev.result.revenue).toBe(900_000);
    expect(ev.flags.find((f) => f.key === 'DATA:revenue-sign')?.level).toBe('INFO');
  });

  it('reads CSV trial balances', () => {
    const csv = 'Account,Debit,Credit,Comment\nRent,"12,000",,\nSales,,"(1,000)",\nTotal,12000,1000,\n';
    const { parsed } = parseFile(new TextEncoder().encode(csv), 'tb.csv');
    expect(parsed.detected).toBe('tb');
    expect(parsed.tb!.lines).toHaveLength(2);
    expect(parsed.tb!.lines[0].debit).toBe(12_000);
  });

  it('detects GL, VAT returns and related parties files', () => {
    const gl = parseWorkbook(
      workbook({
        GL: [
          ['Date', 'Account', 'Description', 'Debit', 'Credit'],
          ['2025-01-05', 'Office expenses', 'RTA traffic fine', 400, null],
          ['2025-01-06', 'Office expenses', 'Printer paper', 120, null],
        ],
      }),
    );
    expect(gl.detected).toBe('gl');
    expect(gl.gl).toHaveLength(2);

    const vat = parseWorkbook(
      workbook({
        VAT: [
          ['Tax period', 'Standard rated supplies', 'Zero rated supplies', 'Exempt supplies', 'Recoverable input tax'],
          ['Q1 2025', 500_000, 20_000, 0, 10_000],
          ['Q2 2025', 600_000, 0, 5_000, 12_000],
        ],
      }),
    );
    expect(vat.detected).toBe('vat');
    expect(vat.vat?.[1]).toMatchObject({ standardRated: 600_000, exempt: 5_000, inputTax: 12_000 });

    const rp = parseWorkbook(
      workbook({
        RP: [
          ['Name', 'Type', 'Relationship', 'Connected to'],
          ['Ahmed Ali', 'Person', 'Director', ''],
          ['Fatima Ahmed', 'Person', 'Wife of director', 'Ahmed Ali'],
          ['Ali Holdings LLC', 'Company', 'Shareholder', 'Ahmed Ali'],
        ],
      }),
    );
    expect(rp.detected).toBe('rp');
    expect(rp.rp?.[1]).toMatchObject({ type: 'person', connectedTo: 'Ahmed Ali' });
    expect(rp.rp?.[2].type).toBe('company');
  });

  it('finds formula error cells with sheet and cell', () => {
    const wb = workbook({ 'P&L': [['Revenue', 100], ['Profit before tax', 50]] });
    wb.Sheets['P&L']['C2'] = { t: 'e', v: 0x17 } as XLSX.CellObject;
    wb.Sheets['P&L']['!ref'] = 'A1:C2';
    const p = parseWorkbook(wb, 'fs.xlsx');
    expect(p.errors).toEqual([{ sheet: 'P&L', cell: 'C2', error: '#REF!', file: 'fs.xlsx' }]);
  });

  it('notices the auditor report and suggests a loss brought forward', () => {
    const p = parseWorkbook(
      workbook({
        Report: [["Independent Auditor's Report to the shareholders"]],
        'P&L': [
          ['Revenue', 1_000],
          ['Profit before tax', 100],
        ],
        Notes: [
          ['', 2025, 2024],
          ['Tax loss for the year', 0, -80_000],
        ],
      }),
    );
    expect(p.fs?.auditedText).toBe(true);
    expect(p.fs?.lossSuggestion?.value).toBe(80_000);
  });
});

describe('a type picked by hand', () => {
  it('Al Noor read as "VAT returns": says that type is not in the file, never "not recognised"', () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'Test_Al_Noor_Trading_FY2025.xlsx')));
    const auto = parseFile(bytes, 'Test_Al_Noor_Trading_FY2025 (2).xlsx').parsed;
    expect(auto.detected).toBe('fs_tb');
    expect(auto.warnings.join(' ')).not.toMatch(/not recognised/);
    const asVat = parseFile(bytes, 'Test_Al_Noor_Trading_FY2025 (2).xlsx', 'vat').parsed;
    expect(asVat.vat).toBeUndefined();
    expect(asVat.warnings).toContain('Nothing of the type you chose (“VAT returns”) was found in this file.');
    expect(asVat.warnings.join(' ')).not.toMatch(/not recognised/);
  });
});

describe('files and sheets that are never read', () => {
  it("refuses the calculator's own Excel export", () => {
    const ws = applyParsedFiles(emptyWorkspace(), [parseFile(toBytes(sampleWorkbook()), 'abc.xlsx').parsed]);
    const bytes = workingPaper(ws, evaluate(ws));
    expect(() => parseFile(bytes, 'CT-ABC Trading LLC-2025-12-31.xlsx')).toThrow(RefusedFileError);
    expect(() => parseFile(bytes, 'CT-ABC Trading LLC-2025-12-31.xlsx')).toThrow('This is a calculator export, not client accounts. Upload the original trial balance.');
    expect(EXPORT_REFUSED_MESSAGE).toBe('This is a calculator export, not client accounts. Upload the original trial balance.');
    // Two of the three export sheet names are enough; a client workbook with only a "Computation" sheet is read.
    expect(isCalculatorExport(['Computation', 'Settings used', 'Notes'])).toBe(true);
    expect(() => parseWorkbook(workbook({ Computation: [['Profit before tax', 100]], 'P&L': [['Profit before tax', 100]] }))).not.toThrow();
  });

  it('never reads numbers from an "Expected Results" or "Answers" sheet; PBT comes from the P&L or the trial balance', () => {
    const tbRows = [
      ['Account', 'Debit', 'Credit'],
      ['Cash at bank', 400_000, null],
      ['Share capital', null, 100_000],
      ['Sales', null, 1_500_000],
      ['Salaries', 920_000, null],
      ['Total', 1_320_000, 1_600_000],
    ];
    for (const sheet of ['Expected Results', 'ANSWERS', 'Answer key']) {
      const p = parseWorkbook(
        workbook({
          [sheet]: [
            ['Profit before tax', 999_999],
            ['Revenue', 7_777_777],
            ['Company: Wrong Name LLC'],
          ],
          'Trial Balance': tbRows,
        }),
        'pack.xlsx',
      );
      expect(p.fs?.pbt, sheet).toBeUndefined();
      expect(p.fs?.revenue, sheet).toBeUndefined();
      expect(p.warnings.join(' '), sheet).toContain(`Not read: "${sheet}"`);
      const ev = evaluate(applyParsedFiles(emptyWorkspace(), [p]));
      // Worked out from the trial balance: 1,500,000 − 920,000.
      expect(ev.result.pbt, sheet).toBe(580_000);
      expect(ev.pbtSource, sheet).toBe('Trial balance (sum of P&L lines)');
    }
    // A notes sheet that is not a P&L is not a PBT source either…
    const notes = parseWorkbook(workbook({ 'Tax note': [['Profit before tax', 123_456]], 'Trial Balance': tbRows }));
    expect(notes.fs?.pbt).toBeUndefined();
    // …but a sheet with a P&L heading is, whatever its name.
    const titled = parseWorkbook(workbook({ Statements: [['Statement of profit or loss for the year ended 31 December 2025'], ['Profit before tax', 580_000]], 'Trial Balance': tbRows }));
    expect(titled.fs?.pbt?.value).toBe(580_000);
  });
});
