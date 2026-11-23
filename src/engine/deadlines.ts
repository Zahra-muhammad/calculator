/**
 * Registration, filing and payment dates, and a penalty estimate.
 * All periods and amounts come from settings.ts.
 */
import { SETTINGS } from './settings';
import type { DeadlineInputs, DeadlineResult, RegistrantType, TimelineEvent } from './types';
import { addMonths, addMonthsSameDay, aed, daysBetween, fmtDate, isIsoDate, pct, round2, todayIso, yearOf } from './util';

const D = SETTINGS.deadlines;
const P = SETTINGS.penalties;

/** Months late, counting part months as full months. 0 if on time. Steps from a month-end due date keep to month ends. */
export function monthsLate(due: string, actual: string): number {
  if (actual <= due) return 0;
  let n = 1;
  while (addMonths(due, n) < actual) n++;
  return n;
}

/** Late filing penalty: AED 500 a month for months 1–12, then AED 1,000 a month. */
export function lateFilingPenalty(months: number): number {
  if (months <= 0) return 0;
  const first = Math.min(months, 12);
  const rest = Math.max(0, months - 12);
  return first * P.lateFilingMonth1to12 + rest * P.lateFilingAfter12;
}

/** Late payment: tax × annual rate ÷ 12 for each month or part of a month late. */
export function latePaymentPenalty(tax: number, monthsLatePaid: number): number {
  if (tax <= 0 || monthsLatePaid <= 0) return 0;
  return round2((tax * P.latePaymentAnnualRate * monthsLatePaid) / 12);
}

const ok = (d?: string): d is string => isIsoDate(d);

/** Registration due date and how it was worked out, for each kind of registrant. */
export function registrationDue(inp: DeadlineInputs): { type: RegistrantType; due?: string; basis?: string; trigger?: { date: string; label: string }; notes: string[] } {
  const type = inp.registrantType ?? 'company';
  const notes: string[] = [];
  const sameDay = (from: string, months: number, what: string) => ({
    due: addMonthsSameDay(from, months),
    basis: `${what} ${fmtDate(from)} + ${months} months`,
  });

  switch (type) {
    case 'natural_person': {
      const threshold = SETTINGS.naturalPersonTurnover;
      const year = inp.turnoverYear ?? (ok(inp.periodEnd) ? yearOf(inp.periodEnd) : undefined);
      if (inp.turnover === undefined) {
        notes.push(`Enter the business turnover for the calendar year. A natural person registers only when it is above ${aed(threshold)}.`);
        return { type, notes };
      }
      if (inp.turnover <= threshold) {
        notes.push(`Turnover of ${aed(inp.turnover)} is not above ${aed(threshold)}${year ? ` in ${year}` : ''}, so no registration is needed for that year.`);
        return { type, notes };
      }
      if (year === undefined) {
        notes.push('Enter the calendar year the turnover is for.');
        return { type, notes };
      }
      const [mm, dd] = D.naturalPersonRegistrationBy.split('-');
      const due = `${year + 1}-${mm}-${dd}`;
      return { type, due, basis: `Turnover above ${aed(threshold)} in ${year}: register by ${fmtDate(due)}`, notes };
    }
    case 'nonresident_pe':
      if (!ok(inp.peStartDate)) {
        notes.push('Enter the date the permanent establishment started.');
        return { type, notes };
      }
      return { type, ...sameDay(inp.peStartDate, D.peRegistrationMonths, 'PE started'), trigger: { date: inp.peStartDate, label: 'Permanent establishment started' }, notes };
    case 'nonresident_nexus':
      if (!ok(inp.nexusDate)) {
        notes.push('Enter the date the nexus was established.');
        return { type, notes };
      }
      return { type, ...sameDay(inp.nexusDate, D.nexusRegistrationMonths, 'Nexus established'), trigger: { date: inp.nexusDate, label: 'Nexus established' }, notes };
    default:
      if (!ok(inp.incorporationDate)) return { type: 'company', notes };
      return { type: 'company', ...sameDay(inp.incorporationDate, D.registrationMonths, 'Incorporated'), trigger: { date: inp.incorporationDate, label: 'Incorporated' }, notes };
  }
}

