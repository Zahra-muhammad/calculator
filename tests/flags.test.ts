import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { computeWithFlags } from '../src/engine/flags';
import { parseWorkbook } from '../src/engine/parse';
import { applyParsedFiles, emptyWorkspace, evaluate } from '../src/engine/workspace';
import { exp, workbook } from './helpers';

function evalWorkbook(wb: XLSX.WorkBook) {
  const parsed = parseWorkbook(wb, 'client.xlsx');
  const ws = applyParsedFiles(emptyWorkspace(), [parsed]);
  return evaluate(ws);
}

describe('balance-sheet lines above Sales', () => {
  const ev = () =>
    evalWorkbook(
      workbook({
        'P&L': [
          ['Gulf Star Trading LLC'],
          ['Revenue', 1_000_000],
          ['Profit before tax', 400_000],
        ],
        TB: [
          ['Account', 'Debit', 'Credit'],
          ['Cash at bank', 200_000, null],
          ['Loan to Related Party', 250_000, null],
          ['Furniture & Fixtures', 120_000, null],
          ['Accum-Depreciation. F&F', null, 40_000],
          ['Prepaid License Fee', 12_000, null],
          ['Share capital', null, 300_000],
          ['Retained earnings', 158_000, null],
          ['Sales', null, 1_000_000],
          ['Portfolio Management Fee', 5_000, null],
          ['Management Services', 60_000, null],
          ['Salaries', 400_000, null],
          ['Rent', 135_000, null],
        ],
      }),
    );

  it('sorts them as balance sheet and the P&L lines into the right buckets', () => {
    const e = ev();
    const cat = (a: string) => e.classified.find((l) => l.account === a)?.category;
    expect(cat('Loan to Related Party')).toBe('balance_sheet');
    expect(cat('Accum-Depreciation. F&F')).toBe('balance_sheet');
    expect(cat('Prepaid License Fee')).toBe('balance_sheet');
    expect(cat('Portfolio Management Fee')).toBe('exempt_income_cost');
    expect(cat('Management Services')).toBe('related_party_expense');
  });

  it('raises RV-05 HIGH for the loan, adds nothing back for it, and the TB profit matches PBT', () => {
    const e = ev();
    expect(e.flags.find((f) => f.id === 'RV-05')).toMatchObject({ level: 'HIGH', amount: 250_000 });
    expect(e.result.addBacks.some((a) => a.account === 'Loan to Related Party')).toBe(false);
    expect(e.result.totalAddBacks).toBe(5_000); // only the portfolio fee (AB-04); management services wait for a market value
    expect(e.flags.some((f) => f.key === 'DATA:tb-vs-pbt')).toBe(false);
    expect(e.flags.some((f) => f.key === 'DATA:tb-balance')).toBe(false);
  });
});

describe('final review: connected persons, drawings and connected income', () => {
  const tbEval = (rows: unknown[][]) =>
    evalWorkbook(
      workbook({
        TB: [['Account', 'Debit', 'Credit'], ['Sales', null, 2_000_000], ...rows],
      }),
    );

  it('counts interest paid to the director towards the AED 500,000 disclosure', () => {
    const e = tbEval([
      ["Director's remuneration", 450_000, null],
      ['Interest on loan from director', 60_000, null],
      ['Loan from director', null, 1_000_000],
    ]);
    expect(e.classified.find((l) => l.account === 'Interest on loan from director')?.category).toBe('interest_expense');
    const f = e.flags.find((x) => x.key === 'RV-04:person-director');
    expect(f).toMatchObject({ level: 'HIGH', amount: 510_000 });
  });

  it('treats drawings as balance sheet with an RV-05 HIGH flag, never towards the AED 500,000', () => {
    const e = tbEval([
      ["Owner's drawings", 400_000, null],
      ['Owner salary', 300_000, null],
    ]);
    expect(e.classified.find((l) => l.account === "Owner's drawings")?.category).toBe('balance_sheet');
    expect(e.flags.find((f) => f.id === 'RV-05')).toMatchObject({ level: 'HIGH', amount: 400_000 });
    expect(e.flags.some((f) => f.id === 'RV-04' && f.key.startsWith('RV-04:person'))).toBe(false); // 300,000 only
    expect(e.result.addBacks.some((a) => a.account === "Owner's drawings")).toBe(false);
  });

  it('flags income from a connected person (MEDIUM RV-04)', () => {
    const e = tbEval([['Rent income from director', null, 24_000]]);
    const f = e.flags.find((x) => x.key === 'RV-04:income-rent income from director');
    expect(f).toMatchObject({ level: 'MEDIUM', amount: 24_000 });
    expect(f?.message).toContain('confirm it is at market value');
  });
});

