import { describe, expect, it } from 'vitest';
import { duplicateToNextYear, exportClients, importClients, loadClients, saveClients, upsertClient, type Storage } from '../src/store/clients';
import { emptyWorkspace, evaluate } from '../src/engine/workspace';

function memory(): Storage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

function client() {
  const ws = emptyWorkspace();
  ws.clientName = 'Omar Gym LLC';
  ws.profile.periodStart = '2025-01-01';
  ws.profile.periodEnd = '2025-12-31';
  ws.headline.pbt = { value: -100_000, byHand: true };
  ws.headline.revenue = { value: 2_000_000, byHand: true };
  ws.mappings = { 'office expenses': 'fines' };
  ws.answers = { 'car costs': { privateUse: 0.3 } };
  ws.resolved = { 'RV-01:missing': { note: 'ok', at: '2026-01-01' } };
  return ws;
}

describe('client store', () => {
  it('saves, loads and survives blocked storage', () => {
    const s = memory();
    const { list, record } = upsertClient([], client());
    expect(saveClients(list, s)).toBe(true);
    const loaded = loadClients(s);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].workspace.mappings).toEqual({ 'office expenses': 'fines' });
    expect(loaded[0].workspace.clientId).toBe(record.id);

    const broken: Storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadClients(broken)).toEqual([]);
    expect(saveClients(list, broken)).toBe(false);
    expect(loadClients(null)).toEqual([]);
  });

  it('updates the same client instead of adding a copy', () => {
    const first = upsertClient([], client());
    const again = upsertClient(first.list, { ...first.record.workspace, trn: '123' });
    expect(again.list).toHaveLength(1);
    expect(again.record.trn).toBe('123');
  });

  it('duplicates to next year with suggestions and carried-forward losses', () => {
    const { record } = upsertClient([], client());
    const next = duplicateToNextYear(record);
    expect(next.clientId).toBeUndefined();
    expect(next.profile.periodStart).toBe('2026-01-01');
    expect(next.profile.periodEnd).toBe('2026-12-31');
    expect(next.mappings).toEqual({});
    expect(next.suggestions?.mappings).toEqual({ 'office expenses': 'fines' });
    expect(next.suggestions?.answers['car costs']).toEqual({ privateUse: 0.3 });
    expect(next.resolved).toEqual({});
    expect(next.headline.lossesBF).toEqual([expect.objectContaining({ periodStart: '2025-01-01', amount: 100_000 })]);
    expect(next.headline.pbt).toEqual({});
  });

  it('saves a QFZP failure on the client and keeps the standard rate for that period and the next 4 in later years', () => {
    const qfzpClient = (ws = emptyWorkspace()) => {
      ws.clientName = 'Free Zone Trading FZCO';
      ws.headline.pbt = { value: 10_000_000, byHand: true };
      ws.headline.revenue = { value: 50_000_000, byHand: true };
      ws.profile = {
        ...ws.profile,
        legalForm: 'qfzp',
        periodStart: ws.profile.periodStart ?? '2025-01-01',
        periodEnd: ws.profile.periodEnd ?? '2025-12-31',
        qfzp: { qualifyingActivity: true, substance: true, auditedFS: true, tpCompliance: true, noElection: true, qualifyingIncome: 9_000_000, nonQualifyingRevenue: 1_000_000 },
      };
      return ws;
    };
    // 2025: substance answered "not met" → QFZP fails this period, and the failure is saved on the client.
    const y2025 = qfzpClient();
    y2025.profile.qfzp.substance = false;
    const { record } = upsertClient([], y2025);
    expect(record.qfzpFailedPeriodEnd).toBe('2025-12-31');
    // A passing year has nothing to save.
    expect(upsertClient([], qfzpClient()).record.qfzpFailedPeriodEnd).toBeUndefined();

    // 2026–2029: all conditions met again, but the standard rate still applies.
    let rec = record;
    for (const year of [2026, 2027, 2028, 2029]) {
      const next = duplicateToNextYear(rec);
      expect(next.profile.periodEnd).toBe(`${year}-12-31`);
      expect(next.profile.qfzpLostPeriodEnd).toBe('2025-12-31');
      const ws = qfzpClient(next);
      const ev = evaluate(ws);
      expect(ev.result.qfzp).toMatchObject({ applied: false, lostUntil: '2029-12-31' });
      expect(ev.result.regime).toBe('standard');
      expect(ev.result.tax).toBe(866_250);
      rec = upsertClient([], ws).record;
      expect(rec.qfzpFailedPeriodEnd).toBe('2025-12-31');
    }
    // 2030: the five periods are over, so QFZP can apply again.
    const y2030 = qfzpClient(duplicateToNextYear(rec));
    expect(y2030.profile.qfzpLostPeriodEnd).toBeUndefined();
    expect(evaluate(y2030).result.qfzp.applied).toBe(true);
  });

  it('reads an early save with a single foreign tax figure as one row', () => {
    const s = memory();
    const { list } = upsertClient([], client());
    const old = JSON.parse(JSON.stringify(list));
    old[0].workspace.headline.foreignTax = { income: 500_000, taxPaid: 10_000 };
    s.setItem('uae-ct-calculator:clients:v1', JSON.stringify(old));
    expect(loadClients(s)[0].workspace.headline.foreignTax).toEqual([{ income: 500_000, taxPaid: 10_000 }]);
  });

  it('exports and imports a JSON backup', () => {
    const { list } = upsertClient([], client());
    const json = exportClients(list);
    const res = importClients([], json);
    expect(res.added).toBe(1);
    expect(importClients(res.list, json).updated).toBe(1);
    expect(() => importClients([], '{"hello":1}')).toThrow('not a client backup');
  });
});
