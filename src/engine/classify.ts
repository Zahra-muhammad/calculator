/**
 * Gives every trial balance line one tax category.
 *
 * Order of evidence (first that applies wins):
 *  1. Saved mapping for this client and account
 *  2. Related-party list match (account name contains a listed name)
 *  3. Comment column rules
 *  4. Account-name keyword rules (ordered; some only for debit or credit balances)
 *  5. Position: lines before the first revenue line in a standard TB are balance sheet
 *  6. Default: credit = other income, debit = normal expense
 *
 * One practical exception: comments and related-party matches never turn a clear
 * balance-sheet account (for example "Due to director") into a P&L add-back, because
 * balance-sheet amounts are not in profit. Those lines stay balance sheet and RV-05 checks them.
 */
import type { Category, ClassifiedLine, LineAnswer, RelatedParty, SubLine, TBLine } from './types';
import { CATEGORY_MAP } from './types';
import { aed, norm } from './util';

interface Rule {
  re: RegExp;
  cat: Category;
  side?: 'debit' | 'credit';
  /** The rule does not apply when this also matches. */
  not?: RegExp;
  /** The rule applies only when this ALSO matches (words in any order). */
  also?: RegExp;
}

/** Government bodies: their penalties are fines (AB-06), not contract damages. */
export const GOVERNMENT =
  /\b(traffic|rta|police|municipality|municipal|ministry|fta|federal tax authority|tax|vat|customs|labou?r|mohre|immigration|gdrfa|ica|ded|court|government|governmental|authorit(y|ies)|regulator|regulatory|parking|salik)\b/;
/** Commercial words: a penalty to a customer or supplier, or under a contract, is contract damages (allowed). */
export const COMMERCIAL = /\b(customers?|clients?|suppliers?|vendors?|subcontractors?|contracts?|contractual|late delivery|delay|delays|delayed|liquidated)\b/;
/** Contract damages named without the word "penalty". */
const CONTRACT_DAMAGES =
  /\bliquidated damages\b|\bcontract(ual)? (penalt\w*|damages)\b|\bdamages paid\b|\bcompensation (paid )?to (customers?|clients?)\b|\bcompensation paid\b|\b(customer|client) compensation\b|\blate delivery (charges?|damages)\b|\bdelay (charges?|damages)\b/;
const ENTERTAINMENT_WORDS = /\b(entertainment|hospitality|meals?|dinners?|lunch(es)?|part(y|ies)|events?|outings?|celebrations?|gatherings?|gifts?|hampers?)\b/;
const STAFF_WORDS = /\b(staff|employees?|team|workers?)\b/;
const CLIENT_WORDS = /\b(clients?|customers?)\b/;
const APPROVED = /\b(approved|qpbe|qualifying public benefit)\b/;
const NOT_APPROVED = /\bnot (an? )?(approved|qpbe)\b|\bnon approved\b|\bunapproved\b/;
const DONATION_WORDS = /\b(donations?|charit(y|ies|able)|zakat|sponsorships?|public benefit)\b/;

/** A name with one of these is never a balance-sheet account ("Interest on loan from director")… */
const NEVER_BS = /\b(interest|finance (costs?|charges?)|profit on|charges?)\b/;
/** …unless it also says something only a balance-sheet account says ("Interest receivable", "Accrued interest"). */
const BS_ONLY = /\b(receivables?|payables?|accrued|accruals?|prepaid|prepayments?|deferred)\b/;

// ───────────────────────── Account-name rules (ordered) ─────────────────────────

/**
 * Words that show a line is a P&L item even though it names a balance-sheet thing
 * ("Interest on bank loan", "Motor vehicle repairs", "Office equipment purchased").
 */
const PL_WORDS =
  /\b(expenses?|charges?|fees?|costs?|income|gains?|loss|losses|written off|write offs?|disposal|paid|received|interest|dividends?|depreciation|amorti[sz]ation|repairs?|maintenance|fuel|petrol|running|insurance|rent|rental|purchased?|purchases|bought|acquired|expenditure|capex|discounts?|commissions?|salar(y|ies)|wages|remuneration|unreali[sz]\w*|fair value|revaluation|fines?|penalt\w*|impairment|profit on)\b/;

