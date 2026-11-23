/**
 * The corporate tax computation, in this order:
 *  Step 1  PBT (as given; never changed here)
 *  Step 2  add-backs AB-01..AB-14 (including the AB-04 overhead slice and AB-13 excess interest)
 *  Step 3  exempt income and other deductions
 *  Step 4  taxable income
 *  Step 5  loss relief (75% cap)
 *  SBR / QFZP regimes
 *  Step 6  tax = 9% above the 0% band
 *
 * Pure function: no React, no DOM, no network. Every number comes from settings.ts.
 */
import { SETTINGS } from './settings';
import type {
  AddBack,
  BusinessType,
  Category,
  ComputeInput,
  ComputeResult,
  CtRevenue,
  CtRevenueGroup,
  CtRevenueLine,
  Deduction,
  Flag,
  ForeignTaxCreditResult,
  InterestResult,
  InterestRow,
  LineAnswer,
  LossResult,
  ParticipationAnswers,
  ParticipationResult,
  QfzpResult,
  SbrResult,
  TaxLine,
} from './types';
import { BUSINESS_TYPE_LABELS, CATEGORY_MAP, INCOME_CATEGORIES } from './types';
import { addMonths, aed, fmtDate, isIsoDate, norm, num, pct, round2, sum, yearOf } from './util';

const S = SETTINGS;

// ───────────────────────── Total revenue for the SBR and QFZP de minimis tests ─────────────────────────

/**
 * Which income counts by default. Every income line counts until the tax team confirms otherwise
 * (QUESTIONS.md). Staff can leave a line out, or put it back, with a reason.
 */
export const CT_REVENUE_DEFAULTS: Record<CtRevenueGroup, boolean> = {
  revenue: true,
  other_income: true,
  gains: true,
  exempt_income: true,
};

const GAIN_RE = /\b(gains?|profit on (sale|disposal)|disposals?)\b/;

/** The group an income line belongs to, or undefined when it is not income. */
function revenueGroup(l: TaxLine, balance: number, exemptForeign?: Set<string>): CtRevenueGroup | undefined {
  switch (l.category) {
    case 'revenue':
      return 'revenue';
    case 'other_income':
      return GAIN_RE.test(norm(l.account)) ? 'gains' : 'other_income';
    case 'interest_income':
      return 'other_income';
    case 'unrealised_gain_loss':
      return balance < 0 ? 'gains' : undefined;
    case 'dividend_received_uae':
      return 'exempt_income';
    case 'dividend_received_foreign':
      return exemptForeign?.has(l.key) ? 'exempt_income' : 'other_income';
    default:
      return undefined;
  }
}

/**
 * Total revenue for the SBR and QFZP de minimis tests: revenue (from the statements when given,
 * otherwise the TB revenue lines), other income, gains and exempt income. VAT is never part of it
 * (output VAT is a balance-sheet liability). `revenueFigure` is the statements' revenue, if any.
 */
export function ctRevenueBreakdown(lines: TaxLine[], answers: Record<string, LineAnswer> = {}, revenueFigure?: number, exemptForeign?: Set<string>): CtRevenue {
  const carved = new Map<string, number>();
  for (const l of lines) if (l.parentKey) carved.set(l.parentKey, (carved.get(l.parentKey) ?? 0) + l.balance);
  const out: CtRevenueLine[] = [];
  for (const l of lines) {
    if (l.parentKey) continue;
    const bal = l.balance - (carved.get(l.key) ?? 0);
    const group = revenueGroup(l, bal, exemptForeign);
    if (!group) continue;
    const a = answers[l.key] ?? {};
    const includedByDefault = CT_REVENUE_DEFAULTS[group];
    out.push({
      key: l.key,
      account: l.account,
      source: l.source,
      group,
      amount: round2(-bal),
      included: a.revenueTest ?? includedByDefault,
      includedByDefault,
      reason: a.revenueTestReason?.trim() || undefined,
    });
  }
  const groupSum = (g: CtRevenueGroup, included: boolean) => sum(out.filter((x) => x.group === g && x.included === included).map((x) => x.amount));
  const revenueLines = sum(out.filter((x) => x.group === 'revenue').map((x) => x.amount));
  const base = Math.abs(revenueFigure ?? revenueLines);
  const revenue = round2(Math.max(0, base - groupSum('revenue', false)));
  const otherIncome = round2(groupSum('other_income', true));
  const gains = round2(groupSum('gains', true));
  const exemptIncome = round2(groupSum('exempt_income', true));
  const excluded = round2(sum(out.filter((x) => !x.included).map((x) => x.amount)));
  return { revenue, otherIncome, gains, exemptIncome, excluded, lines: out, total: round2(revenue + otherIncome + gains + exemptIncome) };
}

// ───────────────────────── QFZP status lost ─────────────────────────

/** Last period end at the standard rate after QFZP status was lost in the period ending `lostPeriodEnd` (that period and the next 4). */
export function qfzpLockUntil(lostPeriodEnd: string): string {
  return addMonths(lostPeriodEnd, 12 * (S.qfzp.failurePenaltyPeriods - 1));
}

/** Banks, insurance providers and natural persons are outside the 30% EBITDA interest limit (Art. 30). */
export function interestLimitExempt(type: BusinessType | undefined): boolean {
  return type === 'bank' || type === 'insurance' || type === 'natural_person';
}

