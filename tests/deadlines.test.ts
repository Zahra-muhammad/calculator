import { describe, expect, it } from 'vitest';
import { deadlines, lateFilingPenalty, latePaymentPenalty, monthsLate } from '../src/engine/deadlines';
import { addMonths, addMonthsSameDay } from '../src/engine/util';

describe('test 15: deadlines and penalties', () => {
  const base = { incorporationDate: '2025-03-10', firstPeriodStart: '2025-03-10', firstPeriodEnd: '2025-12-31', periodEnd: '2025-12-31' };

  it('works out the due dates', () => {
    const r = deadlines({ ...base, today: '2025-04-01' });
    expect(r.registrationDue).toBe('2025-06-10');
    expect(r.returnDue).toBe('2026-09-30');
    expect(r.paymentDue).toBe('2026-09-30');
    expect(r.waiverDeadline).toBe('2026-07-31');
    expect(r.isFirstPeriod).toBe(true);
  });

  it('filing 2 months late costs AED 1,000', () => {
    expect(lateFilingPenalty(2)).toBe(1_000);
    const r = deadlines({ ...base, registrationDate: '2025-05-01', returnFiledDate: '2026-11-30', taxPaidDate: '2026-09-30', today: '2027-01-01' });
    expect(r.monthsLateFiling).toBe(2);
    expect(r.penalties.lateFiling).toBe(1_000);
  });

  it('part months count as full months; after 12 months the rate doubles', () => {
    expect(monthsLate('2026-09-30', '2026-10-01')).toBe(1);
    expect(monthsLate('2026-09-30', '2026-09-30')).toBe(0);
    expect(lateFilingPenalty(14)).toBe(12 * 500 + 2 * 1_000);
  });

  it('late payment: 14% a year for each month or part of a month (Cabinet Decision 75/2023)', () => {
    // AED 100,000 due 30 Sep 2026.
    expect(latePaymentPenalty(100_000, monthsLate('2026-09-30', '2026-10-01'))).toBe(1_166.67); // 1 day = 1 month
    expect(latePaymentPenalty(100_000, monthsLate('2026-09-30', '2026-11-09'))).toBe(2_333.33); // 40 days = 2 months
    const oneDay = deadlines({ ...base, registrationDate: '2025-05-01', returnFiledDate: '2026-09-30', taxPaidDate: '2026-10-01', taxAmount: 100_000 });
    expect(oneDay.daysLatePayment).toBe(1);
    expect(oneDay.monthsLatePayment).toBe(1);
    expect(oneDay.penalties.latePayment).toBe(1_166.67);
    const fortyDays = deadlines({ ...base, registrationDate: '2025-05-01', returnFiledDate: '2026-09-30', taxPaidDate: '2026-11-09', taxAmount: 100_000 });
    expect(fortyDays.daysLatePayment).toBe(40);
    expect(fortyDays.monthsLatePayment).toBe(2);
    expect(fortyDays.penalties.latePayment).toBe(2_333.33);
    // Tax of 29,250 paid 61 days late (30 Sep → 30 Nov) = 2 months.
    const r = deadlines({ ...base, registrationDate: '2025-05-01', returnFiledDate: '2026-09-30', taxPaidDate: '2026-11-30', taxAmount: 29_250 });
    expect(r.monthsLatePayment).toBe(2);
    expect(r.penalties.latePayment).toBe(682.5);
  });

  it('shows "14%" and drops the old note about penalty rules before 14 April 2026', () => {
    const r = deadlines({ ...base, registrationDate: '2025-05-01', returnFiledDate: '2026-09-30', taxPaidDate: '2026-11-09', taxAmount: 100_000 });
    const note = r.notes.find((n) => n.startsWith('Late payment'));
    expect(note).toBe('Late payment: AED 100,000 × 14% ÷ 12 × 2 months. Each month or part of a month late counts as a full month.');
    expect(r.notes.join(' ')).not.toMatch(/earlier penalty rules|April 2026|14\.0000/);
    expect(latePaymentPenalty(100_000, 0)).toBe(0);
    expect(latePaymentPenalty(0, 3)).toBe(0);
  });

  it('late registration costs AED 10,000 unless the first return is filed within 7 months', () => {
    const late = deadlines({ ...base, registrationDate: '2025-08-01', returnFiledDate: '2026-08-15' });
    expect(late.registrationLate).toBe(true);
    expect(late.waiverApplies).toBe(false);
    expect(late.penalties.lateRegistration).toBe(10_000);

    const waived = deadlines({ ...base, registrationDate: '2025-08-01', returnFiledDate: '2026-07-20' });
    expect(waived.waiverApplies).toBe(true);
    expect(waived.penalties.lateRegistration).toBe(0);
  });

  it('adds months with the month-end rule', () => {
    expect(addMonths('2025-12-31', 9)).toBe('2026-09-30');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonths('2025-01-30', 1)).toBe('2025-02-28');
  });
});

