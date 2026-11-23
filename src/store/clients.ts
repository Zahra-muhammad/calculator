/**
 * Saved clients, kept in this browser's localStorage. Uploaded file bytes are never
 * stored: only the profile, the numbers read from the files, the trial balance lines,
 * mappings, answers, resolved flags and dates.
 * Every storage access is wrapped in try/catch so the app still works when storage
 * is blocked (private windows, strict settings).
 */
import { qfzpLockUntil } from '../engine/compute';
import { SETTINGS } from '../engine/settings';
import type { ForeignTaxRow, Workspace } from '../engine/types';
import { addDays, addMonths } from '../engine/util';
import { emptyWorkspace, evaluate } from '../engine/workspace';

const KEY = 'uae-ct-calculator:clients:v1';

export interface ClientRecord {
  id: string;
  name: string;
  trn: string;
  periodEnd?: string;
  updatedAt: string;
  /** End of the period in which QFZP status was lost (this period or an earlier one), if any. */
  qfzpFailedPeriodEnd?: string;
  workspace: Workspace;
}

/**
 * The period in which QFZP status was lost: this period when a condition is answered "not met" (or the
 * de minimis test fails on entered figures), otherwise the earlier period already recorded in the profile.
 */
export function qfzpFailure(ws: Workspace, ev = evaluate(ws)): string | undefined {
  if (ev.result.qfzp.failedThisPeriod && ws.profile.periodEnd) return ws.profile.periodEnd;
  return ws.profile.qfzpLostPeriodEnd || undefined;
}

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function newId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadClients(store: Storage | null = storage()): ClientRecord[] {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter(isRecord).map(normalise) : [];
  } catch {
    return [];
  }
}

export function saveClients(list: ClientRecord[], store: Storage | null = storage()): boolean {
  try {
    if (!store) return false;
    store.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function isRecord(x: unknown): x is ClientRecord {
  return !!x && typeof x === 'object' && typeof (x as ClientRecord).id === 'string' && typeof (x as ClientRecord).workspace === 'object';
}

/** Foreign tax credit inputs: a list of rows (an early save may hold a single { income, taxPaid } object). */
function foreignTaxRows(v: unknown): ForeignTaxRow[] | undefined {
  if (Array.isArray(v)) return v as ForeignTaxRow[];
  if (v && typeof v === 'object') return [v as ForeignTaxRow];
  return undefined;
}

/** Fill in any fields added since the record was saved. */
function normalise(r: ClientRecord): ClientRecord {
  const base = emptyWorkspace();
  const w = r.workspace;
  return {
    ...r,
    workspace: {
      ...base,
      ...w,
      profile: { ...base.profile, ...w.profile, qfzp: { ...(w.profile?.qfzp ?? {}) } },
      headline: { ...base.headline, ...w.headline, foreignTax: foreignTaxRows(w.headline?.foreignTax) },
      fsFacts: { ...base.fsFacts, ...w.fsFacts },
      clientId: r.id,
    },
  };
}

/** Save (insert or update) the workspace as a client. Returns the new list and the record. */
export function upsertClient(list: ClientRecord[], ws: Workspace): { list: ClientRecord[]; record: ClientRecord } {
  const id = ws.clientId ?? newId();
  const record: ClientRecord = {
    id,
    name: ws.clientName.trim() || 'Unnamed client',
    trn: ws.trn,
    periodEnd: ws.profile.periodEnd,
    updatedAt: new Date().toISOString(),
    qfzpFailedPeriodEnd: qfzpFailure(ws),
    workspace: { ...ws, clientId: id },
  };
  const others = list.filter((c) => c.id !== id);
  return { list: [record, ...others], record };
}

export function deleteClient(list: ClientRecord[], id: string): ClientRecord[] {
  return list.filter((c) => c.id !== id);
}

/**
 * Start next year's file for a client: dates move on 12 months, mappings and answers
 * become suggestions, losses and interest carried forward become next year's brought-forward
 * figures, and this year's numbers and resolved flags are cleared. A lost QFZP status is carried
 * while its 5 periods run (the standard rate applies there too).
 */
export function duplicateToNextYear(rec: ClientRecord): Workspace {
  const w = rec.workspace;
  const ev = evaluate(w);
  const next = emptyWorkspace();
  const p = w.profile;
  const periodStart = p.periodEnd ? addDays(p.periodEnd, 1) : undefined;
  const periodEnd = p.periodEnd ? addMonths(p.periodEnd, 12) : undefined;
  const lost = qfzpFailure(w, ev);
  const qfzpLostPeriodEnd = lost && (!periodEnd || periodEnd <= qfzpLockUntil(lost)) ? lost : undefined;
  return {
    ...next,
    clientName: w.clientName,
    trn: w.trn,
    relatedParties: w.relatedParties,
    cautious: w.cautious,
    profile: {
      ...p,
      periodStart,
      periodEnd,
      audited: undefined,
      vatRevenue: undefined,
      vatDifferenceNote: undefined,
      ownershipChange: undefined,
      ownershipChangeLosses: undefined,
      // Next year's "every earlier period under the limit" fails if this year's revenue was above it.
      priorPeriodsUnder3M: ev.result.sbr.revenue > SETTINGS.sbr.revenueLimit ? false : p.priorPeriodsUnder3M,
      qfzpLostPeriodEnd,
      qfzp: { ...p.qfzp, qualifyingIncome: undefined, nonQualifyingRevenue: undefined },
    },
    headline: {
      ...next.headline,
      lossesBF: ev.result.loss.carriedForward > 0 ? [{ periodStart: p.periodStart ?? '', amount: ev.result.loss.carriedForward, source: `Carried forward from ${rec.name} ${p.periodEnd ?? ''}`.trim() }] : [],
      interestCF: ev.result.interest.carriedForwardOut,
    },
    deadlines: {
      incorporationDate: w.deadlines.incorporationDate,
      firstPeriodStart: w.deadlines.firstPeriodStart,
      firstPeriodEnd: w.deadlines.firstPeriodEnd,
      registrationDate: w.deadlines.registrationDate,
    },
    suggestions: { mappings: { ...(w.suggestions?.mappings ?? {}), ...w.mappings }, answers: { ...w.answers } },
  };
}

/** JSON backup of every client. */
export function exportClients(list: ClientRecord[]): string {
  return JSON.stringify({ app: 'uae-ct-calculator', version: 1, exportedAt: new Date().toISOString(), clients: list }, null, 2);
}

/** Read a JSON backup. Clients with the same id are replaced; others are added. */
export function importClients(list: ClientRecord[], json: string): { list: ClientRecord[]; added: number; updated: number } {
  const data = JSON.parse(json) as { clients?: unknown };
  const incoming = Array.isArray(data?.clients) ? data.clients.filter(isRecord).map(normalise) : Array.isArray(data) ? (data as unknown[]).filter(isRecord).map(normalise) : null;
  if (!incoming) throw new Error('This file is not a client backup.');
  let added = 0;
  let updated = 0;
  const byId = new Map(list.map((c) => [c.id, c]));
  for (const c of incoming) {
    if (byId.has(c.id)) updated++;
    else added++;
    byId.set(c.id, c);
  }
  return { list: [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), added, updated };
}