/** Balance-sheet detection. ALL of it runs before any P&L keyword rule. */
export const BS_RULES: Rule[] = [
  // Accumulated depreciation, also abbreviated: "Accum-Depreciation. F&F", "Accum. Depreciation-IT Equipment", "Acc. Dep".
  { re: /\b(accumulated|accum|acc) (dep|depn|depr|depreciation|amort|amortisation|amortization|impairment)\b|\baccum\b/, cat: 'balance_sheet' },
  // Prepayments, even when the name says fee, expense or insurance ("Prepaid License Fee", "Rent Prepaid Expenses").
  { re: /\bprepaid\b|\bprepayments?\b/, cat: 'balance_sheet' },
  // Loans and advances to or from anyone: related party, shareholder, director, staff, others.
  { re: /\bloans? (to|from)\b|\badvances? (to|from)\b/, cat: 'balance_sheet' },
  { re: /\bdue (from|to)\b|\bcurrent (a c|acct|accounts?)\b/, cat: 'balance_sheet' },
  { re: /\b(receivables?|payables?|debtors|creditors)\b/, cat: 'balance_sheet', not: /\b(written off|write offs?|bad debts?)\b/ },
  { re: /\b(accrued|outstanding|unpaid) (expenses?|charges|fees|salaries|rent|interest|liabilities)\b|\baccruals?\b/, cat: 'balance_sheet' },
  { re: /\bdeferred tax (assets?|liabilit(y|ies))\b|\b(corporate|income) tax (payable|provision|liability|receivable)\b|\bprovision for (corporate|income) tax\b/, cat: 'balance_sheet' },
  { re: /\bvat (control|payable|receivable|recoverable|account|input|output|clearing|refundable|suspense)\b|\b(input|output) (vat|tax)\b/, cat: 'balance_sheet' },
  { re: /\b(deferred|unearned) (income|revenue)\b|\badvances? from customers?\b/, cat: 'balance_sheet' },
  { re: /\b(retained (earnings|profits?)|share capital|paid up capital|capital account|statutory reserve|legal reserve|owners? equity|drawings account)\b/, cat: 'balance_sheet' },
  // Drawings are equity: never a connected-person payment, never counted towards the AED 500,000 disclosure.
  { re: /\bdrawings?\b|\bwithdrawals? by (the )?(owners?|partners?|proprietors?|shareholders?|directors?)\b/, cat: 'balance_sheet' },
  { re: /\b(revaluation|fair value|hedging|translation) reserves?\b/, cat: 'balance_sheet' },
  { re: /\bdeposits?\b/, cat: 'balance_sheet', not: /\b(interest|profit|income|gains?)\b/ },
  // Generic balance-sheet nouns, unless the name also has a P&L word.
  {
    re: /\b(bank|banks|cash|petty cash|advances?|capital|reserves?|retained|loans?|borrowings?|provisions?|inventor(y|ies)|stock in trade|land|buildings?|furniture|fixtures|fittings|f and f|office equipment|computer equipment|it equipment|plant|machinery|motor vehicles?|leasehold improvements?|right of use|work in progress|goodwill|intangible assets?|investments?|lease liabilit(y|ies)|equity|fixed assets?|property plant and equipment|suspense|clearing)\b/,
    cat: 'balance_sheet',
    not: PL_WORDS,
  },
];

/** A line above the first revenue line keeps its P&L category only if its name clearly says P&L. */
const PL_CLEAR =
  /\b(expenses?|charges?|costs?|income|salar(y|ies)|wages|fees?|depreciation|interest|profit on|finance costs?|purchases|rent|repairs?|maintenance|utilities|advertising|entertainment|fines?|penalt\w*|donations?|commissions?)\b/;