export function deadlines(inp: DeadlineInputs): DeadlineResult {
  const today = ok(inp.today) ? inp.today : todayIso();
  const events: TimelineEvent[] = [];

  const reg = registrationDue(inp);
  const notes: string[] = [...reg.notes];
  const regDue = reg.due;
  const periodEnd = ok(inp.periodEnd) ? inp.periodEnd : ok(inp.firstPeriodEnd) ? inp.firstPeriodEnd : undefined;
  const returnDue = periodEnd ? addMonths(periodEnd, D.returnMonths) : undefined;
  const paymentDue = returnDue;
  const isFirstPeriod = ok(inp.firstPeriodEnd) && (!periodEnd || periodEnd === inp.firstPeriodEnd);
  const waiverDeadline = ok(inp.firstPeriodEnd) ? addMonths(inp.firstPeriodEnd, D.waiverMonths) : undefined;

  // Registration.
  let registrationLate = false;
  if (regDue) {
    const regDate = ok(inp.registrationDate) ? inp.registrationDate : today;
    registrationLate = regDate > regDue;
    if (!ok(inp.registrationDate) && registrationLate) notes.push('Not registered yet: the registration penalty applies once registered late.');
  }
  const firstReturnFiled = isFirstPeriod && ok(inp.returnFiledDate) ? inp.returnFiledDate : undefined;
  const waiverApplies = registrationLate && !!waiverDeadline && !!firstReturnFiled && firstReturnFiled <= waiverDeadline;
  if (registrationLate && waiverDeadline && !waiverApplies) {
    notes.push(`The late-registration penalty is waived if the first return is filed by ${fmtDate(waiverDeadline)}.`);
  }
  const lateRegistration = registrationLate && !waiverApplies ? P.lateRegistration : 0;

  // Filing.
  let monthsLateFiling = 0;
  if (returnDue) {
    const filed = ok(inp.returnFiledDate) ? inp.returnFiledDate : today > returnDue ? today : undefined;
    if (filed) monthsLateFiling = monthsLate(returnDue, filed);
    if (!ok(inp.returnFiledDate) && monthsLateFiling) notes.push('Return not filed yet: the filing penalty is estimated to today.');
  }
  const lateFiling = lateFilingPenalty(monthsLateFiling);

  // Payment: the annual rate ÷ 12 for each month or part of a month late.
  let daysLatePayment = 0;
  let monthsLatePayment = 0;
  const tax = inp.taxAmount ?? 0;
  if (paymentDue) {
    const paid = ok(inp.taxPaidDate) ? inp.taxPaidDate : today > paymentDue ? today : undefined;
    if (paid) {
      daysLatePayment = Math.max(0, daysBetween(paymentDue, paid));
      monthsLatePayment = monthsLate(paymentDue, paid);
    }
    if (!ok(inp.taxPaidDate) && monthsLatePayment && tax > 0) notes.push('Tax not paid yet: the payment penalty is estimated to today.');
  }
  const latePayment = latePaymentPenalty(tax, monthsLatePayment);
  if (latePayment) {
    notes.push(
      `Late payment: ${aed(tax)} × ${pct(P.latePaymentAnnualRate, 0)} ÷ 12 × ${monthsLatePayment} month${monthsLatePayment === 1 ? '' : 's'}. Each month or part of a month late counts as a full month.`,
    );
  }

  // Timeline.
  const push = (date: string | undefined, label: string, kind: TimelineEvent['kind']) => {
    if (date) events.push({ date, label, kind });
  };
  if (reg.type === 'company') push(inp.incorporationDate, 'Incorporated', 'info');
  else if (reg.trigger) push(reg.trigger.date, reg.trigger.label, 'info');
  push(regDue, 'Registration due', 'due');
  push(inp.registrationDate, 'Registered', registrationLate ? 'late' : 'done');
  push(inp.firstPeriodStart, 'First period starts', 'info');
  push(periodEnd, 'Period ends', 'info');
  if (isFirstPeriod) push(waiverDeadline, 'Waiver deadline (first return)', 'due');
  push(returnDue, 'Return and payment due', 'due');
  push(inp.returnFiledDate, 'Return filed', monthsLateFiling ? 'late' : 'done');
  push(inp.taxPaidDate, 'Tax paid', monthsLatePayment ? 'late' : 'done');
  events.sort((a, b) => a.date.localeCompare(b.date));

  return {
    registrantType: reg.type,
    registrationDue: regDue,
    registrationBasis: reg.basis,
    returnDue,
    paymentDue,
    waiverDeadline,
    isFirstPeriod,
    registrationLate,
    waiverApplies,
    monthsLateFiling,
    daysLatePayment,
    monthsLatePayment,
    penalties: {
      lateRegistration,
      lateFiling,
      latePayment,
      total: round2(lateRegistration + lateFiling + latePayment),
    },
    notes,
    events,
  };
}
