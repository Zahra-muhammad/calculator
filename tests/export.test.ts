import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { exportFileName, workingPaper } from '../src/engine/export';
import { clientReport, pdfText } from '../src/engine/pdf';
import { parseFile } from '../src/engine/parse';
import { applyParsedFiles, emptyWorkspace, evaluate } from '../src/engine/workspace';

function sample() {
  const f = parseFile(new Uint8Array(readFileSync(join(__dirname, '..', 'samples', 'sample-company.xlsx'))), 'sample-company.xlsx').parsed;
  const ws = { ...applyParsedFiles(emptyWorkspace(), [f]), clientName: 'Al Noor Trading LLC', trn: '100123456700003' };
  ws.resolved = { 'RV-05:due from director ahmed ali': { note: 'Benchmark on file', at: '2026-11-11T09:00:00Z' } };
  return { ws, ev: evaluate(ws) };
}

describe('Excel working paper', () => {
  it('has the six sheets plus sources, and the computation agrees with the engine', () => {
    const { ws, ev } = sample();
    const wb = XLSX.read(workingPaper(ws, ev), { type: 'array' });
    expect(wb.SheetNames).toEqual(['Computation', 'Add-backs detail', 'Red flags', 'Account mapping', 'Deadlines', 'Settings used', 'Sources']);
    const comp = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Computation, { header: 1 });
    const taxRow = comp.find((r) => r[1] === 'Corporate tax');
    expect(taxRow?.[3]).toBe(ev.result.tax);
    const flags = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Red flags']);
    expect(flags.find((f) => f.Note === 'Benchmark on file')?.Resolved).toBe('Yes');
    const mapping = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Account mapping']);
    expect(mapping.length).toBeGreaterThan(20);
    expect(exportFileName(ws, 'xlsx')).toBe('CT-Al Noor Trading LLC-2025-12-31.xlsx');
  });

  it('shows the foreign tax credit, the total revenue for SBR / QFZP tests with reasons, and late payment in months', () => {
    const { ws } = sample();
    const next = {
      ...ws,
      headline: { ...ws.headline, foreignTax: [{ country: 'Oman', income: 100_000, taxPaid: 1_000 }] },
      answers: { ...ws.answers, 'professional fees': { supportEvidence: 'none' as const }, 'dividend income': { revenueTest: false, revenueTestReason: 'Exempt dividend' } },
    };
    const ev = evaluate(next);
    expect(ev.result.foreignTaxCredit.credit).toBe(1_000);
    const wb = XLSX.read(workingPaper(next, ev), { type: 'array' });
    const comp = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Computation, { header: 1 });
    const row = (label: string) => comp.find((r) => typeof r[1] === 'string' && (r[1] as string).startsWith(label));
    expect(row('Corporate tax before credits')?.[3]).toBe(ev.result.taxBeforeCredits);
    expect(row('Foreign tax credit')?.[3]).toBe(-1_000);
    expect(row('Corporate tax payable')?.[3]).toBe(ev.result.tax);
    expect(row('Total revenue for SBR / QFZP tests')?.[3]).toBe(ev.result.ctRevenue.total);
    expect(row('  Left out: Dividend income')?.[1]).toContain('Reason: Exempt dividend');
    const src = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Sources, { header: 1 });
    expect(src.find((r) => r[0] === 'Foreign tax paid, Oman')?.[1]).toBe(1_000);
    const dl = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Deadlines, { header: 1 });
    expect(dl.some((r) => typeof r[0] === 'string' && /^Late payment penalty \(\d+ month\(s\)/.test(r[0] as string))).toBe(true);
  });
});

describe('Excel working paper: VAT', () => {
  it('adds a VAT sheet with the summary, both registers and the input VAT treatment when registers are uploaded', () => {
    const f = parseFile(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'UAE_Corporate_Tax_Test_Pack_2025.xlsx'))), 'pack.xlsx').parsed;
    const ws = applyParsedFiles(emptyWorkspace(), [f]);
    const ev = evaluate(ws);
    const wb = XLSX.read(workingPaper(ws, ev), { type: 'array' });
    expect(wb.SheetNames).toContain('VAT');
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.VAT, { header: 1 });
    const value = (label: string) => rows.find((r) => r[0] === label)?.[1];
    expect(value('Output VAT (Box 8)')).toBe(75_000);
    expect(value('Input VAT recoverable (Box 11)')).toBe(30_500);
    expect(value('Input VAT blocked (Executive Regulation Art. 53)')).toBe(1_000);
    expect(value('VAT payable (Box 14)')).toBe(44_500);
    // The VAT return boxes.
    const box = (id: string) => rows.find((r) => r[0] === id && typeof r[1] === 'string' && r[1] !== '');
    expect(box('9')?.[3]).toBe(30_500);
    expect(box('14')?.[3]).toBe(44_500);
    const dinner = rows.find((r) => r[1] === 'R-003');
    expect(dinner?.[9]).toBe('Blocked');
    expect(rows.filter((r) => r[0] === 'Total').map((r) => r[7])).toEqual([75_000, 31_500]);
    // A file with no registers gets no VAT sheet.
    const { ws: plain, ev: plainEv } = sample();
    expect(XLSX.read(workingPaper(plain, plainEv), { type: 'array' }).SheetNames).not.toContain('VAT');
  });
});

describe('PDF report', () => {
  it('produces a PDF of one or two pages', () => {
    const { ws, ev } = sample();
    const bytes = clientReport(ws, ev);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF')).toBe(true);
    const pages = (text.match(/\/Type \/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(pages).toBeLessThanOrEqual(2);
  });

  it('keeps text inside the PDF font range', () => {
    expect(pdfText('AED −1,000 — “ok” ≤ 5')).toBe('AED -1,000 - "ok" <= 5');
  });
});
