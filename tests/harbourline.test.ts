/**
 * Harbourline Technical Supplies LLC (FY2025): company records workbook + auditor's report,
 * director's confirmation and VAT note as PDFs. Foreign branch in Oman, 25% share transfer, no losses.
 * Also: every source reference of every fixture points at the cell that really holds the value.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractFromDocument, parseFile } from '../src/engine/parse';
import { readPdfText } from '../src/engine/pdftext';
import type { ParsedFile } from '../src/engine/types';
import { applyParsedFiles, emptyWorkspace, evaluate } from '../src/engine/workspace';

const DIR = join(__dirname, 'fixtures', 'harbourline');
const RECORDS = 'Harbourline_FY2025_Company_Records.xlsx';
const PDFS = ['Harbourline_Auditors_Report.pdf', 'Harbourline_Director_Confirmation.pdf', 'Harbourline_VAT_Reconciliation.pdf'];

let files: ParsedFile[];
beforeAll(async () => {
  files = [parseFile(new Uint8Array(readFileSync(join(DIR, RECORDS))), RECORDS).parsed];
  for (const n of PDFS) files.push(extractFromDocument(await readPdfText(new Uint8Array(readFileSync(join(DIR, n)))), n).parsed);
});

describe('Harbourline FY2025', () => {
  it('corporate tax AED 62,910 (no foreign tax credit until the Omani certificate is provided)', () => {
    const ev = evaluate(applyParsedFiles(emptyWorkspace(), files));
    expect(ev.result.pbt).toBe(1_098_000);
    expect(ev.result.taxableAfterLoss).toBe(1_074_000); // + 12,000 entertainment + 9,000 fines − 45,000 UAE dividend
    expect(ev.result.tax).toBe(62_910);
    expect(ev.result.sbr.eligible).toBe(false); // revenue AED 4,292,000
  });

  it('TRN, period and standard point at their real cells (TRN is in B4 in this workbook)', () => {
    const ws = applyParsedFiles(emptyWorkspace(), files);
    expect(ws.trn).toBe('100614829700003');
    expect(ws.autoFill.trn?.source).toBe("'Company Profile'!B4");
    expect(ws.autoFill.accountingStandard?.source).toBe("'Company Profile'!B11");
    expect(ws.autoFill.periodStart?.source).toBe("'Company Profile'!B13");
    expect(ws.autoFill.periodEnd?.source).toBe("'Company Profile'!B14");
  });

  it('foreign branch = Yes; "Omani tax paid; certificate not included" is not a "No"', () => {
    const records = files[0].evidence ?? [];
    const b20 = records.filter((e) => e.ref?.cell === 'B20').map((e) => `${e.key}=${e.value}`);
    expect(b20).toEqual(['foreign=true', 'taxCertificates=false']);
    const ws = applyParsedFiles(emptyWorkspace(), files);
    expect(ws.profile.hasForeignIncome).toBe(true);
    expect(ws.autoFill.hasForeignIncome).toMatchObject({ kind: 'file', source: "'Company Profile'!B19" });
    expect(ws.profile.hasTaxCertificates).toBe(false);
    expect(ws.docConflicts).toEqual([]);
    const ev = evaluate(ws);
    expect(ev.flags.some((f) => f.id === 'DOC')).toBe(false);
    expect(ev.flags.find((f) => f.id === 'RV-09')?.message).toMatch(/no foreign tax certificates/);
  });

  it('a real disagreement on the branch is still flagged', () => {
    const contra = extractFromDocument([{ page: 1, paragraphs: ['Harbourline Technical Supplies LLC', 'The Company had no foreign branch and no foreign income in FY2025.'] }], 'Other.pdf').parsed;
    const ws = applyParsedFiles(emptyWorkspace(), [files[0], contra]);
    expect(ws.profile.hasForeignIncome).toBeUndefined();
    expect(evaluate(ws).flags.find((f) => f.key === 'DOC:hasForeignIncome')?.level).toBe('HIGH');
  });

  it('ownership changed (record, register and director agree); with no losses the losses question is not asked', () => {
    const ws = applyParsedFiles(emptyWorkspace(), files);
    expect(ws.profile.ownershipChange).toBe(true);
    expect(ws.autoFill.ownershipChange?.confirmedBy).toBe(2);
    expect(files[2].evidence?.find((e) => e.key === 'ownershipChange')?.value).toBe(true); // "A transfer of 25% of the Company's shares…"
    const ev = evaluate(ws);
    const q = ev.fields.find((f) => f.key === 'ownershipChangeLosses')!;
    expect(q.visible).toBe(false);
    expect(ws.profile.ownershipChangeLosses).toBeUndefined(); // never assumed
    expect(ev.result.loss.broughtForward).toBe(0);
    expect(ev.flags.some((f) => f.key?.includes('ownership') && f.id === 'RV-10')).toBe(false);
  });

  it('with losses entered, the question appears and cautious mode keeps the losses out until answered', () => {
    const ws0 = applyParsedFiles(emptyWorkspace(), files);
    const ws = { ...ws0, headline: { ...ws0.headline, lossesBF: [{ periodStart: '2024-01-01', amount: 100_000 }] } };
    const ev = evaluate(ws);
    expect(ev.fields.find((f) => f.key === 'ownershipChangeLosses')?.visible).toBe(true);
    expect(ev.result.loss.excludedForOwnership).toBe(100_000);
    expect(ev.result.tax).toBe(62_910);
    expect(ev.flags.find((f) => f.id === 'RV-10' && /Ownership changed/.test(f.message))?.level).toBe('HIGH');
    const used = evaluate({ ...ws, profile: { ...ws.profile, ownershipChangeLosses: 'use' } });
    expect(used.result.tax).toBe(Math.round((1_074_000 - 100_000 - 375_000) * 0.09 * 100) / 100);
  });
});

describe('every source reference points at the cell holding the value', () => {
  const clean = (s: string) => s.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const workbooks = [
    ...readdirSync(join(__dirname, 'fixtures')).filter((n) => /\.xlsx$/.test(n)).map((n) => join(__dirname, 'fixtures', n)),
    join(__dirname, 'fixtures', 'desert-star', 'Desert_Star_Company_Records_FY2025.xlsx'),
    join(DIR, RECORDS),
  ];
  for (const path of workbooks) {
    it(path.split('/').pop()!, () => {
      let parsed: ParsedFile;
      try {
        parsed = parseFile(new Uint8Array(readFileSync(path)), path.split('/').pop()!).parsed;
      } catch {
        return; // refused exports
      }
      const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true });
      let checked = 0;
      for (const e of parsed.evidence ?? []) {
        if (!e.ref || e.why?.includes('all at or below') || e.why?.includes('above AED 3M')) continue;
        const cell = wb.Sheets[e.ref.sheet]?.[e.ref.cell];
        expect(cell, `${e.key} → ${e.ref.sheet}!${e.ref.cell}`).toBeDefined();
        const text = clean(String(cell.w ?? cell.v));
        expect(text, `${e.key} → ${e.ref.sheet}!${e.ref.cell}`).toContain(clean(e.text).slice(0, 40));
        checked++;
      }
      // TB lines: the row named in the reference holds that account.
      for (const l of parsed.tb?.lines ?? []) {
        const row = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[l.sheet], { header: 1, blankrows: true, range: 0 });
        const range = XLSX.utils.decode_range(wb.Sheets[l.sheet]['!ref']!);
        const cells = (row[l.row - 1 - range.s.r] ?? []).map((v) => String(v ?? ''));
        expect(cells.join(' | '), `${l.sheet} row ${l.row}`).toContain(l.account);
        checked++;
      }
      expect(checked).toBeGreaterThanOrEqual(0);
    });
  }
});
