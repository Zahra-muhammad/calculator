import { describe, expect, it } from 'vitest';
import { compute, foreignTaxCreditFor, interestLimitation, participationTest, qfzpDeMinimis, standardTax } from '../src/engine/compute';
import { computeWithFlags, connectedPersonGroups } from '../src/engine/flags';
import type { ComputeInput, LineAnswer, TaxLine } from '../src/engine/types';
import { exp, inc } from './helpers';

const loss = (amount: number) => [{ periodStart: '2024-01-01', amount }];

describe('spec tests 1–9: the six steps', () => {
  it('1. simple: fine and personal holiday', () => {
    const r = compute({ pbt: 300_000, lines: [exp('fines', 5_000), exp('personal', 20_000)] });
    expect(r.totalAddBacks).toBe(25_000);
    expect(r.taxableIncome).toBe(325_000);
    expect(r.tax).toBe(0);
  });

  it('2. the 0% band', () => {
    expect(compute({ pbt: 500_000, lines: [] }).tax).toBe(11_250);
    expect(compute({ pbt: 1_000_000, lines: [] }).tax).toBe(56_250);
    expect(compute({ pbt: 375_001, lines: [] }).tax).toBe(0.09);
    expect(standardTax(375_000)).toBe(0);
  });

  it("3. Omar's gym", () => {
    const r = compute({
      pbt: 650_000,
      lines: [exp('entertainment_client', 12_000), exp('fines', 2_500), exp('donation_unlisted', 7_000), exp('personal', 15_000), inc('dividend_received_uae', 50_000)],
    });
    expect(r.addBacks.find((a) => a.ruleId === 'AB-01')?.amount).toBe(6_000);
    expect(r.totalAddBacks).toBe(30_500);
    expect(r.taxableIncome).toBe(630_500);
    expect(r.tax).toBe(22_995);
    // Exempt income but no AB-04 add-back → MEDIUM flag.
    expect(r.flags.some((f) => f.id === 'AB-04' && f.level === 'MEDIUM')).toBe(true);
  });

  it("4. Huda's salon", () => {
    const r = compute({
      pbt: 900_000,
      lines: [exp('fines', 4_000), exp('personal', 11_000), exp('entertainment_client', 20_000), inc('dividend_received_uae', 40_000)],
      lossesBF: loss(300_000),
    });
    expect(r.taxableIncome).toBe(885_000);
    expect(r.loss.used).toBe(300_000);
    expect(r.taxableAfterLoss).toBe(585_000);
    expect(r.tax).toBe(18_900);
  });

  it("5. Mariam's bakery (AB-04)", () => {
    const r = compute({
      pbt: 900_000,
      totalIncome: 2_000_000,
      sharedOverheads: 200_000,
      lines: [
        exp('fines', 5_000),
        exp('entertainment_client', 12_000),
        exp('personal', 7_000),
        exp('donation_unlisted', 3_000),
        inc('dividend_received_uae', 100_000),
        exp('exempt_income_cost', 2_000, 'Adviser fee'),
      ],
      lossesBF: loss(400_000),
    });
    expect(r.addBacks.find((a) => a.label.startsWith('Share of overheads'))?.amount).toBe(10_000);
    expect(r.totalAddBacks).toBe(33_000);
    expect(r.taxableIncome).toBe(833_000);
    expect(r.loss.cap).toBe(624_750);
    expect(r.loss.used).toBe(400_000);
    expect(r.taxableAfterLoss).toBe(433_000);
    expect(r.tax).toBe(5_220);
    expect(r.flags.some((f) => f.id === 'AB-04')).toBe(false);
  });

  it("6. Yousef's tailoring (loss cap binds)", () => {
    // The spec adds back the unsupported 6,000: staff have answered "No evidence".
    const noInvoice = exp('no_invoice', 6_000);
    const r = compute({
      pbt: 2_000_000,
      totalIncome: 5_000_000,
      sharedOverheads: 400_000,
      lines: [exp('fines', 4_000), exp('entertainment_client', 20_000), exp('personal', 25_000), noInvoice, exp('exempt_income_cost', 5_000, 'Broker fee'), inc('dividend_received_uae', 250_000)],
      answers: { [noInvoice.key]: { supportEvidence: 'none' } },
      lossesBF: loss(1_500_000),
    });
    expect(r.totalAddBacks).toBe(70_000);
    expect(r.taxableIncome).toBe(1_820_000);
    expect(r.loss.used).toBe(1_365_000);
    expect(r.taxableAfterLoss).toBe(455_000);
    expect(r.tax).toBe(7_200);
    expect(r.loss.carriedForward).toBe(135_000);
  });

  it("7. Aisha's café (capital item)", () => {
    const machine = exp('capital_expensed', 60_000, 'Coffee machine');
    const r = compute({
      pbt: 800_000,
      totalIncome: 3_000_000,
      sharedOverheads: 200_000,
      lines: [exp('entertainment_client', 18_000), exp('fines', 3_000), machine, exp('exempt_income_cost', 3_000), inc('dividend_received_uae', 150_000)],
      answers: { [machine.key]: { taxDepreciation: 12_000 } },
      lossesBF: loss(300_000),
    });
    expect(r.totalAddBacks).toBe(85_000);
    expect(r.totalDeductions).toBe(162_000);
    expect(r.taxableIncome).toBe(723_000);
    expect(r.loss.used).toBe(300_000);
    expect(r.taxableAfterLoss).toBe(423_000);
    expect(r.tax).toBe(4_320);
  });

  it("8. Salem's shop (connected person)", () => {
    const brother = exp('connected_person_payment', 400_000, "Brother's salary");
    const van = exp('capital_expensed', 90_000, 'Van');
    const r = compute({
      pbt: 1_200_000,
      totalIncome: 6_000_000,
      sharedOverheads: 400_000,
      lines: [brother, exp('entertainment_client', 14_000), exp('donation_unlisted', 6_000), van, exp('exempt_income_cost', 4_000), inc('dividend_received_uae', 300_000)],
      answers: { [brother.key]: { marketValue: 250_000, businessPurpose: 'yes' }, [van.key]: { taxDepreciation: 30_000 } },
      lossesBF: loss(200_000),
    });
    expect(r.addBacks.find((a) => a.lineKey === brother.key)?.amount).toBe(150_000);
    expect(r.taxableIncome).toBe(1_147_000);
    expect(r.taxableAfterLoss).toBe(947_000);
    expect(r.tax).toBe(51_480);
  });

  it('9. loss year', () => {
    const r = compute({ pbt: -200_000, lines: [], lossesBF: loss(50_000) });
    expect(r.tax).toBe(0);
    expect(r.loss.used).toBe(0);
    expect(r.loss.carriedForward).toBe(250_000);
  });
});