/** P&L keyword rules, in order. They run after BS_RULES. */
export const PL_RULES: Rule[] = [
  // Tax lines below profit before tax.
  { re: /\b(corporate|income|current|deferred) tax\b|\btax (expense|charge)\b/, cat: 'below_pbt' },

  { re: /\bunreali[sz]|\bfair value\b|\brevaluation\b/, cat: 'unrealised_gain_loss' },

  // Dividends.
  { re: /\bdividends? (paid|declared|distributed|to shareholders)\b/, cat: 'dividend_paid' },
  { re: /\bdividends?\b.*\b(foreign|overseas|abroad|international|non uae|outside uae)\b|\b(foreign|overseas) .*\bdividends?\b/, cat: 'dividend_received_foreign', side: 'credit' },
  { re: /\bdividends?\b/, cat: 'dividend_received_uae', side: 'credit' },
  { re: /\bdividends?\b/, cat: 'dividend_paid', side: 'debit' },

  // Interest.
  { re: /\binterest\b|\bfinance income\b|\bprofit on (deposits?|savings|fixed deposits?)\b/, cat: 'interest_income', side: 'credit' },
  { re: /\binterest\b|\bfinance (costs?|charges?)\b|\bmurabaha profit\b|\bborrowing costs?\b/, cat: 'interest_expense', side: 'debit' },

  { re: /\b(depreciation|amortisation|amortization)\b/, cat: 'depreciation' },

  // Fines vs contract damages: government penalties are fines; penalties to customers, suppliers or under contracts are damages.
  { re: /\b(fines?|penalt(y|ies)|violations?)\b/, also: GOVERNMENT, cat: 'fines', side: 'debit' },
  { re: /\bpenalt(y|ies)\b/, also: COMMERCIAL, cat: 'contract_damages', side: 'debit' },
  { re: CONTRACT_DAMAGES, cat: 'contract_damages', side: 'debit' },
  // A "fine" or "violation" is imposed by an authority.
  { re: /\bfines?\b|\bviolations?\b/, cat: 'fines', side: 'debit' },
  // Any other penalty could be either: a person decides, and nothing is added back until then.
  { re: /\bpenalt\w*/, cat: 'penalty_review', side: 'debit' },

  { re: /\b(non ?recoverable|irrecoverable|unrecoverable) (vat|input tax)\b|\bvat (expenses?|expensed|cost|written off)\b|\bvat on (entertainment|motor|cars?|vehicles?)\b/, cat: 'vat_expensed', side: 'debit' },

  // Donations are never approved automatically: 100% is added back until staff choose "Donation (approved charity)".
  { re: DONATION_WORDS, cat: 'donation_unlisted', side: 'debit' },

  // Entertainment: staff or client words in any order ("Entertainment - staff", "Entertainment (customer)").
  { re: /\bteam building\b|\bstaff welfare\b|\boffice (part(y|ies)|celebrations?|gatherings?)\b/, cat: 'entertainment_staff', side: 'debit' },
  { re: ENTERTAINMENT_WORDS, also: STAFF_WORDS, not: CLIENT_WORDS, cat: 'entertainment_staff', side: 'debit' },
  { re: ENTERTAINMENT_WORDS, also: CLIENT_WORDS, not: STAFF_WORDS, cat: 'entertainment_client', side: 'debit' },
  { re: /\bbusiness (entertainment|dinners?|lunch(es)?|meals?|gifts?|hospitality)\b/, cat: 'entertainment_client', side: 'debit' },
  // Gifts with no client or staff word, and entertainment that names both or neither: ask for the split.
  { re: /\b(entertainment|hospitality|meals?|gifts?|hampers?)\b/, cat: 'entertainment_unsplit', side: 'debit' },

  // Personal costs of an owner, director or family come BEFORE the connected-person rule.
  {
    re: /\b(school fees?|tuition|family (medical|travel|holidays?|trips?|expenses?)|holidays?|vacations?|home rent|house rent|household|personal)\b/,
    // Pay stays pay: "Director holiday allowance" is a connected-person payment, "holiday pay" is salary.
    not: /\b(holiday pay|leave (salary|pay)|annual leave|allowances?|salar(y|ies)|wages|bonus(es)?|remuneration)\b/,
    cat: 'personal',
    side: 'debit',
  },

  // Connected persons and related parties (pay only: salary, remuneration, fees, bonus, allowances).
  {
    re: /\b(owners?|directors?|shareholders?|partners?|proprietors?|chairman)\b.*\b(salary|salaries|remuneration|fees?|bonus(es)?|allowances?|compensation|wages|emoluments)\b|\b(salary|salaries|remuneration|fees?|bonus(es)?|allowances?)\b.*\b(owners?|directors?|shareholders?|partners?|proprietors?)\b/,
    cat: 'connected_person_payment',
    side: 'debit',
  },
  // Costs of earning exempt (investment) income come BEFORE the related-party rule, so
  // "Portfolio Management Fee" is AB-04, not a related-party management fee.
  {
    re: /\b(investment advisory|portfolio management|custody fees?|custodian fees?)\b|\bbrokerage (on|for) (shares|investments|securities)\b|\b(investments?|portfolio|shares?) .*\b(fees?|costs?|charges?|brokerage)\b/,
    cat: 'exempt_income_cost',
    side: 'debit',
  },
  {
    re: /\b(management (fees?|services?|charges?)|inter ?company|group recharges?|related part(y|ies)|head office (charges|recharges|allocation)|shared service charges?|service charges? from (the )?group|consultancy (fees? )?from (the )?group)\b/,
    cat: 'related_party_expense',
    side: 'debit',
  },

  { re: /\b(motor vehicles?|cars?|vehicles?|automobiles?) (running|expenses?|costs?|fuel|petrol|repairs?|maintenance)\b|\b(car|vehicle) running\b/, cat: 'mixed_use', side: 'debit' },
  { re: /\b(personal|private|family)\b/, cat: 'personal', side: 'debit' },
  { re: /\b(pensions?|gpssa|provident fund|retirement benefits?|social security)\b/, cat: 'pension', side: 'debit' },
  {
    re: /\b(capital (expenditure|items?|purchases?)|capex)\b|\b(equipment|machinery|machines?|furniture|computers?|laptops?|vehicles?|servers?|printers?) (purchased?|bought|acquired)\b/,
    cat: 'capital_expensed',
    side: 'debit',
  },
  { re: /\b(unsupported|no invoice|without invoice|unvouched)\b/, cat: 'no_invoice', side: 'debit' },

  // Revenue and income.
  { re: /\bcost of (sales|revenue|goods|services)\b|\bpurchases?\b|\bdirect costs?\b/, cat: 'normal_expense', side: 'debit' },
  { re: /\bsales (returns?|discounts?|allowances?)\b|\breturns inwards\b/, cat: 'revenue' },
  { re: /\b(revenue|revenues|sales|turnover|service income|contract income|consulting income|professional fees? income)\b/, cat: 'revenue', side: 'credit', not: /\bcommission\b/ },
  { re: /\b(other income|miscellaneous income|sundry income|gains?|income|refunds?|recover(y|ies)|write backs?|written back|reversals?|rental income|commission income)\b/, cat: 'other_income', side: 'credit' },

  // Normal expenses.
  {
    re: /\b(salar(y|ies)|wages|payroll|staff costs?|employee benefits?|end of service|gratuity|rent|rental|utilit(y|ies)|electricity|water|dewa|sewa|addc|telephone|mobile|internet|etisalat|insurance|audit|accounting|bookkeeping|legal|professional|consultancy|consulting|bank charges|printing|stationery|repairs?|maintenance|advertising|advertisement|marketing|promotion|freight|shipping|delivery|courier|postage|licen[cs]es?|visas?|immigration|travel|travell?ing|air ?fares?|hotels?|accommodation|cleaning|software|subscriptions?|commissions?|transport|training|recruitment|office (expenses|supplies)|general expenses|sundry expenses|miscellaneous expenses|bad debts?|write offs?|written off|exchange (loss|losses|difference)|fuel|petrol|salik|parking|uniforms?|medical|health|security|hosting|website|withholding tax|foreign tax|costs?|expenses?|charges?|fees?)\b/,
    cat: 'normal_expense',
    side: 'debit',
  },
];

