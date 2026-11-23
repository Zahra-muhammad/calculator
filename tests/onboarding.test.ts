/**
 * Customer onboarding: the profile is filled from the Desert Star customer test pack
 * (company records workbook + auditor's report, director's confirmation and VAT note as PDFs),
 * reading the ANSWER next to each label, cross-checking the documents, and flagging conflicts.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { negatedAt, readFieldTables, sentenceEvidence, yesNo } from '../src/engine/evidence';
import { extractFromDocument, parseFile, parseWorkbook } from '../src/engine/parse';
import { readPdfText } from '../src/engine/pdftext';
import type { ParsedFile } from '../src/engine/types';
import { applyParsedFiles, emptyWorkspace, evaluate } from '../src/engine/workspace';
import { workbook } from './helpers';

const DIR = join(__dirname, 'fixtures', 'desert-star');
const RECORDS = 'Desert_Star_Company_Records_FY2025.xlsx';
const PDFS = ['Independent_Auditors_Report.pdf', 'Director_Confirmation.pdf', 'VAT_Reconciliation_Note.pdf'];

const records = () => parseFile(new Uint8Array(readFileSync(join(DIR, RECORDS))), RECORDS).parsed;
async function pdf(name: string, text?: string[]): Promise<ParsedFile> {
  const pages = text ? [{ page: 1, paragraphs: text }] : await readPdfText(new Uint8Array(readFileSync(join(DIR, name))));
  return extractFromDocument(pages, name).parsed;
}

let all: ParsedFile[];
beforeAll(async () => {
  all = [records(), ...(await Promise.all(PDFS.map((n) => pdf(n))))];
});

describe('Desert Star customer pack: the six reported problems', () => {
  it('1. reads the period start and end from the company record (and the PDFs agree)', () => {
    const ws = applyParsedFiles(emptyWorkspace(), all);
    expect(ws.profile.periodStart).toBe('2025-01-01');
    expect(ws.profile.periodEnd).toBe('2025-12-31');
    expect(ws.autoFill.periodEnd).toMatchObject({ source: "'Company Master'!B14", file: RECORDS, confirmedBy: 3 });
    expect(ws.autoFill.periodStart?.source).toBe("'Company Master'!B13");
  });

  it('2. legal form is Mainland (an LLC), not Tax group member: the label "Tax group status" is not an answer', () => {
    const ws = applyParsedFiles(emptyWorkspace(), all);
    expect(ws.profile.legalForm).toBe('mainland');
    expect(ws.autoFill.legalForm?.source).toBe("'Company Master'!B9");
    // The records workbook alone gives the same answer.
    expect(applyParsedFiles(emptyWorkspace(), [records()]).profile.legalForm).toBe('mainland');
  });

  it('3. foreign income / branch is No (the answer in B25 and the director\'s confirmation)', () => {
    const ws = applyParsedFiles(emptyWorkspace(), all);
    expect(ws.profile.hasForeignIncome).toBe(false);
    expect(ws.autoFill.hasForeignIncome).toMatchObject({ kind: 'file', source: "'Company Master'!B25", confirmedBy: 2 });
  });

  it("4. recognises the independent auditor's report PDF", () => {
    const report = all[1];
    expect(report.kind).toBe('doc');
    const keys = (report.evidence ?? []).map((e) => `${e.key}=${e.value}`);
    expect(keys).toEqual(expect.arrayContaining(['audited=true', 'periodEnd=2025-12-31', 'auditor=Crescent & Co. Chartered Accountants', 'auditReportDate=2026-03-18']));
    const ws = applyParsedFiles(emptyWorkspace(), all);
    expect(ws.profile.audited).toBe(true);
    expect(ws.autoFill.audited?.confirmedBy).toBe(2);
  });

  it("5. reads 'no change in ownership' from the director's confirmation", () => {
    const director = all[2];
    expect(director.evidence?.find((e) => e.key === 'ownershipChange')).toMatchObject({ value: false, ref: { sheet: 'page 1', cell: 'line 6' } });
    const ws = applyParsedFiles(emptyWorkspace(), all);
    expect(ws.profile.ownershipChange).toBe(false);
    expect(ws.autoFill.ownershipChange?.kind).toBe('file');
  });

  it('6. Small Business Relief is applied (period end found, every condition answered): corporate tax AED 0', () => {
    const ws = applyParsedFiles(emptyWorkspace(), all);
    expect(ws.profile).toMatchObject({ electSBR: true, priorPeriodsUnder3M: true, groupRevenue: 0 });
    const ev = evaluate(ws);
    expect(ev.result.sbr).toMatchObject({ elected: true, eligible: true, applied: true, failed: [], unconfirmed: [] });
    expect(ev.result.tax).toBe(0);
    // Without SBR the same file gives AED 4,140: PBT 436,000 + 8,000 entertainment + 7,000 fines − 30,000 dividend = 421,000.
    const off = evaluate({ ...ws, profile: { ...ws.profile, electSBR: false } });
    expect(off.result.pbt).toBe(436_000);
    expect(off.result.taxableAfterLoss).toBe(421_000);
    expect(Math.round(off.result.tax)).toBe(4_140);
  });

  it('fills the rest of the profile and finds no conflicts', () => {
    const ws = applyParsedFiles(emptyWorkspace(), all);
    expect(ws.trn).toBe('100582947300003');
    expect(ws.suggestedClientName).toBe('Desert Star Office Supplies LLC');
    expect(ws.clientName).toBe(''); // never filled in by itself
    expect(ws.profile).toMatchObject({ accountingStandard: 'IFRS', electRealisation: false, vatRevenue: 1_508_000 });
    expect(ws.profile.vatDifferenceNote).toMatch(/sales returns and credit notes/);
    expect(ws.docConflicts).toEqual([]);
    expect(evaluate(ws).flags.filter((f) => f.id === 'DOC')).toEqual([]);
  });

  it('a missing period end makes SBR "confirm first", not "not eligible"', () => {
    const ws = applyParsedFiles(emptyWorkspace(), all);
    const ev = evaluate({ ...ws, profile: { ...ws.profile, periodEnd: undefined, periodStart: undefined } });
    expect(ev.result.sbr.eligible).toBe(true);
    expect(ev.result.sbr.applied).toBe(false);
    expect(ev.result.sbr.unconfirmed.join()).toMatch(/Period end is not entered/);
  });
});

describe('conflicting or missing information is flagged, never guessed', () => {
  it('two documents disagree on ownership: left blank, HIGH flag naming both sources', async () => {
    const director = await pdf('Director_Confirmation.pdf', ['Desert Star Office Supplies LLC', 'During FY2025 there was a transfer of shares to a new shareholder.']);
    const ws = applyParsedFiles(emptyWorkspace(), [records(), director]);
    expect(ws.profile.ownershipChange).toBeUndefined();
    expect(ws.autoNotes.ownershipChange).toMatch(/disagree.*'Company Master'!B26 says “No”.*Director_Confirmation\.pdf › page 1, line 2 says “Yes”/);
    const flag = evaluate(ws).flags.find((f) => f.key === 'DOC:ownershipChange');
    expect(flag?.level).toBe('HIGH');
    // Once a person answers, the flag goes.
    const answered = { ...ws, profile: { ...ws.profile, ownershipChange: false }, userSet: { ...ws.userSet, ownershipChange: true } };
    expect(evaluate(answered).flags.some((f) => f.key === 'DOC:ownershipChange')).toBe(false);
  });

  it('period end differs between the record and the auditor: not filled, flagged', async () => {
    const report = await pdf('Independent_Auditors_Report.pdf', ['Independent Auditor’s Report', 'Desert Star Office Supplies LLC', 'Financial year ended 31 March 2025']);
    const ws = applyParsedFiles(emptyWorkspace(), [records(), report]);
    expect(ws.profile.periodEnd).toBeUndefined();
    expect(ws.docConflicts?.find((c) => c.field === 'periodEnd')?.items.map((i) => i.value)).toEqual(expect.arrayContaining(['31/12/2025', '31/03/2025']));
    // SBR is then asked for, not refused.
    expect(evaluate(ws).result.sbr.unconfirmed.join()).toMatch(/Period end/);
  });

  it('files for a different company: HIGH flag, no name suggested', async () => {
    const other = await pdf('Director_Confirmation.pdf', ['Palm Breeze Trading LLC', 'There was no change in ownership during FY2025.']);
    const ws = applyParsedFiles(emptyWorkspace(), [records(), other]);
    expect(ws.suggestedClientName).toBeUndefined();
    const flag = evaluate(ws).flags.find((f) => f.key === 'DOC:clientName');
    expect(flag?.level).toBe('HIGH');
    expect(flag?.message).toMatch(/different clients/);
  });

  it('an answer no document gives stays "needs you"', () => {
    const ws = applyParsedFiles(emptyWorkspace(), [records()]);
    const ev = evaluate({ ...ws, profile: { ...ws.profile, priorPeriodsUnder3M: undefined }, autoFill: { ...ws.autoFill, priorPeriodsUnder3M: undefined } });
    expect(ev.fields.find((f) => f.key === 'priorPeriodsUnder3M')?.answered).toBe(false);
  });
});

describe('the answer next to the label, not the label', () => {
  const ref = (g: { name: string }, r: number, c: number) => ({ sheet: g.name, cell: `${String.fromCharCode(65 + c)}${r + 1}` });
  const read = (rows: unknown[][]) => readFieldTables([{ name: 'S', rows: rows as never, maxCol: 3 }], 'f.xlsx', ref).evidence.map((e) => [e.key, e.value, e.ref?.cell]);

  it('reads Yes / No / sentences as answers', () => {
    expect(read([['Tax group status', 'Not a member of a Corporate Tax group']])).toEqual([['taxGroup', false, 'B1']]);
    expect(read([['Tax group member?', 'Yes']])).toEqual([['taxGroup', true, 'B1']]);
    expect(read([['Foreign income / foreign branch', 'No']])).toEqual([['foreign', false, 'B1']]);
    expect(read([['Foreign income / foreign branch', 'Yes – branch in Oman']])).toEqual([['foreign', true, 'B1']]);
    expect(read([['Free-zone status', 'Mainland UAE entity; not a Free Zone Person']])).toEqual([['freeZone', false, 'B1']]);
    expect(read([['Free-zone status', 'DMCC free zone company']])).toEqual([['freeZone', true, 'B1']]);
    expect(read([['Ownership change during FY2025', 'No']])).toEqual([['ownershipChange', false, 'B1']]);
    expect(read([['Financial year end', '31/12/2025']])).toEqual([['periodEnd', '2025-12-31', 'B1']]);
    expect(read([['Tax period', '1 January 2025 to 31 December 2025.']])).toEqual([
      ['periodStart', '2025-01-01', 'B1'],
      ['periodEnd', '2025-12-31', 'B1'],
    ]);
    expect(read([['Group revenue (AED)', 'Not applicable – standalone entity']])).toEqual([['groupRevenue', 0, 'B1']]);
    expect(read([['Unrealised fair value / revaluation / OCI items', 'None identified']])).toEqual([['realisationItems', false, 'B1']]);
  });

  it('a label with no answer gives nothing, and is not read as "yes" by the keyword rules', () => {
    const wb = workbook({
      Profile: [['Gulf Star Trading L.L.C.'], ['Foreign income / foreign branch', ''], ['Tax group status', ''], ['Unrealised fair value / revaluation / OCI items', '']],
      'P&L': [['Revenue', 1_000_000], ['Profit before tax', 100_000]],
    });
    const ws = applyParsedFiles(emptyWorkspace(), [parseWorkbook(wb, 'gs.xlsx')]);
    expect(ws.profile.legalForm).toBe('mainland'); // from "L.L.C." only (a guess), not "tax group"
    expect(ws.autoFill.hasForeignIncome?.source).toMatch(/no branch/); // not found, not "Yes"
    expect(ws.profile.electRealisation).toBe('na');
  });

  it('yesNo and clause-level negation', () => {
    expect(yesNo('Not a member of a multinational enterprise group')).toBe(false);
    expect(yesNo('None identified')).toBe(false);
    expect(yesNo('Yes')).toBe(true);
    expect(yesNo('Quarterly')).toBeUndefined();
    const s = 'it was not a member of a corporate tax group, vat group or multinational enterprise group, and had no foreign branch.';
    expect(negatedAt(s, s.indexOf('multinational'))).toBe(true);
    expect(negatedAt(s, s.indexOf('foreign'))).toBe(true);
    const t = 'the company was not audited last year but has a foreign branch in oman.';
    expect(negatedAt(t, t.indexOf('foreign'))).toBe(false);
  });

  it('reads the director\'s sentences', () => {
    const facts = (s: string) => sentenceEvidence(s, 'd.pdf', undefined).map((e) => `${e.key}=${e.value}`);
    expect(facts('It was not a member of a Corporate Tax group, VAT group or multinational enterprise group, and had no foreign branch.')).toEqual(['taxGroup=false', 'mneGroup=false', 'foreign=false']);
    expect(facts('The Company elected Small Business Relief for FY2025.')).toEqual(['electSBR=true']);
    expect(facts('SBR is not elected for this test.')).toEqual(['electSBR=false']);
    expect(facts('No earlier tax period exceeded AED 3 million.')).toEqual(['priorPeriodsUnder3M=true']);
    expect(facts('The Company did not elect the realisation basis.')).toEqual(['electRealisation=false']);
    expect(facts('There was no change in direct or indirect ownership during FY2025.')).toEqual(['ownershipChange=false']);
    expect(facts('The Company has a foreign branch in Oman.')).toEqual(['foreign=true']);
    expect(facts('The Company operated as a mainland UAE limited liability company throughout FY2025.')).toEqual(['freeZone=false']);
  });
});
