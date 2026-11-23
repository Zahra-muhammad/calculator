/**
 * One-to-two page PDF report for the client. Returns the file bytes.
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SETTINGS } from './settings';
import { currencyText } from './currency';
import type { Workspace } from './types';
import { fmtDate, num, pct } from './util';
import type { Evaluation } from './workspace';

/** The built-in PDF fonts only cover Latin-1; replace the few typographic characters we use. */
export function pdfText(s: string): string {
  return s
    .replace(/[−–—]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/…/g, '...')
    .replace(/↳/g, '>')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '?');
}

const money = (n: number) => pdfText(num(n));

export function clientReport(ws: Workspace, ev: Evaluation): Uint8Array {
  const r = ev.result;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = 48;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  // Only VAT data (no trial balance, no profit figure): a VAT report instead of a corporate tax one.
  const vatOnly = ev.vat.hasData && !ws.tbLines.length && ws.headline.pbt.value === undefined;
  doc.text(vatOnly ? 'UAE VAT return working paper' : 'UAE Corporate Tax computation', M, y);
  y += 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const info: [string, string][] = [
    ['Company', ws.clientName || '-'],
    ['TRN', ws.trn || '-'],
    ['Currency', currencyText(ws.currency)],
    ['Tax period', `${fmtDate(ws.profile.periodStart)} to ${fmtDate(ws.profile.periodEnd)}`],
    ...(vatOnly ? [] : ([['Regime', r.regime === 'sbr' ? 'Small Business Relief' : r.regime === 'qfzp' ? 'Qualifying Free Zone Person' : 'Standard rate']] as [string, string][])),
  ];
  for (const [k, v] of info) {
    doc.setFont('helvetica', 'bold');
    doc.text(`${k}:`, M, y);
    doc.setFont('helvetica', 'normal');
    doc.text(pdfText(v), M + 70, y);
    y += 14;
  }
  y += 6;

  // Add-backs grouped by rule keep the report to one or two pages.
  const byRule = new Map<string, { label: string; amount: number }>();
  for (const a of r.addBacks) {
    const g = byRule.get(a.ruleId) ?? { label: a.label, amount: 0 };
    g.amount += a.amount;
    if (g.label !== a.label) g.label = ruleTitle(a.ruleId, g.label);
    byRule.set(a.ruleId, g);
  }
  const body: (string | { content: string; styles: object })[][] = [];
  const bold = (s: string) => ({ content: pdfText(s), styles: { fontStyle: 'bold' } });
  body.push([bold('1'), bold(`Profit before tax`), bold(money(r.pbt))]);
  body.push([bold('2'), bold('Add-backs'), bold(money(r.totalAddBacks))]);
  for (const [rule, g] of byRule) body.push(['', pdfText(`${rule}  ${g.label}`), money(g.amount)]);
  body.push([bold('3'), bold('Exempt income and other deductions'), bold(money(-r.totalDeductions))]);
  for (const d of r.deductions) body.push(['', pdfText(`${d.ruleId}  ${d.label}${d.account ? ` - ${d.account}` : ''}`), money(-d.amount)]);
  body.push([bold('4'), bold('Taxable income'), bold(money(r.taxableIncome))]);
  body.push([bold('5'), bold(`Loss relief (cap ${pct(SETTINGS.lossOffsetCap, 0)} of taxable income)`), bold(money(-r.loss.used))]);
  body.push(['', 'Taxable income after losses', money(r.taxableAfterLoss)]);
  if (r.foreignTaxCredit.credit > 0) {
    body.push([bold('6'), bold('Corporate tax before credits'), bold(money(Math.round(r.taxBeforeCredits)))]);
    body.push(['', 'Art. 47  Foreign tax credit', money(-Math.round(r.foreignTaxCredit.credit))]);
    body.push(['', bold('Corporate tax payable'), bold(money(Math.round(r.tax)))]);
  } else {
    body.push([bold('6'), bold('Corporate tax payable'), bold(money(Math.round(r.tax)))]);
  }

  if (!vatOnly) autoTable(doc, {
    startY: y,
    head: [['Step', 'Description', 'AED']],
    body,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [11, 107, 102] },
    columnStyles: { 0: { cellWidth: 36 }, 2: { halign: 'right', cellWidth: 90 } },
    margin: { left: M, right: M },
  });
  y = vatOnly ? y : lastY(doc, y) + 16;

  if (ev.vat.hasData) {
    const v = ev.vat;
    autoTable(doc, {
      startY: y,
      head: [['Box', 'VAT return (VAT201)', 'Amount AED', 'VAT AED']],
      body: v.boxes.map((b) => {
        const row = [b.id === '1?' ? '1' : b.id, pdfText(b.label), b.amount === undefined ? '' : money(b.amount), b.vat === undefined ? '' : money(b.vat)];
        return ['8', '11', '14'].includes(b.id) ? row.map((c) => ({ content: c, styles: { fontStyle: 'bold' } })) : row;
      }),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [11, 107, 102] },
      columnStyles: { 0: { cellWidth: 36 }, 2: { halign: 'right', cellWidth: 90 }, 3: { halign: 'right', cellWidth: 90 } },
      margin: { left: M, right: M },
    });
    y = lastY(doc, y) + 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const notes = [
      v.inputBlocked ? `Input VAT blocked (Art. 53): ${money(v.inputBlocked)}` : '',
      v.inputHeld ? `Input VAT held, no valid tax invoice: ${money(v.inputHeld)}` : '',
    ].filter(Boolean);
    if (notes.length) {
      doc.text(pdfText(notes.join('   ·   ')), M, y + 4);
      y += 12;
    }
    y += 10;
  }

  const openHigh = ev.flags.filter((f) => f.level === 'HIGH' && !ws.resolved[f.key]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(openHigh.length ? `Open HIGH flags (${openHigh.length}): the tax figure is not final` : 'Open HIGH flags: none', M, y);
  y += 6;
  if (openHigh.length) {
    autoTable(doc, {
      startY: y,
      head: [['Rule', 'Issue', 'What to do']],
      body: openHigh.slice(0, 12).map((f) => [f.id, pdfText(f.message), pdfText(f.action)]),
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [180, 35, 24] },
      columnStyles: { 0: { cellWidth: 44 }, 2: { cellWidth: 160 } },
      margin: { left: M, right: M },
    });
    y = lastY(doc, y);
    if (openHigh.length > 12) {
      y += 12;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`...and ${openHigh.length - 12} more. See the Excel working paper.`, M, y);
    }
  }
  y += 18;

  if (!vatOnly) autoTable(doc, {
    startY: y,
    head: [['Carried forward to next period', 'AED']],
    body: [
      ['Tax losses', money(r.loss.carriedForward)],
      ['Disallowed net interest', money(r.interest.totalCarriedForward)],
    ],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [11, 107, 102] },
    columnStyles: { 1: { halign: 'right', cellWidth: 90 } },
    margin: { left: M, right: M },
  });
  y = vatOnly ? y + 16 : lastY(doc, y) + 34;

  if (y > doc.internal.pageSize.getHeight() - 90) {
    doc.addPage();
    y = 60;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const third = (W - 2 * M) / 3;
  doc.text('Prepared by ____________', M, y);
  doc.text('Reviewed by ____________', M + third, y);
  doc.text('Date ____________', M + 2 * third, y);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(100);
    const h = doc.internal.pageSize.getHeight();
    doc.text("Prepared with the firm's CT calculator. Subject to professional review.", M, h - 24);
    doc.text(`Page ${i} of ${pages}`, W - M, h - 24, { align: 'right' });
    doc.setTextColor(0);
  }
  return new Uint8Array(doc.output('arraybuffer'));
}

function lastY(doc: jsPDF, fallback: number): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fallback;
}

function ruleTitle(rule: string, fallback: string): string {
  const titles: Record<string, string> = {
    'AB-01': 'Entertainment',
    'AB-02': 'Pension',
    'AB-03': 'Donations',
    'AB-04': 'Costs of exempt income',
    'AB-05A': 'Dividends paid',
    'AB-05B': 'Participation exemption',
    'AB-06': 'Fines and penalties',
    'AB-07': 'VAT expensed',
    'AB-08': 'Related-party pricing',
    'AB-09': 'Connected-person payments',
    'AB-11': 'Personal and private use',
    'AB-12': 'Capital items expensed',
    'AB-13': 'Interest above the limit',
    'AB-14': 'No invoice or support',
    'Step 3': 'Realisation basis',
  };
  return titles[rule] ?? fallback;
}
