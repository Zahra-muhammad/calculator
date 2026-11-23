/**
 * Review flags RV-01..RV-11, AB-10 (transfer pricing files), SBR and DATA checks.
 * Rule-level flags (AB-01..AB-14) are raised by compute.ts next to each rule; this
 * module adds the review checks and merges and sorts everything.
 */
import { roleOf } from './classify';
import { compute } from './compute';
import { SETTINGS } from './settings';
import type {
  CellRef,
  ComputeInput,
  ComputeResult,
  Flag,
  FsFacts,
  LineAnswer,
  Profile,
  RelatedParty,
  TaxLine,
  VatReturnRow,
} from './types';
import { BUSINESS_TYPE_LABELS, CATEGORY_MAP, LEVEL_ORDER, refText } from './types';
import { aed, fmtDate, monthsBetween, norm, pct, slug, sum } from './util';

const S = SETTINGS;

export interface ReviewContext {
  profile?: Partial<Profile>;
  fsFacts?: Partial<FsFacts>;
  relatedParties?: RelatedParty[];
  vatReturns?: VatReturnRow[];
  /** Where PBT came from, for messages. */
  pbtRef?: CellRef;
  /** Net of the counted lines in the sales register, used for RV-03 when there are no filed VAT returns. */
  salesRegisterRevenue?: number;
}

function mk(id: string, subject: string, level: Flag['level'], message: string, action: string, extra: Partial<Flag> = {}): Flag {
  return { id, key: `${id}:${subject}`, level, message, action, ...extra };
}

// ───────────────────────── Connected persons (RV-04) ─────────────────────────

export interface PersonGroup {
  person: string;
  total: number;
  members: { name: string; account: string; amount: number }[];
}

/**
 * Group payments to connected persons by person, putting relatives with the owner or director they
 * belong to. Counts connected-person payments and interest paid to a connected person; never drawings
 * (those are balance-sheet lines). Without a name, lines are grouped by role ("Director").
 */
export function connectedPersonGroups(lines: TaxLine[], answers: Record<string, LineAnswer>, parties: RelatedParty[] = []): PersonGroup[] {
  const groups = new Map<string, PersonGroup>();
  const findParty = (name: string) => parties.find((p) => norm(p.name) === norm(name));
  for (const l of lines) {
    if (l.balance <= 0) continue;
    const isPayment = l.category === 'connected_person_payment';
    const isInterest = l.category === 'interest_expense' && !!l.relatedParty && l.relatedPartyType !== 'company';
    if (!isPayment && !isInterest) continue;
    const name = answers[l.key]?.personName || l.relatedParty || roleOf(l.account)?.name || l.account;
    const party = findParty(name);
    const head = party?.connectedTo ? findParty(party.connectedTo)?.name ?? party.connectedTo : party?.name ?? name;
    const key = norm(head);
    const g = groups.get(key) ?? { person: head, total: 0, members: [] };
    g.total += l.balance;
    g.members.push({ name, account: l.account, amount: l.balance });
    groups.set(key, g);
  }
  return [...groups.values()];
}

// ───────────────────────── Review flags ─────────────────────────

