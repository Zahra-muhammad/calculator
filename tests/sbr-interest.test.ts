/**
 * Small Business Relief on/off on the Desert Star test pack, every SBR condition one by one, and the
 * interest limit (Art. 30: greater of AED 12m or 30% of adjusted EBITDA).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseFile } from '../src/engine/parse';
import type { Workspace } from '../src/engine/types';
import { applyParsedFiles, emptyWorkspace, evaluate } from '../src/engine/workspace';

const pack = parseFile(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'UAE_Corporate_Tax_Test_Pack_2025.xlsx'))), 'pack.xlsx').parsed;
const base = applyParsedFiles(emptyWorkspace(), [pack]);
const withProfile = (p: Partial<Workspace['profile']>, extra: Partial<Workspace> = {}): Workspace => ({ ...base, ...extra, profile: { ...base.profile, ...p } });
const allMet = { electSBR: true, priorPeriodsUnder3M: true, groupRevenue: 0 } as const;

describe('Small Business Relief (Desert Star, revenue AED 1.53m)', () => {
  it('OFF: corporate tax AED 17,550', () => {
    const ev = evaluate(withProfile({ electSBR: false }));
    expect(ev.result.sbr.revenue).toBeLessThan(3_000_000);
    expect(ev.result.sbr.applied).toBe(false);
    expect(Math.round(ev.result.tax)).toBe(17_550);
  });

  it('ON with every condition met: corporate tax AED 0', () => {
    const ev = evaluate(withProfile(allMet));
    expect(ev.result.sbr.eligible).toBe(true);
    expect(ev.result.sbr.applied).toBe(true);
    expect(ev.result.regime).toBe('sbr');
    expect(ev.result.tax).toBe(0);
  });

  it('back OFF: AED 17,550 again', () => {
    expect(Math.round(evaluate(withProfile({ ...allMet, electSBR: false })).result.tax)).toBe(17_550);
  });

  it('elected, but "earlier periods ≤ AED 3m" not answered: not applied (17,550) and asked', () => {
    const ev = evaluate(withProfile({ ...allMet, priorPeriodsUnder3M: undefined }));
    expect(ev.result.sbr.applied).toBe(false);
    expect(ev.result.sbr.unconfirmed.join()).toMatch(/earlier periods/);
    expect(Math.round(ev.result.tax)).toBe(17_550);
  });

  it('elected, but group not answered: not applied', () => {
    const ev = evaluate(withProfile({ ...allMet, groupRevenue: undefined }));
    expect(ev.result.sbr.applied).toBe(false);
    expect(Math.round(ev.result.tax)).toBe(17_550);
  });

  it('an earlier period above AED 3m: not eligible', () => {
    const ev = evaluate(withProfile({ ...allMet, priorPeriodsUnder3M: false }));
    expect(ev.result.sbr.eligible).toBe(false);
    expect(Math.round(ev.result.tax)).toBe(17_550);
  });

  it('member of a multinational group (group revenue ≥ AED 3.15bn): not eligible', () => {
    const ev = evaluate(withProfile({ ...allMet, groupRevenue: 3_150_000_000 }));
    expect(ev.result.sbr.eligible).toBe(false);
    expect(ev.result.sbr.failed.join()).toMatch(/Group revenue/);
    // A small group (below AED 3.15bn) does not block SBR.
    expect(evaluate(withProfile({ ...allMet, groupRevenue: 50_000_000 })).result.sbr.applied).toBe(true);
  });

  it('Qualifying Free Zone Person: not eligible', () => {
    const ev = evaluate(withProfile({ ...allMet, legalForm: 'qfzp' }));
    expect(ev.result.sbr.eligible).toBe(false);
    expect(ev.result.sbr.failed.join()).toMatch(/Qualifying Free Zone Person/);
  });

  it('non-resident (permanent establishment or nexus): not eligible', () => {
    for (const t of ['nonresident_pe', 'nonresident_nexus'] as const) {
      const ev = evaluate(withProfile(allMet, { deadlines: { ...base.deadlines, registrantType: t } }));
      expect(ev.result.sbr.eligible, t).toBe(false);
      expect(ev.result.sbr.failed.join()).toMatch(/Resident Person/);
      expect(Math.round(ev.result.tax)).toBe(17_550);
    }
    // A resident natural person doing business can use it.
    expect(evaluate(withProfile(allMet, { deadlines: { ...base.deadlines, registrantType: 'natural_person' } })).result.sbr.applied).toBe(true);
  });

  it('period ending after 31 Dec 2029: not eligible; ending on 31 Dec 2029: eligible', () => {
    expect(evaluate(withProfile({ ...allMet, periodEnd: '2030-12-31', periodStart: '2030-01-01' })).result.sbr.eligible).toBe(false);
    expect(evaluate(withProfile({ ...allMet, periodEnd: '2029-12-31', periodStart: '2029-01-01' })).result.sbr.applied).toBe(true);
  });

  it('revenue AED 3,000,000 is eligible; AED 3,000,001 is not', () => {
    expect(tb(3_000_000, 0, 2_000_000, allMet).result.sbr.applied).toBe(true);
    const over = tb(3_000_001, 0, 2_000_000, allMet);
    expect(over.result.sbr.eligible).toBe(false);
    expect(Math.round(over.result.tax)).toBe(Math.round((1_000_001 - 375_000) * 0.09));
  });
});

/** A trial balance with one interest line. */
function tb(revenue: number, interest: number, otherCosts: number, extra: Partial<Workspace['profile']> = {}) {
  const rows: unknown[][] = [
    ['Account', 'Debit', 'Credit'],
    ['Sales revenue', 0, revenue],
    ['Cost of sales', otherCosts, 0],
    ...(interest ? [['Interest on bank loan', interest, 0]] : []),
    ['Cash at bank', revenue - otherCosts - interest, 0],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Trial Balance');
  const parsed = parseFile(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })), 'tb.xlsx').parsed;
  const ws = applyParsedFiles(emptyWorkspace(), [parsed]);
  return evaluate({ ...ws, profile: { ...ws.profile, periodStart: '2025-01-01', periodEnd: '2025-12-31', ...extra } });
}

