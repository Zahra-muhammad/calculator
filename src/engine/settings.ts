/**
 * The ONE place for every UAE Corporate Tax number the app uses.
 *
 * Rules:
 * - No rate, threshold, date or penalty may be written anywhere else in the code.
 * - Every value carries a comment naming the law or decision it comes from.
 * - Every value also appears in SETTING_INFO below (a test checks this), so the
 *   Settings screen and the Excel "Settings used" sheet always show the full list.
 *
 * Check these against tax.gov.ae and mof.gov.ae before each filing season.
 */
export const SETTINGS = {
  /** Federal Decree-Law 47/2022 Art. 3; Cabinet Decision 116/2023: standard rate above the 0% band. */
  rate: 0.09,
  /** Cabinet Decision 116/2023: taxable income up to this amount is taxed at 0%. */
  zeroBand: 375_000,
  /** Federal Decree-Law 47/2022 Art. 37: losses can offset at most 75% of taxable income. */
  lossOffsetCap: 0.75,
  /** First tax periods start on or after this date (FDL 47/2022 Art. 69/70). Earlier losses are not allowed. */
  lossesValidFrom: '2023-06-01',
  /** Federal Decree-Law 47/2022 Art. 39: at least 50% common ownership must continue to use losses. */
  lossOwnershipContinuity: 0.5,

  interest: {
    /** FDL 47/2022 Art. 30; Ministerial Decision 126/2023: net interest up to AED 12m is always deductible. */
    deMinimis: 12_000_000,
    /** FDL 47/2022 Art. 30: net interest is deductible up to 30% of adjusted EBITDA. */
    ebitdaShare: 0.3,
    /** FDL 47/2022 Art. 30: disallowed net interest can be carried forward for 10 periods. */
    carryForwardYears: 10,
  },

  /** FDL 47/2022 Art. 32: 50% of client entertainment is not deductible. */
  entertainmentDisallowed: 0.5,

  /** FDL 47/2022 Art. 36; Ministerial Decision 97/2023: disclose connected-person payments above this per person. */
  connectedPersonDisclosure: 500_000,
  /** Ministerial Decision 97/2023: related-party schedule needed when total transactions exceed this. */
  relatedPartyScheduleTotal: 40_000_000,
  /** Ministerial Decision 97/2023: list each transaction category above this in the schedule. */
  relatedPartyScheduleCategory: 4_000_000,
  /** Ministerial Decision 97/2023: Master File and Local File needed at this revenue. */
  masterLocalFileRevenue: 200_000_000,
  /** Ministerial Decision 97/2023: Master File and Local File needed when the group reaches this revenue. */
  masterLocalFileGroupRevenue: 3_150_000_000,
  /** Ministerial Decision 84/2025: audited financial statements needed above this revenue (and for every QFZP). */
  auditRevenueThreshold: 50_000_000,

  sbr: {
    /** FDL 47/2022 Art. 21; Ministerial Decision 73/2023: Small Business Relief revenue limit (this and every earlier period). */
    revenueLimit: 3_000_000,
    /** Ministerial Decision 131/2026 (extended from 2026-12-31): last period end that can use Small Business Relief. */
    lastPeriodEnd: '2029-12-31',
    /** Ministerial Decision 73/2023: members of multinational groups at or above this revenue cannot use SBR. */
    excludedGroupRevenue: 3_150_000_000,
  },

  participation: {
    /** FDL 47/2022 Art. 23: minimum ownership for the participation exemption. */
    minOwnership: 0.05,
    /** Ministerial Decision 116/2023: alternative test, acquisition cost of at least AED 4m. */
    minAcquisitionCost: 4_000_000,
    /** FDL 47/2022 Art. 23: minimum holding period (or intention to hold), in months. */
    minHoldingMonths: 12,
    /** FDL 47/2022 Art. 23: the investee must be taxed at no less than this rate. */
    minInvesteeTaxRate: 0.09,
    /** FDL 47/2022 Art. 23: at most this share of the investee's assets may be non-qualifying. */
    maxNonQualifyingAssets: 0.5,
    /** FDL 47/2022 Art. 23: shares acquired in a restructuring within this many years are excluded. */
    restructuringBlockYears: 2,
  },

  qfzp: {
    /** Ministerial Decision 265/2023: non-qualifying revenue de minimis, share of total revenue. */
    deMinimisShare: 0.05,
    /** Ministerial Decision 265/2023: non-qualifying revenue de minimis, absolute cap. */
    deMinimisCap: 5_000_000,
    /** FDL 47/2022 Art. 18: failing a condition removes QFZP status for this period and the next 4. */
    failurePenaltyPeriods: 5,
  },

  /** Federal Decree-Law 8/2017 on VAT: standard rate. */
  vatRate: 0.05,

  /** Cabinet Decision 49/2023: a natural person doing business is taxable once turnover in a calendar year is above this. */
  naturalPersonTurnover: 1_000_000,

  deadlines: {
    /** FTA Decision 3/2024: register within 3 months of incorporation. */
    registrationMonths: 3,
    /** FTA Decision 3/2024: a resident natural person registers by this day (MM-DD) of the year after the year turnover went above the threshold. */
    naturalPersonRegistrationBy: '03-31',
    /** FTA Decision 3/2024: a non-resident with a permanent establishment registers within 6 months of the PE starting. */
    peRegistrationMonths: 6,
    /** FTA Decision 3/2024: a non-resident with a nexus in the UAE registers within 3 months of the nexus. */
    nexusRegistrationMonths: 3,
    /** FDL 47/2022 Art. 53: file the return and pay within 9 months of the period end. */
    returnMonths: 9,
    /** Cabinet Decision on the late-registration penalty waiver: file the first return within 7 months of the first period end. */
    waiverMonths: 7,
  },

  penalties: {
    /** Cabinet Decision 10/2024: late registration penalty. */
    lateRegistration: 10_000,
    /** Cabinet Decision 75/2023 as amended: late filing, per month (or part) for the first 12 months. */
    lateFilingMonth1to12: 500,
    /** Cabinet Decision 75/2023 as amended: late filing, per month (or part) from month 13. */
    lateFilingAfter12: 1_000,
    /** Cabinet Decision 75/2023: late payment of Corporate Tax, 14% a year for each month or part thereof. */
    latePaymentAnnualRate: 0.14,
  },

  /** Federal Decree-Law 28/2022 on Tax Procedures: keep records for 7 years. */
  recordKeepingYears: 7,
} as const;