describe('spec tests 10–14: regimes and special rules', () => {
  const sbrInput = (periodEnd: string): ComputeInput => ({
    pbt: 800_000,
    revenue: 2_500_000,
    lines: [],
    profile: { electSBR: true, periodEnd, priorPeriodsUnder3M: true, groupRevenue: 0, legalForm: 'mainland' },
  });

  it('10. SBR eligible → tax 0; period after 2029 → not eligible + HIGH flag', () => {
    const ok = computeWithFlags(sbrInput('2027-12-31'));
    expect(ok.result.sbr.applied).toBe(true);
    expect(ok.result.tax).toBe(0);
    expect(ok.flags.some((f) => f.id === 'SBR' && f.level === 'HIGH')).toBe(false);

    const late = computeWithFlags(sbrInput('2030-12-31'));
    expect(late.result.sbr.eligible).toBe(false);
    expect(late.result.tax).toBeGreaterThan(0);
    const f = late.flags.find((x) => x.id === 'SBR' && x.level === 'HIGH');
    expect(f?.message).toContain('2029-12-31');
  });

  it('10b. SBR: a loss year keeps only the loss brought forward, with an info note', () => {
    const r = computeWithFlags({ ...sbrInput('2027-12-31'), pbt: -100_000, lossesBF: loss(20_000) });
    expect(r.result.loss.carriedForward).toBe(20_000);
    expect(r.flags.some((f) => f.key === 'SBR:loss' && f.level === 'INFO')).toBe(true);
  });

  it('11. interest limit', () => {
    const a = interestLimitation({ net: 20_000_000, adjustedEbitda: 40_000_000, periodYear: 2025 });
    expect(a.excess).toBe(8_000_000);
    expect(a.carriedForwardOut).toEqual([{ year: 2025, amount: 8_000_000 }]);
    const b = interestLimitation({ net: 25_000_000, adjustedEbitda: 100_000_000, periodYear: 2025 });
    expect(b.excess).toBe(0);

    // Through compute: PBT 20m after 20m interest → adjusted EBITDA 40m.
    const r = computeWithFlags({ pbt: 20_000_000, lines: [exp('interest_expense', 20_000_000)], profile: { periodEnd: '2025-12-31' } });
    expect(r.result.interest.adjustedEbitda).toBe(40_000_000);
    expect(r.result.addBacks.find((x) => x.ruleId === 'AB-13')?.amount).toBe(8_000_000);
    expect(r.result.interest.totalCarriedForward).toBe(8_000_000);
    expect(r.flags.find((f) => f.id === 'RV-06')?.level).toBe('HIGH');

    const r2 = compute({ pbt: 75_000_000, lines: [exp('interest_expense', 25_000_000)] });
    expect(r2.interest.adjustedEbitda).toBe(100_000_000);
    expect(r2.interest.excess).toBe(0);
  });

  it('11b. interest carried forward is used under the limit, and expires after 10 years', () => {
    const r = compute({
      pbt: 1_000_000,
      lines: [exp('interest_expense', 2_000_000)],
      interestCF: [
        { year: 2013, amount: 1_000_000 },
        { year: 2020, amount: 3_000_000 },
      ],
      profile: { periodEnd: '2025-12-31' },
    });
    expect(r.interest.expired).toBe(1_000_000);
    expect(r.interest.used).toBe(3_000_000);
    expect(r.deductions.find((d) => d.ruleId === 'AB-13')?.amount).toBe(3_000_000);
  });

  it('12. participation exemption', () => {
    const fail = participationTest({ ownership: 0.3, investeeTaxRate: 0, monthsHeld: 24, nonQualifyingAssets: 0.1 });
    expect(fail.exempt).toBe(false);
    const div = inc('dividend_received_foreign', 100_000, 'Dividend from Cayman Co');
    const r = computeWithFlags({ pbt: 500_000, lines: [div], answers: { [div.key]: { participation: { ownership: 0.3, investeeTaxRate: 0, monthsHeld: 24, nonQualifyingAssets: 0.1 } } } });
    expect(r.result.exemptIncome).toBe(0);
    expect(r.result.taxableIncome).toBe(500_000);
    expect(r.flags.some((f) => f.id === 'AB-05B' && f.level === 'HIGH')).toBe(true);

    const pass = participationTest({ ownership: 0.06, monthsHeld: 4, intendsToHold12: true, investeeTaxRate: 0.15, nonQualifyingAssets: 0.2 });
    expect(pass).toEqual({ exempt: true, failed: [] });
    const r2 = compute({
      pbt: 500_000,
      lines: [div],
      answers: { [div.key]: { participation: { ownership: 0.06, monthsHeld: 4, intendsToHold12: true, investeeTaxRate: 0.15, nonQualifyingAssets: 0.2 } } },
    });
    expect(r2.exemptIncome).toBe(100_000);
    expect(r2.taxableIncome).toBe(400_000);
  });

  it('12b. clawback when ownership fell below 5% within 12 months', () => {
    const div = inc('dividend_received_foreign', 10_000);
    const r = compute({
      pbt: 500_000,
      lines: [div],
      answers: { [div.key]: { participation: { ownership: 0.03, investeeTaxRate: 0.2, nonQualifyingAssets: 0, monthsHeld: 6, fellBelowBefore12: true, clawbackAmount: 40_000 } } },
    });
    expect(r.addBacks.find((a) => a.label.startsWith('Clawback'))?.amount).toBe(40_000);
  });

  it('13. QFZP de minimis', () => {
    expect(qfzpDeMinimis(50_000_000, 2_000_000)).toEqual({ limit: 2_500_000, passes: true });
    expect(qfzpDeMinimis(50_000_000, 3_000_000).passes).toBe(false);

    const base: ComputeInput = {
      pbt: 10_000_000,
      revenue: 50_000_000,
      lines: [],
      profile: {
        legalForm: 'qfzp',
        qfzp: { qualifyingIncome: 9_000_000, nonQualifyingRevenue: 2_000_000, qualifyingActivity: true, substance: true, auditedFS: true, tpCompliance: true, noElection: true },
      },
    };
    const ok = computeWithFlags(base);
    expect(ok.result.qfzp.applied).toBe(true);
    expect(ok.result.tax).toBe(90_000); // 9% × (10m − 9m), no 0% band
    expect(ok.flags.some((f) => f.id === 'RV-11' && f.level === 'HIGH')).toBe(false);

    const bad = computeWithFlags({ ...base, profile: { ...base.profile, qfzp: { ...base.profile!.qfzp!, nonQualifyingRevenue: 3_000_000 } } });
    expect(bad.result.qfzp.applied).toBe(false);
    expect(bad.result.tax).toBe(866_250); // standard: (10m − 375k) × 9%
    const f = bad.flags.find((x) => x.id === 'RV-11' && x.level === 'HIGH');
    expect(f?.message).toContain('this period and the next 4');
  });

  it('13b. QFZP: taxable non-qualifying income = taxable income − qualifying income (after costs), floored at 0', () => {
    const qfzp = { qualifyingActivity: true, substance: true, auditedFS: true, tpCompliance: true, noElection: true, nonQualifyingRevenue: 1_000_000 };
    const run = (qualifyingIncome: number) =>
      compute({ pbt: 4_000_000, revenue: 40_000_000, lines: [exp('fines', 500_000)], profile: { legalForm: 'qfzp', qfzp: { ...qfzp, qualifyingIncome } } });
    // Taxable income 4,500,000.
    const part = run(3_000_000);
    expect(part.qfzp.taxableNonQualifying).toBe(1_500_000);
    expect(part.tax).toBe(135_000); // 9% × 1,500,000, no 0% band
    const over = run(6_000_000);
    expect(over.qfzp.taxableNonQualifying).toBe(0);
    expect(over.tax).toBe(0);
  });

  it('14. connected persons grouped with relatives', () => {
    const parties = [
      { name: 'Ahmed Ali', type: 'person' as const, relationship: 'Director' },
      { name: 'Fatima Ahmed', type: 'person' as const, relationship: 'Wife of director', connectedTo: 'Ahmed Ali' },
    ];
    const director = { ...exp('connected_person_payment', 350_000, 'Director salary - Ahmed Ali'), relatedParty: 'Ahmed Ali' };
    const wife = { ...exp('connected_person_payment', 200_000, 'Salary - Fatima Ahmed'), relatedParty: 'Fatima Ahmed' };
    const answers: Record<string, LineAnswer> = {
      [director.key]: { marketValue: 350_000, businessPurpose: 'yes' },
      [wife.key]: { marketValue: 200_000, businessPurpose: 'yes' },
    };
    const groups = connectedPersonGroups([director, wife], answers, parties);
    expect(groups).toHaveLength(1);
    expect(groups[0].total).toBe(550_000);

    const r = computeWithFlags({ pbt: 1_000_000, lines: [director, wife], answers }, { relatedParties: parties });
    expect(r.result.totalAddBacks).toBe(0);
    const f = r.flags.find((x) => x.id === 'RV-04' && x.level === 'HIGH' && x.key.includes('person'));
    expect(f?.amount).toBe(550_000);
  });
});

