/**
 * VAT from the sales and purchase registers and the imports list, at the standard rate in settings.ts,
 * laid out as the FTA VAT return (VAT201).
 *
 *  Output VAT (Box 8)  = VAT due on standard-rated sales (Box 1, by emirate)
 *                      + VAT on imported services under the reverse charge (Box 3)
 *                      + VAT on goods imported through UAE customs (Box 6).
 *  Input VAT (Box 11)  = recoverable VAT on purchases (Box 9) + recoverable VAT on imports (Box 10).
 *  Payable (Box 14)    = Box 12 (= Box 8 VAT) − Box 13 (= Box 11 VAT); negative = refundable.
 *
 * Rules applied automatically (staff can change any purchase or import line, with a reason):
 *  - VAT due on a standard-rated sale is the standard rate of its value. When an invoice shows a different
 *    amount, the correct amount is counted and the difference is flagged.
 *  - Input VAT is blocked (UAE VAT Executive Regulation Art. 53) for entertainment of people who are not
 *    employees, motor vehicles available for personal use, and goods or services for employees' personal use.
 *  - Input VAT is held (not claimed) when the register has a supplier TRN column but the TRN is missing:
 *    input VAT is only recovered with a valid tax invoice (Executive Regulation Art. 55).
 *  - Input VAT counted is never more than the standard rate of the net amount.
 *  - An exact repeat of an earlier line (same number, party, net and VAT) is left out of the totals and
 *    flagged; staff can count it if it really is a separate invoice.
 *
 * Pure: no React, no DOM. It does not change the corporate tax computation.
 */
import { SETTINGS } from './settings';
import type { Flag, InputVatTreatment, InvoiceLine, VatChoice } from './types';
import { INPUT_VAT_LABELS } from './types';
import { aed, norm, num, pct, round2, sum } from './util';

export type SupplyKind = 'standard' | 'zero' | 'exempt' | 'oos';

export const SUPPLY_LABELS: Record<SupplyKind, string> = {
  standard: 'Standard rated',
  zero: 'Zero rated',
  exempt: 'Exempt',
  oos: 'Out of scope',
};

/** VAT return Box 1 rows, by emirate. */
export const EMIRATE_BOXES = [
  ['1a', 'Abu Dhabi', /\babu ?dhabi\b|\bauh\b/],
  ['1b', 'Dubai', /\bdubai\b|\bdxb\b/],
  ['1c', 'Sharjah', /\bsharjah\b|\bshj\b/],
  ['1d', 'Ajman', /\bajman\b/],
  ['1e', 'Umm Al Quwain', /\bumm al ?quwain\b|\buaq\b/],
  ['1f', 'Ras Al Khaimah', /\bras al ?khaimah\b|\brak\b/],
  ['1g', 'Fujairah', /\bfujairah\b/],
] as const;

export type BoxId = '1a' | '1b' | '1c' | '1d' | '1e' | '1f' | '1g' | '1?' | '3' | '4' | '5' | '6' | '8' | '9' | '10' | '11' | '12' | '13' | '14';

export interface VatBox {
  id: BoxId;
  label: string;
  /** Value (net) in AED; undefined for boxes that only hold tax. */
  amount?: number;
  vat?: number;
}

export interface SalesLine extends InvoiceLine {
  supply: SupplyKind;
  /** Box 1 row (standard-rated only). */
  box?: BoxId;
  /** VAT counted on the return (the VAT due). */
  counted: number;
  /** Left out of the totals (an exact repeat of an earlier line). */
  excluded: boolean;
  /** The line this one repeats. */
  dupOf?: string;
}

export interface VatLine extends InvoiceLine {
  /** The treatment used: a person's choice, or the automatic one. */
  treatment: InputVatTreatment;
  /** The treatment without a person's choice. */
  auto: InputVatTreatment;
  /** Why the automatic treatment was chosen. */
  why: string;
  /** True when a person chose the treatment. */
  chosen: boolean;
  reason?: string;
  /** Input VAT counted as recoverable (0 unless recoverable; capped at the standard rate of net). */
  counted: number;
  excluded: boolean;
  dupOf?: string;
}

export interface RegisterTotals {
  count: number;
  net: number;
  vat: number;
  gross: number;
}