export function reviewFlags(input: ComputeInput, result: ComputeResult, ctx: ReviewContext = {}): Flag[] {
  const out: Flag[] = [];
  const profile: Partial<Profile> = { ...(input.profile ?? {}), ...(ctx.profile ?? {}) };
  const facts = ctx.fsFacts ?? {};
  const answers = input.answers ?? {};
  const lines = input.lines;
  const revenue = result.revenue;

  // RV-01 profile completeness.
  const missing: string[] = [];
  if (!profile.legalForm) missing.push('legal form');
  if (!profile.periodStart || !profile.periodEnd) missing.push('period dates');
  if (!profile.accountingStandard) missing.push('accounting standard');
  if (profile.electSBR === undefined || profile.electRealisation === undefined) missing.push('elections');
  if (missing.length) {
    out.push(mk('RV-01', 'missing', 'MEDIUM', `Company profile is incomplete: ${missing.join(', ')}.`, 'Complete the company profile.'));
  }
  if (profile.periodStart && profile.periodEnd) {
    const months = monthsBetween(profile.periodStart, profile.periodEnd);
    if (months !== 12) {
      out.push(mk('RV-01', 'length', 'MEDIUM', `The period is about ${months} months, not 12.`, 'Check the period dates. A first or changed period may be shorter or longer.'));
    }
  }

  // RV-02 audit.
  const auditNeeded = revenue > S.auditRevenueThreshold || profile.legalForm === 'qfzp';
  if (auditNeeded && !profile.audited) {
    out.push(
      mk(
        'RV-02',
        'audit',
        'HIGH',
        `Audited financial statements are needed (${profile.legalForm === 'qfzp' ? 'every QFZP' : `revenue above ${aed(S.auditRevenueThreshold)}`}), but they are not marked as audited.`,
        'Get the audited statements, then tick "Audited" in the profile.',
      ),
    );
  } else {
    out.push(mk('RV-02', 'audit', 'PASS', auditNeeded ? 'Audit requirement met.' : 'Audited statements are not required.', 'None.'));
  }

  // RV-03 revenue vs VAT returns.
  const vatFromReturns = ctx.vatReturns?.length ? sum(ctx.vatReturns.map((v) => v.standardRated + v.zeroRated + v.exempt)) : undefined;
  // Without filed VAT returns, the sales register (net of every counted sale) is the VAT figure to compare.
  const vatRevenue = profile.vatRevenue ?? vatFromReturns ?? ctx.salesRegisterRevenue;
  if (vatRevenue === undefined) {
    out.push(mk('RV-03', 'vat', 'MEDIUM', 'Revenue has not been reconciled to the VAT returns yet.', 'Enter the VAT-return revenue or upload the VAT returns.'));
  } else {
    const diff = revenue - vatRevenue;
    const share = revenue ? Math.abs(diff) / Math.abs(revenue) : vatRevenue ? 1 : 0;
    if (share > 0.01 && !profile.vatDifferenceNote?.trim()) {
      out.push(
        mk('RV-03', 'vat', 'MEDIUM', `Revenue (${aed(revenue)}) differs from the VAT returns (${aed(vatRevenue)}) by ${aed(Math.abs(diff))} (${pct(share)}).`, 'Explain the difference (for example timing, out-of-scope income) in the profile.', {
          amount: Math.abs(diff),
        }),
      );
    } else {
      out.push(mk('RV-03', 'vat', 'PASS', share > 0.01 ? `Difference to VAT returns explained: ${profile.vatDifferenceNote}` : 'Revenue agrees with the VAT returns (within 1%).', 'None.'));
    }
  }

  // RV-04 related parties and connected persons.
  for (const g of connectedPersonGroups(lines, answers, ctx.relatedParties)) {
    if (g.total > S.connectedPersonDisclosure) {
      out.push(
        mk(
          'RV-04',
          `person-${slug(g.person)}`,
          'HIGH',
          `Payments to ${g.person}${g.members.length > 1 ? ' and relatives' : ''} total ${aed(g.total)}, above ${aed(S.connectedPersonDisclosure)}. Disclose them in the return.${g.members.length > 1 ? ` (${g.members.map((m) => `${m.name}: ${aed(m.amount)}`).join('; ')})` : ''}`,
          'Prepare the connected-person disclosure and keep market-value support.',
          { amount: g.total },
        ),
      );
    }
  }
  // Income from a connected person or related company: confirm the price.
  for (const l of lines) {
    if (l.balance >= 0 || !l.relatedParty || l.category === 'balance_sheet' || l.category === 'below_pbt') continue;
    out.push(
      mk('RV-04', `income-${l.key}`, 'MEDIUM', `${l.account}${l.source ? ` (${l.source})` : ''}: income from a connected person (${l.relatedParty}): confirm it is at market value.`, 'Check the price against what an unrelated party would pay, and keep the support.', {
        amount: -l.balance,
        source: l.source,
      }),
    );
  }

  const rpLines = lines.filter((l) => l.category === 'related_party_expense' || l.category === 'connected_person_payment' || (l.relatedParty && l.category !== 'balance_sheet'));
  const rpTotal = sum(rpLines.map((l) => Math.abs(l.balance)));
  if (rpTotal > S.relatedPartyScheduleTotal) {
    const byCat = new Map<string, number>();
    for (const l of rpLines) byCat.set(CATEGORY_MAP[l.category].label, (byCat.get(CATEGORY_MAP[l.category].label) ?? 0) + Math.abs(l.balance));
    const big = [...byCat.entries()].filter(([, v]) => v > S.relatedPartyScheduleCategory);
    out.push(
      mk(
        'RV-04',
        'schedule',
        'HIGH',
        `Related-party transactions total ${aed(rpTotal)}, above ${aed(S.relatedPartyScheduleTotal)}. A related-party schedule is needed.${big.length ? ` Categories above ${aed(S.relatedPartyScheduleCategory)}: ${big.map(([k, v]) => `${k} ${aed(v)}`).join('; ')}.` : ''}`,
        'Prepare the transfer pricing disclosure form.',
        { amount: rpTotal },
      ),
    );
  }
  // Connected-person lines are left out: each unbenchmarked one already has its own AB-09 HIGH flag.
  const unbenchmarked = lines.filter((l) => l.category === 'related_party_expense' && answers[l.key]?.marketValue === undefined);
  if (unbenchmarked.length) {
    out.push(
      mk('RV-04', 'tp-support', 'HIGH', `Transfer pricing support is missing for ${unbenchmarked.length} related-party line(s): ${unbenchmarked.map((l) => l.account).slice(0, 6).join(', ')}.`, 'Get benchmarking support and enter the market values.', {
        amount: sum(unbenchmarked.map((l) => l.balance)),
      }),
    );
  }

  // AB-10 Master File and Local File.
  const groupRevenue = profile.groupRevenue ?? 0;
  if (revenue >= S.masterLocalFileRevenue || groupRevenue >= S.masterLocalFileGroupRevenue) {
    out.push(mk('AB-10', 'master-local', 'HIGH', `A Master File and Local File are needed (revenue ${aed(revenue)}${groupRevenue ? `, group revenue ${aed(groupRevenue)}` : ''}).`, 'Prepare the Master File and Local File.'));
  } else {
    out.push(mk('AB-10', 'master-local', 'PASS', 'Master File and Local File are not required.', 'None.'));
  }

  // RV-05 balances with owners and related parties.
  // Balance-sheet lines about owners or related parties (or matched to the related-party list).
  const RV05_RE =
    /\b(shareholders?|directors?|owners?|partners?|proprietors?|chairman|related part(y|ies)|due (from|to)|sister compan(y|ies)|group compan(y|ies)|associates?|affiliates?|affiliated|inter ?company|drawings?|withdrawals?)\b/;
  for (const l of lines) {
    if (l.category !== 'balance_sheet' || Math.abs(l.balance) < 0.005) continue;
    if (!RV05_RE.test(norm(l.account)) && !l.relatedParty) continue;
    out.push(
      mk('RV-05', l.key, 'HIGH', `${l.account}${l.source ? ` (${l.source})` : ''} has a balance of ${aed(Math.abs(l.balance))} ${l.balance > 0 ? 'owed to the company' : 'owed by the company'}.`, 'Check interest charged, terms, market rate, personal expenses paid through it, and any write-off.', {
        amount: Math.abs(l.balance),
        source: l.source,
      }),
    );
  }

  // RV-06 interest.
  if (result.interest.expense === 0 && result.interest.income === 0 && !result.interest.carriedForwardIn) {
    out.push(mk('RV-06', 'interest', 'PASS', 'No interest in the accounts.', 'None.'));
  } else if (result.interest.exempt) {
    out.push(mk('RV-06', 'interest', 'PASS', `The interest limit does not apply to this business type (${BUSINESS_TYPE_LABELS[profile.businessType ?? 'ordinary']}). Net interest: ${aed(result.interest.net)}.`, 'None.'));
  } else if (result.interest.excess > 0) {
    out.push(
      mk(
        'RV-06',
        'interest',
        'HIGH',
        `Net interest of ${aed(result.interest.net)} is above the limit of ${aed(result.interest.limit)}. ${aed(result.interest.excess)} is added back and carried forward.`,
        `Check the interest figures and the adjusted EBITDA.${profile.businessType ? '' : ' If the company is a bank or an insurance provider, set its business type in the profile: the limit does not apply to them.'}`,
        { amount: result.interest.excess },
      ),
    );
  } else {
    out.push(mk('RV-06', 'interest', 'PASS', `Net interest of ${aed(result.interest.net)} is within the limit of ${aed(result.interest.limit)}.`, 'None.'));
  }
  if (result.interest.expired > 0) {
    out.push(mk('RV-06', 'expired', 'INFO', `${aed(result.interest.expired)} of interest carried forward is more than ${S.interest.carryForwardYears} years old and has expired.`, 'Remove it from next year’s carry-forward.'));
  }

  // RV-07 capital items, unrealised items, OCI.
  const capital = lines.filter((l) => l.category === 'capital_expensed');
  if (capital.length) {
    out.push(mk('RV-07', 'capital', 'MEDIUM', `Capital items were expensed: ${capital.map((l) => `${l.account} ${aed(l.balance)}`).join('; ')}.`, 'Add back the cost and enter the tax depreciation allowed.', { amount: sum(capital.map((l) => l.balance)) }));
  }
  const unreal = lines.filter((l) => l.category === 'unrealised_gain_loss');
  if (unreal.length) {
    out.push(
      mk(
        'RV-07',
        'unrealised',
        'MEDIUM',
        `Unrealised gains or losses are in profit: ${unreal.map((l) => `${l.account} ${aed(-l.balance)}`).join('; ')}. ${profile.electRealisation === true ? 'They are reversed because the realisation election is made.' : 'They stay taxable because the realisation election is not made.'}`,
        'Confirm the realisation election and the amounts.',
      ),
    );
  }
  if (facts.ociText) {
    out.push(mk('RV-07', 'oci', 'MEDIUM', `Other comprehensive income items found at ${refText(facts.ociText)}.`, 'Check whether any OCI item must be included in taxable income.', { source: refText(facts.ociText) }));
  }

  // RV-08 VAT, penalties and taxes above PBT.
  const rv08: string[] = [];
  const vatLines = lines.filter((l) => l.category === 'vat_expensed');
  const fineLines = lines.filter((l) => l.category === 'fines' || l.category === 'penalty_review');
  const foreignTax = lines.filter((l) => /\b(withholding tax|foreign tax|wht)\b/.test(norm(l.account)));
  if (vatLines.length) rv08.push(`VAT ${aed(sum(vatLines.map((l) => l.balance)))}`);
  if (fineLines.length) rv08.push(`penalties ${aed(sum(fineLines.map((l) => l.balance)))}`);
  if (foreignTax.length) rv08.push(`foreign or withholding tax ${aed(sum(foreignTax.map((l) => l.balance)))}`);
  const plLines = lines.filter((l) => l.category !== 'balance_sheet' && !l.parentKey);
  const taxLines = plLines.filter((l) => l.category === 'below_pbt');
  const profitExclTax = -sum(plLines.filter((l) => l.category !== 'below_pbt').map((l) => l.balance));
  const profitInclTax = -sum(plLines.map((l) => l.balance));
  if (plLines.length && taxLines.length && Math.abs(profitInclTax - result.pbt) <= 1 && Math.abs(profitExclTax - result.pbt) > 1) {
    rv08.push(`corporate or deferred tax ${aed(sum(taxLines.map((l) => l.balance)))} deducted above PBT`);
  }
  if (rv08.length) {
    out.push(mk('RV-08', 'above-pbt', 'MEDIUM', `Found in the P&L above PBT: ${rv08.join('; ')}.`, 'Check each is handled: VAT (AB-07), penalties (AB-06), taxes are not deductible.'));
  }
  if (plLines.length > 0 && Math.abs(profitExclTax - result.pbt) > 1 && Math.abs(profitInclTax - result.pbt) > 1) {
    out.push(
      mk('DATA', 'tb-vs-pbt', 'DATA', `Profit from the trial balance (${aed(profitExclTax)}) does not match PBT (${aed(result.pbt)}). Difference ${aed(profitExclTax - result.pbt)}.`, 'Check the PBT figure and that the trial balance is the final one.', {
        amount: Math.abs(profitExclTax - result.pbt),
      }),
    );
  }

  // RV-09 foreign income.
  const hasForeign = profile.hasForeignIncome || !!facts.foreignText || lines.some((l) => l.category === 'dividend_received_foreign') || result.foreignTaxCredit.taxPaid > 0;
  if (hasForeign && !profile.hasTaxCertificates) {
    out.push(
      mk('RV-09', 'foreign', 'MEDIUM', `Foreign income or a foreign branch${facts.foreignText ? ` (see ${refText(facts.foreignText)})` : ''}, but no foreign tax certificates are recorded.`, 'Get tax residence and foreign tax certificates, or confirm there is no foreign income.'),
    );
  }

  // RV-10 losses.
  const lossesEntered = (input.lossesBF ?? []).some((r) => r.amount > 0);
  if (!lossesEntered && facts.pbtPrior !== undefined && facts.pbtPrior < 0) {
    out.push(mk('RV-10', 'missing', 'MEDIUM', `Last year's statements show a loss (${aed(facts.pbtPrior)}) but no tax losses brought forward are entered.`, 'Enter the tax losses brought forward, or confirm there are none.'));
  }
  if (result.loss.undated.length) {
    const amount = sum(result.loss.undated.map((r) => r.amount));
    out.push(
      mk('RV-10', 'undated', 'MEDIUM', `Enter the period this loss came from: ${aed(amount)} of losses brought forward has no period start date, so it is not used yet.`, 'Enter the start date of the period that made the loss (Headline numbers).', {
        amount,
      }),
    );
  }
  if (result.loss.rejected.length) {
    out.push(
      mk('RV-10', 'pre-2023', 'MEDIUM', `Losses from periods starting before ${S.lossesValidFrom} are not allowed and were ignored: ${aed(sum(result.loss.rejected.map((r) => r.amount)))}.`, 'Remove these rows, or correct the period start date.', {
        amount: sum(result.loss.rejected.map((r) => r.amount)),
      }),
    );
  }
  if (profile.ownershipChange && (result.loss.broughtForward > 0 || result.loss.excludedForOwnership > 0)) {
    const excluded = result.loss.excludedForOwnership > 0;
    out.push(
      mk(
        'RV-10',
        'ownership',
        'HIGH',
        `Ownership changed and there are losses brought forward. Losses can be used only if at least ${pct(S.lossOwnershipContinuity, 0)} of ownership continued, or the same business continues (Art. 39). ${excluded ? `Losses of ${aed(result.loss.excludedForOwnership)} are excluded${profile.ownershipChangeLosses ? '' : ' (cautious mode)'}.` : 'Losses are being used.'}`,
        'Check the ownership history and choose whether the losses can be used.',
      ),
    );
  }
  if (result.loss.broughtForward > 0 || result.loss.carriedForward > 0) {
    out.push(mk('RV-10', 'summary', 'INFO', `Losses: brought forward ${aed(result.loss.broughtForward)}, used ${aed(result.loss.used)}, carried forward ${aed(result.loss.carriedForward)}.`, 'None.'));
  }

  // RV-11 QFZP.
  const later = S.qfzp.failurePenaltyPeriods - 1;
  if (result.qfzp.claimed && result.qfzp.lostUntil) {
    out.push(
      mk(
        'RV-11',
        'qfzp',
        'HIGH',
        `QFZP status was lost in the period ending ${fmtDate(profile.qfzpLostPeriodEnd)}. The standard rate applies to all income for that period and the next ${later}, so until the period ending ${fmtDate(result.qfzp.lostUntil)}.`,
        'Keep the standard rate for this period. Change the date in the profile only if it is wrong.',
      ),
    );
  } else if (result.qfzp.claimed && result.qfzp.failedThisPeriod) {
    out.push(
      mk(
        'RV-11',
        'qfzp',
        'HIGH',
        `QFZP conditions not met: ${result.qfzp.failed.join('; ')}. The standard rate applies to all income for this period and the next ${later}. This is saved with the client and carried into next year's file when you duplicate it.`,
        'Check each QFZP condition and the non-qualifying revenue.',
      ),
    );
  } else if (result.qfzp.claimed && !result.qfzp.applied) {
    out.push(
      mk(
        'RV-11',
        'qfzp',
        'HIGH',
        `QFZP conditions not confirmed: ${result.qfzp.failed.join('; ')}. The standard rate is used until they are answered. A condition that is really not met removes QFZP status for this period and the next ${later}.`,
        'Answer each QFZP condition and enter the non-qualifying revenue before you duplicate the client to next year: only an answered failure is carried over.',
      ),
    );
  } else if (result.qfzp.claimed) {
    out.push(mk('RV-11', 'qfzp', 'PASS', `QFZP conditions met. De minimis limit ${aed(result.qfzp.deMinimisLimit)}.`, 'None.'));
    if (profile.qfzp?.qualifyingIncome === undefined) {
      out.push(mk('RV-11', 'qualifying-income', 'MEDIUM', 'Qualifying income is not entered, so all taxable income is taxed at 9%.', 'Enter the qualifying income.'));
    }
  } else if (profile.legalForm === 'free_zone') {
    out.push(mk('RV-11', 'free-zone', 'INFO', 'This is a free zone company that is not claiming QFZP status.', 'Check whether it could qualify as a Qualifying Free Zone Person.'));
  }

  // SBR.
  if (result.sbr.elected && result.sbr.eligible && result.sbr.unconfirmed.length) {
    out.push(
      mk(
        'SBR',
        'confirm',
        'HIGH',
        `Confirm before using SBR: ${result.sbr.unconfirmed.join('; ')}. Small Business Relief is not applied until both are answered.`,
        'Answer these questions in the Company profile.',
      ),
    );
  }
  // Eligible but not elected while tax is due: electing would bring the tax to nil.
  if (!result.sbr.elected && result.sbr.eligible && result.taxBeforeCredits > 0) {
    out.push(mk('SBR', 'eligible', 'MEDIUM', 'Eligible for SBR: electing would make the tax AED 0.', 'Confirm with the client.', { amount: result.taxBeforeCredits }));
  }
  if (result.sbr.elected && !result.sbr.eligible) {
    out.push(mk('SBR', 'not-eligible', 'HIGH', `Small Business Relief was chosen but the company does not qualify: ${result.sbr.failed.join('; ')}.`, 'Remove the SBR election, or correct the facts.'));
  }
  if (result.taxableIncome < 0 && (result.sbr.elected || result.sbr.eligible)) {
    out.push(
      mk('SBR', 'loss', 'INFO', `The company has a tax loss of ${aed(-result.taxableIncome)}. Electing Small Business Relief would lose this year's loss (it is not carried forward).`, 'Compare: SBR now vs. carrying the loss forward.'),
    );
  }

  // DATA checks.
  const errs = facts.formulaErrors ?? [];
  if (errs.length) {
    const list = errs.slice(0, 8).map((e) => `${refText(e)} ${e.error}`).join(', ');
    out.push(mk('DATA', 'formula-errors', 'DATA', `${errs.length} cell(s) show formula errors: ${list}${errs.length > 8 ? ', …' : ''}.`, 'Fix the formulas in the source file and upload it again.', { source: refText(errs[0]) }));
  }
  if (facts.tbTotals && Math.abs(facts.tbTotals.debit - facts.tbTotals.credit) > 1) {
    const d = facts.tbTotals.debit - facts.tbTotals.credit;
    out.push(mk('DATA', 'tb-balance', 'DATA', `Trial balance does not balance: debits ${aed(facts.tbTotals.debit)}, credits ${aed(facts.tbTotals.credit)}, difference ${aed(Math.abs(d))}.`, 'Check the trial balance is complete.', { amount: Math.abs(d) }));
  }
  if (facts.totalAssets && facts.totalEquityLiabilities && Math.abs(facts.totalAssets.value - facts.totalEquityLiabilities.value) > 1) {
    const d = facts.totalAssets.value - facts.totalEquityLiabilities.value;
    out.push(
      mk(
        'DATA',
        'bs-balance',
        'DATA',
        `Balance sheet does not balance: total assets ${aed(facts.totalAssets.value)} (${refText(facts.totalAssets.ref)}) vs equity and liabilities ${aed(facts.totalEquityLiabilities.value)} (${refText(facts.totalEquityLiabilities.ref)}). Difference ${aed(Math.abs(d))}.`,
        'Check the statements.',
        { amount: Math.abs(d), source: refText(facts.totalAssets.ref) },
      ),
    );
  }
  if (facts.revenueSignFixed) {
    out.push(
      mk('DATA', 'revenue-sign', 'INFO', `Revenue at ${refText(facts.revenueSignFixed)} is shown as a negative number. The calculator uses ${aed(revenue)} (its absolute value).`, 'Check the sign in the statements.', {
        source: refText(facts.revenueSignFixed),
      }),
    );
  }
  for (const t of facts.templateTexts ?? []) {
    if (t.topic === 'sbr' && revenue > S.sbr.revenueLimit) {
      out.push(mk('DATA', `template-sbr-${slug(refText(t.ref))}`, 'DATA', `The statements mention Small Business Relief (${refText(t.ref)}) but revenue is ${aed(revenue)}, above ${aed(S.sbr.revenueLimit)}.`, 'Remove or correct the template text in the statements.', { source: refText(t.ref) }));
    }
    if (t.topic === 'qfzp' && profile.legalForm !== 'qfzp') {
      out.push(mk('DATA', `template-qfzp-${slug(refText(t.ref))}`, 'DATA', `The statements mention Qualifying Free Zone Person status (${refText(t.ref)}) but the profile does not.`, 'Check the legal form in the profile, or correct the statements.', { source: refText(t.ref) }));
    }
  }

  return out;
}

// ───────────────────────── Merge and sort ─────────────────────────

export function sortFlags(flags: Flag[]): Flag[] {
  const seen = new Set<string>();
  const unique = flags.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true)));
  return unique.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || a.id.localeCompare(b.id));
}

export function allFlags(input: ComputeInput, result: ComputeResult, ctx: ReviewContext = {}): Flag[] {
  return sortFlags([...result.flags, ...reviewFlags(input, result, ctx)]);
}

/** Compute and collect every flag in one call. */
export function computeWithFlags(input: ComputeInput, ctx: ReviewContext = {}): { result: ComputeResult; flags: Flag[] } {
  const result = compute(input);
  return { result, flags: allFlags(input, result, ctx) };
}

export function countByLevel(flags: Flag[]): Record<Flag['level'], number> {
  const c: Record<Flag['level'], number> = { HIGH: 0, MEDIUM: 0, DATA: 0, INFO: 0, PASS: 0 };
  for (const f of flags) c[f.level]++;
  return c;
}

/** HIGH flags that are not resolved. */
export function openHigh(flags: Flag[], resolved: Record<string, unknown>): Flag[] {
  return flags.filter((f) => f.level === 'HIGH' && !resolved[f.key]);
}