describe('cautious mode and other rules', () => {
  it('cautious mode only affects unsplit entertainment and VAT; connected persons and mixed use add nothing until answered', () => {
    const ent = exp('entertainment_unsplit', 10_000);
    const car = exp('mixed_use', 8_000);
    const vat = exp('vat_expensed', 1_000);
    const cp = exp('connected_person_payment', 100_000);
    const lines = [ent, car, vat, cp];
    const on = compute({ pbt: 1_000_000, lines, cautious: true });
    const off = compute({ pbt: 1_000_000, lines, cautious: false });
    expect(on.totalAddBacks).toBe(5_000 + 1_000);
    expect(off.totalAddBacks).toBe(0);
    expect(on.flags.filter((f) => f.level === 'MEDIUM').length).toBe(3);
    const high = on.flags.filter((f) => f.level === 'HIGH');
    expect(high).toHaveLength(1);
    expect(high[0]).toMatchObject({ id: 'AB-09', amount: 100_000 });
    expect(high[0].message).toContain('not benchmarked');
    expect(off.flags.filter((f) => f.level === 'HIGH')).toHaveLength(1);

    // Business purpose defaults to yes: a market value alone gives the excess.
    expect(compute({ pbt: 1_000_000, lines: [cp], answers: { [cp.key]: { marketValue: 70_000 } } }).totalAddBacks).toBe(30_000);
    // Only an explicit "no" adds back the whole payment, with no benchmarking flag.
    const no = compute({ pbt: 1_000_000, lines: [cp], answers: { [cp.key]: { businessPurpose: 'no' } } });
    expect(no.totalAddBacks).toBe(100_000);
    expect(no.flags).toHaveLength(0);

    const answered = compute({
      pbt: 1_000_000,
      lines,
      answers: { [ent.key]: { clientAmount: 4_000 }, [car.key]: { privateUse: 0.25 }, [vat.key]: { vatRecoverable: 'no' }, [cp.key]: { businessPurpose: 'yes', marketValue: 90_000 } },
    });
    expect(answered.totalAddBacks).toBe(2_000 + 2_000 + 0 + 10_000);
  });

  it('a loss row without a period start date is not used, with a MEDIUM RV-10 flag', () => {
    const r = computeWithFlags({ pbt: 1_000_000, lines: [], lossesBF: [{ periodStart: '', amount: 100_000 }, ...loss(50_000)] });
    expect(r.result.loss.broughtForward).toBe(50_000);
    expect(r.result.loss.used).toBe(50_000);
    expect(r.result.loss.undated).toHaveLength(1);
    const f = r.flags.find((x) => x.key === 'RV-10:undated');
    expect(f).toMatchObject({ level: 'MEDIUM', amount: 100_000 });
    expect(f?.message).toContain('Enter the period this loss came from');
  });

  it('losses from before June 2023 are rejected; ownership change can exclude losses', () => {
    const r = computeWithFlags({ pbt: 1_000_000, lines: [], lossesBF: [{ periodStart: '2022-01-01', amount: 100_000 }, ...loss(50_000)] });
    expect(r.result.loss.broughtForward).toBe(50_000);
    expect(r.flags.some((f) => f.key === 'RV-10:pre-2023')).toBe(true);

    const own = computeWithFlags({ pbt: 1_000_000, lines: [], lossesBF: loss(50_000), profile: { ownershipChange: true } });
    expect(own.result.loss.used).toBe(0);
    expect(own.result.loss.excludedForOwnership).toBe(50_000);
    expect(own.flags.find((f) => f.key === 'RV-10:ownership')?.level).toBe('HIGH');

    const use = compute({ pbt: 1_000_000, lines: [], lossesBF: loss(50_000), profile: { ownershipChange: true, ownershipChangeLosses: 'use' } });
    expect(use.loss.used).toBe(50_000);
  });

  it('sub-lines are carved out of their parent', () => {
    const office = exp('normal_expense', 50_000, 'Office expenses', 'office');
    const fines = { ...exp('fines', 18_400, 'Fines inside Office expenses'), parentKey: 'office' };
    const r = compute({ pbt: 400_000, lines: [office, fines] });
    expect(r.totalAddBacks).toBe(18_400);
  });

  it('unrealised items reverse only with the realisation election', () => {
    const gain = inc('unrealised_gain_loss', 30_000);
    expect(compute({ pbt: 500_000, lines: [gain] }).taxableIncome).toBe(500_000);
    expect(compute({ pbt: 500_000, lines: [gain], profile: { electRealisation: true } }).taxableIncome).toBe(470_000);
  });

  it('dividends paid in the P&L are added back with a HIGH flag', () => {
    const r = compute({ pbt: 100_000, lines: [exp('dividend_paid', 40_000)] });
    expect(r.totalAddBacks).toBe(40_000);
    expect(r.flags[0].level).toBe('HIGH');
  });
});