export interface VatResult {
  /** True when there is at least one sales, purchase or import line. */
  hasData: boolean;
  rate: number;
  sales: SalesLine[];
  salesTotals: RegisterTotals;
  purchases: VatLine[];
  purchaseTotals: RegisterTotals;
  imports: VatLine[];
  importTotals: RegisterTotals;
  /** Box 8 VAT: all output VAT, including the reverse charge and imports. */
  outputVat: number;
  /** Box 11 VAT: all recoverable input VAT, including imports. */
  inputRecoverable: number;
  inputBlocked: number;
  inputHeld: number;
  inputNotApplicable: number;
  /** Box 14: positive = payable, negative = refundable. */
  payable: number;
  /** The VAT return (VAT201) boxes, in order. */
  boxes: VatBox[];
  flags: Flag[];
}

/** Client entertainment in a description or category ("Client business dinner", "Client entertainment"). */
const CLIENT_ENTERTAINMENT =
  /\b(clients?|customers?)\b.*\b(entertainment|hospitality|dinners?|lunch(es)?|meals?|events?|gifts?|parties|party)\b|\b(entertainment|hospitality|dinners?|lunch(es)?|meals?)\b.*\b(clients?|customers?)\b/;
/** A car or other motor vehicle that is also used privately. */
const VEHICLE = /\b(cars?|vehicles?|motor|suvs?|4x4|pick ?up)\b/;
const PRIVATE_USE = /\b(personal|private|family|weekends?|home use)\b/;
/** Goods or services for employees' personal use. */
const EMPLOYEE_PERSONAL = /\b(staff|employees?|workers?)\b.*\b(personal use|private use|personal (benefit|gift|expenses?))\b|\b(personal use|private use)\b.*\b(staff|employees?)\b/;

/** The input VAT treatment of a purchase or import line before any choice by a person. */
export function autoInputTreatment(l: InvoiceLine): { treatment: InputVatTreatment; why: string } {
  const status = norm(l.status);
  if (/\bblocked\b/.test(status) && !/\bnot blocked\b/.test(status)) return { treatment: 'blocked', why: 'The status says blocked.' };
  if (/\bnot applicable\b|^n ?a$|\bout of scope\b|\bno vat\b/.test(status)) return { treatment: 'na', why: 'The status says not applicable.' };
  if (!l.vat) return { treatment: 'na', why: 'No VAT on this line.' };
  const text = norm(`${l.description} ${l.category ?? ''}`);
  if (CLIENT_ENTERTAINMENT.test(text)) {
    return { treatment: 'blocked', why: 'Client entertainment: input VAT is blocked (Executive Regulation Art. 53).' };
  }
  if (VEHICLE.test(text) && PRIVATE_USE.test(text)) {
    return { treatment: 'blocked', why: 'Motor vehicle available for personal use: input VAT is blocked (Executive Regulation Art. 53).' };
  }
  if (EMPLOYEE_PERSONAL.test(text)) {
    return { treatment: 'blocked', why: "Goods or services for employees' personal use: input VAT is blocked (Executive Regulation Art. 53)." };
  }
  if (l.trnColumn && !l.trn && !l.importType) {
    return { treatment: 'held', why: 'No supplier TRN: input VAT is held until a valid tax invoice is received (Executive Regulation Art. 55).' };
  }
  return { treatment: 'recoverable', why: l.importType ? 'Self-accounted VAT on an import, recoverable as input VAT.' : 'A business purchase with VAT.' };
}

/** Standard rated, zero rated, exempt or out of scope, from the supply type text and the rate. */
export function supplyKind(l: InvoiceLine): SupplyKind {
  const t = norm(`${l.supplyType ?? ''}`);
  if (/\bexempt\b/.test(t)) return 'exempt';
  if (/\bout of scope\b|\boutside (the )?scope\b|\bnot in scope\b|\bnon taxable\b/.test(t)) return 'oos';
  if (/\bzero\b|\bexports?\b|\b0 ?(%|percent)\b/.test(t)) return 'zero';
  if (t) return 'standard';
  if (l.rate === 0 || (l.rate === undefined && !l.vat)) return 'zero';
  return 'standard';
}

function emirateBox(emirate: string | undefined): BoxId {
  const t = norm(emirate);
  for (const [id, , re] of EMIRATE_BOXES) if (re.test(t)) return id;
  return '1?';
}

