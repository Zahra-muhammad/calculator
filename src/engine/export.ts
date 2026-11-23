/**
 * Excel working paper: Computation, Add-backs detail, Red flags, Account mapping,
 * Deadlines and Settings used. Returns the file bytes; saving is done by the UI.
 */
import * as XLSX from 'xlsx';
import { SETTING_INFO, formatSetting } from './settings';
import type { Workspace } from './types';
import { CATEGORY_MAP, INPUT_VAT_LABELS, REGISTRANT_LABELS, refText } from './types';
import { fmtDate, round2, sum } from './util';
import { SUPPLY_LABELS } from './vat';
import { currencyText } from './currency';
import type { Evaluation } from './workspace';

const MONEY = '#,##0.00;(#,##0.00)';

export function exportFileName(ws: Workspace, ext: 'xlsx' | 'pdf'): string {
  const client = (ws.clientName || 'client').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60) || 'client';
  const vatOnly = !ws.tbLines.length && ws.headline.pbt.value === undefined && ((ws.salesInvoices?.length ?? 0) + (ws.purchaseInvoices?.length ?? 0) + (ws.importInvoices?.length ?? 0)) > 0;
  return `${vatOnly ? 'VAT' : 'CT'}-${client}-${ws.profile.periodEnd || 'no-period'}.${ext}`;
}

type Row = (string | number | null | undefined)[];

function sheet(rows: Row[], widths: number[], moneyCols: number[] = [], headerRow = 0): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((v) => (v === undefined ? null : v))));
  ws['!cols'] = widths.map((wch) => ({ wch }));
  for (let r = headerRow + 1; r < rows.length; r++) {
    for (const c of moneyCols) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === 'n') cell.z = MONEY;
    }
  }
  return ws;
}

export function computationRows(ws: Workspace, ev: Evaluation): Row[] {
  const r = ev.result;
  const rows: Row[] = [
    ['Client', ws.clientName || '—', '', ''],
    ['TRN', ws.trn || '—', '', ''],
    ['Period', `${fmtDate(ws.profile.periodStart)} to ${fmtDate(ws.profile.periodEnd)}`, '', ''],
    ['Prepared', new Date().toISOString().slice(0, 10), '', ''],
    ['Cautious mode', ws.cautious ? 'On' : 'Off', '', ''],
    ['Currency', currencyText(ws.currency), '', ''],
    [],
    ['Step', 'Description', 'Rule', 'AED'],
    ['Step 1', `Profit before tax (${ev.pbtSource || 'not found'})`, '', r.pbt],
    ['Step 2', 'Add-backs', '', r.totalAddBacks],
    ...r.addBacks.map((a): Row => ['', `${a.label}${a.account ? ` — ${a.account}` : ''}${a.source ? ` (${a.source})` : ''}`, a.ruleId, a.amount]),
    ['Step 3', 'Exempt income and other deductions', '', -r.totalDeductions],
    ...r.deductions.map((d): Row => ['', `${d.label}${d.account ? ` — ${d.account}` : ''}${d.source ? ` (${d.source})` : ''}`, d.ruleId, -d.amount]),
    ['Step 4', 'Taxable income', '', r.taxableIncome],
    ['Step 5', `Loss relief (brought forward ${r.loss.broughtForward}, cap ${r.loss.cap})`, 'Art. 37', -r.loss.used],
    ['', 'Taxable income after losses', '', r.taxableAfterLoss],
    ['', `Regime: ${r.regime === 'sbr' ? 'Small Business Relief' : r.regime === 'qfzp' ? 'QFZP' : 'Standard'}`, '', null],
    ...(r.foreignTaxCredit.credit > 0
      ? ([
          ['Step 6', 'Corporate tax before credits', '', r.taxBeforeCredits],
          ['', `Foreign tax credit: ${r.foreignTaxCredit.basis}`, 'Art. 47', -r.foreignTaxCredit.credit],
          ['', 'Corporate tax payable', '', r.tax],
        ] as Row[])
      : ([['Step 6', 'Corporate tax', '', r.tax]] as Row[])),
    [],
    ['', 'Total revenue for SBR / QFZP tests', '', r.ctRevenue.total],
    ['', '  Revenue', '', r.ctRevenue.revenue],
    ['', '  Other income (including interest)', '', r.ctRevenue.otherIncome],
    ['', '  Gains', '', r.ctRevenue.gains],
    ['', '  Exempt income', '', r.ctRevenue.exemptIncome],
    ['', '  Left out by staff (not counted)', '', r.ctRevenue.excluded],
    ['', '  VAT: excluded (output VAT is not revenue)', '', null],
    ...r.ctRevenue.lines
      .filter((l) => l.included !== l.includedByDefault)
      .map((l): Row => ['', `  ${l.included ? 'Counted' : 'Left out'}: ${l.account}${l.source ? ` (${l.source})` : ''}. Reason: ${l.reason ?? 'none given'}`, '', l.amount]),
    ['', 'Effective rate on PBT', '', r.pbt > 0 ? Math.round(r.effectiveRate * 10000) / 100 : null],
    ['', 'Losses carried forward', '', r.loss.carriedForward],
    ['', 'Interest carried forward', '', r.interest.totalCarriedForward],
    ['', 'Net interest / limit', '', `${r.interest.net} / ${r.interest.limit}`],
    ...r.notes.map((n): Row => ['', n, '', null]),
  ];
  return rows;
}