describe('Interest limit (Art. 30)', () => {
  it('net interest AED 11m: below AED 12m, fully deductible', () => {
    const ev = tb(200_000_000, 11_000_000, 179_000_000); // PBT 10m
    expect(ev.result.pbt).toBe(10_000_000);
    expect(ev.result.interest.excess).toBe(0);
    expect(Math.round(ev.result.tax)).toBe(Math.round((10_000_000 - 375_000) * 0.09));
  });

  it('net interest AED 14m, 30% of EBITDA = 7.2m: the AED 12m floor applies, AED 2m added back', () => {
    const ev = tb(200_000_000, 14_000_000, 176_000_000); // PBT 10m, EBITDA 24m
    expect(ev.result.interest.limit).toBe(12_000_000);
    expect(ev.result.interest.excess).toBe(2_000_000);
    expect(Math.round(ev.result.tax)).toBe(Math.round((12_000_000 - 375_000) * 0.09)); // 1,046,250
  });

  it('net interest AED 20m, 30% of EBITDA = 15m: AED 5m added back and carried forward', () => {
    const ev = tb(200_000_000, 20_000_000, 150_000_000); // PBT 30m, EBITDA 50m
    expect(ev.result.interest.limit).toBe(15_000_000);
    expect(ev.result.interest.excess).toBe(5_000_000);
    expect(ev.result.interest.carriedForwardOut).toEqual([{ year: 2025, amount: 5_000_000 }]);
    expect(Math.round(ev.result.tax)).toBe(Math.round((35_000_000 - 375_000) * 0.09)); // 3,116,250
  });
});
