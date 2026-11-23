import * as XLSX from 'xlsx';
import type { Category, TaxLine } from '../src/engine/types';

let n = 0;

/** An expense line (debit balance). */
export function exp(category: Category, amount: number, account: string = category, key?: string): TaxLine {
  n++;
  return { key: key ?? `${category}-${n}`, account, category, balance: amount, source: `test line ${n}` };
}

/** An income line (credit balance). */
export function inc(category: Category, amount: number, account: string = category, key?: string): TaxLine {
  n++;
  return { key: key ?? `${category}-${n}`, account, category, balance: -amount, source: `test line ${n}` };
}

export function workbook(sheets: Record<string, unknown[][]>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return wb;
}

export function toBytes(wb: XLSX.WorkBook): Uint8Array {
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

/** Test 16 workbook: a P&L sheet and a TB sheet. */
export function sampleWorkbook(): XLSX.WorkBook {
  return workbook({
    'P&L': [
      ['ABC Trading LLC'],
      ['Statement of profit or loss for the year ended 31 December 2025'],
      ['', 'Notes', 2025, 2024],
      ['Revenue', 4, 2_500_000, 2_100_000],
      ['Cost of sales', 5, -1_200_000, -1_000_000],
      ['Gross profit', '', 1_300_000, 1_100_000],
      ['General and administrative expenses', 6, -700_000, -1_150_000],
      ['Profit/(Loss) before Taxation', 7, 600_000, -50_000],
      ['Corporate tax', 8, -20_250, 0],
      ['Profit for the year', '', 579_750, -50_000],
    ],
    TB: [
      ['Code', 'Particulars', 'Debit', 'Credit', 'Comment'],
      [1001, 'Cash at bank', 500_000, null, ''],
      [1100, 'Trade receivables', 300_000, null, ''],
      [2000, 'Trade payables', null, 250_000, ''],
      [3000, 'Share capital', null, 100_000, ''],
      [4000, 'Revenue', null, 2_500_000, ''],
      [5000, 'Cost of sales', 1_200_000, null, ''],
      [6000, 'Salaries', 400_000, null, ''],
      [6100, 'Office expenses', 50_000, null, 'no invoice'],
      [6200, 'Police fine', 5_000, null, ''],
      [6300, "Director's remuneration", 240_000, null, ''],
      [6400, 'Rent', 155_000, null, ''],
      [null, null, null, null, null],
      [null, 'Total', 2_850_000, 2_850_000, ''],
    ],
  });
}