export const NAME_RULES: Rule[] = [...BS_RULES, ...PL_RULES];

// ───────────────────────── Comment rules (ordered) ─────────────────────────

export const COMMENT_RULES: Rule[] = [
  { re: /\b(no invoice|invoice not available|no support|unsupported|without invoice|no receipts?|no supporting|missing invoice|not supported|no documents?)\b/, cat: 'no_invoice' },
  { re: /\b(fines?|penalt(y|ies)|violations?)\b/, also: GOVERNMENT, cat: 'fines' },
  { re: /\bpenalt(y|ies)\b/, also: COMMERCIAL, cat: 'contract_damages' },
  { re: CONTRACT_DAMAGES, cat: 'contract_damages' },
  { re: /\bfines?\b|\bviolations?\b/, cat: 'fines' },
  { re: /\bpenalt\w*/, cat: 'penalty_review' },
  { re: DONATION_WORDS, cat: 'donation_unlisted' },
  { re: /\bteam building\b|\bstaff welfare\b|\bemployee events?\b/, cat: 'entertainment_staff' },
  { re: /\blaunch party\b/, cat: 'entertainment_client' },
  { re: ENTERTAINMENT_WORDS, also: STAFF_WORDS, not: CLIENT_WORDS, cat: 'entertainment_staff' },
  { re: ENTERTAINMENT_WORDS, also: CLIENT_WORDS, not: STAFF_WORDS, cat: 'entertainment_client' },
  { re: /\b(entertainment|hospitality|meals?|gifts?|hampers?)\b/, cat: 'entertainment_unsplit' },
  // Shared use comes before "personal" and before "owner": a car the owner also uses is mixed use, not a payment to him.
  {
    re: /\b(private use|personal use|business and private|mixed use|partly private|used privately|also used( by)?|used by (the )?(owner|director|family|shareholder)s?|at (the )?weekends?)\b/,
    cat: 'mixed_use',
  },
  { re: /\b(personal|private|family|holidays?|vacations?|school fees)\b/, cat: 'personal' },
  { re: /\b(related party|intercompany|inter company|management fees?|group recharges?|sister company|group company)\b/, cat: 'related_party_expense' },
  {
    re: /\b(owners?|directors?|shareholders?|partners?|proprietors?|brothers?|sisters?|wife|husband|spouse|sons?|daughters?|father|mother|relatives?|cousins?)\b/,
    cat: 'connected_person_payment',
  },
  { re: /\b(capital items?|capitali[sz]e[ds]?|fixed assets?|asset purchases?|capex)\b/, cat: 'capital_expensed' },
  { re: /\b(non ?recoverable vat|irrecoverable vat|vat (expensed|not claimed|not recovered|included))\b/, cat: 'vat_expensed' },
  { re: /\b(exempt income|for (the )?investments?|relates? to dividends?|dividend related|share investments?)\b/, cat: 'exempt_income_cost' },
  { re: /\bunreali[sz]|\bfair value\b|\brevaluation\b/, cat: 'unrealised_gain_loss' },
];