function totals(lines: InvoiceLine[]): RegisterTotals {
  return {
    count: lines.length,
    net: round2(sum(lines.map((l) => l.net))),
    vat: round2(sum(lines.map((l) => l.vat))),
    gross: round2(sum(lines.map((l) => l.gross ?? l.net + l.vat))),
  };
}

const where = (l: InvoiceLine) => `${l.number} (${l.sheet} row ${l.row})`;
const list = (items: string[]) => `${items.slice(0, 6).join('; ')}${items.length > 6 ? `; and ${items.length - 6} more` : ''}`;

/** VAT shown on the line, unless it is more than 1 AED away from the standard rate of net: then the standard rate. */
function statutory(l: InvoiceLine, rate: number): number {
  const expected = round2(l.net * rate);
  return Math.abs(l.vat - expected) <= 1 ? l.vat : expected;
}

/** Lines whose VAT is not the standard rate of net (only lines that are standard-rated). */
function rateProblems(lines: InvoiceLine[], rate: number, isStandard: (l: InvoiceLine) => boolean): { line: InvoiceLine; expected: number }[] {
  return lines
    .filter(isStandard)
    .map((l) => ({ line: l, expected: round2(l.net * rate) }))
    .filter(({ line, expected }) => Math.abs(line.vat - expected) > 1 || (line.rate !== undefined && line.rate > 0 && Math.abs(line.rate - rate) > 1e-6));
}

/**
 * Exact repeats: same number (and party, for purchases), net and VAT as an earlier line. Returns the key of
 * the earlier line for each repeat. Same number with different amounts is only flagged, not left out.
 */
