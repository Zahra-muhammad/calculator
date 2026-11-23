/** Small pure helpers shared by the engine. No tax numbers here. */

/** Lower-case, "&" → "and", apostrophes removed, other punctuation → space, single spaces. */
export function norm(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Read an amount from a cell value. Handles "1,234", "(1,234)", "1,234-", "AED 1,234",
 * the unicode minus, and a lone dash meaning zero. Returns undefined if not a number.
 */
export function parseAmount(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean' || value instanceof Date || typeof value === 'object') return undefined;
  let s = String(value).trim();
  if (!s) return undefined;
  if (/^[-–—]$/.test(s)) return 0;
  s = s.replace(/aed|dhs?|dirhams?/gi, '').replace(/[\s, ]/g, '').replace(/−/g, '-');
  let negative = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) {
    negative = true;
    s = paren[1];
  }
  if (/^[0-9.]+-$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

/**
 * Read a signed balance from one column: "1,000.00 Dr", "Dr 1,000", "1000 CR", "(500)", "-500", 500.
 * Dr (debit) is positive, Cr (credit) is negative. Without Dr/Cr the number keeps its own sign.
 */
export function parseSignedAmount(value: unknown): number | undefined {
  if (typeof value !== 'string') return parseAmount(value);
  const s = value.trim();
  let side: string | undefined;
  let rest = s;
  let m = /^(dr|cr)\.?\s+(.*)$|^(dr|cr)\.?(\d.*)$/i.exec(s);
  if (m) {
    side = (m[1] ?? m[3]).toLowerCase();
    rest = m[2] ?? m[4];
  } else if ((m = /^(.*?\d[\d,.)]*)\s*(dr|cr)\.?$/i.exec(s))) {
    side = m[2].toLowerCase();
    rest = m[1];
  }
  const n = parseAmount(rest);
  if (n === undefined) return undefined;
  if (!side) return n;
  return side === 'dr' ? Math.abs(n) : -Math.abs(n);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** "AED 18,400" (whole dirhams by default). */
export function aed(n: number, decimals = 0): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}AED ${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** "18,400" with no currency. */
export function num(n: number, decimals = 0): string {
  const sign = n < 0 ? '−' : '';
  return sign + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function pct(n: number, decimals = 1): string {
  return `${+(n * 100).toFixed(decimals)}%`;
}

/** Short slug for flag keys. */
export function slug(s: string): string {
  return norm(s).replace(/ /g, '-').slice(0, 60) || 'x';
}

// ───────────────────────── Dates (YYYY-MM-DD strings, no time zones) ─────────────────────────

export function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

function toParts(s: string): [number, number, number] {
  const [y, m, d] = s.split('-').map(Number);
  return [y, m, d];
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function fromParts(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Add calendar months. If the start date is the last day of its month, the result is the
 * last day of the target month (31 Dec + 9 months = 30 Sep). Otherwise the day is kept,
 * clamped to the month length (10 Mar + 3 months = 10 Jun).
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = toParts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = daysInMonth(ny, nm);
  const isMonthEnd = d === daysInMonth(y, m);
  return fromParts(ny, nm, isMonthEnd ? lastDay : Math.min(d, lastDay));
}

/**
 * Add calendar months keeping the same day number, clamped to the month length, with NO
 * month-end jump (28 Feb + 3 months = 28 May; 30 Sep + 3 months = 30 Dec; 31 Jan + 3 months = 30 Apr).
 * Used for registration deadlines counted from an event date such as incorporation.
 */
export function addMonthsSameDay(date: string, months: number): string {
  const [y, m, d] = toParts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fromParts(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Months between two dates, rounded to the nearest whole month (for "is the period 12 months?"). */
export function monthsBetween(start: string, end: string): number {
  return Math.round((daysBetween(start, end) + 1) / 30.4375);
}

export function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

export function todayIso(): string {
  const d = new Date();
  return fromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** "30 Sep 2026" */
export function fmtDate(date?: string): string {
  if (!date || !isIsoDate(date)) return '—';
  const [y, m, d] = toParts(date);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}