describe('SBR: both questions must be answered first', () => {
  const base: ComputeInput = { pbt: 800_000, revenue: 2_500_000, lines: [], profile: { electSBR: true, periodEnd: '2027-12-31', legalForm: 'mainland' } };
  const run = (extra: ComputeInput['profile'], cautious = true) => computeWithFlags({ ...base, cautious, profile: { ...base.profile, ...extra } });

  it('"All earlier periods ≤ AED 3M" not answered → SBR is not applied, with a HIGH "Confirm before using SBR" flag', () => {
    const r = run({ groupRevenue: 0 });
    expect(r.result.sbr).toMatchObject({ elected: true, eligible: true, applied: false });
    expect(r.result.regime).toBe('standard');
    expect(r.result.tax).toBe(38_250);
    const f = r.flags.find((x) => x.key === 'SBR:confirm');
    expect(f?.level).toBe('HIGH');
    expect(f?.message).toMatch(/^Confirm before using SBR: "All earlier periods had revenue ≤ AED 3,000,000" is not answered\./);
  });

  it('group revenue not answered → SBR is not applied (also with cautious mode off)', () => {
    for (const cautious of [true, false]) {
      const r = run({ priorPeriodsUnder3M: true }, cautious);
      expect(r.result.sbr.applied).toBe(false);
      expect(r.flags.find((x) => x.key === 'SBR:confirm')?.message).toContain('Group revenue is not answered');
    }
  });

  it('both answered → SBR applies and the flag goes away; not elected → no flag', () => {
    const ok = run({ priorPeriodsUnder3M: true, groupRevenue: 0 });
    expect(ok.result.sbr.applied).toBe(true);
    expect(ok.result.tax).toBe(0);
    expect(ok.flags.some((f) => f.key === 'SBR:confirm')).toBe(false);
    expect(run({ electSBR: false }).flags.some((f) => f.key === 'SBR:confirm')).toBe(false);
  });
});

