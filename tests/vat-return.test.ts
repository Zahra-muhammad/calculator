/**
 * The VAT return (VAT201) from registers and imports, checked against the answer key of
 * tests/fixtures/VAT_Test_Pack_Q3_2026.xlsx (Palm Breeze Trading LLC, Q3 2026).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { cleanCompanyName } from '../src/engine/autofill';
import { exportFileName, workingPaper } from '../src/engine/export';
import { extractFromGrids, parseFile, RefusedFileError } from '../src/engine/parse';
import { clientReport } from '../src/engine/pdf';
import type { InvoiceLine } from '../src/engine/types';
import { autoInputTreatment, computeVat, supplyKind } from '../src/engine/vat';
import { applyParsedFiles, emptyWorkspace, evaluate } from '../src/engine/workspace';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));
const load = (name: string) => {
  const parsed = parseFile(fixture(name), name).parsed;
  const ws = applyParsedFiles(emptyWorkspace(), [parsed]);
  return { parsed, ws, ev: evaluate(ws) };
};
const boxes = (ev: ReturnType<typeof evaluate>) => Object.fromEntries(ev.vat.boxes.map((b) => [b.id, [b.amount, b.vat]]));

let row = 0;
const line = (p: Partial<InvoiceLine> & { net: number; vat: number }): InvoiceLine => {
  row++;
  return { key: `T!${row}`, sheet: 'T', row, number: `N-${row}`, party: '', trnColumn: false, description: '', ...p };
};

describe('VAT test pack Q3 2026: the full VAT return', () => {
  const { parsed, ev } = load('VAT_Test_Pack_Q3_2026.xlsx');

  it('reads every sheet: sales, purchases and imports', () => {
    expect(parsed.sheets?.map((s) => [s.name, s.role])).toEqual([
      ['READ ME', 'other'],
      ['Sales Invoices', 'sales'],
      ['Purchase Invoices', 'purchases'],
      ['Imports', 'imports'],
    ]);
    expect(parsed.imports?.map((l) => [l.number, l.importType, l.net, l.vat])).toEqual([
      ['IM-01', 'services', 40_000, 2_000],
      ['IM-02', 'goods', 300_000, 15_000],
    ]);
  });

  it('gives every box of the answer key', () => {
    expect(boxes(ev)).toMatchObject({
      '1a': [150_000, 7_500],
      '1b': [230_000, 11_500],
      '1c': [80_000, 4_000],
      '3': [40_000, 2_000],
      '4': [120_000, 0],
      '5': [0, 0],
      '6': [300_000, 15_000],
      '8': [920_000, 40_000],
      '9': [330_000, 16_500],
      '10': [340_000, 17_000],
      '11': [670_000, 33_500],
    });
    expect(ev.vat).toMatchObject({ outputVat: 40_000, inputRecoverable: 33_500, inputBlocked: 6_500, inputHeld: 400, payable: 6_500 });
  });

  it('treats each trap as the answer key says', () => {
    const p = Object.fromEntries(ev.vat.purchases.map((l) => [l.number, l.treatment]));
    expect(p).toEqual({ 'P-201': 'recoverable', 'P-202': 'recoverable', 'P-203': 'blocked', 'P-204': 'blocked', 'P-205': 'recoverable', 'P-206': 'held' });
    const s105 = ev.vat.sales.find((l) => l.number === 'S-105')!;
    expect([s105.vat, s105.counted]).toEqual([2_000, 2_500]);
    expect(ev.vat.sales.filter((l) => l.excluded).map((l) => [l.number, l.row])).toEqual([['S-103', 11]]);
    expect(ev.vat.sales.find((l) => l.number === 'S-104')?.supply).toBe('zero');
    expect(ev.vat.sales.find((l) => l.number === 'CN-01')).toMatchObject({ supply: 'standard', box: '1b', counted: -1_000 });
  });

  it('raises the five checks, and no corporate tax flags for a VAT-only file', () => {
    const keys = ev.flags.map((f) => [f.key, f.level]);
    expect(keys).toEqual(
      expect.arrayContaining([
        ['VAT:duplicates-sales', 'HIGH'],
        ['VAT:rate-sales', 'MEDIUM'],
        ['VAT:trn', 'MEDIUM'],
        ['VAT:blocked', 'INFO'],
      ]),
    );
    expect(ev.flags.find((f) => f.key === 'VAT:blocked')?.amount).toBe(6_500);
    expect(ev.flags.every((f) => f.id === 'VAT')).toBe(true);
  });

  it('counts a repeated invoice when staff say it is separate', () => {
    const { ws } = load('VAT_Test_Pack_Q3_2026.xlsx');
    const dup = ws.salesInvoices.find((l) => l.number === 'S-103' && l.row === 11)!;
    const ev2 = evaluate({ ...ws, vatChoices: { [dup.key]: { include: true } } });
    expect(ev2.vat.outputVat).toBe(44_000);
    expect(ev2.vat.sales.some((l) => l.excluded)).toBe(false);
  });

  it('claims held VAT once staff mark the corrected invoice recoverable', () => {
    const { ws } = load('VAT_Test_Pack_Q3_2026.xlsx');
    const laptop = ws.purchaseInvoices.find((l) => l.number === 'P-206')!;
    const ev2 = evaluate({ ...ws, vatChoices: { [laptop.key]: { treatment: 'recoverable', reason: 'Corrected invoice with TRN received' } } });
    expect(ev2.vat).toMatchObject({ inputRecoverable: 33_900, inputHeld: 0, payable: 6_100 });
  });

  it('exports the VAT return to Excel and PDF, named VAT-…', () => {
    const { ws, ev: e } = load('VAT_Test_Pack_Q3_2026.xlsx');
    expect(exportFileName(ws, 'xlsx')).toMatch(/^VAT-/);
    const wb = XLSX.read(workingPaper(ws, e), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.VAT, { header: 1 });
    expect(rows.find((r) => r[0] === '14')?.[3]).toBe(6_500);
    expect(rows.find((r) => r[1] === 'IM-02')?.[8]).toBe('Goods (Box 6)');
    const pdf = new TextDecoder('latin1').decode(clientReport(ws, e));
    expect(pdf.startsWith('%PDF')).toBe(true);
    // Our own export is refused when uploaded again.
    expect(() => parseFile(workingPaper(ws, e), 'VAT-export.xlsx')).toThrow(RefusedFileError);
  });
});

describe('input VAT rules', () => {
  const t = (p: Partial<InvoiceLine>) => autoInputTreatment(line({ net: 1_000, vat: 50, ...p })).treatment;
  it('blocks motor vehicles available for personal use and goods for employees’ personal use (Art. 53)', () => {
    expect(t({ description: 'Car for Managing Director, used for business and personal trips' })).toBe('blocked');
    expect(t({ description: 'SUV lease', category: 'Motor vehicle – private use' })).toBe('blocked');
    expect(t({ description: 'Delivery van fuel' })).toBe('recoverable');
    expect(t({ description: 'Gifts for staff personal use' })).toBe('blocked');
  });
  it('holds input VAT when the supplier TRN is missing (Art. 55), not when the register has no TRN column', () => {
    expect(t({ trnColumn: true })).toBe('held');
    expect(t({ trnColumn: true, trn: '100200300400500' })).toBe('recoverable');
    expect(t({ trnColumn: false })).toBe('recoverable');
  });
  it('counts no more than 5% of net as input VAT', () => {
    const v = computeVat([], [line({ net: 10_000, vat: 800, rate: 0.05 })]);
    expect(v.inputRecoverable).toBe(500);
    expect(v.flags.some((f) => f.key === 'VAT:rate-purchases')).toBe(true);
  });
});

describe('sales: supply type and emirate', () => {
  it('reads standard, zero-rated, exempt and out-of-scope supplies', () => {
    expect(supplyKind(line({ net: 1, vat: 0.05, supplyType: 'Standard rated' }))).toBe('standard');
    expect(supplyKind(line({ net: 1, vat: 0, supplyType: 'Zero rated' }))).toBe('zero');
    expect(supplyKind(line({ net: 1, vat: 0, supplyType: 'Export of goods' }))).toBe('zero');
    expect(supplyKind(line({ net: 1, vat: 0, supplyType: 'Exempt – residential rent' }))).toBe('exempt');
    expect(supplyKind(line({ net: 1, vat: 0, supplyType: 'Out of scope' }))).toBe('oos');
    expect(supplyKind(line({ net: 1, vat: 0, rate: 0 }))).toBe('zero');
    expect(supplyKind(line({ net: 1, vat: 0.05 }))).toBe('standard');
  });
  it('flags VAT shown on a zero-rated sale and splits Box 1 by emirate', () => {
    const v = computeVat(
      [line({ net: 1_000, vat: 50, supplyType: 'Zero rated' }), line({ net: 2_000, vat: 100, emirate: 'Ras Al Khaimah' }), line({ net: 4_000, vat: 200, emirate: 'Ajman' })],
      [],
    );
    expect(v.flags.find((f) => f.key === 'VAT:vat-on-zero')).toMatchObject({ level: 'MEDIUM', amount: 50 });
    expect(boxes({ vat: v } as never)).toMatchObject({ '1d': [4_000, 200], '1f': [2_000, 100], '4': [1_000, 0] });
  });
});

describe('Desert Star test pack (corporate tax + VAT in one workbook)', () => {
  it('works out PBT from the trial balance, never from the answer key: tax 17,550, VAT 44,500', () => {
    const { parsed, ws, ev } = load('UAE_Corporate_Tax_Test_Pack_2025.xlsx');
    expect(parsed.detected).toBe('tb');
    expect(ev.result).toMatchObject({ pbt: 580_000, taxableIncome: 570_000, tax: 17_550 });
    expect(ev.vat.payable).toBe(44_500);
    // The name is offered, never filled in by itself.
    expect(ws.suggestedClientName).toBe('Desert Star Office Supplies LLC');
    expect(ws.clientName).toBe('');
    // The sales register reconciles revenue, so RV-03 passes.
    expect(ev.flags.find((f) => f.id === 'RV-03')?.level).toBe('PASS');
  });
});

describe('client name is never left over from another file', () => {
  it('a second file does not inherit the first file’s name, and a typed name is kept', () => {
    const ds = load('UAE_Corporate_Tax_Test_Pack_2025.xlsx').parsed;
    const an = load('Test_Al_Noor_Trading_FY2025.xlsx').parsed;
    let ws = applyParsedFiles(emptyWorkspace(), [ds]);
    ws = applyParsedFiles(ws, [an], 'replace');
    expect(ws.clientName).toBe('');
    expect(ws.suggestedClientName).toBe('AL NOOR TRADING LLC');
    ws = { ...ws, clientName: 'Al Noor Trading LLC' };
    ws = applyParsedFiles(ws, [ds], 'replace');
    expect(ws.clientName).toBe('Al Noor Trading LLC');
  });
});

describe('client name from a title or READ ME sentence', () => {
  it('stops at the legal ending', () => {
    expect(cleanCompanyName('Desert Star Office Supplies LLC – fictional UAE mainland resident company.')).toBe('Desert Star Office Supplies LLC');
    expect(cleanCompanyName('XYZ FZE - Annual report')).toBe('XYZ FZE');
    expect(cleanCompanyName('Acme Holdings Ltd, Dubai')).toBe('Acme Holdings Ltd');
    expect(cleanCompanyName('Gulf Co. LLC')).toBe('Gulf Co. LLC');
    expect(cleanCompanyName('ABC Trading L.L.C.')).toBe('ABC Trading L.L.C.');
    expect(cleanCompanyName('AL NOOR TRADING LLC')).toBe('AL NOOR TRADING LLC');
  });
});

describe('file type: only Corporate tax or VAT', () => {
  it('detects a workbook with only VAT sheets as VAT', () => {
    expect(load('VAT_Test_Pack_Q3_2026.xlsx').parsed.detected).toBe('vatdata');
    expect(load('UAE_Corporate_Tax_Test_Pack_2025.xlsx').parsed.detected).toBe('tb');
  });

  it('VAT on a workbook with a trial balance reads only the VAT sheets', () => {
    const { parsed } = load('UAE_Corporate_Tax_Test_Pack_2025.xlsx');
    const ws = applyParsedFiles(emptyWorkspace(), [{ ...parsed, kind: 'vatdata' }]);
    const ev = evaluate(ws);
    expect(ws.tbLines).toHaveLength(0);
    expect(ev.result.tax).toBe(0);
    expect(ev.vat.payable).toBe(44_500);
    expect(ev.flags.every((f) => f.id === 'VAT')).toBe(true);
  });

  it('VAT picked by hand on an unrecognised file still reads the registers', () => {
    const grids = parseFile(fixture('VAT_Test_Pack_Q3_2026.xlsx'), 'x.xlsx').grids;
    const forced = extractFromGrids(grids, 'x.xlsx', 'vatdata');
    expect([forced.sales?.length, forced.purchases?.length, forced.imports?.length]).toEqual([7, 6, 2]);
    expect(forced.tb).toBeUndefined();
  });
});