/** The VAT sheet: summary, VAT return boxes, sales register, purchase register, imports and the checks. */
export function vatRows(ev: Evaluation, ws?: Workspace): Row[] {
  const v = ev.vat;
  const rate = (r?: number) => (r === undefined ? '' : `${Math.round(r * 10000) / 100}%`);
  const dup = (l: { excluded: boolean; dupOf?: string }) => (l.dupOf ? (l.excluded ? `Left out: repeats ${l.dupOf}` : `Counted although it repeats ${l.dupOf}`) : '');
  const rows: Row[] = [
    ['VAT summary', null],
    ['Currency', currencyText(ws?.currency)],
    ['Standard rate', rate(v.rate)],
    ['Output VAT (Box 8)', v.outputVat],
    ['Input VAT recoverable (Box 11)', v.inputRecoverable],
    ['Input VAT blocked (Executive Regulation Art. 53)', v.inputBlocked],
    ['Input VAT held: no valid tax invoice', v.inputHeld],
    ['Input VAT not applicable', v.inputNotApplicable],
    [v.payable >= 0 ? 'VAT payable (Box 14)' : 'VAT refundable (Box 14)', Math.abs(v.payable)],
    [],
    ['VAT return (VAT201)'],
    ['Box', 'Description', 'Amount AED', 'VAT AED'],
    ...v.boxes.map((b): Row => [b.id === '1?' ? '1' : b.id, b.label, b.amount ?? null, b.vat ?? null]),
    [],
    ['Sales invoices'],
    ['Sheet!Row', 'Invoice', 'Date', 'Customer', 'Description', 'Net', 'Rate', 'VAT', 'Gross', 'TRN', 'Supply', 'Emirate / box', 'VAT counted', 'Duplicate'],
    ...v.sales.map((l): Row => [
      `${l.sheet}!${l.row}`,
      l.number,
      l.date ?? '',
      l.party,
      l.description,
      l.net,
      rate(l.rate),
      l.vat,
      l.gross ?? null,
      l.trn ?? '',
      SUPPLY_LABELS[l.supply],
      l.box ? `${l.emirate ?? ''} · Box ${l.box === '1?' ? '1' : l.box}` : '',
      l.counted,
      dup(l),
    ]),
    ['Total', `${v.salesTotals.count} lines`, '', '', '', v.salesTotals.net, '', v.salesTotals.vat, v.salesTotals.gross, '', '', '', round2(sum(v.sales.map((l) => l.counted)))],
    [],
    ['Purchase invoices / receipts'],
    ['Sheet!Row', 'Invoice', 'Date', 'Supplier', 'Description', 'Net', 'Rate', 'VAT', 'Gross', 'Input VAT', 'Automatic', 'Reason', 'TRN', 'Category / status', 'VAT counted', 'Duplicate'],
    ...v.purchases.map((l): Row => [
      `${l.sheet}!${l.row}`,
      l.number,
      l.date ?? '',
      l.party,
      l.description,
      l.net,
      rate(l.rate),
      l.vat,
      l.gross ?? null,
      INPUT_VAT_LABELS[l.treatment],
      l.chosen ? `${INPUT_VAT_LABELS[l.auto]} (changed by a person)` : l.why,
      l.reason ?? '',
      l.trn ?? (l.trnColumn ? 'missing' : ''),
      [l.category, l.status].filter(Boolean).join(' · '),
      l.counted,
      dup(l),
    ]),
    ['Total', `${v.purchaseTotals.count} lines`, '', '', '', v.purchaseTotals.net, '', v.purchaseTotals.vat, v.purchaseTotals.gross, '', '', '', '', '', round2(sum(v.purchases.map((l) => l.counted)))],
  ];
  if (v.imports.length) {
    rows.push(
      [],
      ['Imports (reverse charge and customs)'],
      ['Sheet!Row', 'Ref', 'Date', 'Supplier', 'Description', 'Value', 'Rate', 'VAT', 'Type', 'Input VAT', 'Automatic', 'Reason', 'Customs declaration', 'Country', 'VAT counted as input', 'Duplicate'],
      ...v.imports.map((l): Row => [
        `${l.sheet}!${l.row}`,
        l.number,
        l.date ?? '',
        l.party,
        l.description,
        l.net,
        rate(l.rate),
        l.vat,
        l.importType === 'goods' ? 'Goods (Box 6)' : 'Services, reverse charge (Box 3)',
        INPUT_VAT_LABELS[l.treatment],
        l.chosen ? `${INPUT_VAT_LABELS[l.auto]} (changed by a person)` : l.why,
        l.reason ?? '',
        l.customsNo ?? '',
        l.category ?? '',
        l.counted,
        dup(l),
      ]),
      ['Total', `${v.importTotals.count} lines`, '', '', '', v.importTotals.net, '', v.importTotals.vat],
    );
  }
  rows.push(
    [],
    ['Checks'],
    ...(ev.flags.filter((f) => f.id === 'VAT').length
      ? ev.flags.filter((f) => f.id === 'VAT').map((f): Row => [f.level, f.message, '', '', '', f.amount ?? null])
      : ([['PASS', 'All VAT checks passed.']] as Row[])),
  );
  return rows;
}

