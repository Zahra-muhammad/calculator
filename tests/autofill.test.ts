import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDateText, setProfileByUser, summaryText } from '../src/engine/autofill';
import { parseFile, parseWorkbook } from '../src/engine/parse';
import type { ParsedFile } from '../src/engine/types';
import { applyParsedFiles, emptyWorkspace, evaluate } from '../src/engine/workspace';
import { toBytes, workbook } from './helpers';

const FIXTURE = join(__dirname, 'fixtures', 'Test_Al_Noor_Trading_FY2025.xlsx');

function fromFiles(files: ParsedFile[]) {
  const ws = applyParsedFiles(emptyWorkspace(), files);
  return { ws, ev: evaluate(ws) };
}

function fixture() {
  return fromFiles([parseFile(new Uint8Array(readFileSync(FIXTURE)), 'Test_Al_Noor_Trading_FY2025.xlsx').parsed]);
}

const field = (ev: ReturnType<typeof evaluate>, key: string) => ev.fields.find((f) => f.key === key)!;

describe('auto-fill: Al Noor Trading fixture', () => {
  it('suggests the name (never fills it in) and fills the period and the derived answers', () => {
    const { ws, ev } = fixture();
    expect(ws.clientName).toBe('');
    expect(ws.suggestedClientName).toBe('AL NOOR TRADING LLC');
    expect(ws.autoFill.clientName).toBeUndefined();
    expect(ws.profile.periodStart).toBe('2025-01-01');
    expect(ws.profile.periodEnd).toBe('2025-12-31');
    expect(ws.autoFill.periodEnd?.source).toBe('P&L!A2');
    expect(ws.profile.legalForm).toBe('mainland');

    // SBR: No and locked, because revenue (P&L!C6, AED 7,880,000) is above AED 3M.
    expect(ev.profile.electSBR).toBe(false);
    expect(ev.sbrLocked).toBe(true);
    expect(field(ev, 'electSBR').locked).toBe('Not available: revenue is above AED 3M');
    expect(ws.autoFill.electSBR?.source).toBe('P&L!C6');

    // Earlier periods: 2024 revenue (P&L!D6, AED 5,200,000) is above AED 3M.
    expect(ws.profile.priorPeriodsUnder3M).toBe(false);
    expect(ws.autoFill.priorPeriodsUnder3M).toMatchObject({ kind: 'file', source: 'P&L!D6' });

    expect(ws.profile.electRealisation).toBe('na');
    expect(ws.profile.hasForeignIncome).toBe(false);
    expect(ws.autoFill.hasForeignIncome?.kind).toBe('suggested');
    expect(field(ev, 'hasTaxCertificates').visible).toBe(false);
    expect(field(ev, 'electForeignPE').visible).toBe(false);
    expect(ws.profile.ownershipChange).toBeUndefined();
  });

  it('leaves the rest for a person, with a reason, and counts them', () => {
    const { ev } = fixture();
    for (const k of ['clientName', 'groupRevenue', 'vatRevenue', 'trn', 'accountingStandard', 'audited', 'ownershipChange']) {
      expect(field(ev, k).answered, k).toBe(false);
      expect(field(ev, k).reason, k).toBeTruthy();
    }
    expect(field(ev, 'vatRevenue').reason).toContain('Upload the VAT returns');
    expect(field(ev, 'clientName').reason).toBe('Type the client name, or use the name found in the file.');
    expect(ev.fieldSummary).toEqual({ total: 14, auto: 7, user: 0, need: 7 });
    expect(summaryText(ev.fieldSummary)).toBe('7 of 14 answers filled from the file. 7 need you.');
  });
});

describe('auto-fill: free zone company (in-memory workbook)', () => {
  const wb = () =>
    workbook({
      Cover: [
        ['XYZ Technologies FZCO (Draft)'],
        ['Tax Registration Number', 100234567800003],
        ['Financial statements for the period from 1 March 2025 to 31 December 2025'],
        ['Prepared in accordance with IFRS for SMEs'],
      ],
      'P&L': [
        ['Statement of profit or loss for the period from 1 March 2025 to 31 December 2025'],
        ['', 2025],
        ['Revenue', 2_400_000],
        ['Profit before tax', 300_000],
      ],
    });

  it('reads FZCO, IFRS for SMEs, the TRN and the period from/to', () => {
    const { ws, ev } = fromFiles([parseFile(toBytes(wb()), 'xyz.xlsx').parsed]);
    expect(ws.suggestedClientName).toBe('XYZ Technologies FZCO');
    expect(ws.clientName).toBe('');
    expect(ws.profile.legalForm).toBe('free_zone');
    expect(ws.profile.accountingStandard).toBe('IFRS for SMEs');
    expect(ws.trn).toBe('100234567800003');
    expect(ws.autoFill.trn?.source).toBe('Cover!B2');
    expect(ws.profile.periodStart).toBe('2025-03-01');
    expect(ws.profile.periodEnd).toBe('2025-12-31');
    // Revenue is under AED 3M, so SBR stays open for a person.
    expect(ev.sbrLocked).toBe(false);
    expect(ws.profile.electSBR).toBeUndefined();
  });

  it("keeps a person's answer when the files are uploaded again", () => {
    const parsed = parseFile(toBytes(wb()), 'xyz.xlsx').parsed;
    const first = applyParsedFiles(emptyWorkspace(), [parsed]);
    const edited = setProfileByUser(first, { legalForm: 'qfzp', clientName: 'XYZ Tech FZCO' });
    expect(edited.autoFill.legalForm).toBeUndefined();
    const again = applyParsedFiles(edited, [parseFile(toBytes(wb()), 'xyz.xlsx').parsed], 'replace');
    expect(again.profile.legalForm).toBe('qfzp');
    expect(again.clientName).toBe('XYZ Tech FZCO');
    expect(again.profile.accountingStandard).toBe('IFRS for SMEs'); // still auto
    // Removing the file clears auto answers but not the person's.
    const removed = applyParsedFiles(again, [], 'replace');
    expect(removed.profile.accountingStandard).toBeUndefined();
    expect(removed.profile.legalForm).toBe('qfzp');
  });
});