describe('total revenue for SBR / QFZP tests', () => {
  const lines = () => [
    inc('revenue', 2_600_000, 'Sales', 'sales'),
    inc('other_income', 150_000, 'Sundry income', 'sundry'),
    inc('other_income', 200_000, 'Gain on disposal of vehicle', 'gain'),
    inc('interest_income', 30_000, 'Interest income', 'interest'),
    inc('dividend_received_uae', 100_000, 'Dividend income', 'dividend'),
    exp('normal_expense', 50_000, 'Rent', 'rent'),
  ];
  const sbrProfile = { electSBR: true, periodEnd: '2027-12-31', priorPeriodsUnder3M: true, groupRevenue: 0, legalForm: 'mainland' as const };

  it('breaks down revenue, other income, gains and exempt income (VAT is never part of it)', () => {
    const r = compute({ pbt: 900_000, lines: lines() });
    expect(r.ctRevenue).toMatchObject({ revenue: 2_600_000, otherIncome: 180_000, gains: 200_000, exemptIncome: 100_000, excluded: 0, total: 3_080_000 });
    expect(r.ctRevenue.lines.map((l) => [l.key, l.group, l.included])).toEqual([
      ['sales', 'revenue', true],
      ['sundry', 'other_income', true],
      ['gain', 'gains', true],
      ['interest', 'other_income', true],
      ['dividend', 'exempt_income', true],
    ]);
  });

  it('is the figure the SBR test uses: revenue alone (2.6m) would pass, the total (3.08m) fails', () => {
    const r = computeWithFlags({ pbt: 900_000, lines: lines(), profile: sbrProfile });
    expect(r.result.revenue).toBe(2_600_000);
    expect(r.result.sbr.revenue).toBe(3_080_000);
    expect(r.result.sbr.eligible).toBe(false);
    expect(r.result.sbr.failed[0]).toBe('Total revenue for the SBR test (AED 3,080,000) is above AED 3,000,000');
  });

  it('staff can leave lines out with a reason; a change without a reason raises a MEDIUM flag', () => {
    const answers: Record<string, LineAnswer> = {
      gain: { revenueTest: false, revenueTestReason: 'One-off sale of a capital asset' },
      dividend: { revenueTest: false },
    };
    const r = computeWithFlags({ pbt: 900_000, lines: lines(), answers, profile: sbrProfile });
    expect(r.result.ctRevenue).toMatchObject({ gains: 0, exemptIncome: 0, excluded: 300_000, total: 2_780_000 });
    expect(r.result.ctRevenue.lines.find((l) => l.key === 'gain')).toMatchObject({ included: false, includedByDefault: true, reason: 'One-off sale of a capital asset' });
    expect(r.result.sbr.applied).toBe(true);
    expect(r.flags.find((f) => f.key === 'REV:dividend')).toMatchObject({ level: 'MEDIUM', amount: 100_000 });
    expect(r.flags.some((f) => f.key === 'REV:gain')).toBe(false);
  });

  it('a revenue line left out comes off the statements revenue figure', () => {
    const r = compute({
      pbt: 500_000,
      revenue: 2_600_000,
      lines: [inc('revenue', 2_400_000, 'Sales', 's1'), inc('revenue', 200_000, 'Sales - agency', 's2')],
      answers: { s2: { revenueTest: false, revenueTestReason: 'Collected as agent' } },
    });
    expect(r.revenue).toBe(2_600_000);
    expect(r.ctRevenue.revenue).toBe(2_400_000);
    expect(r.ctRevenue.total).toBe(2_400_000);
  });

  it('is the figure the QFZP de minimis test uses', () => {
    const qfzp = { qualifyingIncome: 9_000_000, nonQualifyingRevenue: 2_200_000, qualifyingActivity: true, substance: true, auditedFS: true, tpCompliance: true, noElection: true };
    const input: ComputeInput = { pbt: 10_000_000, revenue: 40_000_000, lines: [inc('other_income', 10_000_000, 'Other income', 'oi')], profile: { legalForm: 'qfzp', qfzp } };
    // 5% of 50m = 2.5m, so 2.2m of non-qualifying revenue passes (with revenue alone, 5% of 40m = 2m would fail).
    const r = compute(input);
    expect(r.qfzp.deMinimisLimit).toBe(2_500_000);
    expect(r.qfzp.applied).toBe(true);
    const out = compute({ ...input, answers: { oi: { revenueTest: false, revenueTestReason: 'Tax team' } } });
    expect(out.qfzp.deMinimisLimit).toBe(2_000_000);
    expect(out.qfzp.applied).toBe(false);
  });
});