export function workingPaper(ws: Workspace, ev: Evaluation): Uint8Array {
  const wb = XLSX.utils.book_new();
  const r = ev.result;

  const comp = computationRows(ws, ev);
  XLSX.utils.book_append_sheet(wb, sheet(comp, [10, 80, 10, 18], [3], 6), 'Computation');

  const ab: Row[] = [['Rule', 'Description', 'Account', 'Source row', 'Amount', 'Basis', 'Answer given']];
  for (const a of r.addBacks) ab.push([a.ruleId, a.label, a.account, a.source ?? '', a.amount, a.basis, a.answer ?? '']);
  for (const d of r.deductions) ab.push([d.ruleId, `Deduction: ${d.label}`, d.account ?? '', d.source ?? '', -d.amount, d.basis ?? '', '']);
  XLSX.utils.book_append_sheet(wb, sheet(ab, [9, 44, 34, 26, 16, 34, 30], [4]), 'Add-backs detail');

  const fl: Row[] = [['ID', 'Level', 'Message', 'Amount', 'Action', 'Resolved', 'Note', 'Resolved on']];
  for (const f of ev.flags) {
    const res = ws.resolved[f.key];
    fl.push([f.id, f.level, f.message, f.amount ?? null, f.action, res ? 'Yes' : 'No', res?.note ?? '', res?.at.slice(0, 10) ?? '']);
  }
  XLSX.utils.book_append_sheet(wb, sheet(fl, [9, 9, 80, 16, 50, 9, 40, 12], [3]), 'Red flags');

  const map: Row[] = [['Row', 'Account', 'Balance (Dr +, Cr −)', 'Comment', 'Category', 'Rule', 'Evidence', 'Reason']];
  for (const l of ev.classified) {
    map.push([l.row, l.account, l.balance, l.comment, CATEGORY_MAP[l.category].label, CATEGORY_MAP[l.category].rule, l.evidence, l.reason]);
    for (const s of ev.subLines.filter((x) => x.parentKey === l.key)) {
      map.push([l.row, `  ↳ ${s.label}`, s.amount, s.evidence.slice(0, 3).join(' | '), CATEGORY_MAP[s.category].label, CATEGORY_MAP[s.category].rule, s.source, '']);
    }
  }
  XLSX.utils.book_append_sheet(wb, sheet(map, [7, 40, 18, 30, 30, 8, 14, 60], [2]), 'Account mapping');

  const d = ev.deadlines;
  const dl: Row[] = [
    ['Item', 'Value'],
    ['Registering as', REGISTRANT_LABELS[d.registrantType]],
    ['Incorporation date', ws.deadlines.incorporationDate ?? ''],
    ['Registration due', d.registrationDue ?? ''],
    ['How the registration date was worked out', d.registrationBasis ?? ''],
    ['Registered on', ws.deadlines.registrationDate ?? ''],
    ['Period end', ws.deadlines.periodEnd ?? ws.profile.periodEnd ?? ''],
    ['Return and payment due', d.returnDue ?? ''],
    ['Waiver deadline (first return)', d.waiverDeadline ?? ''],
    ['Return filed on', ws.deadlines.returnFiledDate ?? ''],
    ['Tax paid on', ws.deadlines.taxPaidDate ?? ''],
    ['Late registration penalty', d.penalties.lateRegistration],
    [`Late filing penalty (${d.monthsLateFiling} months)`, d.penalties.lateFiling],
    [`Late payment penalty (${d.monthsLatePayment} month(s), ${d.daysLatePayment} days, estimate)`, d.penalties.latePayment],
    ['Total penalties (estimate)', d.penalties.total],
    ...d.notes.map((n): Row => [n, '']),
  ];
  XLSX.utils.book_append_sheet(wb, sheet(dl, [46, 22], [1]), 'Deadlines');

  if (ev.vat.hasData) XLSX.utils.book_append_sheet(wb, sheet(vatRows(ev, ws), [22, 44, 14, 26, 34, 16, 8, 16, 16, 18, 18, 42, 18, 24, 16, 30], [1, 2, 3, 5, 7, 8, 12, 14]), 'VAT');

  const st: Row[] = [['Key', 'Setting', 'Value', 'Reference', 'Note']];
  for (const s of SETTING_INFO) st.push([s.key, s.label, formatSetting(s), s.reference, s.note ?? '']);
  XLSX.utils.book_append_sheet(wb, sheet(st, [34, 46, 20, 52, 26]), 'Settings used');

  const src: Row[] = [['Number', 'Value', 'Source']];
  const h = ws.headline;
  const srcText = (s: { ref?: { sheet: string; cell: string; file?: string }; byHand?: boolean; note?: string }) =>
    s.byHand ? 'Entered by hand' : s.ref ? `${s.ref.file ? `${s.ref.file} ` : ''}${refText(s.ref)}` : s.note ?? '';
  src.push(['Profit before tax', r.pbt, h.pbt.value === undefined ? ev.pbtSource : srcText(h.pbt)]);
  src.push(['Revenue', r.revenue, h.revenue.value === undefined ? 'Sum of TB revenue lines' : srcText(h.revenue)]);
  src.push(['Total income (AB-04)', r.totalIncome, h.totalIncome.value === undefined ? 'Default' : srcText(h.totalIncome)]);
  src.push(['Shared overheads', h.sharedOverheads.value ?? 0, srcText(h.sharedOverheads)]);
  for (const l of h.lossesBF) src.push([`Loss b/f (period from ${l.periodStart || '?'})`, l.amount, l.source ?? 'Entered by hand']);
  for (const i of h.interestCF) src.push([`Interest c/f from ${i.year}`, i.amount, 'Entered by hand']);
  (h.foreignTax ?? []).forEach((f, i) => {
    const name = f.country?.trim() || `row ${i + 1}`;
    if (f.income !== undefined) src.push([`Foreign income, ${name} (foreign tax credit)`, f.income, 'Entered by hand']);
    if (f.taxPaid !== undefined) src.push([`Foreign tax paid, ${name}`, f.taxPaid, 'Entered by hand']);
  });
  XLSX.utils.book_append_sheet(wb, sheet(src, [36, 18, 50], [1]), 'Sources');

  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer);
}
