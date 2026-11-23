import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { suggestionToSubLine } from '../src/engine/gl';
import { parseFile, parseWorkbook } from '../src/engine/parse';
import { applyParsedFiles, emptyWorkspace, evaluate, glFromFiles, usedParts } from '../src/engine/workspace';
import { toBytes, workbook } from './helpers';

describe('Al Noor fixture: tax figures (cautious mode on, the default)', () => {
  const load = (withLoss = false) => {
    const f = parseFile(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'Test_Al_Noor_Trading_FY2025.xlsx'))), 'fixture.xlsx').parsed;
    const ws = applyParsedFiles(emptyWorkspace(), [f]);
    return withLoss ? { ...ws, headline: { ...ws.headline, lossesBF: [{ periodStart: '2024-01-01', amount: 150_000 }] } } : ws;
  };
  // The ANSWERS sheet's part A treats the Portfolio Management Fee as an AB-08 related-party fee (its note C).
  const asSheetPartA = { 'portfolio management fee': 'related_party_expense' as const };
  // The sheet adds back "Consultancy Fees" (no invoice). It is now added back only when staff answer "No evidence".
  const noEvidence = { 'consultancy fees': { supportEvidence: 'none' as const } };

  it('the Portfolio Management Fee is now sorted as AB-04 by itself', () => {
    const ev = evaluate(load());
    expect(ev.classified.find((l) => l.account === 'Portfolio Management Fee')?.category).toBe('exempt_income_cost');
  });

  it('truly nothing answered: the no-invoice consultancy fee is flagged, not added back → 54,000 / 864,000 / 44,010', () => {
    const ev = evaluate(load());
    expect(ev.result.totalAddBacks).toBe(54_000);
    expect(ev.result.taxableIncome).toBe(864_000);
    expect(ev.result.tax).toBe(44_010);
    const f = ev.flags.find((x) => x.key === 'AB-14:consultancy fees');
    expect(f).toMatchObject({ level: 'MEDIUM', amount: 25_000 });
    expect(f?.message).toMatch(/^Supporting evidence missing: Consultancy Fees/);
  });

  it('only "No evidence" answered, no loss: the ANSWERS sheet figures (fee in AB-08 as the sheet assumes) → 74,000 / 884,000 / 45,810', () => {
    const ev = evaluate({ ...load(), mappings: asSheetPartA, answers: noEvidence });
    expect(ev.result.totalAddBacks).toBe(74_000);
    expect(ev.result.taxableIncome).toBe(884_000);
    expect(ev.result.tax).toBe(45_810);
  });

  it('only "No evidence" answered, no loss, with the fee auto-sorted as AB-04 → 79,000 / 889,000 / 46,260', () => {
    const ev = evaluate({ ...load(), answers: noEvidence });
    expect(ev.result.totalAddBacks).toBe(79_000);
    expect(ev.result.taxableIncome).toBe(889_000);
    expect(ev.result.tax).toBe(46_260);
    // Director and car are not added back while unanswered; the director keeps one HIGH flag.
    const ab09 = ev.flags.filter((f) => f.id === 'AB-09');
    expect(ab09).toHaveLength(1);
    expect(ab09[0]).toMatchObject({ level: 'HIGH', amount: 700_000 });
  });

  it('loss of 150,000 entered → 32,310 (sheet assumption) and 32,760 (fee auto-sorted)', () => {
    expect(evaluate({ ...load(true), mappings: asSheetPartA, answers: noEvidence }).result.tax).toBe(32_310);
    const ev = evaluate({ ...load(true), answers: noEvidence });
    expect(ev.result.loss.used).toBe(150_000);
    expect(ev.result.tax).toBe(32_760);
  });

  it('market values, car 25%, fee auto-sorted as AB-04, overheads 400,000, total income 8,000,000, business purpose NOT answered → 54,810', () => {
    const ws = load(true);
    const ev = evaluate({
      ...ws,
      answers: {
        ...noEvidence,
        'directors remuneration': { marketValue: 500_000 },
        'management fees': { marketValue: 120_000 },
        'motor vehicle expenses': { privateUse: 0.25 },
      },
      headline: { ...ws.headline, sharedOverheads: { value: 400_000, byHand: true }, totalIncome: { value: 8_000_000, byHand: true } },
    });
    expect(ev.result.totalAddBacks).toBe(324_000);
    expect(ev.result.taxableIncome).toBe(1_134_000);
    expect(ev.result.taxableAfterLoss).toBe(984_000);
    expect(ev.result.tax).toBe(54_810);
  });
});