describe('penalties and missing evidence', () => {
  it('a penalty that does not say who imposed it adds nothing until a person decides (even in cautious mode)', () => {
    const p = exp('penalty_review', 8_000, 'Penalties');
    for (const cautious of [true, false]) {
      const open = compute({ pbt: 500_000, lines: [p], cautious });
      expect(open.totalAddBacks).toBe(0);
      expect(open.flags).toEqual([expect.objectContaining({ id: 'AB-06', key: `AB-06:${p.key}`, level: 'MEDIUM', amount: 8_000 })]);
    }
    const gov = compute({ pbt: 500_000, lines: [p], answers: { [p.key]: { penaltyType: 'government' } } });
    expect(gov.totalAddBacks).toBe(8_000);
    expect(gov.addBacks[0]).toMatchObject({ ruleId: 'AB-06', answer: 'Fine or penalty, not contract compensation' });
    expect(gov.flags).toHaveLength(0);
    const contract = compute({ pbt: 500_000, lines: [p], answers: { [p.key]: { penaltyType: 'contract' } } });
    expect(contract.totalAddBacks).toBe(0);
    expect(contract.flags).toHaveLength(0);
  });

  it('no invoice: "Supporting evidence missing" until answered; added back only on "No evidence"', () => {
    const n = exp('no_invoice', 6_000, 'Consultancy');
    for (const cautious of [true, false]) {
      const open = compute({ pbt: 500_000, lines: [n], cautious });
      expect(open.totalAddBacks).toBe(0);
      expect(open.flags[0]).toMatchObject({ id: 'AB-14', level: 'MEDIUM', amount: 6_000 });
      expect(open.flags[0].message).toMatch(/^Supporting evidence missing: Consultancy/);
    }
    const found = compute({ pbt: 500_000, lines: [n], answers: { [n.key]: { supportEvidence: 'found' } } });
    expect(found.totalAddBacks).toBe(0);
    expect(found.flags).toHaveLength(0);
    const none = compute({ pbt: 500_000, lines: [n], answers: { [n.key]: { supportEvidence: 'none' } } });
    expect(none.totalAddBacks).toBe(6_000);
    expect(none.addBacks[0]).toMatchObject({ ruleId: 'AB-14', answer: 'No evidence' });
    expect(none.flags).toHaveLength(0);
  });
});