/** Categories a comment may NOT override (the line is not a P&L expense). */
const COMMENT_PROTECTED: Category[] = ['balance_sheet', 'below_pbt'];

function sideOf(balance: number): 'debit' | 'credit' {
  return balance >= 0 ? 'debit' : 'credit';
}

function matchRule(rules: Rule[], text: string, side: 'debit' | 'credit'): { rule: Rule; word: string } | undefined {
  for (const rule of rules) {
    if (rule.side && rule.side !== side) continue;
    const m = rule.re.exec(text);
    if (!m) continue;
    if (rule.not && rule.not.test(text)) continue;
    if (rule.also && !rule.also.test(text)) continue;
    return { rule, word: m[0] };
  }
  return undefined;
}

/** Account-name rule only (used for related-party and position decisions). */
export function categoryFromName(account: string, balance: number): { cat: Category; word: string } | undefined {
  const t = norm(account);
  // Interest, finance costs, "profit on" and charges are P&L, even when the name also says "loan".
  const rules = NEVER_BS.test(t) && !BS_ONLY.test(t) ? PL_RULES : NAME_RULES;
  const hit = matchRule(rules, t, sideOf(balance));
  return hit ? { cat: hit.rule.cat, word: hit.word } : undefined;
}

const ROLE_RE = /\b(owners?|directors?|shareholders?|partners?|proprietors?|chairman|sister compan(y|ies)|group compan(y|ies)|related part(y|ies))\b/;