/** Tax on an amount of taxable income under the standard regime (0% band, then 9%). */
export function standardTax(taxableAfterLoss: number): number {
  return round2(Math.max(0, taxableAfterLoss - S.zeroBand) * S.rate);
}

/** QFZP de minimis: non-qualifying revenue may not exceed the lower of 5% of revenue and AED 5m. */
export function qfzpDeMinimis(totalRevenue: number, nonQualifyingRevenue: number): { limit: number; passes: boolean } {
  const limit = Math.min(S.qfzp.deMinimisShare * totalRevenue, S.qfzp.deMinimisCap);
  return { limit, passes: nonQualifyingRevenue <= limit };
}

/** Participation exemption tests for a foreign dividend (Art. 23). All must pass. */
export function participationTest(p: ParticipationAnswers | undefined): { exempt: boolean; failed: string[] } {
  const P = S.participation;
  const a = p ?? {};
  const failed: string[] = [];
  const ownershipOk = (a.ownership ?? -1) >= P.minOwnership || (a.acquisitionCost ?? -1) >= P.minAcquisitionCost;
  if (!ownershipOk) {
    failed.push(
      a.ownership === undefined && a.acquisitionCost === undefined
        ? 'Ownership and acquisition cost not given'
        : `Ownership below ${pct(P.minOwnership, 0)} and acquisition cost below ${aed(P.minAcquisitionCost)}`,
    );
  }
  const holdingOk = (a.monthsHeld ?? -1) >= P.minHoldingMonths || a.intendsToHold12 === true;
  if (!holdingOk) failed.push(`Not held for ${P.minHoldingMonths} months and no intention to hold that long`);
  if (a.investeeTaxRate === undefined) failed.push('Investee tax rate not known');
  else if (a.investeeTaxRate < P.minInvesteeTaxRate) failed.push(`Investee taxed at ${pct(a.investeeTaxRate)}, below ${pct(P.minInvesteeTaxRate, 0)}`);
  if (a.nonQualifyingAssets === undefined) failed.push('Share of non-qualifying assets not known');
  else if (a.nonQualifyingAssets > P.maxNonQualifyingAssets) failed.push(`Non-qualifying assets ${pct(a.nonQualifyingAssets)} are above ${pct(P.maxNonQualifyingAssets, 0)}`);
  if (a.investeeDeducts) failed.push('The investee deducts the dividend');
  if (a.deductibleImpairment) failed.push('A deductible impairment was taken on the holding or a loan to the investee');
  if (a.liquidationLoss) failed.push('This is a loss on liquidation');
  if (a.restructuringWithin2Years) failed.push(`Acquired in a restructuring within ${P.restructuringBlockYears} years`);
  return { exempt: failed.length === 0, failed };
}

/** The AB-13 interest limit on its own (used by compute and by tests). */
export function interestLimitation(args: {
  net: number;
  adjustedEbitda: number;
  carriedForward?: InterestRow[];
  periodYear: number;
}): { limit: number; excess: number; used: number; expired: number; carriedForwardOut: InterestRow[] } {
  const I = S.interest;
  const limit = Math.max(I.deMinimis, I.ebitdaShare * args.adjustedEbitda);
  const rows = (args.carriedForward ?? []).filter((r) => r.amount > 0);
  const expiredRows = rows.filter((r) => args.periodYear - r.year > I.carryForwardYears);
  const valid = rows.filter((r) => !expiredRows.includes(r)).sort((a, b) => a.year - b.year).map((r) => ({ ...r }));
  const expired = sum(expiredRows.map((r) => r.amount));
  let excess = 0;
  let used = 0;
  if (args.net > limit) {
    excess = args.net - limit;
    valid.push({ year: args.periodYear, amount: excess });
  } else {
    let room = limit - Math.max(0, args.net);
    for (const r of valid) {
      if (room <= 0) break;
      const take = Math.min(r.amount, room);
      r.amount -= take;
      room -= take;
      used += take;
    }
  }
  return { limit, excess, used, expired, carriedForwardOut: valid.filter((r) => r.amount > 0) };
}

/**
 * Foreign tax credit (Art. 47): for each country or source, the lower of the foreign tax paid on that
 * income and the UAE tax on the same income. UAE tax on the income = tax × (that income ÷ taxable income
 * after losses), so the 0% band and loss relief are shared across all income and the credit can never be
 * more than the law allows. Rows are capped separately, so a high foreign tax in one country cannot use
 * room left by a low tax in another. If the foreign income in total is more than taxable income, the shares
 * are scaled down so the caps never add up to more than the tax. Unused credit is lost.
 */