export type Settings = typeof SETTINGS;

/** 'dayMonth' = a day of the year stored as "MM-DD", e.g. "03-31" (31 March). */
export type SettingFormat = 'percent' | 'aed' | 'date' | 'number' | 'months' | 'years' | 'dayMonth';

export interface SettingInfo {
  /** Dot path into SETTINGS, e.g. "interest.deMinimis". */
  key: string;
  label: string;
  format: SettingFormat;
  reference: string;
  note?: string;
}

/** Labels and references for the Settings screen and the Excel export. Keep in the same order as SETTINGS. */
export const SETTING_INFO: SettingInfo[] = [
  { key: 'rate', label: 'Corporate tax rate', format: 'percent', reference: 'Federal Decree-Law 47/2022 Art. 3; Cabinet Decision 116/2023' },
  { key: 'zeroBand', label: '0% band (taxable income)', format: 'aed', reference: 'Cabinet Decision 116/2023' },
  { key: 'lossOffsetCap', label: 'Loss relief cap (share of taxable income)', format: 'percent', reference: 'Federal Decree-Law 47/2022 Art. 37' },
  { key: 'lossesValidFrom', label: 'Losses allowed from periods starting on', format: 'date', reference: 'First tax periods (FDL 47/2022)' },
  { key: 'lossOwnershipContinuity', label: 'Ownership continuity for losses', format: 'percent', reference: 'Federal Decree-Law 47/2022 Art. 39' },
  { key: 'interest.deMinimis', label: 'Interest limit: de minimis', format: 'aed', reference: 'FDL 47/2022 Art. 30; Ministerial Decision 126/2023' },
  { key: 'interest.ebitdaShare', label: 'Interest limit: share of adjusted EBITDA', format: 'percent', reference: 'FDL 47/2022 Art. 30' },
  { key: 'interest.carryForwardYears', label: 'Disallowed interest carry-forward', format: 'years', reference: 'FDL 47/2022 Art. 30' },
  { key: 'entertainmentDisallowed', label: 'Client entertainment not deductible', format: 'percent', reference: 'FDL 47/2022 Art. 32' },
  { key: 'connectedPersonDisclosure', label: 'Connected person disclosure (per person)', format: 'aed', reference: 'FDL 47/2022 Art. 36; Ministerial Decision 97/2023' },
  { key: 'relatedPartyScheduleTotal', label: 'Related-party schedule: total transactions', format: 'aed', reference: 'Ministerial Decision 97/2023' },
  { key: 'relatedPartyScheduleCategory', label: 'Related-party schedule: per category', format: 'aed', reference: 'Ministerial Decision 97/2023' },
  { key: 'masterLocalFileRevenue', label: 'Master and Local File: revenue', format: 'aed', reference: 'Ministerial Decision 97/2023' },
  { key: 'masterLocalFileGroupRevenue', label: 'Master and Local File: group revenue', format: 'aed', reference: 'Ministerial Decision 97/2023' },
  { key: 'auditRevenueThreshold', label: 'Audited statements needed above revenue (and all QFZPs)', format: 'aed', reference: 'Ministerial Decision 84/2025' },
  { key: 'sbr.revenueLimit', label: 'Small Business Relief: revenue limit', format: 'aed', reference: 'FDL 47/2022 Art. 21; Ministerial Decision 73/2023' },
  { key: 'sbr.lastPeriodEnd', label: 'Small Business Relief: last period end', format: 'date', reference: 'Ministerial Decision 131/2026', note: 'Extended from 2026-12-31' },
  { key: 'sbr.excludedGroupRevenue', label: 'Small Business Relief: excluded group revenue', format: 'aed', reference: 'Ministerial Decision 73/2023' },
  { key: 'participation.minOwnership', label: 'Participation: minimum ownership', format: 'percent', reference: 'FDL 47/2022 Art. 23' },
  { key: 'participation.minAcquisitionCost', label: 'Participation: or minimum acquisition cost', format: 'aed', reference: 'Ministerial Decision 116/2023' },
  { key: 'participation.minHoldingMonths', label: 'Participation: minimum holding period', format: 'months', reference: 'FDL 47/2022 Art. 23' },
  { key: 'participation.minInvesteeTaxRate', label: 'Participation: minimum investee tax rate', format: 'percent', reference: 'FDL 47/2022 Art. 23' },
  { key: 'participation.maxNonQualifyingAssets', label: 'Participation: maximum non-qualifying assets', format: 'percent', reference: 'FDL 47/2022 Art. 23' },
  { key: 'participation.restructuringBlockYears', label: 'Participation: restructuring block', format: 'years', reference: 'FDL 47/2022 Art. 23' },
  { key: 'qfzp.deMinimisShare', label: 'QFZP de minimis: share of revenue', format: 'percent', reference: 'Ministerial Decision 265/2023' },
  { key: 'qfzp.deMinimisCap', label: 'QFZP de minimis: cap', format: 'aed', reference: 'Ministerial Decision 265/2023' },
  { key: 'qfzp.failurePenaltyPeriods', label: 'QFZP failure: periods at the standard rate', format: 'number', reference: 'FDL 47/2022 Art. 18', note: 'This period and the next 4' },
  { key: 'vatRate', label: 'VAT standard rate', format: 'percent', reference: 'Federal Decree-Law 8/2017 on VAT' },
  { key: 'naturalPersonTurnover', label: 'Natural person: taxable when turnover is above', format: 'aed', reference: 'Cabinet Decision 49/2023', note: 'Per calendar year' },
  { key: 'deadlines.registrationMonths', label: 'Registration due after incorporation', format: 'months', reference: 'FTA Decision 3/2024' },
  {
    key: 'deadlines.naturalPersonRegistrationBy',
    label: 'Natural person (resident): register by',
    format: 'dayMonth',
    reference: 'FTA Decision 3/2024',
    note: 'Of the year after turnover went above the threshold',
  },
  { key: 'deadlines.peRegistrationMonths', label: 'Non-resident with a PE: register within', format: 'months', reference: 'FTA Decision 3/2024', note: 'From the date the PE starts' },
  { key: 'deadlines.nexusRegistrationMonths', label: 'Non-resident with a nexus: register within', format: 'months', reference: 'FTA Decision 3/2024', note: 'From the date of the nexus' },
  { key: 'deadlines.returnMonths', label: 'Return and payment due after period end', format: 'months', reference: 'FDL 47/2022 Art. 53' },
  { key: 'deadlines.waiverMonths', label: 'Late-registration waiver: first return within', format: 'months', reference: 'Cabinet Decision on the late-registration penalty waiver', note: 'First period only' },
  { key: 'penalties.lateRegistration', label: 'Late registration penalty', format: 'aed', reference: 'Cabinet Decision 10/2024' },
  { key: 'penalties.lateFilingMonth1to12', label: 'Late filing, per month (months 1–12)', format: 'aed', reference: 'Cabinet Decision 75/2023 as amended' },
  { key: 'penalties.lateFilingAfter12', label: 'Late filing, per month (from month 13)', format: 'aed', reference: 'Cabinet Decision 75/2023 as amended' },
  {
    key: 'penalties.latePaymentAnnualRate',
    label: 'Late payment, a year (for each month or part of a month)',
    format: 'percent',
    reference: 'Cabinet Decision 75/2023',
    note: 'Tax × rate ÷ 12 for each month or part of a month late',
  },
  { key: 'recordKeepingYears', label: 'Keep records for', format: 'years', reference: 'Federal Decree-Law 28/2022 on Tax Procedures' },
];