function findDuplicates(lines: InvoiceLine[], byParty: boolean): { exact: Map<string, string>; groups: InvoiceLine[][] } {
  const groups = new Map<string, InvoiceLine[]>();
  for (const l of lines) {
    const k = byParty ? `${norm(l.party)}|${norm(l.number)}` : norm(l.number);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const exact = new Map<string, string>();
  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  for (const g of dupGroups) {
    g.forEach((l, i) => {
      const first = g.slice(0, i).find((e) => Math.abs(e.net - l.net) < 0.005 && Math.abs(e.vat - l.vat) < 0.005 && norm(e.party) === norm(l.party));
      if (first) exact.set(l.key, first.key);
    });
  }
  return { exact, groups: dupGroups };
}

/**
 * Work out VAT from the registers. `revenue` is revenue in the trial balance (credit positive), used to
 * check VAT on standard-rated sales against the standard rate of revenue.
 */
export function computeVat(
  salesIn: InvoiceLine[],
  purchasesIn: InvoiceLine[],
  choices: Record<string, VatChoice> = {},
  revenue?: number,
  importsIn: InvoiceLine[] = [],
): VatResult {
  const rate = SETTINGS.vatRate;
  const flags: Flag[] = [];
  const flag = (subject: string, level: Flag['level'], message: string, action: string, amount?: number) =>
    flags.push({ id: 'VAT', key: `VAT:${subject}`, level, message, action, amount: amount === undefined ? undefined : round2(amount) });

  // ── Sales ──
  const salesDup = findDuplicates(salesIn, false);
  const sales: SalesLine[] = salesIn.map((l) => {
    const supply = supplyKind(l);
    const dupOf = salesDup.exact.get(l.key);
    const excluded = !!dupOf && choices[l.key]?.include !== true;
    const counted = excluded ? 0 : supply === 'standard' ? statutory(l, rate) : 0;
    return { ...l, supply, box: supply === 'standard' ? emirateBox(l.emirate) : undefined, counted, excluded, dupOf };
  });
  const countedSales = sales.filter((l) => !l.excluded);

  // ── Purchases and imports ──
  const treat = (l: InvoiceLine, dupOf: string | undefined): VatLine => {
    const auto = autoInputTreatment(l);
    const c = choices[l.key];
    const chosen = !!c?.treatment && c.treatment !== auto.treatment;
    const treatment = chosen ? c!.treatment! : auto.treatment;
    const excluded = !!dupOf && c?.include !== true;
    // Never more than the standard rate of net (1 AED rounding allowed).
    const cap = round2(l.net * rate);
    const counted = !excluded && treatment === 'recoverable' ? (l.vat <= cap + 1 ? l.vat : cap) : 0;
    return { ...l, treatment, auto: auto.treatment, why: auto.why, chosen, reason: c?.reason?.trim() || undefined, counted, excluded, dupOf };
  };
  const purchDup = findDuplicates(purchasesIn, true);
  const purchases = purchasesIn.map((l) => treat(l, purchDup.exact.get(l.key)));
  const importDup = findDuplicates(importsIn, true);
  const imports = importsIn.map((l) => treat(l, importDup.exact.get(l.key)));
  const liveImports = imports.filter((l) => !l.excluded);

  const vatOf = (lines: VatLine[], t: InputVatTreatment) => round2(sum(lines.filter((l) => !l.excluded && l.treatment === t).map((l) => l.vat)));

  // ── VAT return boxes ──
  const boxes: VatBox[] = [];
  for (const [id, name] of [...EMIRATE_BOXES.map(([i, n]) => [i, n] as const), ['1?', 'Emirate not given'] as const]) {
    const ls = countedSales.filter((l) => l.box === id);
    if (ls.length || id !== '1?') boxes.push({ id, label: `Standard rated supplies in ${name}`, amount: round2(sum(ls.map((l) => l.net))), vat: round2(sum(ls.map((l) => l.counted))) });
  }
  const svc = liveImports.filter((l) => l.importType !== 'goods');
  const goods = liveImports.filter((l) => l.importType === 'goods');
  const box3 = { amount: round2(sum(svc.map((l) => l.net))), vat: round2(sum(svc.map((l) => l.vat))) };
  const box6 = { amount: round2(sum(goods.map((l) => l.net))), vat: round2(sum(goods.map((l) => l.vat))) };
  const box4 = round2(sum(countedSales.filter((l) => l.supply === 'zero').map((l) => l.net)));
  const box5 = round2(sum(countedSales.filter((l) => l.supply === 'exempt').map((l) => l.net)));
  boxes.push({ id: '3', label: 'Supplies subject to the reverse charge (imported services)', ...box3 });
  boxes.push({ id: '4', label: 'Zero rated supplies', amount: box4, vat: 0 });
  boxes.push({ id: '5', label: 'Exempt supplies', amount: box5, vat: 0 });
  boxes.push({ id: '6', label: 'Goods imported into the UAE', ...box6 });
  const box1 = boxes.filter((b) => b.id.startsWith('1'));
  const box8 = {
    amount: round2(sum(box1.map((b) => b.amount ?? 0)) + box3.amount + box4 + box5 + box6.amount),
    vat: round2(sum(box1.map((b) => b.vat ?? 0)) + box3.vat + box6.vat),
  };
  boxes.push({ id: '8', label: 'Total output', ...box8 });
  const recP = purchases.filter((l) => !l.excluded && l.treatment === 'recoverable');
  const recI = liveImports.filter((l) => l.treatment === 'recoverable');
  const box9 = { amount: round2(sum(recP.map((l) => l.net))), vat: round2(sum(recP.map((l) => l.counted))) };
  const box10 = { amount: round2(sum(recI.map((l) => l.net))), vat: round2(sum(recI.map((l) => l.counted))) };
  const box11 = { amount: round2(box9.amount + box10.amount), vat: round2(box9.vat + box10.vat) };
  boxes.push({ id: '9', label: 'Standard rated expenses (recoverable)', ...box9 });
  boxes.push({ id: '10', label: 'Supplies subject to the reverse charge (recoverable)', ...box10 });
  boxes.push({ id: '11', label: 'Total input', ...box11 });
  boxes.push({ id: '12', label: 'Total value of due tax for the period', vat: box8.vat });
  boxes.push({ id: '13', label: 'Total value of recoverable tax for the period', vat: box11.vat });
  const payable = round2(box8.vat - box11.vat);
  boxes.push({ id: '14', label: payable >= 0 ? 'Payable tax for the period' : 'Refundable tax for the period', vat: payable });

  // ── Checks ──
  // A change by a person needs a reason (audit trail).
  for (const l of [...purchases, ...imports]) {
    if (l.chosen && !l.reason) {
      flag(`reason-${l.key}`, 'MEDIUM', `Input VAT on ${where(l)} was changed to "${INPUT_VAT_LABELS[l.treatment]}" without a reason.`, 'Enter the reason next to the line in the VAT section.', l.vat);
    }
  }

  for (const [kind, lines, label, isStd] of [
    ['sales', sales, 'sales', (l: InvoiceLine) => supplyKind(l) === 'standard'],
    ['purchases', purchases, 'purchase', (l: InvoiceLine) => (l.rate === undefined ? l.vat !== 0 : l.rate > 0)],
  ] as const) {
    if (!lines.length) continue;
    const bad = rateProblems(lines, rate, isStd);
    if (bad.length) {
      flag(
        `rate-${kind}`,
        'MEDIUM',
        `VAT is not ${pct(rate, 0)} of net on ${bad.length} ${label} line${bad.length === 1 ? '' : 's'}: ${list(bad.map(({ line, expected }) => `${where(line)}: VAT ${num(line.vat, 2)}, expected ${num(expected, 2)}`))}.`,
        kind === 'sales'
          ? `The VAT due is ${pct(rate, 0)} of the value, so the correct amount is counted on the return. Issue a corrected tax invoice or a credit note for the difference.`
          : `No more than ${pct(rate, 0)} of net is counted as input VAT. Ask the supplier for a corrected tax invoice.`,
        sum(bad.map(({ line, expected }) => Math.abs(line.vat - expected))),
      );
    }
    // Zero-rated, exempt or out-of-scope sales that still show VAT.
    if (kind === 'sales') {
      const vatOnNonStd = sales.filter((l) => l.supply !== 'standard' && Math.abs(l.vat) > 0.005);
      if (vatOnNonStd.length) {
        flag(
          'vat-on-zero',
          'MEDIUM',
          `VAT is shown on ${vatOnNonStd.length} sales line${vatOnNonStd.length === 1 ? '' : 's'} that ${vatOnNonStd.length === 1 ? 'is' : 'are'} not standard rated: ${list(vatOnNonStd.map((l) => `${where(l)}: ${SUPPLY_LABELS[l.supply]}, VAT ${num(l.vat, 2)}`))}.`,
          'Check the supply type. Zero-rated, exempt and out-of-scope supplies carry no VAT.',
          sum(vatOnNonStd.map((l) => Math.abs(l.vat))),
        );
      }
    }
    // Net + VAT must equal gross.
    const grossBad = lines.filter((l) => l.gross !== undefined && Math.abs(l.net + l.vat - l.gross) > 1);
    if (grossBad.length) {
      flag(
        `gross-${kind}`,
        'MEDIUM',
        `Net + VAT does not equal gross on ${grossBad.length} ${label} line${grossBad.length === 1 ? '' : 's'}: ${list(grossBad.map((l) => `${where(l)}: ${num(l.net, 2)} + ${num(l.vat, 2)} ≠ ${num(l.gross!, 2)}`))}.`,
        'Check the amounts against the invoices.',
        sum(grossBad.map((l) => Math.abs(l.net + l.vat - l.gross!))),
      );
    }
    // Duplicate invoice numbers.
    const dup = kind === 'sales' ? salesDup : purchDup;
    if (dup.groups.length) {
      const left = (lines as readonly (SalesLine | VatLine)[]).filter((l) => l.excluded);
      flag(
        `duplicates-${kind}`,
        'HIGH',
        `Duplicate invoice numbers in the ${label} register: ${list(dup.groups.map((g) => `${g[0].number} (rows ${g.map((l) => l.row).join(', ')})`))}.${left.length ? ` ${left.length} exact repeat${left.length === 1 ? ' is' : 's are'} left out of the totals.` : ' The amounts differ, so every line is counted.'}`,
        kind === 'sales'
          ? 'Confirm with the client. If a repeat really is a separate invoice, tick "Count this line" in the VAT section.'
          : 'Confirm with the supplier. If a repeat really is a separate invoice, tick "Count this line" in the VAT section.',
        sum(dup.groups.flatMap((g) => g.slice(1).map((l) => l.vat))),
      );
    }
  }

  // Supplier TRN: input VAT is recovered only with a tax invoice that shows the supplier's TRN.
  const held = purchases.filter((l) => !l.excluded && l.treatment === 'held');
  if (held.length) {
    flag(
      'trn',
      'MEDIUM',
      `Input VAT of ${aed(sum(held.map((l) => l.vat)), 2)} is held on ${held.length} purchase line${held.length === 1 ? '' : 's'} with no supplier TRN: ${list(held.map((l) => `${where(l)}${l.party ? `, ${l.party}` : ''}`))}.`,
      "Input VAT can only be recovered with a tax invoice that shows the supplier's TRN. Get a corrected invoice, then change the line to Recoverable with a reason.",
      sum(held.map((l) => l.vat)),
    );
  }
  // Blocked input VAT: not claimed (Executive Regulation Art. 53). Shown so a person can confirm it.
  const blocked = [...purchases, ...imports].filter((l) => !l.excluded && l.treatment === 'blocked' && l.vat > 0);
  if (blocked.length) {
    flag(
      'blocked',
      'INFO',
      `Input VAT of ${aed(sum(blocked.map((l) => l.vat)), 2)} is blocked and not claimed on ${blocked.length} line${blocked.length === 1 ? '' : 's'}: ${list(blocked.map((l) => `${where(l)} (${l.chosen ? 'changed by staff' : l.why.split(':')[0].toLowerCase()})`))}.`,
      'Confirm each one. If a line is not blocked (for example staff entertainment), change it to Recoverable with a reason.',
      sum(blocked.map((l) => l.vat)),
    );
  }
  const claimable = purchases.filter((l) => l.treatment === 'recoverable' && l.vat > 0);
  if (claimable.some((l) => !l.trnColumn)) {
    flag('trn-column', 'INFO', 'The purchase register has no supplier TRN column, so missing TRNs could not be checked.', "Check that each recoverable invoice shows the supplier's TRN.");
  }
  // Imports whose type could not be told.
  const unknownType = imports.filter((l) => !l.importType);
  if (unknownType.length) {
    flag(
      'import-type',
      'MEDIUM',
      `Import type not clear on ${unknownType.length} line${unknownType.length === 1 ? '' : 's'}: ${list(unknownType.map(where))}. Counted as imported services (Box 3).`,
      'Say in the type column whether it is an import of services (reverse charge) or of goods (customs).',
    );
  }
  // Standard-rated sales with no emirate.
  const noEmirate = countedSales.filter((l) => l.box === '1?');
  if (noEmirate.length) {
    flag(
      'emirate',
      'INFO',
      `No emirate on ${noEmirate.length} standard-rated sales line${noEmirate.length === 1 ? '' : 's'}, so Box 1 cannot be split by emirate.`,
      'Add an Emirate column to the sales register, or split Box 1 by hand when filing.',
    );
  }

  // VAT on standard-rated sales should be the standard rate of revenue less zero-rated and exempt sales.
  if (countedSales.length && revenue !== undefined && revenue > 0) {
    const nonStd = sum(countedSales.filter((l) => l.supply !== 'standard').map((l) => l.net));
    const base = Math.max(0, revenue - nonStd);
    const box1Vat = round2(sum(box1.map((b) => b.vat ?? 0)));
    const expected = round2(base * rate);
    const diff = round2(box1Vat - expected);
    if (Math.abs(diff) > Math.max(1, expected * 0.001)) {
      flag(
        'sales-vs-revenue',
        'MEDIUM',
        `VAT on standard-rated sales (${aed(box1Vat, 2)}) is not ${pct(rate, 0)} of revenue in the trial balance less zero-rated and exempt sales (${pct(rate, 0)} × ${aed(base)} = ${aed(expected, 2)}). Difference ${aed(Math.abs(diff), 2)}.`,
        'Check for out-of-scope sales, timing differences, or invoices missing from the sales register.',
        Math.abs(diff),
      );
    }
  }

  return {
    hasData: sales.length > 0 || purchases.length > 0 || imports.length > 0,
    rate,
    sales,
    salesTotals: totals(sales),
    purchases,
    purchaseTotals: totals(purchases),
    imports,
    importTotals: totals(imports),
    outputVat: box8.vat,
    inputRecoverable: box11.vat,
    inputBlocked: round2(vatOf(purchases, 'blocked') + vatOf(imports, 'blocked')),
    inputHeld: round2(vatOf(purchases, 'held') + vatOf(imports, 'held')),
    inputNotApplicable: round2(vatOf(purchases, 'na') + vatOf(imports, 'na')),
    payable,
    boxes,
    flags,
  };
}