export function foreignTaxCreditFor(tax: number, taxableAfterLoss: number, input: ComputeInput['foreignTax']): ForeignTaxCreditResult {
  const rows = (input ?? []).map((r, i) => ({
    country: r.country?.trim() || `Row ${i + 1}`,
    income: Math.max(0, r.income ?? 0),
    taxPaid: Math.max(0, r.taxPaid ?? 0),
  }));
  const counted = rows.filter((r) => r.taxPaid > 0 && r.income > 0);
  const denominator = Math.max(taxableAfterLoss, sum(counted.map((r) => r.income)));
  const out = rows.map((r) => {
    if (r.taxPaid <= 0) return { ...r, cap: 0, credit: 0, unused: 0, basis: 'No foreign tax entered' };
    if (r.income <= 0) return { ...r, cap: 0, credit: 0, unused: 0, basis: 'Foreign income not entered: no credit yet' };
    if (tax <= 0 || taxableAfterLoss <= 0) return { ...r, cap: 0, credit: 0, unused: r.taxPaid, basis: 'No UAE tax is due, so no credit' };
    const cap = round2((tax * r.income) / denominator);
    const credit = round2(Math.min(r.taxPaid, cap));
    return {
      ...r,
      cap,
      credit,
      unused: round2(r.taxPaid - credit),
      basis: `${r.country}: lower of foreign tax ${num(r.taxPaid)} and UAE tax on that income ${num(cap, 2)} (${num(tax, 2)} × ${num(r.income)} ÷ ${num(denominator)})`,
    };
  });
  const total = (k: 'income' | 'taxPaid' | 'cap' | 'credit' | 'unused') => round2(sum(out.map((r) => r[k])));
  const credit = Math.min(total('credit'), Math.max(0, tax));
  return {
    income: total('income'),
    taxPaid: total('taxPaid'),
    cap: total('cap'),
    credit,
    unused: total('unused'),
    basis: out
      .filter((r) => r.credit > 0)
      .map((r) => r.basis)
      .join('; '),
    rows: out,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function compute(input: ComputeInput): ComputeResult {
  const cautious = input.cautious ?? true;
  const profile = input.profile ?? {};
  const answers: Record<string, LineAnswer> = input.answers ?? {};
  const flags: Flag[] = [];
  const addBacks: AddBack[] = [];
  const deductions: Deduction[] = [];
  const notes: string[] = [];
  const pbt = input.pbt;
  const periodYear = profile.periodEnd ? yearOf(profile.periodEnd) : new Date().getFullYear();

  // Sub-lines are carved out of their parent, so the parent keeps only the rest.
  const carved = new Map<string, number>();
  for (const l of input.lines) {
    if (l.parentKey) carved.set(l.parentKey, (carved.get(l.parentKey) ?? 0) + l.balance);
  }
  const effective = (l: TaxLine) => (l.parentKey ? l.balance : l.balance - (carved.get(l.key) ?? 0));

  const flag = (f: Omit<Flag, 'key'> & { subject: string }) => {
    const { subject, ...rest } = f;
    flags.push({ ...rest, key: `${f.id}:${subject}` });
  };
  const addBack = (ruleId: string, label: string, line: TaxLine | undefined, amount: number, basis: string, answer?: string) => {
    const a = round2(amount);
    if (a === 0) return;
    addBacks.push({ ruleId, label, account: line?.account ?? '', lineKey: line?.key, source: line?.source, amount: a, basis, answer });
  };
  const deduct = (ruleId: string, label: string, line: TaxLine | undefined, amount: number, basis?: string) => {
    const a = round2(amount);
    if (a === 0) return;
    deductions.push({ ruleId, label, account: line?.account, lineKey: line?.key, source: line?.source, amount: a, basis });
  };

  let revenueLines = 0;
  let otherIncome = 0;
  let exemptIncome = 0;
  let interestExpense = 0;
  let interestIncome = 0;
  let art31Interest = 0;
  let depreciation = 0;
  let capitalTaxDep = 0;
  const participation: ParticipationResult[] = [];

  for (const l of input.lines) {
    const a = answers[l.key] ?? {};
    const bal = effective(l);
    const cat: Category = l.category;
    const isIncome = INCOME_CATEGORIES.includes(cat);
    const x = bal; // expense amount (debit positive)
    const y = -bal; // income amount (credit positive)
    const rule = CATEGORY_MAP[cat]?.rule ?? '';
    const where = l.source ? ` (${l.source})` : '';

    // Expense categories with a credit balance: do not add back; ask a person to check.
    const expenseAddBackCats: Category[] = [
      'entertainment_client',
      'entertainment_unsplit',
      'pension',
      'donation_unlisted',
      'exempt_income_cost',
      'dividend_paid',
      'fines',
      'penalty_review',
      'vat_expensed',
      'related_party_expense',
      'connected_person_payment',
      'personal',
      'mixed_use',
      'capital_expensed',
      'no_invoice',
    ];
    if (expenseAddBackCats.includes(cat) && x < 0) {
      flag({
        id: 'DATA',
        subject: `direction-${l.key}`,
        level: 'DATA',
        message: `${l.account}${where} is marked "${CATEGORY_MAP[cat].label}" but has a credit balance of ${aed(-x)}. Nothing was added back.`,
        amount: -x,
        action: 'Check the category and the sign of this line.',
        source: l.source,
      });
      continue;
    }

    switch (cat) {
      case 'revenue':
        revenueLines += y;
        break;
      case 'other_income':
        otherIncome += y;
        break;
      case 'depreciation':
        depreciation += x;
        break;
      case 'entertainment_client':
        addBack(rule, 'Client entertainment (50% not deductible)', l, x * S.entertainmentDisallowed, `${pct(S.entertainmentDisallowed, 0)} of ${num(x)}`);
        break;
      case 'entertainment_unsplit': {
        if (a.clientAmount !== undefined) {
          const c = clamp(a.clientAmount, 0, x);
          addBack(rule, 'Client entertainment (50% not deductible)', l, c * S.entertainmentDisallowed, `${pct(S.entertainmentDisallowed, 0)} of client part ${num(c)}`, `Client part: ${aed(c)}`);
        } else {
          if (cautious) addBack(rule, 'Entertainment not split (all treated as client)', l, x * S.entertainmentDisallowed, `${pct(S.entertainmentDisallowed, 0)} of ${num(x)} (cautious mode)`);
          flag({
            id: rule,
            subject: l.key,
            level: 'MEDIUM',
            message: `${l.account}${where}: entertainment of ${aed(x)} is not split between clients and staff. ${cautious ? 'Cautious mode treats it all as client entertainment.' : 'Nothing is added back until it is split.'}`,
            amount: x,
            action: 'Enter the client part of this amount.',
            source: l.source,
          });
        }
        break;
      }
      case 'pension':
        if (a.confirmedAmount !== undefined) {
          addBack(rule, 'Pension cost not deductible (confirmed)', l, clamp(a.confirmedAmount, 0, x), 'Amount confirmed by the tax team', `Confirmed: ${aed(a.confirmedAmount)}`);
        } else {
          flag({
            id: rule,
            subject: l.key,
            level: 'MEDIUM',
            message: `${l.account}${where}: pension cost of ${aed(x)}. Nothing is added back until the tax team confirms the amount.`,
            amount: x,
            action: 'Confirm which part (if any) is not deductible, and enter it.',
            source: l.source,
          });
        }
        break;
      case 'donation_unlisted':
        addBack(rule, 'Donation to a body not on the approved list', l, x, '100%');
        flag({
          id: rule,
          subject: l.key,
          level: 'MEDIUM',
          message: `${l.account}${where}: donation of ${aed(x)} added back in full.`,
          amount: x,
          action: 'If the recipient is a Qualifying Public Benefit Entity, change the category to "Donation (approved charity)".',
          source: l.source,
        });
        break;
      case 'exempt_income_cost':
        addBack(rule, 'Direct cost of exempt income', l, x, '100%');
        break;
      case 'dividend_paid':
        addBack(rule, 'Dividend paid charged to profit', l, x, '100%');
        flag({
          id: rule,
          subject: l.key,
          level: 'HIGH',
          message: `${l.account}${where}: dividends of ${aed(x)} were charged in the profit and loss. Dividends are not deductible.`,
          amount: x,
          action: 'Confirm the accounting. Dividends normally go to equity, not the P&L.',
          source: l.source,
        });
        break;
      case 'dividend_received_uae':
        deduct('Step 3', 'UAE dividend (exempt)', l, y, '100% exempt');
        exemptIncome += y;
        break;
      case 'dividend_received_foreign': {
        const p = participationTest(a.participation);
        participation.push({ lineKey: l.key, account: l.account, amount: y, exempt: p.exempt, failed: p.failed });
        if (p.exempt) {
          deduct('AB-05B', 'Foreign dividend (participation exemption)', l, y, 'All participation tests pass');
          exemptIncome += y;
        } else {
          otherIncome += y;
          flag({
            id: 'AB-05B',
            subject: l.key,
            level: 'HIGH',
            message: `${l.account}${where}: foreign dividend of ${aed(y)} is taxable. Failed: ${p.failed.join('; ')}.`,
            amount: y,
            action: 'Answer or check the participation exemption tests for this holding.',
            source: l.source,
          });
        }
        const pa = a.participation;
        if (pa?.fellBelowBefore12) {
          if (pa.clawbackAmount !== undefined) {
            addBack('AB-05B', 'Clawback of earlier exempt income (holding fell below 5% within 12 months)', l, pa.clawbackAmount, '100% of earlier exempt income', `Earlier exempt income: ${aed(pa.clawbackAmount)}`);
          } else {
            flag({
              id: 'AB-05B',
              subject: `clawback-${l.key}`,
              level: 'HIGH',
              message: `${l.account}: ownership fell below ${pct(S.participation.minOwnership, 0)} within ${S.participation.minHoldingMonths} months. Earlier exempt income from this holding must be added back.`,
              action: 'Enter the earlier exempt income from this holding.',
              source: l.source,
            });
          }
        }
        break;
      }
      case 'fines':
        addBack(rule, 'Fines and penalties', l, x, '100%');
        flag({
          id: rule,
          subject: l.key,
          level: 'MEDIUM',
          message: `${l.account}${where}: fines or penalties of ${aed(x)} added back in full.`,
          amount: x,
          action: 'Check none of this is compensation under a contract (which is allowed).',
          source: l.source,
        });
        break;
      case 'penalty_review': {
        // Not clearly a government fine: a person decides. Nothing is added back until then (also in cautious mode).
        const t = a.penaltyType ?? 'unknown';
        if (t === 'government') {
          addBack(rule, 'Fine or penalty not under a contract', l, x, '100%', 'Fine or penalty, not contract compensation');
        } else if (t === 'unknown') {
          flag({
            id: rule,
            subject: l.key,
            level: 'MEDIUM',
            message: `${l.account}${where}: penalty of ${aed(x)} does not say who imposed it. Nothing is added back until a person decides.`,
            amount: x,
            action: 'Check the document. A fine or penalty is added back unless it is compensation for damages or a breach of contract (Art. 33). Choose one on the line.',
            source: l.source,
          });
        }
        break;
      }
      case 'vat_expensed': {
        const rec = a.vatRecoverable ?? 'unknown';
        if (rec === 'yes') addBack(rule, 'Recoverable VAT charged to expenses', l, x, '100%', 'VAT was recoverable');
        else if (rec === 'unknown') {
          if (cautious) addBack(rule, 'VAT charged to expenses (recoverability not confirmed)', l, x, '100% (cautious mode)');
          flag({
            id: rule,
            subject: l.key,
            level: 'MEDIUM',
            message: `${l.account}${where}: VAT of ${aed(x)} was expensed. ${cautious ? 'Cautious mode adds it back.' : 'Not added back until answered.'}`,
            amount: x,
            action: 'Check if this VAT could have been recovered on the VAT return.',
            source: l.source,
          });
        }
        break;
      }
      case 'related_party_expense': {
        if (a.marketValue !== undefined) {
          const excess = Math.max(0, x - a.marketValue);
          addBack(rule, 'Related-party expense above market value', l, excess, `${num(x)} paid − ${num(a.marketValue)} market value`, `Market value: ${aed(a.marketValue)}`);
        } else {
          flag({
            id: rule,
            subject: l.key,
            level: 'MEDIUM',
            message: `${l.account}${where}: related-party expense of ${aed(x)} is not benchmarked.`,
            amount: x,
            action: 'Get transfer pricing support and enter the market value.',
            source: l.source,
          });
        }
        break;
      }
      case 'connected_person_payment': {
        // Business purpose defaults to "yes"; only an explicit "no" adds back the whole payment.
        if (a.businessPurpose === 'no') {
          addBack(rule, 'Connected-person payment with no business purpose', l, x, '100%', 'No business purpose');
        } else if (a.marketValue !== undefined) {
          const excess = Math.max(0, x - a.marketValue);
          addBack(rule, 'Connected-person payment above market value', l, excess, `${num(x)} paid − ${num(a.marketValue)} market value`, `Market value: ${aed(a.marketValue)}`);
        } else {
          flag({
            id: rule,
            subject: l.key,
            level: 'HIGH',
            message: `${l.account}${where}: payment of ${aed(x)} to a connected person is not benchmarked. Nothing is added back yet; amount at risk ${aed(x)}.`,
            amount: x,
            action: 'Benchmark the payment against market value and enter it. Answer "No" to business purpose if it was not for the business.',
            source: l.source,
          });
        }
        break;
      }
      case 'personal':
        addBack(rule, 'Personal expense', l, x, '100%');
        break;
      case 'mixed_use': {
        if (a.privateUse !== undefined) {
          const share = clamp(a.privateUse, 0, 1);
          addBack(rule, 'Private use share', l, x * share, `${pct(share)} of ${num(x)}`, `Private use: ${pct(share)}`);
        } else {
          flag({
            id: rule,
            subject: l.key,
            level: 'MEDIUM',
            message: `${l.account}${where}: ${aed(x)} is partly private. Nothing is added back until the private share is given.`,
            amount: x,
            action: 'Enter the private-use share (for example from a mileage log).',
            source: l.source,
          });
        }
        break;
      }
      case 'capital_expensed':
        addBack(rule, 'Capital item charged as an expense', l, x, '100%');
        if (a.taxDepreciation !== undefined) {
          const dep = clamp(a.taxDepreciation, 0, x);
          deduct(rule, 'Tax depreciation on capital item', l, dep, 'Entered by the tax team');
          capitalTaxDep += dep;
        } else {
          flag({
            id: rule,
            subject: l.key,
            level: 'MEDIUM',
            message: `${l.account}${where}: capital item of ${aed(x)} added back. No tax depreciation entered yet.`,
            amount: x,
            action: 'Enter the depreciation allowed for this asset this period.',
            source: l.source,
          });
        }
        break;
      case 'interest_expense': {
        // Art. 31: interest on a related-party loan used for a dividend, share buyback or capital contribution
        // is not deductible. A person answers; "yes" adds the interest back and keeps it out of the interest limit.
        const use = l.relatedParty && x > 0 ? (a.art31Use ?? 'unknown') : 'no';
        if (use === 'yes') {
          addBack(
            rule,
            'Interest on a related-party loan used for a dividend, buyback or capital contribution (Art. 31)',
            l,
            x,
            '100% (Art. 31)',
            'Loan used for a dividend, buyback or capital contribution',
          );
          art31Interest += x;
          break;
        }
        if (use === 'unknown') {
          flag({
            id: rule,
            subject: `art31-${l.key}`,
            level: 'MEDIUM',
            message: `${l.account}${where}: interest of ${aed(x)} on a loan from a related party (${l.relatedParty}). Art. 31: if the loan paid for a dividend, a share buyback or a capital contribution, this interest is not deductible.`,
            amount: x,
            action: 'Check what the loan was used for and answer the question on this line. Answer "Yes" only if there is no good commercial reason for the loan.',
            source: l.source,
          });
        }
        interestExpense += x;
        break;
      }
      case 'interest_income':
        interestIncome += y;
        break;
      case 'no_invoice': {
        // Added back only when staff answer "No evidence" (also in cautious mode).
        const e = a.supportEvidence ?? 'unknown';
        if (e === 'none') {
          addBack(rule, 'Expense with no invoice or support', l, x, '100%', 'No evidence');
        } else if (e === 'unknown') {
          flag({
            id: rule,
            subject: l.key,
            level: 'MEDIUM',
            message: `Supporting evidence missing: ${l.account}${where}, ${aed(x)}. Nothing is added back until someone checks.`,
            amount: x,
            action: 'Look for the invoice or other support. Answer "No evidence" to add it back, or "Evidence found" to allow it.',
            source: l.source,
          });
        }
        break;
      }
      case 'unrealised_gain_loss':
        if (profile.electRealisation === true) {
          if (bal < 0) deduct('Step 3', 'Unrealised gain removed (realisation basis)', l, -bal, 'Realisation election');
          else addBack('Step 3', 'Unrealised loss added back (realisation basis)', l, bal, 'Realisation election');
        }
        break;
      default:
        // normal_expense, entertainment_staff, donation_listed, contract_damages, balance_sheet, below_pbt: no adjustment.
        if (isIncome) otherIncome += y;
        break;
    }
  }

  // Revenue is never negative (a sign mix-up in the statements or the TB). Use the absolute value and say so.
  const rawRevenue = input.revenue ?? revenueLines;
  const revenue = Math.abs(rawRevenue);
  if (rawRevenue < 0) {
    flag({
      id: 'DATA',
      subject: 'revenue-sign',
      level: 'INFO',
      message: `Revenue came out as a negative number (${aed(rawRevenue)}). The calculator uses ${aed(revenue)}.`,
      action: 'Check the sign of the revenue figure or the revenue lines.',
    });
  }
  otherIncome += interestIncome;
  const totalIncome = input.totalIncome ?? revenue + otherIncome + exemptIncome;

  // AB-04 overhead slice.
  const shared = input.sharedOverheads ?? 0;
  if (exemptIncome > 0 && shared > 0 && totalIncome > 0) {
    const slice = (shared * exemptIncome) / totalIncome;
    addBack('AB-04', 'Share of overheads for exempt income', undefined, slice, `${num(shared)} × ${num(exemptIncome)} ÷ ${num(totalIncome)}`);
  }
  if (exemptIncome > 0 && !addBacks.some((ab) => ab.ruleId === 'AB-04')) {
    flag({
      id: 'AB-04',
      subject: 'no-cost',
      level: 'MEDIUM',
      message: `Exempt income of ${aed(exemptIncome)} but no costs are added back for it.`,
      amount: exemptIncome,
      action: 'Enter the shared overheads (and any direct costs) that relate to the exempt income.',
    });
  }

  // Other deductions entered by hand.
  if (input.otherDeductions) deduct('Step 3', 'Other deductions (entered by hand)', undefined, input.otherDeductions);

  // AB-13 interest limitation. Banks, insurance providers and natural persons are outside it (Art. 30).
  // Interest already added back under Art. 31 is not in the net interest (it would be disallowed twice); it is
  // already back in taxable income through its add-back, so adjusted EBITDA still includes it.
  const taxableBeforeInterest = pbt + sum(addBacks.map((a) => a.amount)) - sum(deductions.map((d) => d.amount));
  const net = interestExpense - interestIncome;
  const adjustedEbitda = taxableBeforeInterest + Math.max(0, net) + depreciation + capitalTaxDep;
  const interestExempt = interestLimitExempt(profile.businessType);
  const lim = interestExempt
    ? { limit: 0, excess: 0, used: 0, expired: 0, carriedForwardOut: (input.interestCF ?? []).filter((r) => r.amount > 0).map((r) => ({ ...r })) }
    : interestLimitation({ net, adjustedEbitda, carriedForward: input.interestCF, periodYear });
  if (interestExempt && (interestExpense > 0 || interestIncome > 0)) {
    notes.push(`The interest limit does not apply: the business type is "${BUSINESS_TYPE_LABELS[profile.businessType!]}" (Art. 30). Net interest of ${aed(net)} is not limited.`);
  }
  if (lim.excess > 0) {
    addBack('AB-13', 'Net interest above the limit', undefined, lim.excess, `${num(net)} net interest − ${num(lim.limit)} limit`);
  }
  if (lim.used > 0) deduct('AB-13', 'Interest carried forward, now usable', undefined, lim.used, `Room under the limit: ${num(lim.limit - Math.max(0, net))}`);
  const interest: InterestResult = {
    exempt: interestExempt,
    art31: art31Interest,
    expense: interestExpense,
    income: interestIncome,
    net,
    adjustedEbitda,
    limit: lim.limit,
    excess: lim.excess,
    carriedForwardIn: sum((input.interestCF ?? []).map((r) => r.amount)),
    expired: lim.expired,
    used: lim.used,
    carriedForwardOut: lim.carriedForwardOut,
    totalCarriedForward: sum(lim.carriedForwardOut.map((r) => r.amount)),
  };

  // Step 4.
  const totalAddBacks = round2(sum(addBacks.map((a) => a.amount)));
  const totalDeductions = round2(sum(deductions.map((d) => d.amount)));
  const taxableIncome = round2(pbt + totalAddBacks - totalDeductions);

  // Losses brought forward.
  const lossRows = (input.lossesBF ?? []).filter((r) => r.amount > 0);
  // A loss needs the start date of the period it came from; without one it is not used (RV-10 asks for it).
  const undated = lossRows.filter((r) => !isIsoDate(r.periodStart));
  const rejected = lossRows.filter((r) => isIsoDate(r.periodStart) && r.periodStart < S.lossesValidFrom);
  let lossBF = sum(lossRows.filter((r) => !rejected.includes(r) && !undated.includes(r)).map((r) => r.amount));
  let excludedForOwnership = 0;
  if (profile.ownershipChange && lossBF > 0) {
    const choice = profile.ownershipChangeLosses ?? (cautious ? 'exclude' : 'use');
    if (choice === 'exclude') {
      excludedForOwnership = lossBF;
      lossBF = 0;
    }
  }

  // Total revenue for the SBR and QFZP de minimis tests (revenue, other income, gains, exempt income; never VAT).
  const exemptForeign = new Set(participation.filter((p) => p.exempt).map((p) => p.lineKey));
  const ctRevenue = ctRevenueBreakdown(input.lines, answers, input.revenue, exemptForeign);
  for (const r of ctRevenue.lines) {
    if (r.included === r.includedByDefault || r.reason) continue;
    flag({
      id: 'REV',
      subject: r.key,
      level: 'MEDIUM',
      message: `${r.account}${r.source ? ` (${r.source})` : ''}: ${r.included ? 'put into' : 'left out of'} total revenue for the SBR / QFZP tests, but no reason is given.`,
      amount: r.amount,
      action: 'Enter the reason next to this line (Headline numbers → Total revenue for SBR / QFZP tests).',
      source: r.source,
    });
  }

  // SBR eligibility.
  const sbrRevenue = ctRevenue.total;
  const sbrFailed: string[] = [];
  if (sbrRevenue > S.sbr.revenueLimit) sbrFailed.push(`Total revenue for the SBR test (${aed(sbrRevenue)}) is above ${aed(S.sbr.revenueLimit)}`);
  if (profile.priorPeriodsUnder3M === false) sbrFailed.push(`An earlier period had revenue above ${aed(S.sbr.revenueLimit)}`);
  if (profile.periodEnd && profile.periodEnd > S.sbr.lastPeriodEnd) sbrFailed.push(`Period ends after ${S.sbr.lastPeriodEnd}, the last date SBR can be used`);
  if (profile.legalForm === 'qfzp') sbrFailed.push('A Qualifying Free Zone Person cannot use SBR');
  // Ministerial Decision 73/2023 Art. 2: only a Resident Person can elect SBR (not a non-resident with a PE or nexus).
  if (input.registrantType === 'nonresident_pe' || input.registrantType === 'nonresident_nexus')
    sbrFailed.push('Only a UAE Resident Person can use SBR, and this is registered as a non-resident (Deadlines → Who is registering?)');
  if ((profile.groupRevenue ?? 0) >= S.sbr.excludedGroupRevenue) sbrFailed.push(`Group revenue is ${aed(S.sbr.excludedGroupRevenue)} or more`);
  // SBR is never applied on an unanswered question (whatever cautious mode says): a HIGH flag asks for it.
  const sbrUnconfirmed: string[] = [];
  if (profile.priorPeriodsUnder3M === undefined) sbrUnconfirmed.push(`"All earlier periods had revenue ≤ ${aed(S.sbr.revenueLimit)}" is not answered`);
  // A missing period end is not a reason to refuse SBR: it is asked for (the relief needs it to check 31 Dec 2029).
  if (!profile.periodEnd) sbrUnconfirmed.push('Period end is not entered (SBR is only for periods ending on or before 31 Dec 2029)');
  if (profile.groupRevenue === undefined) sbrUnconfirmed.push('Group revenue is not answered (tick "Not part of a group" if it is not in one)');
  const sbr: SbrResult = {
    elected: !!profile.electSBR,
    eligible: sbrFailed.length === 0,
    unconfirmed: sbrUnconfirmed,
    applied: false,
    failed: sbrFailed,
    revenue: sbrRevenue,
  };
  sbr.applied = sbr.elected && sbr.eligible && sbr.unconfirmed.length === 0;

  // QFZP.
  const q = profile.qfzp ?? {};
  const qfzp: QfzpResult = {
    claimed: profile.legalForm === 'qfzp',
    deMinimisLimit: 0,
    deMinimisPass: false,
    conditionsPass: false,
    applied: false,
    failed: [],
    qualifyingIncome: 0,
    taxableNonQualifying: 0,
    failedThisPeriod: false,
  };
  if (qfzp.claimed) {
    // Status lost in an earlier period (or typed for this one): the standard rate for that period and the next 4.
    const lost = profile.qfzpLostPeriodEnd;
    if (isIsoDate(lost) && profile.periodEnd && profile.periodEnd >= lost && profile.periodEnd <= qfzpLockUntil(lost)) {
      qfzp.lostUntil = qfzpLockUntil(lost);
      qfzp.failed.push(`QFZP status was lost in the period ending ${fmtDate(lost)}. The standard rate applies until the period ending ${fmtDate(qfzp.lostUntil)}`);
    }
    let definite = false;
    const dm = qfzpDeMinimis(ctRevenue.total, q.nonQualifyingRevenue ?? 0);
    qfzp.deMinimisLimit = dm.limit;
    if (q.nonQualifyingRevenue === undefined) {
      qfzp.deMinimisPass = !cautious;
      if (cautious) qfzp.failed.push('Non-qualifying revenue not entered');
    } else {
      qfzp.deMinimisPass = dm.passes;
      if (!dm.passes) {
        definite = true;
        qfzp.failed.push(`Non-qualifying revenue ${aed(q.nonQualifyingRevenue)} is above the de minimis limit of ${aed(dm.limit)}`);
      }
    }
    const conds: [boolean | undefined, string][] = [
      [q.qualifyingActivity, 'Qualifying activity'],
      [q.substance, 'Adequate substance in the free zone'],
      [q.auditedFS, 'Audited financial statements'],
      [q.tpCompliance, 'Transfer pricing compliance'],
      [q.noElection, 'No election to be taxed at the standard rate'],
    ];
    for (const [v, label] of conds) {
      if (v === false) definite = true;
      if (v === false || (v === undefined && cautious)) qfzp.failed.push(`${label}: ${v === false ? 'not met' : 'not confirmed'}`);
    }
    qfzp.conditionsPass = !qfzp.failed.some((f) => !f.startsWith('Non-qualifying'));
    qfzp.applied = qfzp.deMinimisPass && qfzp.conditionsPass;
    qfzp.qualifyingIncome = q.qualifyingIncome ?? 0;
    // A new failure only counts when the status was not already lost (it is saved on the client and carried to next year).
    qfzp.failedThisPeriod = definite && !qfzp.lostUntil;
  }

  // Steps 5 and 6.
  let tax = 0;
  let used = 0;
  let cap = 0;
  let carriedForward = lossBF;
  let taxableAfterLoss = 0;
  let regime: ComputeResult['regime'] = 'standard';

  if (sbr.applied) {
    regime = 'sbr';
    notes.push('Small Business Relief applies: the company is treated as having no taxable income. No loss is used, and this period’s loss (if any) is not carried forward.');
  } else if (taxableIncome <= 0) {
    carriedForward = lossBF + Math.abs(taxableIncome);
    if (qfzp.applied) regime = 'qfzp';
  } else if (qfzp.applied) {
    regime = 'qfzp';
    // Qualifying income is entered after its share of costs; whatever taxable income is left over is non-qualifying (never below 0).
    qfzp.taxableNonQualifying = Math.max(0, taxableIncome - qfzp.qualifyingIncome);
    cap = S.lossOffsetCap * qfzp.taxableNonQualifying;
    used = Math.min(lossBF, cap);
    taxableAfterLoss = qfzp.taxableNonQualifying - used;
    tax = round2(taxableAfterLoss * S.rate);
    carriedForward = lossBF - used;
    notes.push(`QFZP: qualifying income of ${aed(qfzp.qualifyingIncome)} is taxed at 0%. Taxable non-qualifying income is taxed at ${pct(S.rate, 0)} with no 0% band.`);
  } else {
    cap = S.lossOffsetCap * taxableIncome;
    used = Math.min(lossBF, cap);
    taxableAfterLoss = taxableIncome - used;
    tax = standardTax(taxableAfterLoss);
    carriedForward = lossBF - used;
  }

  const loss: LossResult = {
    broughtForward: lossBF,
    rejected,
    undated,
    excludedForOwnership,
    cap: round2(cap),
    used: round2(used),
    carriedForward: round2(carriedForward),
  };
  if (excludedForOwnership > 0) {
    notes.push(`Losses of ${aed(excludedForOwnership)} are excluded because ownership changed (Art. 39). They are not carried forward.`);
  }

  // Foreign tax credit (Art. 47), worked out per country or source (see foreignTaxCreditFor). Unused credit is lost.
  const foreignTaxCredit = foreignTaxCreditFor(round2(tax), round2(taxableAfterLoss), input.foreignTax);
  foreignTaxCredit.rows.forEach((r, i) => {
    if (r.taxPaid > 0 && r.income <= 0) {
      flag({
        id: 'FTC',
        subject: `income-${i + 1}`,
        level: 'MEDIUM',
        message: `${r.country}: foreign tax of ${aed(r.taxPaid)} is entered, but not the foreign income it was paid on. No credit is given for it until it is.`,
        amount: r.taxPaid,
        action: 'Enter the foreign income (after its own costs) that is included in taxable income.',
      });
    }
  });
  const unusedRows = foreignTaxCredit.rows.filter((r) => r.unused > 0);
  if (unusedRows.length) {
    flag({
      id: 'FTC',
      subject: 'unused',
      level: 'INFO',
      message: `Foreign tax is more than the UAE tax on the same income: ${unusedRows.map((r) => `${r.country} ${aed(r.unused, 2)}`).join('; ')}. That part cannot be used: it is not carried forward, carried back or refunded.`,
      amount: foreignTaxCredit.unused,
      action: 'None, unless a foreign income or foreign tax figure is wrong.',
    });
  }
  const taxBeforeCredits = round2(tax);
  tax = round2(tax - foreignTaxCredit.credit);

  if (cautious) {
    notes.push(
      'Cautious mode is on: unsplit entertainment counts as client entertainment, VAT of unknown recoverability is added back, and unanswered QFZP conditions and losses after an ownership change take the stricter reading. Other open questions add nothing until answered; their flags stay open.',
    );
  }

  return {
    pbt,
    revenue,
    otherIncome,
    exemptIncome,
    totalIncome,
    addBacks,
    totalAddBacks,
    deductions,
    totalDeductions,
    taxableIncome,
    loss,
    taxableAfterLoss: round2(taxableAfterLoss),
    interest,
    sbr,
    qfzp,
    participation,
    ctRevenue,
    regime,
    taxBeforeCredits,
    foreignTaxCredit,
    tax: round2(tax),
    effectiveRate: pbt > 0 ? tax / pbt : 0,
    notes,
    flags,
  };
}
