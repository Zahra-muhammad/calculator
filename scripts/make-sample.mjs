// Builds the demo files in samples/. Run: npm run sample
// Made-up company. Expected result with no questions answered: tax AED 4,275.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples');
mkdirSync(out, { recursive: true });

function save(name, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [sheet, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
  writeFileSync(join(out, name), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// Trial balance: closing, adjustments and adjusted columns. The adjustment moves AED 3,000 of
// VAT from the VAT control account into Office expenses (hidden VAT).
const tb = [
  ['Code', 'Account name', 'Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit', 'Comment'],
  [1000, 'Cash at bank', 650000, null, null, null, 650000, null, ''],
  [1100, 'Trade receivables', 480000, null, null, null, 480000, null, ''],
  [1200, 'Due from director (Ahmed Ali)', 75000, null, null, null, 75000, null, 'Personal card spend paid by company'],
  [1500, 'Furniture and fixtures', 120000, null, null, null, 120000, null, ''],
  [1510, 'Accumulated depreciation - furniture', null, 40000, null, null, null, 40000, ''],
  [2000, 'Trade payables', null, 310000, null, null, null, 310000, ''],
  [2100, 'VAT control account', null, 39000, null, 3000, null, 42000, ''],
  [3000, 'Share capital', null, 300000, null, null, null, 300000, ''],
  [3100, 'Retained earnings', null, 238000, null, null, null, 238000, ''],
  [4000, 'Sales', null, 4200000, null, null, null, 4200000, ''],
  [4100, 'Dividend income', null, 50000, null, null, null, 50000, 'From Emirates Foods PJSC (UAE)'],
  [4200, 'Interest income', null, 10000, null, null, null, 10000, ''],
  [5000, 'Cost of sales', 2500000, null, null, null, 2500000, null, ''],
  [6000, 'Salaries', 470000, null, null, null, 470000, null, ''],
  [6010, 'Salary - Mariam Ali', 150000, null, null, null, 150000, null, 'Wife of owner'],
  [6020, "Director's remuneration - Ahmed Ali", 360000, null, null, null, 360000, null, ''],
  [6100, 'Rent', 180000, null, null, null, 180000, null, ''],
  [6200, 'Office expenses', 61000, null, 3000, null, 64000, null, ''],
  [6300, 'Client entertainment', 24000, null, null, null, 24000, null, ''],
  [6310, 'Traffic fines', 3500, null, null, null, 3500, null, ''],
  [6320, 'Donations', 10000, null, null, null, 10000, null, ''],
  [6400, 'Motor vehicle running costs', 30000, null, null, null, 30000, null, ''],
  [6500, 'Laptop purchase', 9000, null, null, null, 9000, null, 'Capital item'],
  [6600, 'Depreciation', 20000, null, null, null, 20000, null, ''],
  [6700, 'Bank charges', 4500, null, null, null, 4500, null, ''],
  [6800, 'Professional fees', 25000, null, null, null, 25000, null, 'No invoice'],
  [7000, 'Corporate tax expense', 15000, null, null, null, 15000, null, ''],
];
const totalDr = tb.slice(1).reduce((a, r) => a + (r[6] ?? 0), 0);
const totalCr = tb.slice(1).reduce((a, r) => a + (r[7] ?? 0), 0);
tb.push([null, 'Total', null, null, null, null, totalDr, totalCr, '']);
if (totalDr !== totalCr) throw new Error(`Sample TB does not balance: ${totalDr} vs ${totalCr}`);

save('sample-company.xlsx', {
  Report: [
    ['Al Noor Trading LLC'],
    ["Independent Auditor's Report to the Shareholders of Al Noor Trading LLC"],
    ['We have audited the financial statements for the year ended 31 December 2025.'],
  ],
  'Balance sheet': [
    ['Al Noor Trading LLC'],
    ['Statement of financial position as at 31 December 2025'],
    ['', 'Note', 2025, 2024],
    ['Total assets', '', 1285000, 1100000],
    ['Total equity and liabilities', '', 1285000, 1100000],
  ],
  'P&L': [
    ['Al Noor Trading LLC'],
    ['Statement of profit or loss for the year ended 31 December 2025'],
    ['', 'Note', 2025, 2024],
    ['Revenue', 4, 4200000, 3600000],
    ['Cost of sales', 5, -2500000, -2200000],
    ['Gross profit', '', 1700000, 1400000],
    ['Other income', 6, 60000, 20000],
    ['General and administrative expenses', 7, -1350000, -1200000],
    ['Profit before tax', '', 410000, 220000],
    ['Corporate tax', 8, -15000, 0],
    ['Profit for the year', '', 395000, 220000],
  ],
  TB: [
    [null, null, 'Closing', null, 'Adjustments', null, 'Adjusted', null],
    ...tb,
  ],
});

save('sample-general-ledger.xlsx', {
  GL: [
    ['Date', 'Account', 'Description', 'Debit', 'Credit'],
    ['2025-01-14', 'Office expenses', 'RTA traffic fine - delivery van', 400, null],
    ['2025-02-03', 'Office expenses', 'Printer toner', 2000, null],
    ['2025-03-22', 'Office expenses', 'Municipality penalty - signage', 1100, null],
    ['2025-04-09', 'Office expenses', 'Gift hamper for client', 750, null],
    ['2025-05-30', 'Office expenses', 'School fees - Ahmed family', 6500, null],
    ['2025-06-18', 'Office expenses', 'Stationery', 900, null],
    ['2025-07-02', 'Rent', 'Office rent Q3', 45000, null],
  ],
});

writeFileSync(
  join(out, 'sample-vat-returns.csv'),
  'Tax period,Standard rated supplies,Zero rated supplies,Exempt supplies,Recoverable input tax\n' +
    'Q1 2025,"1,000,000",20000,0,"60,000"\n' +
    'Q2 2025,"1,050,000",0,0,"62,000"\n' +
    'Q3 2025,"1,020,000",10000,0,"58,000"\n' +
    'Q4 2025,"1,050,000",0,0,"61,000"\n',
);

writeFileSync(
  join(out, 'sample-related-parties.csv'),
  'Name,Type,Relationship,Connected to\n' + 'Ahmed Ali,Person,Director and owner,\n' + 'Mariam Ali,Person,Wife of owner,Ahmed Ali\n' + 'Al Noor Holdings LLC,Company,Shareholder,Ahmed Ali\n',
);

console.log(`Sample files written to ${out}`);
