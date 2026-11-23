/** Shared types for the engine and the UI. No React or DOM types here. */

// ───────────────────────── Flags ─────────────────────────

export type Level = 'HIGH' | 'MEDIUM' | 'INFO' | 'DATA' | 'PASS';

/** Display order for flags (most serious first). */
export const LEVEL_ORDER: Level[] = ['HIGH', 'MEDIUM', 'DATA', 'INFO', 'PASS'];

export interface Flag {
  /** Rule ID, e.g. "AB-06", "RV-04", "SBR", "DATA". */
  id: string;
  /** Stable key used to remember "Resolved" across recalculations, e.g. "AB-06:office-fines". */
  key: string;
  level: Level;
  message: string;
  amount?: number;
  action: string;
  /** Where it came from, e.g. "TB row 23" or "P&L!C30". */
  source?: string;
}

export interface Resolution {
  note: string;
  at: string;
}

// ───────────────────────── Source references ─────────────────────────

export interface CellRef {
  sheet: string;
  cell: string;
  file?: string;
}

export function refText(ref?: CellRef): string {
  if (!ref) return '';
  // Quote names with spaces or quotes ('Balance sheet'!C1); keep short names like P&L!C30 readable.
  // A PDF: "page 1, line 4".
  if (/^line \d+$/.test(ref.cell)) return `${ref.sheet}, ${ref.cell}`;
  const sheet = /[\s'!]/.test(ref.sheet) ? `'${ref.sheet.replace(/'/g, "''")}'` : ref.sheet;
  return `${sheet}!${ref.cell}`;
}

// ───────────────────────── Categories ─────────────────────────

export type Category =
  | 'balance_sheet'
  | 'revenue'
  | 'other_income'
  | 'normal_expense'
  | 'depreciation'
  | 'entertainment_client'
  | 'entertainment_staff'
  | 'entertainment_unsplit'
  | 'pension'
  | 'donation_listed'
  | 'donation_unlisted'
  | 'exempt_income_cost'
  | 'dividend_paid'
  | 'dividend_received_uae'
  | 'dividend_received_foreign'
  | 'fines'
  | 'penalty_review'
  | 'contract_damages'
  | 'vat_expensed'
  | 'related_party_expense'
  | 'connected_person_payment'
  | 'personal'
  | 'mixed_use'
  | 'capital_expensed'
  | 'interest_expense'
  | 'interest_income'
  | 'no_invoice'
  | 'unrealised_gain_loss'
  | 'below_pbt';

export interface CategoryInfo {
  id: Category;
  label: string;
  /** Rule ID shown on chips, e.g. "AB-01" or "Step 3". */
  rule: string;
  treatment: string;
  /** True when a person must answer a question before the treatment is final. */
  asks: boolean;
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'balance_sheet', label: 'Balance sheet', rule: '—', treatment: 'Not in the tax sum. Checked by RV-05.', asks: false },
  { id: 'revenue', label: 'Revenue', rule: '—', treatment: 'Taxable, already in profit.', asks: false },
  { id: 'other_income', label: 'Other income', rule: '—', treatment: 'Taxable, already in profit.', asks: false },
  { id: 'normal_expense', label: 'Normal expense', rule: '—', treatment: 'Allowed.', asks: false },
  { id: 'depreciation', label: 'Depreciation / amortisation', rule: '—', treatment: 'Allowed. Used for the interest limit.', asks: false },
  { id: 'entertainment_client', label: 'Client entertainment', rule: 'AB-01', treatment: 'Add back 50%.', asks: false },
  { id: 'entertainment_staff', label: 'Staff entertainment', rule: 'AB-01', treatment: 'Allowed.', asks: false },
  { id: 'entertainment_unsplit', label: 'Entertainment (not split)', rule: 'AB-01', treatment: 'Ask the client share. Add back 50% of it.', asks: true },
  { id: 'pension', label: 'Pension', rule: 'AB-02', treatment: 'Add back only the amount the tax team confirms.', asks: true },
  { id: 'donation_listed', label: 'Donation (approved charity)', rule: 'AB-03', treatment: 'Allowed.', asks: false },
  { id: 'donation_unlisted', label: 'Donation (not approved)', rule: 'AB-03', treatment: 'Add back 100%.', asks: false },
  { id: 'exempt_income_cost', label: 'Cost of exempt income', rule: 'AB-04', treatment: 'Add back 100%.', asks: false },
  { id: 'dividend_paid', label: 'Dividend paid', rule: 'AB-05A', treatment: 'Add back 100%.', asks: false },
  { id: 'dividend_received_uae', label: 'Dividend received (UAE)', rule: 'Step 3', treatment: 'Exempt. Deduct.', asks: false },
  { id: 'dividend_received_foreign', label: 'Dividend received (foreign)', rule: 'AB-05B', treatment: 'Exempt only if the participation tests pass.', asks: true },
  { id: 'fines', label: 'Fines and penalties (government)', rule: 'AB-06', treatment: 'Add back 100%.', asks: false },
  {
    id: 'penalty_review',
    label: 'Penalty (needs review)',
    rule: 'AB-06',
    treatment: 'Ask: government fine or contract penalty? Nothing is added back until a person decides.',
    asks: true,
  },
  { id: 'contract_damages', label: 'Contract damages', rule: 'AB-06', treatment: 'Allowed.', asks: false },
  { id: 'vat_expensed', label: 'VAT expensed', rule: 'AB-07', treatment: 'Ask if recoverable. Yes = add back.', asks: true },
  { id: 'related_party_expense', label: 'Related-party expense', rule: 'AB-08', treatment: 'Add back the amount above market value.', asks: true },
  { id: 'connected_person_payment', label: 'Connected-person payment', rule: 'AB-09', treatment: 'Ask market value and business purpose.', asks: true },
  { id: 'personal', label: 'Personal expense', rule: 'AB-11', treatment: 'Add back 100%.', asks: false },
  { id: 'mixed_use', label: 'Mixed use (business + private)', rule: 'AB-11', treatment: 'Add back the private share.', asks: true },
  { id: 'capital_expensed', label: 'Capital item expensed', rule: 'AB-12', treatment: 'Add back 100%. Deduct tax depreciation.', asks: true },
  { id: 'interest_expense', label: 'Interest expense', rule: 'AB-13', treatment: 'Checked against the interest limit.', asks: false },
  { id: 'interest_income', label: 'Interest income', rule: 'AB-13', treatment: 'Netted against interest expense.', asks: false },
  { id: 'no_invoice', label: 'No invoice / no support', rule: 'AB-14', treatment: 'Ask if support exists. Added back only when staff answer "No evidence".', asks: true },
  { id: 'unrealised_gain_loss', label: 'Unrealised gain or loss', rule: 'Step 3', treatment: 'Adjusted only if the realisation election is made.', asks: false },
  { id: 'below_pbt', label: 'Tax line (below PBT)', rule: '—', treatment: 'Ignored.', asks: false },
];

export const CATEGORY_MAP: Record<Category, CategoryInfo> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<Category, CategoryInfo>;

/** Categories that are income by nature (credit balance is normal). */
export const INCOME_CATEGORIES: Category[] = [
  'revenue',
  'other_income',
  'dividend_received_uae',
  'dividend_received_foreign',
  'interest_income',
];

// ───────────────────────── Parsed data ─────────────────────────

export interface FormulaError {
  sheet: string;
  cell: string;
  error: string;
  file?: string;
}

export interface FoundNumber {
  value: number;
  ref: CellRef;
  label: string;
  /** The next number to the right (normally the prior-year column). */
  prior?: number;
  priorRef?: CellRef;
}

export interface TemplateText {
  topic: 'sbr' | 'qfzp';
  text: string;
  ref: CellRef;
}

export interface FsData {
  pbt?: FoundNumber;
  revenue?: FoundNumber;
  /** Revenue was shown as a negative number; `revenue` holds its absolute value. */
  revenueWasNegative?: boolean;
  /** Suggested tax loss brought forward (to confirm). */
  lossSuggestion?: FoundNumber;
  totalAssets?: FoundNumber;
  totalEquityLiabilities?: FoundNumber;
  /** True when a sheet contains "Independent Auditor's Report". */
  auditedText: boolean;
  templateTexts: TemplateText[];
  /** Signs of foreign income or a foreign branch in the text. */
  foreignText?: CellRef;
  /** Other comprehensive income items found. */
  ociText?: CellRef;
}

/** One fact found in a file for the Company profile, with where it was found. */
export interface Hint<T> {
  value: T;
  ref?: CellRef;
  /** The text that matched, e.g. "for the year ended 31 December 2025". */
  text: string;
  /** How the value was worked out from the text, when it is not read directly. */
  why?: string;
}

/** Profile facts found in one file (see autofill.ts). */
export interface ProfileHints {
  clientName?: Hint<string>;
  trn?: Hint<string>;
  periodStart?: Hint<string>;
  periodEnd?: Hint<string>;
  accountingStandard?: Hint<'IFRS' | 'IFRS for SMEs'>;
  legalForm?: Hint<LegalForm>;
  audited?: Hint<true>;
  /** Text about a change of ownership, or a shareholder table that differs between years. */
  ownershipChange?: Hint<true>;
  /** A branch, permanent establishment, withholding or foreign tax, or income naming a foreign country. */
  foreign?: Hint<true>;
  /** An unrealised, fair value, revaluation or OCI item (so the realisation election matters). */
  realisation?: Hint<true>;
}

export interface TBLine {
  /** Stable key: normalised account name (made unique with the row when names repeat). */
  key: string;
  /** 1-based row in the source sheet. */
  row: number;
  sheet: string;
  file?: string;
  account: string;
  debit: number;
  credit: number;
  /** debit − credit (positive = debit balance). */
  balance: number;
  comment: string;
  /** Values in an "Adjustments" debit/credit pair, when the TB has one. */
  adjDebit?: number;
  adjCredit?: number;
}

export type Evidence = 'saved' | 'related_party' | 'comment' | 'keyword' | 'position' | 'default';

export const EVIDENCE_LABELS: Record<Evidence, string> = {
  saved: 'Saved mapping',
  related_party: 'Related party',
  comment: 'Comment',
  keyword: 'Account name',
  position: 'Position',
  default: 'Default (no rule matched)',
};

export interface ClassifiedLine extends TBLine {
  category: Category;
  reason: string;
  evidence: Evidence;
  /** Matched related party name, when the account name contains one. */
  relatedParty?: string;
  relatedPartyType?: 'company' | 'person';
}

export interface TbData {
  sheet: string;
  headerRow: number;
  nameCol: number;
  debitCol: number;
  creditCol: number;
  commentCol?: number;
  pairLabels: string[];
  hasAdjustments: boolean;
  /** True when the TB has one signed balance column instead of Debit/Credit. */
  singleColumn?: boolean;
  lines: TBLine[];
  totalDebit: number;
  totalCredit: number;
}

export interface GlTxn {
  row: number;
  date?: string;
  account: string;
  description: string;
  debit: number;
  credit: number;
  /** debit − credit */
  amount: number;
}

export interface VatReturnRow {
  row: number;
  period: string;
  standardRated: number;
  zeroRated: number;
  exempt: number;
  inputTax: number;
}

export interface RelatedParty {
  name: string;
  type: 'company' | 'person';
  relationship: string;
  /** The owner or director this person or company belongs to (for grouping). */
  connectedTo?: string;
}

export type FileKind = 'fs' | 'tb' | 'fs_tb' | 'gl' | 'vat' | 'rp' | 'sales' | 'purchases' | 'imports' | 'vatdata' | 'doc' | 'unknown' | 'ignore';

export const FILE_KIND_LABELS: Record<FileKind, string> = {
  fs: 'Financial statements',
  tb: 'Trial balance',
  fs_tb: 'Financial statements + trial balance',
  gl: 'General ledger',
  vat: 'VAT returns',
  rp: 'Related parties list',
  sales: 'Sales invoices',
  purchases: 'Purchase invoices / receipts',
  imports: 'Imports (reverse charge / customs)',
  vatdata: 'VAT',
  doc: 'Supporting document',
  unknown: 'Not recognised',
  ignore: 'Ignore this file',
};

/** What one sheet of a workbook was read as. */
export type SheetRole = 'fs' | 'tb' | 'gl' | 'vat' | 'rp' | 'sales' | 'purchases' | 'imports' | 'answers' | 'other';

export const SHEET_ROLE_LABELS: Record<SheetRole, string> = {
  fs: 'financial statements',
  tb: 'trial balance',
  gl: 'general ledger',
  vat: 'VAT returns',
  rp: 'related parties',
  sales: 'sales invoices',
  purchases: 'purchase invoices',
  imports: 'imports',
  answers: 'not read (answer key)',
  other: 'notes (text only)',
};

export interface SheetInfo {
  name: string;
  role: SheetRole;
}

/** One line of a sales or purchase register (invoice list). */
export interface InvoiceLine {
  /** Stable key: "<sheet>!<row>". */
  key: string;
  sheet: string;
  /** 1-based row in the sheet. */
  row: number;
  file?: string;
  number: string;
  date?: string;
  /** Customer (sales) or supplier (purchases). */
  party: string;
  /** The party's TRN, when the register has a TRN column. */
  trn?: string;
  /** True when the register has a TRN column at all. */
  trnColumn: boolean;
  description: string;
  /** "Business purpose" or "Category" column, when there is one. */
  category?: string;
  net: number;
  /** Rate as given (0.05, 0), when the register has a rate column. */
  rate?: number;
  vat: number;
  gross?: number;
  /** "Input VAT status" text (purchases), when there is one. */
  status?: string;
  /** Emirate or place of supply (sales), for the VAT return boxes 1a–1g. */
  emirate?: string;
  /** "Supply type" / "VAT treatment" text, e.g. Standard rated, Zero rated, Exempt, Credit note. */
  supplyType?: string;
  /** Imports only: imported services (reverse charge, Box 3) or goods through customs (Box 6). */
  importType?: 'services' | 'goods';
  /** Imports only: customs declaration number. */
  customsNo?: string;
}

export type InputVatTreatment = 'recoverable' | 'blocked' | 'held' | 'na';

export const INPUT_VAT_LABELS: Record<InputVatTreatment, string> = {
  recoverable: 'Recoverable',
  blocked: 'Blocked',
  held: 'Held: no valid tax invoice',
  na: 'Not applicable',
};

/** A person's choice for one purchase line. */
export interface VatChoice {
  treatment?: InputVatTreatment;
  /** Duplicates: true = count this line even though it repeats an earlier one; false = leave it out. */
  include?: boolean;
  reason?: string;
}

export interface ParsedFile {
  id: string;
  name: string;
  size: number;
  detected: FileKind;
  /** The type in use (the user can change it). */
  kind: FileKind;
  fs?: FsData;
  tb?: TbData;
  gl?: GlTxn[];
  vat?: VatReturnRow[];
  rp?: RelatedParty[];
  /** Sales register lines (all sales-invoice sheets). */
  sales?: InvoiceLine[];
  /** Purchase register lines (all purchase-invoice or receipt sheets). */
  purchases?: InvoiceLine[];
  /** Imports of services (reverse charge) and goods (customs). */
  imports?: InvoiceLine[];
  /** What each sheet was read as (answer-key sheets are listed but never read). */
  sheets?: SheetInfo[];
  /** The currency named in the file (titles, headers, amounts), and where. */
  currency?: { code: string; ref: string };
  /** Company profile facts found in the statements or trial balance. */
  hints?: ProfileHints;
  /** Profile answers found in this file, each with its source (see evidence.ts). */
  evidence?: import('./evidence').Evidence[];
  errors: FormulaError[];
  warnings: string[];
}

// ───────────────────────── Inputs to the computation ─────────────────────────

export type LegalForm = 'mainland' | 'free_zone' | 'qfzp' | 'tax_group';

/** Banks, insurance providers and natural persons are outside the interest limit (Art. 30). Unset = ordinary business. */
export type BusinessType = 'ordinary' | 'bank' | 'insurance' | 'natural_person';

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  ordinary: 'Ordinary business',
  bank: 'Bank',
  insurance: 'Insurance provider',
  natural_person: 'Natural person',
};

export interface QfzpInputs {
  qualifyingIncome?: number;
  nonQualifyingRevenue?: number;
  qualifyingActivity?: boolean;
  substance?: boolean;
  auditedFS?: boolean;
  tpCompliance?: boolean;
  /** True = the company has NOT elected to be taxed at the standard rate. */
  noElection?: boolean;
}

export interface Profile {
  legalForm?: LegalForm;
  periodStart?: string;
  periodEnd?: string;
  accountingStandard?: 'IFRS' | 'IFRS for SMEs' | 'Other';
  audited?: boolean;
  groupRevenue?: number;
  vatRevenue?: number;
  vatDifferenceNote?: string;
  electSBR?: boolean;
  /** 'na' = not relevant: there are no unrealised items to elect over. */
  electRealisation?: boolean | 'na';
  electForeignPE?: boolean;
  /** Every earlier period had revenue of AED 3m or less (or this is the first period). */
  priorPeriodsUnder3M?: boolean;
  hasForeignIncome?: boolean;
  hasTaxCertificates?: boolean;
  ownershipChange?: boolean;
  /** What to do with losses after an ownership change. Unset = cautious mode decides. */
  ownershipChangeLosses?: 'use' | 'exclude';
  /** Decides whether the 30% EBITDA interest limit applies. Unset = ordinary business (the limit applies). */
  businessType?: BusinessType;
  /**
   * End of an EARLIER period in which QFZP status was lost (filled when the client is duplicated
   * to the next year, or typed by staff). The standard rate applies to that period and the next 4.
   */
  qfzpLostPeriodEnd?: string;
  qfzp: QfzpInputs;
}

export interface ParticipationAnswers {
  /** 0–1 */
  ownership?: number;
  acquisitionCost?: number;
  monthsHeld?: number;
  intendsToHold12?: boolean;
  /** 0–1. Unknown = fail. */
  investeeTaxRate?: number;
  /** 0–1 */
  nonQualifyingAssets?: number;
  investeeDeducts?: boolean;
  deductibleImpairment?: boolean;
  liquidationLoss?: boolean;
  restructuringWithin2Years?: boolean;
  /** Ownership fell below 5% before 12 months: claw back earlier exempt income. */
  fellBelowBefore12?: boolean;
  clawbackAmount?: number;
}

export type Tri = 'yes' | 'no' | 'unknown';

/** Answers a person gives for one line (TB line or sub-line), keyed by line key. */
export interface LineAnswer {
  /** entertainment_unsplit: the client part of the amount. */
  clientAmount?: number;
  /** pension: amount the tax team confirms must be added back. */
  confirmedAmount?: number;
  /** vat_expensed: could this VAT have been recovered? */
  vatRecoverable?: Tri;
  /** related_party_expense / connected_person_payment: market value of the same service. */
  marketValue?: number;
  /** connected_person_payment: was the payment for the business? */
  businessPurpose?: Tri;
  /** connected_person_payment: the person paid (for grouping with relatives). */
  personName?: string;
  /** mixed_use: private-use share, 0–1. */
  privateUse?: number;
  /** capital_expensed: tax depreciation allowed this period. */
  taxDepreciation?: number;
  participation?: ParticipationAnswers;
  /** penalty_review: who imposed the penalty. Government = fine (added back); contract = allowed. */
  penaltyType?: 'government' | 'contract' | 'unknown';
  /** no_invoice: has supporting evidence been found? Only "none" adds the line back. */
  supportEvidence?: 'found' | 'none' | 'unknown';
  /** interest_expense on a related-party loan: was the loan used for a dividend, share buyback or capital contribution (Art. 31)? */
  art31Use?: Tri;
  /** Income lines: include in total revenue for the SBR and QFZP de minimis tests. Unset = the default for its group. */
  revenueTest?: boolean;
  /** Why the line was included or left out of total revenue, when that differs from the default. */
  revenueTestReason?: string;
  note?: string;
}

export interface TaxLine {
  key: string;
  account: string;
  category: Category;
  /** debit − credit. Expenses are positive, income is negative. */
  balance: number;
  /** e.g. "TB row 23". */
  source?: string;
  /** Set for sub-lines carved out of a parent line. */
  parentKey?: string;
  relatedParty?: string;
  relatedPartyType?: 'company' | 'person';
}

export interface LossRow {
  /** Start date of the period that made the loss (YYYY-MM-DD). */
  periodStart: string;
  amount: number;
  source?: string;
}

export interface InterestRow {
  /** Year the interest was disallowed (period-end year). */
  year: number;
  amount: number;
}

export interface ComputeInput {
  pbt: number;
  /** Revenue from the statements. Defaults to the sum of revenue lines. */
  revenue?: number;
  /** Override for the AB-04 denominator. Defaults to revenue + other income + exempt income. */
  totalIncome?: number;
  sharedOverheads?: number;
  otherDeductions?: number;
  lines: TaxLine[];
  answers?: Record<string, LineAnswer>;
  lossesBF?: LossRow[];
  interestCF?: InterestRow[];
  /** Foreign tax credit (Art. 47): one row per country or source of foreign income. */
  foreignTax?: ForeignTaxRow[];
  profile?: Partial<Profile>;
  /** Default true: unanswered questions take the less favourable treatment. */
  cautious?: boolean;
  /** Who is registering (Deadlines). A non-resident cannot use Small Business Relief. Default: resident company. */
  registrantType?: RegistrantType;
}

/** One country or source of foreign income. The credit is capped separately for each row. */
export interface ForeignTaxRow {
  /** Country or source, e.g. "Saudi Arabia – branch profit". */
  country?: string;
  /** Net foreign income (after its own costs) that is included in taxable income. */
  income?: number;
  /** Foreign tax paid on that income. */
  taxPaid?: number;
}

// ───────────────────────── Results ─────────────────────────

export interface AddBack {
  ruleId: string;
  label: string;
  account: string;
  lineKey?: string;
  source?: string;
  amount: number;
  /** How the amount was worked out, e.g. "50% of 12,000". */
  basis: string;
  /** The answer that drove the amount, if any. */
  answer?: string;
}

export interface Deduction {
  ruleId: string;
  label: string;
  account?: string;
  lineKey?: string;
  source?: string;
  amount: number;
  basis?: string;
}

export interface InterestResult {
  /** True when the interest limit does not apply (banks, insurance providers, natural persons). */
  exempt: boolean;
  /** Interest on related-party loans added back under Art. 31 (left out of the net interest below). */
  art31: number;
  expense: number;
  income: number;
  net: number;
  adjustedEbitda: number;
  limit: number;
  excess: number;
  carriedForwardIn: number;
  expired: number;
  used: number;
  carriedForwardOut: InterestRow[];
  totalCarriedForward: number;
}

export interface LossResult {
  broughtForward: number;
  rejected: LossRow[];
  /** Rows with no period start date: not used until the period is entered. */
  undated: LossRow[];
  excludedForOwnership: number;
  cap: number;
  used: number;
  carriedForward: number;
}

export interface SbrResult {
  elected: boolean;
  /** No known reason to refuse SBR. */
  eligible: boolean;
  /** Questions that must be answered before SBR is applied (earlier periods, group revenue). */
  unconfirmed: string[];
  applied: boolean;
  failed: string[];
  /** The revenue figure the test used (total revenue for SBR / QFZP tests). */
  revenue: number;
}

export interface QfzpResult {
  claimed: boolean;
  deMinimisLimit: number;
  deMinimisPass: boolean;
  conditionsPass: boolean;
  applied: boolean;
  failed: string[];
  qualifyingIncome: number;
  taxableNonQualifying: number;
  /** A condition was answered "not met" or the de minimis test failed on entered figures (not just unanswered). */
  failedThisPeriod: boolean;
  /** Set when QFZP status was lost in an earlier period: the last period end at the standard rate. */
  lostUntil?: string;
}

export type CtRevenueGroup = 'revenue' | 'other_income' | 'gains' | 'exempt_income';

export const CT_REVENUE_GROUP_LABELS: Record<CtRevenueGroup, string> = {
  revenue: 'Revenue',
  other_income: 'Other income (including interest)',
  gains: 'Gains',
  exempt_income: 'Exempt income',
};

export interface CtRevenueLine {
  key: string;
  account: string;
  source?: string;
  group: CtRevenueGroup;
  /** Credit is positive. */
  amount: number;
  included: boolean;
  /** What the line would be without a person's choice. */
  includedByDefault: boolean;
  reason?: string;
}

/** Total revenue for the SBR and QFZP de minimis tests, with its breakdown. */
export interface CtRevenue {
  /** Revenue from the statements (or the TB revenue lines), less revenue lines left out. */
  revenue: number;
  otherIncome: number;
  gains: number;
  exemptIncome: number;
  /** Income lines left out (shown as a reminder; already not in the groups above). */
  excluded: number;
  lines: CtRevenueLine[];
  total: number;
}

export interface ForeignTaxCreditRowResult {
  country: string;
  income: number;
  taxPaid: number;
  /** UAE tax on this income: tax × (this income ÷ taxable income after losses). */
  cap: number;
  credit: number;
  /** Foreign tax that cannot be credited (it is not carried forward, carried back or refunded). */
  unused: number;
  basis: string;
}

/** Totals over every row; each row is capped on its own. */
export interface ForeignTaxCreditResult {
  income: number;
  taxPaid: number;
  cap: number;
  credit: number;
  unused: number;
  basis: string;
  rows: ForeignTaxCreditRowResult[];
}

export interface ParticipationResult {
  lineKey: string;
  account: string;
  amount: number;
  exempt: boolean;
  failed: string[];
}

export interface ComputeResult {
  pbt: number;
  revenue: number;
  otherIncome: number;
  exemptIncome: number;
  totalIncome: number;
  addBacks: AddBack[];
  totalAddBacks: number;
  deductions: Deduction[];
  totalDeductions: number;
  taxableIncome: number;
  loss: LossResult;
  taxableAfterLoss: number;
  interest: InterestResult;
  sbr: SbrResult;
  qfzp: QfzpResult;
  participation: ParticipationResult[];
  ctRevenue: CtRevenue;
  regime: 'standard' | 'sbr' | 'qfzp';
  /** Tax before the foreign tax credit. */
  taxBeforeCredits: number;
  foreignTaxCredit: ForeignTaxCreditResult;
  /** Tax payable (after the foreign tax credit). */
  tax: number;
  effectiveRate: number;
  notes: string[];
  flags: Flag[];
}

// ───────────────────────── Deadlines ─────────────────────────

/** Who is registering, which decides the registration deadline (FTA Decision 3/2024). */
export type RegistrantType = 'company' | 'natural_person' | 'nonresident_pe' | 'nonresident_nexus';

export const REGISTRANT_LABELS: Record<RegistrantType, string> = {
  company: 'Company (resident juridical person)',
  natural_person: 'Natural person doing business (resident)',
  nonresident_pe: 'Non-resident with a permanent establishment',
  nonresident_nexus: 'Non-resident with a nexus (UAE property income)',
};

export interface DeadlineInputs {
  /** Default: company (or natural person when the profile's business type says so). */
  registrantType?: RegistrantType;
  /** Natural person: business turnover in the calendar year below. */
  turnover?: number;
  /** Natural person: the calendar year the turnover is for. Defaults to the period-end year. */
  turnoverYear?: number;
  /** Non-resident: date the permanent establishment started. */
  peStartDate?: string;
  /** Non-resident: date the nexus was established. */
  nexusDate?: string;
  incorporationDate?: string;
  firstPeriodStart?: string;
  firstPeriodEnd?: string;
  periodEnd?: string;
  registrationDate?: string;
  returnFiledDate?: string;
  taxPaidDate?: string;
  /** Tax to pay. Defaults to the computed tax. */
  taxAmount?: number;
  /** "Today" for estimates when something has not happened yet. */
  today?: string;
}

export interface TimelineEvent {
  date: string;
  label: string;
  kind: 'due' | 'done' | 'late' | 'info';
}

export interface DeadlineResult {
  registrantType: RegistrantType;
  registrationDue?: string;
  /** How the registration date was worked out, e.g. "Incorporation 28 Feb 2025 + 3 months". */
  registrationBasis?: string;
  returnDue?: string;
  paymentDue?: string;
  waiverDeadline?: string;
  isFirstPeriod: boolean;
  registrationLate: boolean;
  waiverApplies: boolean;
  monthsLateFiling: number;
  daysLatePayment: number;
  /** Months late for payment, each month or part of a month counting in full. */
  monthsLatePayment: number;
  penalties: {
    lateRegistration: number;
    lateFiling: number;
    latePayment: number;
    total: number;
  };
  notes: string[];
  events: TimelineEvent[];
}

// ───────────────────────── Workspace (one client, one period) ─────────────────────────

export interface Sourced {
  value?: number;
  ref?: CellRef;
  /** Where the value came from when it is not a single cell, e.g. "Trial balance". */
  note?: string;
  /** True when a person typed the value. */
  byHand?: boolean;
}

export interface Headline {
  pbt: Sourced;
  revenue: Sourced;
  totalIncome: Sourced;
  sharedOverheads: Sourced;
  otherDeductions: Sourced;
  lossesBF: LossRow[];
  interestCF: InterestRow[];
  /** Foreign tax credit inputs (entered by hand), one row per country or source. */
  foreignTax?: ForeignTaxRow[];
}

export interface SubLine {
  key: string;
  parentKey: string;
  category: Category;
  amount: number;
  label: string;
  source: 'gl' | 'hidden_vat';
  evidence: string[];
}

export interface FsFacts {
  /** Tax loss brought forward found in the statements: a suggestion to confirm. */
  lossSuggestion?: FoundNumber;
  totalAssets?: FoundNumber;
  totalEquityLiabilities?: FoundNumber;
  pbtPrior?: number;
  auditedText: boolean;
  templateTexts: TemplateText[];
  foreignText?: CellRef;
  ociText?: CellRef;
  formulaErrors: FormulaError[];
  tbTotals?: { debit: number; credit: number; sheet: string };
  /** Where revenue was shown as a negative number (its absolute value is used). */
  revenueSignFixed?: CellRef;
}

/** Profile answers that can be filled from the files. */
export type ProfileField =
  | 'clientName'
  | 'trn'
  | 'legalForm'
  | 'accountingStandard'
  | 'periodStart'
  | 'periodEnd'
  | 'audited'
  | 'groupRevenue'
  | 'vatRevenue'
  | 'electSBR'
  | 'priorPeriodsUnder3M'
  | 'electRealisation'
  | 'electForeignPE'
  | 'hasForeignIncome'
  | 'hasTaxCertificates'
  | 'ownershipChange'
  | 'ownershipChangeLosses';

/** How an answer was filled from the files. */
export interface AutoMark {
  /** file = read directly; derived = worked out from file numbers; suggested = a best guess to confirm. */
  kind: 'file' | 'derived' | 'suggested';
  /** "P&L!A1", or a description when there is no single cell. */
  source: string;
  /** True when `source` is a cell reference. */
  cell: boolean;
  /** The text that matched, shown in quotes under the field. */
  text?: string;
  /** How the answer was worked out, e.g. "period end − 1 year + 1 day". */
  why?: string;
  /** The file the answer came from. */
  file?: string;
  /** Other documents that give the same answer. */
  also?: string[];
  /** Number of files that agree, when more than one. */
  confirmedBy?: number;
}

export interface Workspace {
  clientId?: string;
  clientName: string;
  /** A company name found in the files. Never filled in by itself: staff choose to use it. */
  suggestedClientName?: string;
  /** Currency of the amounts in the files, and AED per 1 unit. Everything is worked out in AED. */
  currency?: import('./currency').CurrencyChoice;
  trn: string;
  profile: Profile;
  headline: Headline;
  tbLines: TBLine[];
  /** Category chosen by a person, keyed by line key. Always wins. */
  mappings: Record<string, Category>;
  answers: Record<string, LineAnswer>;
  subLines: SubLine[];
  /** GL suggestion decisions keyed by suggestion id. */
  glDecisions: Record<string, 'accepted' | 'rejected'>;
  vatReturns: VatReturnRow[];
  relatedParties: RelatedParty[];
  /** Sales and purchase register lines read from the files (kept with the client, like the TB lines). */
  salesInvoices: InvoiceLine[];
  purchaseInvoices: InvoiceLine[];
  /** Imports of services (reverse charge) and goods (customs), self-accounted VAT. */
  importInvoices?: InvoiceLine[];
  /** Input VAT treatment chosen by a person, keyed by invoice line key. Always wins. */
  vatChoices: Record<string, VatChoice>;
  resolved: Record<string, Resolution>;
  cautious: boolean;
  deadlines: DeadlineInputs;
  fsFacts: FsFacts;
  /** Profile answers filled from the files (removed as soon as a person changes the answer). */
  autoFill: Partial<Record<ProfileField, AutoMark>>;
  /** Profile answers a person has set. These always win over auto-fill, also on re-upload. */
  userSet: Partial<Record<ProfileField, boolean>>;
  /** Why an answer was NOT filled although the files say something about it. */
  autoNotes: Partial<Record<ProfileField, string>>;
  /** Profile facts the uploaded files disagree on (see autofill.ts). */
  docConflicts?: import('./autofill').DocConflict[];
  /** Answers carried from last year: shown as suggestions only. */
  suggestions?: { mappings: Record<string, Category>; answers: Record<string, LineAnswer> };
}