describe('auto-fill rules', () => {
  const fs = (rows: unknown[][], extra: Record<string, unknown[][]> = {}) =>
    parseWorkbook(workbook({ 'P&L': [['Gulf Star Trading L.L.C.'], ...rows, ['Revenue', 1_000_000], ['Profit before tax', 100_000]], ...extra }), 'fs.xlsx');

  it('reads dates in the usual formats', () => {
    expect(parseDateText('31 December 2025')).toBe('2025-12-31');
    expect(parseDateText('December 31, 2025')).toBe('2025-12-31');
    expect(parseDateText('1st March 2025')).toBe('2025-03-01');
    expect(parseDateText('31/12/2025')).toBe('2025-12-31');
    expect(parseDateText('2025-12-31')).toBe('2025-12-31');
    expect(parseDateText('31 February 2025')).toBeUndefined();
  });

  it('suggests an ownership change from the text, but not when negated', () => {
    expect(fromFiles([fs([['During the year there was a transfer of shares to a new shareholder.']])]).ws.profile.ownershipChange).toBe(true);
    // A clear "no change" statement is read as No (it used to be left blank).
    const no = fromFiles([fs([['There was no change in ownership during the year.']])]).ws;
    expect(no.profile.ownershipChange).toBe(false);
    expect(no.autoFill.ownershipChange).toMatchObject({ kind: 'file', source: 'P&L!A2' });
  });

  it('suggests an ownership change when the shareholder table differs between years', () => {
    const { ws } = fromFiles([
      fs([], {
        Notes: [
          ['Shareholders', 2025, 2024],
          ['Mr. Saeed', '60%', '100%'],
          ['Mr. Omar', '40%', '0%'],
        ],
      }),
    ]);
    expect(ws.profile.ownershipChange).toBe(true);
    expect(ws.autoFill.ownershipChange).toMatchObject({ kind: 'suggested', source: 'Notes!A2' });
  });

  it('suggests foreign income from a branch note or a foreign income line, and then asks for certificates', () => {
    const branch = fromFiles([fs([['The Company has a branch in Muscat, Oman.']])]);
    expect(branch.ws.profile.hasForeignIncome).toBe(true);
    expect(branch.ws.profile.hasTaxCertificates).toBeUndefined();
    expect(field(branch.ev, 'hasTaxCertificates').visible).toBe(true);

    const tb = parseWorkbook(
      workbook({
        TB: [
          ['Account', 'Debit', 'Credit'],
          ['Sales - Saudi Arabia', null, 400_000],
          ['Rent', 400_000, null],
        ],
      }),
    );
    expect(fromFiles([tb]).ws.profile.hasForeignIncome).toBe(true);
  });

  it('leaves the realisation basis open when unrealised items exist', () => {
    const { ws, ev } = fromFiles([fs([['Unrealised gain on investments', 20_000]])]);
    expect(ws.profile.electRealisation).toBeUndefined();
    expect(field(ev, 'electRealisation').reason).toContain('Found at P&L!A2');
  });

  it('works out the legal form', () => {
    expect(fromFiles([fs([['The Company is registered with the Department of Economy and Tourism.']])]).ws.profile.legalForm).toBe('mainland');
    expect(fromFiles([fs([['The Company is a Qualifying Free Zone Person.']])]).ws.profile.legalForm).toBe('qfzp');
    expect(fromFiles([fs([['The Company is not a Qualifying Free Zone Person. It is licensed by JAFZA.']])]).ws.profile.legalForm).toBe('free_zone');
    expect(fromFiles([fs([['The Company is a member of a Tax Group.']])]).ws.profile.legalForm).toBe('tax_group');
    expect(fromFiles([fs([])]).ws.profile.legalForm).toBe('mainland'); // L.L.C. in the title, no free zone words
  });

  it('fills VAT-return revenue only when VAT returns are uploaded', () => {
    const vat = parseWorkbook(
      workbook({
        VAT: [
          ['Tax period', 'Standard rated supplies', 'Zero rated supplies', 'Exempt supplies'],
          ['Q1', 600_000, 0, 0],
          ['Q2', 400_000, 0, 0],
        ],
      }),
      'vat.xlsx',
    );
    const { ws, ev } = fromFiles([fs([]), vat]);
    expect(ws.profile.vatRevenue).toBe(1_000_000);
    expect(ws.autoFill.vatRevenue?.source).toContain('VAT returns: 2 periods');
    expect(field(ev, 'vatRevenue').answered).toBe(true);
  });

  it('unlocks SBR when revenue is corrected below the limit', () => {
    const { ws } = fixture();
    const fixed = { ...ws, headline: { ...ws.headline, revenue: { value: 2_000_000, byHand: true } } };
    expect(evaluate(fixed).sbrLocked).toBe(false);
  });
});