describe('interest: business type and Art. 31', () => {
  const big: ComputeInput = { pbt: 20_000_000, lines: [exp('interest_expense', 20_000_000)], profile: { periodEnd: '2025-12-31' } };

  it('banks, insurance providers and natural persons are outside the 30% EBITDA limit', () => {
    for (const businessType of ['bank', 'insurance', 'natural_person'] as const) {
      const r = computeWithFlags({ ...big, profile: { ...big.profile, businessType } });
      expect(r.result.interest.exempt).toBe(true);
      expect(r.result.interest.excess).toBe(0);
      expect(r.result.addBacks.some((a) => a.ruleId === 'AB-13')).toBe(false);
      expect(r.flags.find((f) => f.key === 'RV-06:interest')?.level).toBe('PASS');
    }
    const ordinary = computeWithFlags({ ...big, profile: { ...big.profile, businessType: 'ordinary' } });
    expect(ordinary.result.interest.excess).toBe(8_000_000);
    // Not answered = ordinary business (the limit applies), and the HIGH flag says how to change it.
    const unset = computeWithFlags(big);
    expect(unset.result.interest.excess).toBe(8_000_000);
    expect(unset.flags.find((f) => f.key === 'RV-06:interest')?.action).toContain('bank or an insurance provider');
  });

  it('Art. 31: interest on a related-party loan raises a flag; "yes" adds it back and keeps it out of the limit', () => {
    const loan: TaxLine = { ...exp('interest_expense', 60_000, 'Interest on loan from shareholder'), relatedParty: 'Shareholder', relatedPartyType: 'person' };
    const bank = exp('interest_expense', 40_000, 'Interest on bank loan');
    const open = compute({ pbt: 1_000_000, lines: [loan, bank] });
    expect(open.totalAddBacks).toBe(0);
    expect(open.flags).toEqual([expect.objectContaining({ id: 'AB-13', key: `AB-13:art31-${loan.key}`, level: 'MEDIUM', amount: 60_000 })]);
    expect(open.flags[0].message).toContain('Art. 31');

    const yes = compute({ pbt: 1_000_000, lines: [loan, bank], answers: { [loan.key]: { art31Use: 'yes' } } });
    expect(yes.totalAddBacks).toBe(60_000);
    expect(yes.addBacks[0].label).toContain('(Art. 31)');
    expect(yes.interest).toMatchObject({ expense: 40_000, art31: 60_000, net: 40_000 });
    expect(yes.flags).toHaveLength(0);

    const no = compute({ pbt: 1_000_000, lines: [loan, bank], answers: { [loan.key]: { art31Use: 'no' } } });
    expect(no.totalAddBacks).toBe(0);
    expect(no.interest.expense).toBe(100_000);
    expect(no.flags).toHaveLength(0);
  });

  it('interest to a related company never counts towards the AED 500,000 connected-person disclosure', () => {
    const sister: TaxLine = { ...exp('interest_expense', 600_000, 'Interest on loan from sister company'), relatedParty: 'Sister company', relatedPartyType: 'company' };
    expect(connectedPersonGroups([sister], {})).toEqual([]);
  });
});