/** The connected person or related company an account name refers to ("Interest on loan from director" → Director). */
export function roleOf(account: string): { name: string; type: 'person' | 'company' } | undefined {
  const m = ROLE_RE.exec(norm(account));
  if (!m) return undefined;
  const w = m[1];
  if (/^sister/.test(w)) return { name: 'Sister company', type: 'company' };
  if (/^group/.test(w)) return { name: 'Group company', type: 'company' };
  if (/^related/.test(w)) return { name: 'Related party', type: 'company' };
  const singular = w.replace(/s$/, '');
  return { name: singular.charAt(0).toUpperCase() + singular.slice(1), type: 'person' };
}

/** Income categories a connected-person credit line keeps (they have their own tax treatment). */
const KEEP_INCOME: Category[] = ['revenue', 'interest_income', 'dividend_received_uae', 'dividend_received_foreign', 'unrealised_gain_loss'];
/** Debit categories a related-party match keeps instead of becoming a payment to that party. */
const KEEP_WITH_PARTY: Category[] = ['balance_sheet', 'interest_expense', 'personal'];

function relatedPartyMatch(account: string, parties: RelatedParty[]): RelatedParty | undefined {
  const text = ` ${norm(account)} `;
  for (const p of parties) {
    const n = norm(p.name);
    if (n.length < 3) continue;
    if (text.includes(` ${n} `)) return p;
  }
  return undefined;
}

export interface ClassifyOptions {
  /** Saved mappings by line key. Always win. */
  mappings?: Record<string, Category>;
  relatedParties?: RelatedParty[];
}

export function classifyLine(line: TBLine, opts: ClassifyOptions = {}): ClassifiedLine {
  // 1. Saved mapping (always wins; nothing below changes it).
  const saved = opts.mappings?.[line.key];
  if (saved) return { ...line, category: saved, evidence: 'saved', reason: 'Saved mapping for this client.' };

  const rp = opts.relatedParties?.length ? relatedPartyMatch(line.account, opts.relatedParties) : undefined;
  return adjust(baseCategory(line, rp), rp);
}

/** Steps 2–4 and 6 of the order of evidence. */
function baseCategory(line: TBLine, rp: RelatedParty | undefined): ClassifiedLine {
  const side = sideOf(line.balance);
  const fromName = categoryFromName(line.account, line.balance);

  // 2. Related party.
  if (rp) {
    const tag = { relatedParty: rp.name, relatedPartyType: rp.type };
    if (fromName?.cat === 'balance_sheet') {
      return { ...line, ...tag, category: 'balance_sheet', evidence: 'related_party', reason: `Balance with related party "${rp.name}" (${rp.relationship || rp.type}).` };
    }
    if (side === 'debit') {
      if (fromName && KEEP_WITH_PARTY.includes(fromName.cat)) {
        return { ...line, ...tag, category: fromName.cat, evidence: 'related_party', reason: `Account name contains "${fromName.word}"; it relates to "${rp.name}" (${rp.relationship || rp.type}).` };
      }
      const cat: Category = rp.type === 'person' ? 'connected_person_payment' : 'related_party_expense';
      return { ...line, ...tag, category: cat, evidence: 'related_party', reason: `Account name matches related party "${rp.name}" (${rp.relationship || rp.type}).` };
    }
    return { ...line, ...tag, category: fromName?.cat ?? 'other_income', evidence: 'related_party', reason: `Income from related party "${rp.name}".` };
  }

  // 3. Comment rules.
  const comment = norm(line.comment);
  if (comment && !(fromName && COMMENT_PROTECTED.includes(fromName.cat))) {
    // Comment rules describe expenses, so they only apply to debit lines (unrealised items can be either side).
    const rules = side === 'debit' ? COMMENT_RULES : COMMENT_RULES.filter((r) => r.cat === 'unrealised_gain_loss');
    const hit = matchRule(rules, comment, side);
    if (hit) {
      return { ...line, category: hit.rule.cat, evidence: 'comment', reason: `Comment says "${hit.word}".` };
    }
  }

  // 4. Account-name keywords.
  if (fromName) {
    return { ...line, category: fromName.cat, evidence: 'keyword', reason: `Account name contains "${fromName.word}".` };
  }

  // 6. Default (5 is applied across the whole list in classifyLines).
  if (side === 'credit') {
    return { ...line, category: 'other_income', evidence: 'default', reason: 'No rule matched. Credit balance treated as other income. Please check.' };
  }
  return { ...line, category: 'normal_expense', evidence: 'default', reason: 'No rule matched. Debit balance treated as a normal expense. Please check.' };
}