const dir = join(__dirname, '..', 'samples');
const names = ['sample-company.xlsx', 'sample-general-ledger.xlsx', 'sample-vat-returns.csv', 'sample-related-parties.csv'];

function loadSample() {
  const files = names.map((n) => parseFile(new Uint8Array(readFileSync(join(dir, n))), n).parsed);
  const ws = applyParsedFiles(emptyWorkspace(), files, 'merge');
  return { files, ws, gl: glFromFiles(files) };
}

describe('end to end on the sample files', () => {
  it('detects every file type', () => {
    const { files } = loadSample();
    expect(files.map((f) => f.detected)).toEqual(['fs_tb', 'gl', 'vat', 'rp']);
  });

  it('computes the expected tax in cautious mode', () => {
    const { ws, gl } = loadSample();
    expect(ws.profile.periodEnd).toBe('2025-12-31');
    expect(ws.profile.periodStart).toBe('2025-01-01');
    expect(ws.profile.audited).toBe(true);
    const ev = evaluate(ws, gl);
    expect(ev.result.pbt).toBe(410_000);
    expect(ev.pbtSource).toBe('P&L!C9');
    // "Professional fees" has no invoice: flagged, and not added back until staff answer.
    expect(ev.result.totalAddBacks).toBe(37_500);
    expect(ev.result.taxableIncome).toBe(397_500);
    expect(ev.result.tax).toBe(2_025);
    expect(ev.flags.find((f) => f.key === 'AB-14:professional fees')?.message).toContain('Supporting evidence missing');

    const noEvidence = evaluate({ ...ws, answers: { 'professional fees': { supportEvidence: 'none' } } }, gl);
    expect(noEvidence.result.totalAddBacks).toBe(62_500);
    expect(noEvidence.result.taxableIncome).toBe(422_500);
    expect(noEvidence.result.tax).toBe(4_275);
    expect(noEvidence.flags.some((f) => f.id === 'AB-14')).toBe(false);
  });

  it('finds hidden VAT, connected persons, balances with the director and the VAT gap', () => {
    const { ws, gl } = loadSample();
    const ev = evaluate(ws, gl);
    expect(ev.hiddenVat).toHaveLength(1);
    expect(ev.hiddenVat[0]).toMatchObject({ parentKey: 'office expenses', amount: 3_000 });
    // One AB-07 flag per hidden-VAT sub-line (no duplicate).
    expect(ev.flags.filter((f) => f.id === 'AB-07')).toHaveLength(1);
    // The connected persons have their own AB-09 flags, so no RV-04 "TP support missing" list.
    expect(ev.flags.some((f) => f.key === 'RV-04:tp-support')).toBe(false);
    expect(ev.flags.filter((f) => f.id === 'AB-09' && f.level === 'HIGH')).toHaveLength(2);
    const key = (k: string) => ev.flags.find((f) => f.key === k);
    expect(key('RV-04:person-ahmed-ali')?.amount).toBe(510_000);
    expect(ev.flags.some((f) => f.id === 'RV-05' && f.level === 'HIGH')).toBe(true);
    expect(key('RV-03:vat')?.level).toBe('MEDIUM');
    expect(key('RV-02:audit')?.level).toBe('PASS');
    expect(ev.flags.some((f) => f.key === 'DATA:tb-vs-pbt')).toBe(false);
    expect(ev.flags.some((f) => f.key === 'DATA:bs-balance')).toBe(false);
  });

  it('answers questions and GL suggestions change the tax as expected', () => {
    const { ws, gl } = loadSample();
    const ev = evaluate(ws, gl);
    expect(ev.glSuggestions.map((s) => [s.category, s.total])).toEqual([
      ['personal', 6_500],
      ['fines', 1_500],
      ['entertainment_client', 750],
    ]);
    const fines = ev.glSuggestions.find((s) => s.category === 'fines')!;
    expect(fines.message).toBe('2 transactions, AED 1,500, look like fines or penalties inside Office expenses.');

    const answered = {
      ...ws,
      subLines: [suggestionToSubLine(fines)],
      answers: {
        // Line keys are the normalised account names.
        'professional fees': { supportEvidence: 'none' as const },
        'directors remuneration ahmed ali': { businessPurpose: 'yes' as const, marketValue: 360_000 },
        'salary mariam ali': { businessPurpose: 'yes' as const, marketValue: 120_000 },
        'motor vehicle running costs': { privateUse: 0.2 },
        'office expenses::hidden-vat': { vatRecoverable: 'yes' as const },
      },
    };
    const ev2 = evaluate(answered, gl);
    // 62,500 + 30,000 (Mariam above market) + 6,000 (car 20%) + 1,500 (GL fines)
    expect(ev2.result.totalAddBacks).toBe(100_000);
    expect(ev2.result.taxableIncome).toBe(460_000);
    expect(ev2.result.tax).toBe(7_650);
  });
});