describe('registration due dates', () => {
  it('companies: incorporation + 3 months keeps the day number (clamped), with no jump to month end', () => {
    const due = (d: string) => deadlines({ incorporationDate: d, today: '2025-01-01' }).registrationDue;
    expect(due('2025-02-28')).toBe('2025-05-28');
    expect(due('2025-04-30')).toBe('2025-07-30');
    expect(due('2025-09-30')).toBe('2025-12-30');
    expect(due('2025-11-30')).toBe('2026-02-28'); // clamped to the month length
    expect(addMonthsSameDay('2025-01-31', 3)).toBe('2025-04-30');
    expect(deadlines({ incorporationDate: '2025-02-28' }).registrationBasis).toBe('Incorporated 28 Feb 2025 + 3 months');
  });

  it('return deadlines keep the month-end rule (31 Dec → 30 Sep)', () => {
    expect(deadlines({ periodEnd: '2025-12-31', today: '2026-01-01' }).returnDue).toBe('2026-09-30');
    expect(deadlines({ periodEnd: '2025-06-30', today: '2026-01-01' }).returnDue).toBe('2026-03-31');
  });

  it('natural persons with turnover above AED 1M register by 31 March of the next year', () => {
    const np = deadlines({ registrantType: 'natural_person', turnover: 1_200_000, turnoverYear: 2025, today: '2026-01-01' });
    expect(np.registrantType).toBe('natural_person');
    expect(np.registrationDue).toBe('2026-03-31');
    expect(np.registrationBasis).toBe('Turnover above AED 1,000,000 in 2025: register by 31 Mar 2026');
    // The year defaults to the period-end year.
    expect(deadlines({ registrantType: 'natural_person', turnover: 2_000_000, periodEnd: '2026-12-31', today: '2027-01-01' }).registrationDue).toBe('2027-03-31');
    // AED 1,000,000 exactly is not above the threshold.
    const under = deadlines({ registrantType: 'natural_person', turnover: 1_000_000, turnoverYear: 2025 });
    expect(under.registrationDue).toBeUndefined();
    expect(under.notes[0]).toContain('no registration is needed');
    expect(deadlines({ registrantType: 'natural_person', turnoverYear: 2025 }).notes[0]).toContain('Enter the business turnover');
    // Registered late: the AED 10,000 penalty applies.
    const late = deadlines({ registrantType: 'natural_person', turnover: 1_500_000, turnoverYear: 2025, registrationDate: '2026-04-01' });
    expect(late.registrationLate).toBe(true);
    expect(late.penalties.lateRegistration).toBe(10_000);
  });

  it('non-residents: a permanent establishment registers within 6 months, a nexus within 3 months', () => {
    const pe = deadlines({ registrantType: 'nonresident_pe', peStartDate: '2025-03-15', today: '2025-04-01' });
    expect(pe.registrationDue).toBe('2025-09-15');
    expect(pe.registrationBasis).toBe('PE started 15 Mar 2025 + 6 months');
    expect(pe.events.map((e) => e.label)).toEqual(['Permanent establishment started', 'Registration due']);
    expect(deadlines({ registrantType: 'nonresident_pe', peStartDate: '2025-08-31' }).registrationDue).toBe('2026-02-28');
    const nexus = deadlines({ registrantType: 'nonresident_nexus', nexusDate: '2025-03-15', today: '2025-04-01' });
    expect(nexus.registrationDue).toBe('2025-06-15');
    expect(nexus.events[0].label).toBe('Nexus established');
    expect(deadlines({ registrantType: 'nonresident_nexus' }).notes[0]).toBe('Enter the date the nexus was established.');
    // The incorporation date is not used for a non-resident.
    expect(deadlines({ registrantType: 'nonresident_pe', incorporationDate: '2025-01-10' }).registrationDue).toBeUndefined();
  });
});