/** Adjustments that depend on the whole line (name and comment), applied after the base category. */
function adjust(c: ClassifiedLine, rp: RelatedParty | undefined): ClassifiedLine {
  const name = norm(c.account);
  const comment = norm(c.comment);

  // A donation is never approved automatically, even when the name or comment says so: staff check the
  // recipient against the approved list and choose "Donation (approved charity)" themselves.
  if (c.category === 'donation_unlisted' && APPROVED.test(`${name} ${comment}`) && !NOT_APPROVED.test(`${name} ${comment}`)) {
    return {
      ...c,
      reason: `${c.reason} It says "approved": if the recipient is a Qualifying Public Benefit Entity, choose "Donation (approved charity)".`,
    };
  }

  const role = rp ? { name: rp.name, type: rp.type } : roleOf(c.account);
  if (!role || c.category === 'balance_sheet' || c.category === 'below_pbt') return c;

  // Income from a shareholder, director, owner, partner, sister company or listed related party.
  if (c.balance < 0) {
    const category = KEEP_INCOME.includes(c.category) ? c.category : 'other_income';
    return {
      ...c,
      category,
      relatedParty: role.name,
      relatedPartyType: role.type,
      evidence: 'related_party',
      reason: `Income from a connected person (${role.name}). Confirm it is at market value.`,
    };
  }

  // Interest paid to a director, owner or shareholder counts towards that person's AED 500,000 disclosure.
  // Interest to a sister or group company is tagged too, for the Art. 31 question (it never counts towards the AED 500,000).
  if (c.category === 'interest_expense' && !c.relatedParty) {
    const who = role.type === 'person' ? 'a connected person' : 'a related company';
    return { ...c, relatedParty: role.name, relatedPartyType: role.type, reason: `${c.reason} Paid to ${who} (${role.name}).` };
  }
  return c;
}

export function classifyLines(lines: TBLine[], opts: ClassifyOptions = {}): ClassifiedLine[] {
  const out = lines.map((l) => classifyLine(l, opts));
  // 5. Position: in a standard TB the balance sheet comes first, then revenue. Every line above the
  //    first revenue line is balance sheet unless its name clearly says P&L. This overrides keyword,
  //    comment and related-party matches (not saved mappings). Lines below revenue are never moved.
  const firstRevenue = out.findIndex((l) => l.category === 'revenue' && l.evidence !== 'default');
  if (firstRevenue > 0) {
    // "Standard" = most recognised lines above revenue are balance-sheet accounts (protects P&L-first layouts).
    const known = out.slice(0, firstRevenue).filter((l) => l.evidence !== 'default');
    const bsShare = known.length ? known.filter((l) => l.category === 'balance_sheet').length / known.length : 1;
    if (bsShare >= 0.5) {
      for (let i = 0; i < firstRevenue; i++) {
        const l = out[i];
        if (l.category === 'balance_sheet' || l.evidence === 'saved' || PL_CLEAR.test(norm(l.account))) continue;
        out[i] = { ...l, category: 'balance_sheet', evidence: 'position', reason: 'Above the first revenue line in a balance-sheet-first trial balance, so treated as a balance-sheet account.' };
      }
    }
  }
  return out;
}

// ───────────────────────── Hidden VAT ─────────────────────────

