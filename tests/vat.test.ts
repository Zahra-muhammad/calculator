import { describe, expect, it } from 'vitest';
import { extractRegister, readGrids } from '../src/engine/parse';
import type { InvoiceLine } from '../src/engine/types';
import { autoInputTreatment, computeVat } from '../src/engine/vat';
import { toBytes, workbook } from './helpers';

let row = 4;
function line(p: Partial<InvoiceLine> & { number: string; net: number; vat: number }, sheet = 'Register'): InvoiceLine {
  row++;
  return { key: `${sheet}!${row}`, sheet, row, party: '', trnColumn: false, description: '', gross: p.net + p.vat, rate: p.vat ? 0.05 : 0, ...p };
}

// The test pack's registers.
const sales = () => [
  line({ number: 'DS-001', party: 'ABC Stationery LLC', net: 100_000, vat: 5_000 }, 'Sales Invoices'),
  line({ number: 'DS-002', party: 'Gulf Design LLC', net: 250_000, vat: 12_500 }, 'Sales Invoices'),
  line({ number: 'DS-003', party: 'City Services LLC', net: 350_000, vat: 17_500 }, 'Sales Invoices'),
  line({ number: 'DS-004', party: 'Palm Business LLC', net: 800_000, vat: 40_000 }, 'Sales Invoices'),
];
const purchases = () => [
  line({ number: 'R-001', party: 'Desert Property LLC', description: 'Office rent', category: 'Business premises', status: 'Potentially recoverable', net: 80_000, vat: 4_000 }, 'Purchase Receipts'),
  line({ number: 'R-002', party: 'Utility Provider', description: 'Electricity and internet', category: 'Business utilities', status: 'Potentially recoverable', net: 30_000, vat: 1_500 }, 'Purchase Receipts'),
  line({ number: 'R-003', party: 'Restaurant LLC', description: 'Client business dinner', category: 'Client entertainment', status: 'Blocked for this test', net: 20_000, vat: 1_000 }, 'Purchase Receipts'),
  line({ number: 'R-004', party: 'Municipal Authority', description: 'Government fine', category: 'Government fine', status: 'Not applicable', net: 10_000, vat: 0 }, 'Purchase Receipts'),
  line({ number: 'R-005', party: 'Wholesale Supplier LLC', description: 'Inventory purchases / cost of sales', status: 'Potentially recoverable', net: 500_000, vat: 25_000 }, 'Purchase Receipts'),
];