describe('QFZP status lost', () => {
  const conditions = { qualifyingActivity: true, substance: true, auditedFS: true, tpCompliance: true, noElection: true };
  const input = (periodEnd: string, extra: Partial<NonNullable<ComputeInput['profile']>> = {}, qfzp = {}): ComputeInput => ({
    pbt: 10_000_000,
    revenue: 50_000_000,
    lines: [],
    profile: { legalForm: 'qfzp', periodEnd, qfzp: { qualifyingIncome: 9_000_000, nonQualifyingRevenue: 1_000_000, ...conditions, ...qfzp }, ...extra },
  });

  it('a condition answered "not met" is a failure this period; an unanswered one is not', () => {
    expect(compute(input('2025-12-31', {}, { substance: false })).qfzp).toMatchObject({ applied: false, failedThisPeriod: true });
    expect(compute(input('2025-12-31', {}, { substance: undefined })).qfzp).toMatchObject({ applied: false, failedThisPeriod: false });
    expect(compute(input('2025-12-31', {}, { nonQualifyingRevenue: 3_000_000 })).qfzp.failedThisPeriod).toBe(true);
  });

  it('after a loss of status, the standard rate applies to that period and the next 4', () => {
    const lost = { qfzpLostPeriodEnd: '2025-12-31' };
    for (const end of ['2026-12-31', '2029-12-31']) {
      const r = computeWithFlags(input(end, lost));
      expect(r.result.qfzp).toMatchObject({ applied: false, lostUntil: '2029-12-31', failedThisPeriod: false });
      expect(r.result.tax).toBe(866_250); // standard: (10m − 375k) × 9%
      expect(r.flags.find((f) => f.key === 'RV-11:qfzp')?.message).toContain('until the period ending 31 Dec 2029');
    }
    const free = compute(input('2030-12-31', lost));
    expect(free.qfzp.applied).toBe(true);
    expect(free.tax).toBe(90_000);
  });
});

describe('foreign tax credit (Art. 47)', () => {
  // PBT 1,375,000 → tax 9% × 1,000,000 = 90,000.
  const run = (foreignTax?: ComputeInput['foreignTax'], pbt = 1_375_000) => computeWithFlags({ pbt, lines: [], foreignTax });

  it('is capped at the UAE tax on that income: tax × foreign income ÷ taxable income', () => {
    const r = run([{ country: 'Saudi Arabia', income: 500_000, taxPaid: 60_000 }]);
    expect(r.result.taxBeforeCredits).toBe(90_000);
    expect(r.result.foreignTaxCredit).toMatchObject({ cap: 32_727.27, credit: 32_727.27, unused: 27_272.73 });
    expect(r.result.tax).toBe(57_272.73);
    const f = r.flags.find((x) => x.key === 'FTC:unused');
    expect(f).toMatchObject({ level: 'INFO', amount: 27_272.73 });
    expect(f?.message).toContain('Saudi Arabia AED 27,272.73');
    expect(f?.message).toContain('not carried forward, carried back or refunded');
  });

  it('gives the foreign tax paid in full when it is below the cap', () => {
    const r = run([{ income: 500_000, taxPaid: 10_000 }]);
    expect(r.result.foreignTaxCredit.credit).toBe(10_000);
    expect(r.result.tax).toBe(80_000);
    expect(r.flags.some((f) => f.id === 'FTC')).toBe(false);
  });

  it('caps each country on its own: a high tax in one country cannot use room left by another', () => {
    const r = run([
      { country: 'Country A', income: 200_000, taxPaid: 40_000 },
      { country: 'Country B', income: 300_000, taxPaid: 5_000 },
    ]);
    expect(r.result.foreignTaxCredit.rows.map((x) => [x.country, x.cap, x.credit, x.unused])).toEqual([
      ['Country A', 13_090.91, 13_090.91, 26_909.09],
      ['Country B', 19_636.36, 5_000, 0],
    ]);
    // Pooled, it would be the lower of 45,000 and 32,727.27; per country it is 18,090.91.
    expect(r.result.foreignTaxCredit.credit).toBe(18_090.91);
    expect(r.result.tax).toBe(71_909.09);
  });

  it('never goes above the tax itself, gives nothing when no UAE tax is due, and needs the foreign income', () => {
    expect(run([{ income: 2_000_000, taxPaid: 200_000 }]).result.tax).toBe(0);
    // Two countries whose income adds up to more than taxable income: the caps still add up to the tax at most.
    const over = run([
      { income: 1_000_000, taxPaid: 100_000 },
      { income: 1_000_000, taxPaid: 100_000 },
    ]);
    expect(over.result.foreignTaxCredit.credit).toBe(90_000);
    expect(over.result.tax).toBe(0);
    const band = run([{ income: 100_000, taxPaid: 5_000 }], 300_000);
    expect(band.result.foreignTaxCredit.credit).toBe(0);
    expect(band.result.tax).toBe(0);
    const noIncome = run([{ taxPaid: 5_000 }]);
    expect(noIncome.result.foreignTaxCredit.credit).toBe(0);
    expect(noIncome.result.tax).toBe(90_000);
    expect(noIncome.flags.find((f) => f.key === 'FTC:income-1')?.level).toBe('MEDIUM');
    expect(noIncome.flags.some((f) => f.key === 'RV-09:foreign')).toBe(true);
    const none = run();
    expect(none.result.tax).toBe(none.result.taxBeforeCredits);
    expect(foreignTaxCreditFor(90_000, 1_000_000, [{ income: 250_000, taxPaid: 1_000_000 }])).toMatchObject({ cap: 22_500, credit: 22_500 });
  });
});