export const SETTINGS_CHECK_NOTE = 'Check against tax.gov.ae and mof.gov.ae before each filing season.';

/** Read a setting by dot path, e.g. "interest.deMinimis". */
export function settingValue(key: string): number | string | undefined {
  let node: unknown = SETTINGS;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof node === 'number' || typeof node === 'string' ? node : undefined;
}

/** All leaf keys of SETTINGS as dot paths (used by tests and the export). */
export function settingKeys(obj: Record<string, unknown> = SETTINGS as unknown as Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') keys.push(...settingKeys(v as Record<string, unknown>, path));
    else keys.push(path);
  }
  return keys;
}

/** "03-31" → "31 March". */
export function formatDayMonth(mmdd: string): string {
  const [m, d] = mmdd.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return months[m - 1] ? `${d} ${months[m - 1]}` : mmdd;
}

/** Format a setting for display. */
export function formatSetting(info: SettingInfo): string {
  const v = settingValue(info.key);
  if (v === undefined) return '—';
  if (typeof v === 'string' && info.format === 'dayMonth') return formatDayMonth(v);
  if (typeof v === 'string') return v;
  switch (info.format) {
    case 'percent':
      return `${+(v * 100).toFixed(2)}%`;
    case 'aed':
      return `AED ${v.toLocaleString('en-US')}`;
    case 'months':
      return `${v} months`;
    case 'years':
      return `${v} years`;
    default:
      return String(v);
  }
}