/**
 * In a TB with an adjustments column: if the VAT control account is credited and an
 * expense account is debited by the same amount, the expense line probably contains
 * VAT that was expensed. Returns sub-lines to tag that VAT.
 */
export function detectHiddenVat(lines: ClassifiedLine[]): SubLine[] {
  const out: SubLine[] = [];
  const used = new Set<string>();
  const vatLines = lines.filter((l) => l.category === 'balance_sheet' && /\bvat\b/.test(norm(l.account)) && (l.adjCredit ?? 0) > 0);
  for (const v of vatLines) {
    const amount = v.adjCredit ?? 0;
    const target = lines.find(
      (l) =>
        !used.has(l.key) &&
        l.key !== v.key &&
        !['balance_sheet', 'below_pbt', 'vat_expensed', ...['revenue', 'other_income']].includes(l.category) &&
        Math.abs((l.adjDebit ?? 0) - amount) < 0.01,
    );
    if (!target) continue;
    used.add(target.key);
    out.push({
      key: `${target.key}::hidden-vat`,
      parentKey: target.key,
      category: 'vat_expensed',
      amount,
      label: `VAT expensed inside ${target.account}`,
      source: 'hidden_vat',
      evidence: [
        `Adjustments column: ${v.account} (row ${v.row}) credited ${aed(amount)}`,
        `${target.account} (row ${target.row}) debited ${aed(amount)}`,
      ],
    });
  }
  return out;
}

// ───────────────────────── Questions still open ─────────────────────────

/**
 * Plain-English questions a person still has to answer for this line. Empty = nothing open.
 * `relatedParty` is set for lines paid to a related party (used for the Art. 31 interest question).
 */
export function openQuestions(category: Category, answer: LineAnswer | undefined, evidence?: string, relatedParty?: string): string[] {
  const a = answer ?? {};
  const q: string[] = [];
  switch (category) {
    case 'penalty_review':
      if (!a.penaltyType || a.penaltyType === 'unknown') q.push('Was this penalty imposed by a government body (a fine) or under a contract?');
      break;
    case 'no_invoice':
      if (!a.supportEvidence || a.supportEvidence === 'unknown') q.push('Is there an invoice or other supporting evidence for this expense?');
      break;
    case 'interest_expense':
      if (relatedParty && (!a.art31Use || a.art31Use === 'unknown')) q.push('Was this related-party loan used for a dividend, a share buyback or a capital contribution?');
      break;
    case 'entertainment_unsplit':
      if (a.clientAmount === undefined) q.push('How much of this was for clients (not staff)?');
      break;
    case 'pension':
      if (a.confirmedAmount === undefined) q.push('What amount does the tax team confirm must be added back? (0 if none)');
      break;
    case 'vat_expensed':
      if (!a.vatRecoverable || a.vatRecoverable === 'unknown') q.push('Could this VAT have been recovered on the VAT return?');
      break;
    case 'related_party_expense':
      if (a.marketValue === undefined) q.push('What is the market value of this service? (needs transfer pricing support)');
      break;
    case 'connected_person_payment':
      // Business purpose defaults to "yes", so only the market value is an open question.
      if (a.marketValue === undefined) q.push('What is the market value of this payment?');
      break;
    case 'mixed_use':
      if (a.privateUse === undefined) q.push('What share is private use?');
      break;
    case 'capital_expensed':
      if (a.taxDepreciation === undefined) q.push('What tax depreciation is allowed this period?');
      break;
    case 'dividend_received_foreign': {
      const p = a.participation ?? {};
      if ((p.ownership === undefined && p.acquisitionCost === undefined) || p.investeeTaxRate === undefined || p.nonQualifyingAssets === undefined || (p.monthsHeld === undefined && p.intendsToHold12 === undefined)) {
        q.push('Answer the participation exemption tests.');
      }
      break;
    }
    default:
      break;
  }
  if (evidence === 'default' && !['balance_sheet', 'below_pbt'].includes(category)) q.push('No rule matched. Is this category right?');
  return q;
}

export function categoryLabel(c: Category): string {
  return CATEGORY_MAP[c]?.label ?? c;
}
