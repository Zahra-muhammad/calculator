import { describe, expect, it } from 'vitest';
import { classifyLines } from '../src/engine/classify';
import { scanGl, suggestionToSubLine } from '../src/engine/gl';
import type { GlTxn, TBLine } from '../src/engine/types';

const line = (account: string, balance: number, row: number): TBLine => ({ key: account.toLowerCase(), row, sheet: 'TB', account, debit: balance, credit: 0, balance, comment: '' });
const tx = (row: number, account: string, description: string, amount: number): GlTxn => ({ row, account, description, debit: amount, credit: 0, amount });

describe('general ledger scan', () => {
  const lines = classifyLines([line('Office expenses', 50_000, 10), line('Traffic fines', 1_000, 11), line('Consultancy', 80_000, 12)]);

  it('groups suspicious transactions inside normal expense accounts', () => {
    const gl = Array.from({ length: 12 }, (_, i) => tx(i + 2, 'Office expenses', `Police fine ${i + 1}`, 1_000)).concat([
      tx(20, 'Office expenses', 'Printer paper', 400),
      tx(21, 'Traffic fines', 'Fine', 500),
      tx(22, 'Consultancy', 'Fee paid to Ali Holdings LLC', 30_000),
    ]);
    const s = scanGl(gl, lines, [{ name: 'Ali Holdings LLC', type: 'company', relationship: 'Shareholder' }]);
    expect(s).toHaveLength(2);
    const fines = s.find((x) => x.category === 'fines')!;
    expect(fines.count).toBe(12);
    expect(fines.message).toBe('12 transactions, AED 12,000, look like fines or penalties inside Office expenses.');
    expect(s.find((x) => x.category === 'related_party_expense')?.total).toBe(30_000);
  });

  it('penalties in the ledger: government = fines, unclear = needs review, contract = no suggestion', () => {
    const s = scanGl(
      [
        tx(2, 'Office expenses', 'Municipality penalty - signage', 1_100),
        tx(3, 'Office expenses', 'Late payment penalty', 900),
        tx(4, 'Office expenses', 'Penalty to customer for late delivery', 2_000),
        tx(5, 'Office expenses', 'Supplier delay penalty', 700),
      ],
      lines,
    );
    expect(s.map((x) => [x.category, x.total])).toEqual([
      ['fines', 1_100],
      ['penalty_review', 900],
    ]);
  });

  it('turns an accepted suggestion into an add-back sub-line with evidence', () => {
    const s = scanGl([tx(5, 'Office expenses', 'Family holiday tickets', 7_000)], lines)[0];
    const sub = suggestionToSubLine(s);
    expect(sub).toMatchObject({ parentKey: 'office expenses', category: 'personal', amount: 7_000, source: 'gl' });
    expect(sub.evidence[0]).toContain('GL row 5');
  });
});