describe('workspace inputs added in the review', () => {
  const base = () => {
    const ws = emptyWorkspace();
    ws.headline.pbt = { value: 1_375_000, byHand: true };
    ws.profile.periodEnd = '2025-12-31';
    return ws;
  };

  it('passes the foreign tax credit inputs to the computation', () => {
    const ws = { ...base(), headline: { ...base().headline, foreignTax: [{ country: 'Oman', income: 500_000, taxPaid: 10_000 }] }, deadlines: { taxPaidDate: '2026-10-01' } };
    const ev = evaluate(ws);
    expect(ev.result.taxBeforeCredits).toBe(90_000);
    expect(ev.result.tax).toBe(80_000);
    // Late payment uses the tax after the credit: 80,000 × 14% ÷ 12 × 1 month.
    expect(ev.deadlines.penalties.latePayment).toBe(933.33);
  });

  it('a natural person (business type) gets the natural-person registration rule by default', () => {
    const ws = base();
    ws.profile.businessType = 'natural_person';
    ws.deadlines = { turnover: 1_500_000 };
    const ev = evaluate(ws);
    expect(ev.deadlines.registrantType).toBe('natural_person');
    expect(ev.deadlines.registrationDue).toBe('2026-03-31');
    // A choice made in the Deadlines section wins.
    expect(evaluate({ ...ws, deadlines: { registrantType: 'company', incorporationDate: '2025-02-28' } }).deadlines.registrationDue).toBe('2025-05-28');
  });

  it('"Donations" of 10,000 are added back in full (10,000) unless staff choose "approved charity"', () => {
    const ws = base();
    ws.tbLines = [
      { key: 'sales', row: 2, sheet: 'TB', account: 'Sales', debit: 0, credit: 1_500_000, balance: -1_500_000, comment: '' },
      { key: 'donations', row: 3, sheet: 'TB', account: 'Donations', debit: 10_000, credit: 0, balance: 10_000, comment: '' },
    ];
    const ev = evaluate(ws);
    expect(ev.classified.find((l) => l.key === 'donations')?.category).toBe('donation_unlisted');
    expect(ev.result.addBacks.filter((a) => a.lineKey === 'donations').map((a) => [a.ruleId, a.amount])).toEqual([['AB-03', 10_000]]);
    expect(ev.result.totalAddBacks).toBe(10_000);
    const approved = evaluate({ ...ws, mappings: { donations: 'donation_listed' } });
    expect(approved.result.totalAddBacks).toBe(0);
  });

  it('the SBR lock uses total revenue for the SBR test, not revenue alone', () => {
    const ws = applyParsedFiles(emptyWorkspace(), []);
    ws.headline.revenue = { value: 2_950_000, byHand: true };
    ws.tbLines = [
      { key: 'sales', row: 2, sheet: 'TB', account: 'Sales', debit: 0, credit: 2_950_000, balance: -2_950_000, comment: '' },
      { key: 'other income', row: 3, sheet: 'TB', account: 'Other income', debit: 0, credit: 100_000, balance: -100_000, comment: '' },
    ];
    expect(evaluate(ws).sbrLocked).toBe(true);
    const left = { ...ws, answers: { 'other income': { revenueTest: false, revenueTestReason: 'One-off insurance refund' } } };
    expect(evaluate(left).sbrLocked).toBe(false);
  });
});