describe('RV-04 transfer pricing support', () => {
  it('lists related-party expenses only, not connected persons (they have their own AB-09 flag)', () => {
    const cp = exp('connected_person_payment', 300_000, 'Director salary');
    const rp = exp('related_party_expense', 150_000, 'Management fees');
    const { flags } = computeWithFlags({ pbt: 1_000_000, lines: [cp, rp] });
    const tp = flags.find((f) => f.key === 'RV-04:tp-support');
    expect(tp?.message).toContain('Management fees');
    expect(tp?.message).not.toContain('Director salary');
    expect(tp?.amount).toBe(150_000);
    expect(flags.filter((f) => f.id === 'AB-09')).toHaveLength(1);
    expect(computeWithFlags({ pbt: 1_000_000, lines: [cp] }).flags.some((f) => f.key === 'RV-04:tp-support')).toBe(false);
  });
});

describe('test 17: data checks', () => {
  it('raises a DATA flag when TB debits do not equal credits', () => {
    const ev = evalWorkbook(
      workbook({
        TB: [
          ['Account', 'Debit', 'Credit'],
          ['Rent', 10_000, null],
          ['Sales', null, 9_000],
        ],
      }),
    );
    const f = ev.flags.find((x) => x.key === 'DATA:tb-balance');
    expect(f?.level).toBe('DATA');
    expect(f?.amount).toBe(1_000);
  });

  it('raises a DATA flag when the balance sheet is off by 500,000', () => {
    const ev = evalWorkbook(
      workbook({
        'Balance sheet': [
          ['Total assets', 3, 2_000_000, 1_800_000],
          ['Total equity and liabilities', '', 1_500_000, 1_800_000],
        ],
        'P&L': [
          ['Revenue', 1_000_000],
          ['Profit before tax', 100_000],
        ],
      }),
    );
    const f = ev.flags.find((x) => x.key === 'DATA:bs-balance');
    expect(f?.level).toBe('DATA');
    expect(f?.amount).toBe(500_000);
    expect(f?.message).toContain("'Balance sheet'!C1");
  });

  it('raises a DATA flag for a #REF! cell', () => {
    const wb = workbook({
      'P&L': [
        ['Revenue', 1_000_000],
        ['Profit before tax', 100_000],
        ['Other', null],
      ],
    });
    wb.Sheets['P&L']['B3'] = { t: 'e', v: 0x17, w: '#REF!' } as XLSX.CellObject;
    const ev = evalWorkbook(wb);
    const f = ev.flags.find((x) => x.key === 'DATA:formula-errors');
    expect(f?.level).toBe('DATA');
    expect(f?.message).toContain('P&L');
    expect(f?.message).toContain('B3');
    expect(f?.message).toContain('#REF!');
  });

  it('flags template text that claims SBR while revenue is above 3m', () => {
    const ev = evalWorkbook(
      workbook({
        'P&L': [
          ['Revenue', 4_000_000],
          ['Profit before tax', 100_000],
        ],
        Notes: [['The Company has elected for Small Business Relief.']],
      }),
    );
    expect(ev.flags.some((f) => f.id === 'DATA' && f.key.startsWith('DATA:template-sbr'))).toBe(true);
  });
});

describe('SBR eligible but not elected', () => {
  const input = (electSBR?: boolean, pbt = 580_000) => ({
    pbt,
    revenue: 1_500_000,
    lines: [],
    profile: { electSBR, periodEnd: '2025-12-31', priorPeriodsUnder3M: true, groupRevenue: 0, legalForm: 'mainland' as const },
  });

  it('raises a MEDIUM flag while tax is due and SBR is not elected', () => {
    for (const elect of [undefined, false]) {
      const { result, flags } = computeWithFlags(input(elect));
      expect(result.tax).toBe(18_450);
      const f = flags.find((x) => x.key === 'SBR:eligible');
      expect(f).toMatchObject({ id: 'SBR', level: 'MEDIUM', message: 'Eligible for SBR: electing would make the tax AED 0.', action: 'Confirm with the client.', amount: 18_450 });
    }
  });

  it('no flag once elected, when not eligible, or when no tax is due', () => {
    expect(computeWithFlags(input(true)).flags.some((f) => f.key === 'SBR:eligible')).toBe(false);
    expect(computeWithFlags({ ...input(), revenue: 3_500_000 }).flags.some((f) => f.key === 'SBR:eligible')).toBe(false);
    expect(computeWithFlags(input(undefined, 300_000)).flags.some((f) => f.key === 'SBR:eligible')).toBe(false);
  });
});