describe('VAT from the sales and purchase registers', () => {
  it('test pack: output 75,000 · recoverable 30,500 · blocked 1,000 · payable 44,500 (5% from settings)', () => {
    const v = computeVat(sales(), purchases(), {}, 1_500_000);
    expect(v.rate).toBe(0.05);
    expect(v).toMatchObject({ outputVat: 75_000, inputRecoverable: 30_500, inputBlocked: 1_000, inputNotApplicable: 0, payable: 44_500 });
    expect(v.salesTotals).toEqual({ count: 4, net: 1_500_000, vat: 75_000, gross: 1_575_000 });
    expect(v.purchaseTotals).toEqual({ count: 5, net: 640_000, vat: 31_500, gross: 671_500 });
    expect(v.purchases.map((l) => [l.number, l.treatment])).toEqual([
      ['R-001', 'recoverable'],
      ['R-002', 'recoverable'],
      ['R-003', 'blocked'],
      ['R-004', 'na'],
      ['R-005', 'recoverable'],
    ]);
    // Only INFO notes: the blocked dinner, no TRN column, no emirate column.
    expect(v.flags.map((f) => [f.key, f.level])).toEqual([
      ['VAT:blocked', 'INFO'],
      ['VAT:trn-column', 'INFO'],
      ['VAT:emirate', 'INFO'],
    ]);
  });

  it('blocks input VAT when the status says blocked, or the description or category is client entertainment', () => {
    const t = (p: Partial<InvoiceLine>) => autoInputTreatment(line({ number: 'X', net: 1_000, vat: 50, ...p })).treatment;
    expect(t({ status: 'Blocked' })).toBe('blocked');
    expect(t({ status: 'Not blocked', description: 'Stationery' })).toBe('recoverable');
    expect(t({ category: 'Client entertainment' })).toBe('blocked');
    expect(t({ description: 'Client business dinner' })).toBe('blocked');
    expect(t({ description: 'Hospitality for customers' })).toBe('blocked');
    expect(t({ description: 'Staff party' })).toBe('recoverable');
    expect(t({ description: 'Office rent' })).toBe('recoverable');
    expect(t({ status: 'Not applicable' })).toBe('na');
    expect(t({ vat: 0, description: 'Government fine' })).toBe('na');
  });

  it('staff can change a line, with a reason; a change without a reason raises a MEDIUM flag', () => {
    const p = purchases();
    const dinner = p[2].key;
    const withReason = computeVat(sales(), p, { [dinner]: { treatment: 'recoverable', reason: 'Staff training lunch, not client entertainment' } });
    expect(withReason).toMatchObject({ inputRecoverable: 31_500, inputBlocked: 0, payable: 43_500 });
    expect(withReason.purchases[2]).toMatchObject({ treatment: 'recoverable', auto: 'blocked', chosen: true });
    expect(withReason.flags.some((f) => f.key.startsWith('VAT:reason'))).toBe(false);

    const noReason = computeVat(sales(), p, { [p[0].key]: { treatment: 'blocked' } });
    expect(noReason.inputBlocked).toBe(5_000);
    expect(noReason.flags.find((f) => f.key === `VAT:reason-${p[0].key}`)).toMatchObject({ level: 'MEDIUM', amount: 4_000 });
    // Choosing the automatic treatment again is not a change.
    expect(computeVat([], p, { [dinner]: { treatment: 'blocked' } }).flags.some((f) => f.key.startsWith('VAT:reason'))).toBe(false);
  });

  it('shows a refund when recoverable input VAT is more than output VAT', () => {
    const v = computeVat([line({ number: 'S1', net: 10_000, vat: 500 })], [line({ number: 'P1', net: 100_000, vat: 5_000 })]);
    expect(v.payable).toBe(-4_500);
  });

  it('checks: VAT not 5% of net, net + VAT ≠ gross, duplicates, missing supplier TRN, VAT on sales vs 5% of revenue', () => {
    const s = [
      line({ number: 'S-1', net: 100_000, vat: 5_100 }), // VAT should be 5,000
      line({ number: 'S-2', net: 10_000, vat: 1_000, rate: 0.1 }), // rate is not 5%
      line({ number: 'S-3', net: 8_000, vat: 0, rate: 0 }), // zero-rated: fine
      line({ number: 'S-4', net: 20_000, vat: 1_000, gross: 22_000 }), // gross should be 21,000
      line({ number: 'S-4', net: 20_000, vat: 1_000 }), // duplicate number
    ];
    const p = [
      line({ number: 'INV-9', party: 'Alpha LLC', net: 2_000, vat: 100, trnColumn: true, trn: '100200300400500' }),
      line({ number: 'INV-9', party: 'Beta LLC', net: 2_000, vat: 100, trnColumn: true }), // same number, other supplier: not a duplicate; TRN missing
    ];
    const v = computeVat(s, p, {}, 100_000);
    const byKey = Object.fromEntries(v.flags.map((f) => [f.key, f]));
    expect(byKey['VAT:rate-sales']).toMatchObject({ level: 'MEDIUM' });
    expect(byKey['VAT:rate-sales'].message).toContain('S-1');
    expect(byKey['VAT:rate-sales'].message).toContain('S-2');
    expect(byKey['VAT:rate-sales'].message).not.toContain('S-3');
    expect(byKey['VAT:gross-sales']).toMatchObject({ level: 'MEDIUM', amount: 1_000 });
    expect(byKey['VAT:duplicates-sales']).toMatchObject({ level: 'HIGH', amount: 1_000 });
    expect(byKey['VAT:duplicates-purchases']).toBeUndefined();
    // Missing TRN: the VAT is held, not claimed.
    expect(byKey['VAT:trn']).toMatchObject({ level: 'MEDIUM', amount: 100 });
    expect(v.inputHeld).toBe(100);
    expect(v.inputRecoverable).toBe(100);
    expect(byKey['VAT:trn'].message).toContain('Beta LLC');
    expect(byKey['VAT:trn-column']).toBeUndefined();
    // VAT due is 5% of the value: S-1 5,000 (not 5,100), S-2 500 (not 1,000), S-4 1,000; the exact repeat of S-4
    // is left out. 6,500 vs 5% × (100,000 − zero-rated 8,000) = 4,600.
    expect(v.outputVat).toBe(6_500);
    expect(v.sales.filter((l) => l.excluded).map((l) => l.number)).toEqual(['S-4']);
    expect(byKey['VAT:sales-vs-revenue']).toMatchObject({ level: 'MEDIUM', amount: 1_900 });
    // In line with revenue: no warning flags (only the INFO note about the missing emirate column).
    expect(computeVat(sales(), [], {}, 1_500_000).flags.map((f) => f.level)).toEqual(['INFO']);
  });
});

describe('reading sales and purchase registers', () => {
  it('finds a sales register by its customer column and a purchase register by its supplier or input VAT status column', () => {
    const grids = readGrids(
      toBytes(
        workbook({
          'Sales Invoices': [
            ['SALES INVOICES'],
            [],
            ['Invoice No', 'Invoice Date', 'Customer', 'Customer TRN', 'Description', 'Net AED', 'VAT Rate', 'VAT AED', 'Gross AED'],
            ['DS-001', new Date(Date.UTC(2025, 0, 15)), 'ABC Stationery LLC', '100111222333444', 'Office supplies', 100_000, '5%', 5_000, 105_000],
            ['Total', null, null, null, null, 100_000, null, 5_000, 105_000],
          ],
          Receipts: [
            ['Receipt No', 'Date', 'Description', 'Net', 'VAT', 'Gross', 'Input VAT Status'],
            ['R-1', '2025-02-01', 'Office rent', 80_000, 4_000, 84_000, 'Potentially recoverable'],
          ],
          'Q1 list': [
            ['Bill No', 'Date', 'Supplier', 'Net Amount', 'Tax Rate', 'VAT Amount'],
            ['B-7', '2025-02-01', 'Alpha LLC', 1_000, 5, 50],
          ],
        }),
      ),
      'registers.xlsx',
    );
    const s = extractRegister(grids[0]);
    expect(s?.kind).toBe('sales');
    expect(s?.lines).toHaveLength(1);
    expect(s?.lines[0]).toMatchObject({ key: 'Sales Invoices!4', number: 'DS-001', date: '2025-01-15', party: 'ABC Stationery LLC', trn: '100111222333444', trnColumn: true, net: 100_000, rate: 0.05, vat: 5_000, gross: 105_000 });
    const r = extractRegister(grids[1]);
    expect(r?.kind).toBe('purchases');
    expect(r?.lines[0]).toMatchObject({ status: 'Potentially recoverable', trnColumn: false });
    const b = extractRegister(grids[2]);
    expect(b?.kind).toBe('purchases');
    expect(b?.lines[0]).toMatchObject({ party: 'Alpha LLC', rate: 0.05, vat: 50 });
  });
});