describe('UAE CT test pack (Desert Star Office Supplies): every sheet is read on its own', () => {
  const PACK = join(__dirname, 'fixtures', 'UAE_Corporate_Tax_Test_Pack_2025.xlsx');
  const kept = () => new Uint8Array(readFileSync(PACK));
  const deleted = () => {
    const wb = XLSX.read(kept(), { type: 'array', cellDates: true });
    wb.SheetNames = wb.SheetNames.filter((n) => n !== 'Expected Results');
    delete wb.Sheets['Expected Results'];
    return toBytes(wb);
  };
  const roles = [
    ['READ ME', 'other'],
    ['Trial Balance', 'tb'],
    ['General Ledger', 'gl'],
    ['Sales Invoices', 'sales'],
    ['Purchase Receipts', 'purchases'],
    ['Related Parties', 'rp'],
  ];

  for (const [label, bytes, sheetRoles] of [
    ['kept', kept, [...roles, ['Expected Results', 'answers']]],
    ['deleted', deleted, roles],
  ] as const) {
    it(`Expected Results ${label}: detected as a trial balance, PBT 580,000 from the TB, taxable 570,000, tax 17,550`, () => {
      const p = parseFile(bytes(), 'UAE_Corporate_Tax_Test_Pack_2025.xlsx').parsed;
      expect(p.detected).toBe('tb');
      expect(p.kind).toBe('tb');
      expect(p.sheets?.map((s) => [s.name, s.role])).toEqual(sheetRoles);
      // The other sheets are read and used too.
      expect(usedParts(p)).toMatchObject({ tb: expect.anything(), gl: expect.any(Array), rp: expect.any(Array), sales: expect.any(Array), purchases: expect.any(Array) });
      expect([p.gl?.length, p.rp?.length, p.sales?.length, p.purchases?.length]).toEqual([9, 1, 4, 5]);
      expect(p.warnings.some((w) => /not recognised/i.test(w))).toBe(false);

      const ws = applyParsedFiles(emptyWorkspace(), [p]);
      expect(ws.relatedParties.map((r) => r.name)).toEqual(['UAE Subsidiary']);
      const ev = evaluate(ws, glFromFiles([p]));
      expect(ev.result.pbt).toBe(580_000);
      expect(ev.pbtSource).toBe('Trial balance (sum of P&L lines)');
      const f = ev.flags.find((x) => x.key === 'DATA:pbt-from-tb');
      expect(f).toMatchObject({ id: 'DATA', level: 'DATA', amount: 580_000 });
      expect(f?.message).toMatch(/^PBT taken from the trial balance/);
      expect(ev.result.totalAddBacks).toBe(20_000);
      expect(ev.result.totalDeductions).toBe(30_000);
      expect(ev.result.taxableIncome).toBe(570_000);
      expect(ev.result.tax).toBe(17_550);
      // VAT from the invoice sheets.
      expect(ev.vat).toMatchObject({ outputVat: 75_000, inputRecoverable: 30_500, inputBlocked: 1_000, payable: 44_500 });
      // The ledger is scanned (9 transactions, nothing hidden).
      expect(glFromFiles([p])).toHaveLength(9);
      expect(ev.glSuggestions).toEqual([]);
    });
  }

  it('a workbook with a trial balance is at least "Trial balance", never "VAT returns" or "not recognised"', () => {
    const p = parseWorkbook(
      workbook({
        'Sales Invoices': [
          ['Invoice No', 'Date', 'Customer', 'Net', 'VAT Rate', 'VAT', 'Gross'],
          ['S-1', '2025-03-01', 'A LLC', 100_000, '5%', 5_000, 105_000],
        ],
        'VAT Return': [
          ['Period', 'Standard rated supplies', 'Zero rated supplies', 'Exempt supplies', 'Input tax'],
          ['2025-Q1', 100_000, 0, 0, 2_000],
        ],
        'Trial Balance': [
          ['Account', 'Debit', 'Credit'],
          ['Bank', 60_000, null],
          ['Sales', null, 100_000],
          ['Rent', 40_000, null],
        ],
      }),
      'mixed.xlsx',
    );
    expect(p.detected).toBe('tb');
    expect(p.sheets?.map((s) => s.role)).toEqual(['sales', 'vat', 'tb']);
    const ev = evaluate(applyParsedFiles(emptyWorkspace(), [p]));
    expect(ev.result.pbt).toBe(60_000);
    expect(ev.vat.outputVat).toBe(5_000);
    // Choosing one type by hand uses only that part.
    expect(usedParts({ ...p, kind: 'vat' })).toMatchObject({ tb: undefined, sales: undefined, vat: expect.any(Array) });
  });
});

