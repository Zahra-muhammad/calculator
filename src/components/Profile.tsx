import type { ReactNode } from 'react';
import { setProfileByUser, summaryText, type FieldState } from '../engine/autofill';
import { qfzpLockUntil } from '../engine/compute';
import { SETTINGS } from '../engine/settings';
import type { BusinessType, LegalForm, Profile as ProfileT, QfzpInputs, Workspace } from '../engine/types';
import { BUSINESS_TYPE_LABELS } from '../engine/types';
import { aed, fmtDate } from '../engine/util';
import type { Evaluation } from '../engine/workspace';
import { CardField, DateInput, NumberInput, Pill, Section, YesNo } from './ui';

export type Update = (fn: (ws: Workspace) => Workspace) => void;

/** Status pill for a profile answer: auto (green), suggested (blue), locked (grey) or needs you (yellow). */
function statusPill(s?: FieldState) {
  if (!s) return undefined;
  if (s.locked) return <Pill kind="neutral">locked</Pill>;
  if (!s.answered) return <Pill kind="need">needs you</Pill>;
  if (s.auto) return s.auto.kind === 'suggested' ? <Pill kind="suggested">suggested</Pill> : <Pill kind="auto">auto</Pill>;
  return undefined;
}

/** Grey note under a profile answer: where an auto-filled answer came from, a lock, or why it needs a person. */
function Note({ s, children, multi = true }: { s?: FieldState; children?: ReactNode; multi?: boolean }) {
  if (!s) return <>{children}</>;
  return (
    <>
      {s.locked && <span className="lock-note">{s.locked}</span>}
      {s.auto && <span className="from">{s.auto.cell ? `from ${s.auto.file && multi ? `${s.auto.file} › ` : ''}${s.auto.source}` : s.auto.source}</span>}
      {s.auto?.cell && s.auto.text && <span className="matched">“{s.auto.text}”</span>}
      {s.auto?.why && <span className="matched">{s.auto.why}.</span>}
      {s.auto?.confirmedBy && (
        <span className="confirmed" title={s.auto.also?.join('\n')}>
          ✓ Same answer in {s.auto.confirmedBy} files{s.auto.also?.length ? `: ${s.auto.also.map((a) => a.split(' › ')[0]).filter((v, i, l) => l.indexOf(v) === i && v !== s.auto?.file).join(', ')}` : ''}
        </span>
      )}
      {!s.answered && s.reason && <span className="need-text">{s.reason}</span>}
      {children}
    </>
  );
}

export function Profile({ ws, ev, update }: { ws: Workspace; ev: Evaluation; update: Update }) {
  const p = ev.profile;
  const st = (k: string) => ev.fields.find((f) => f.key === k);
  const setP = (patch: Partial<ProfileT> & { clientName?: string; trn?: string }) => update((w) => setProfileByUser(w, patch));
  const setQ = (patch: Partial<QfzpInputs>) => update((w) => ({ ...w, profile: { ...w.profile, qfzp: { ...w.profile.qfzp, ...patch } } }));
  const showForeign = p.hasForeignIncome !== false;
  const realisationValue = p.electRealisation === undefined ? '' : p.electRealisation === 'na' ? 'na' : p.electRealisation ? 'yes' : 'no';
  const s = ev.fieldSummary;
  const r = ev.result;
  const q = r.qfzp;
  const filled = s.total ? Math.round((s.auto / s.total) * 100) : 0;

  /** A profile answer card: label, status pill, control and note, tinted yellow while unanswered. */
  const card = (key: string, label: string, control: (id: string) => ReactNode, extra?: ReactNode) => {
    const fs = st(key);
    return (
      <CardField label={label} pill={statusPill(fs)} need={!!fs && !fs.answered} note={<Note s={fs}>{extra}</Note>}>
        {control}
      </CardField>
    );
  };
  const sbrEligibleNote =
    !r.sbr.elected && r.sbr.eligible && r.taxBeforeCredits > 0 ? (
      <span className="good-text">
        Eligible: total revenue {aed(r.sbr.revenue)} is under {aed(SETTINGS.sbr.revenueLimit)}. Electing would make the tax AED 0.
      </span>
    ) : undefined;

  return (
    <Section id="profile" step="2" title="Company profile" intro="Answers found in the files are filled in and marked “auto”. Change any of them; your answer always wins, also when you upload the files again.">
      <div className={`progress-row ${s.need ? '' : 'done'}`} role="status" data-testid="autofill-summary">
        <span className="progress-text">
          {s.auto > 0 ? (
            <>
              <strong>
                {s.auto} of {s.total}
              </strong>{' '}
              answers filled from the file{s.user ? `, ${s.user} answered by you` : ''}
            </>
          ) : (
            <>Upload the statements to fill most of these answers.</>
          )}
          <span className="visually-hidden"> {s.auto > 0 ? summaryText(s) : `${s.need} of ${s.total} still need an answer.`}</span>
        </span>
        <span className="bar" aria-hidden="true">
          <span style={{ width: `${filled}%` }} />
        </span>
        {s.need > 0 ? <Pill kind="need">{s.need} need you</Pill> : <Pill kind="auto">all answered</Pill>}
      </div>

      <fieldset className="pgroup">
        <legend>Company</legend>
        <div className="cgrid">
          {card(
            'clientName',
            'Client name',
            (id) => <input id={id} value={ws.clientName} placeholder="Type the client name" onChange={(e) => setP({ clientName: e.target.value })} />,
            ws.suggestedClientName && ws.suggestedClientName !== ws.clientName.trim() ? (
              <button type="button" className="small suggest-btn" onClick={() => setP({ clientName: ws.suggestedClientName })}>
                Use “{ws.suggestedClientName}” from the file
              </button>
            ) : undefined,
          )}
          {card('trn', 'TRN', (id) => (
            <input id={id} value={ws.trn} inputMode="numeric" placeholder="Not answered" onChange={(e) => setP({ trn: e.target.value })} />
          ))}
          {card('legalForm', 'Legal form', (id) => (
            <select id={id} className={p.legalForm ? '' : 'empty'} value={p.legalForm ?? ''} onChange={(e) => setP({ legalForm: (e.target.value || undefined) as LegalForm | undefined })}>
              <option value="">Not answered</option>
              <option value="mainland">Mainland company</option>
              <option value="free_zone">Free zone company (not claiming QFZP)</option>
              <option value="qfzp">Qualifying Free Zone Person (QFZP)</option>
              <option value="tax_group">Tax group member</option>
            </select>
          ))}
          <CardField label="Business type" note="Banks, insurance providers and natural persons are outside the 30% EBITDA interest limit. Not answered = ordinary business (the limit applies).">
            {(id) => (
              <select id={id} value={p.businessType ?? ''} onChange={(e) => setP({ businessType: (e.target.value || undefined) as ProfileT['businessType'] })}>
                <option value="">Not answered (ordinary business)</option>
                {(Object.keys(BUSINESS_TYPE_LABELS) as BusinessType[]).map((k) => (
                  <option key={k} value={k}>
                    {BUSINESS_TYPE_LABELS[k]}
                  </option>
                ))}
              </select>
            )}
          </CardField>
          {card('accountingStandard', 'Accounting standard', (id) => (
            <select
              id={id}
              className={p.accountingStandard ? '' : 'empty'}
              value={p.accountingStandard ?? ''}
              onChange={(e) => setP({ accountingStandard: (e.target.value || undefined) as ProfileT['accountingStandard'] })}
            >
              <option value="">Not answered</option>
              <option value="IFRS">IFRS</option>
              <option value="IFRS for SMEs">IFRS for SMEs</option>
              <option value="Other">Other</option>
            </select>
          ))}
          {card('periodStart', 'Period start', (id) => (
            <DateInput id={id} value={p.periodStart} onChange={(v) => setP({ periodStart: v })} />
          ))}
          {card('periodEnd', 'Period end', (id) => (
            <DateInput id={id} value={p.periodEnd} onChange={(v) => setP({ periodEnd: v })} />
          ))}
          {card('audited', 'Financial statements audited?', (id) => (
            <YesNo id={id} value={p.audited} onChange={(v) => setP({ audited: v })} />
          ))}
        </div>
      </fieldset>

      <fieldset className="pgroup">
        <legend>Group and VAT</legend>
        <div className="cgrid">
          {card(
            'groupRevenue',
            'Group revenue (AED)',
            (id) => <NumberInput id={id} value={p.groupRevenue === 0 ? undefined : p.groupRevenue} placeholder={p.groupRevenue === 0 ? 'Not part of a group' : 'Not answered'} disabled={p.groupRevenue === 0} onChange={(v) => setP({ groupRevenue: v })} min={0} />,
            <label className="inline-check">
              <input type="checkbox" checked={p.groupRevenue === 0} onChange={(e) => setP({ groupRevenue: e.target.checked ? 0 : undefined })} />
              Not part of a group
            </label>,
          )}
          {card('vatRevenue', 'Revenue per VAT returns (AED)', (id) => (
            <NumberInput id={id} value={p.vatRevenue} placeholder="Enter total or upload VAT returns" onChange={(v) => setP({ vatRevenue: v })} />
          ))}
          <CardField label="Explanation of any difference" note="Optional.">
            {(id) => <input id={id} value={p.vatDifferenceNote ?? ''} placeholder="Optional" onChange={(e) => setP({ vatDifferenceNote: e.target.value || undefined })} />}
          </CardField>
        </div>
      </fieldset>

      <fieldset className="pgroup">
        <legend>Elections and history</legend>
        <div className="cgrid">
          {card('electSBR', 'Small Business Relief elected?', (id) => <YesNo id={id} value={p.electSBR} onChange={(v) => setP({ electSBR: v })} disabled={ev.sbrLocked} />, sbrEligibleNote)}
          {card(
            'priorPeriodsUnder3M',
            'All earlier periods had revenue ≤ AED 3M?',
            (id) => <YesNo id={id} value={p.priorPeriodsUnder3M} onChange={(v) => setP({ priorPeriodsUnder3M: v })} />,
            !st('priorPeriodsUnder3M')?.answered && <span>Say yes if this is the first period.</span>,
          )}
          {card('electRealisation', 'Realisation basis elected?', (id) => (
            <select
              id={id}
              className={realisationValue ? '' : 'empty'}
              value={realisationValue}
              onChange={(e) => {
                const v = e.target.value;
                setP({ electRealisation: v === '' ? undefined : v === 'na' ? 'na' : v === 'yes' });
              }}
            >
              <option value="">Not answered</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="na">Not relevant (no unrealised items)</option>
            </select>
          ))}
          {card('hasForeignIncome', 'Foreign income or a foreign branch?', (id) => (
            <YesNo id={id} value={p.hasForeignIncome} onChange={(v) => setP({ hasForeignIncome: v })} />
          ))}
          {showForeign &&
            card('hasTaxCertificates', 'Foreign tax certificates held?', (id) => <YesNo id={id} value={p.hasTaxCertificates} onChange={(v) => setP({ hasTaxCertificates: v })} />)}
          {showForeign &&
            card('electForeignPE', 'Foreign branch (PE) exemption elected?', (id) => <YesNo id={id} value={p.electForeignPE} onChange={(v) => setP({ electForeignPE: v })} />)}
          {card('ownershipChange', 'Did ownership change this period?', (id) => (
            <YesNo id={id} value={p.ownershipChange} onChange={(v) => setP({ ownershipChange: v })} />
          ))}
          {st('ownershipChangeLosses')?.visible &&
            card(
              'ownershipChangeLosses',
              'Losses after the ownership change',
              (id) => (
                <select
                  id={id}
                  className={p.ownershipChangeLosses ? '' : 'empty'}
                  value={p.ownershipChangeLosses ?? ''}
                  onChange={(e) => setP({ ownershipChangeLosses: (e.target.value || undefined) as ProfileT['ownershipChangeLosses'] })}
                >
                  <option value="">Not decided (cautious mode decides)</option>
                  <option value="use">Use the losses (conditions met)</option>
                  <option value="exclude">Exclude the losses</option>
                </select>
              ),
              <span>Losses need 50% continuing ownership or the same business.</span>,
            )}
        </div>
      </fieldset>

      {p.legalForm === 'qfzp' && (
        <fieldset className="pgroup">
          <legend>Qualifying Free Zone Person</legend>
          <div className="cgrid">
            <CardField label="Qualifying income (after its share of costs)" need={p.qfzp.qualifyingIncome === undefined} note="Qualifying income minus the costs that relate to it, in AED. The rest of taxable income is taxed at 9%.">
              {(id) => <NumberInput id={id} value={p.qfzp.qualifyingIncome} placeholder="Not answered" onChange={(v) => setQ({ qualifyingIncome: v })} />}
            </CardField>
            <CardField label="Non-qualifying revenue (AED)" need={p.qfzp.nonQualifyingRevenue === undefined}>
              {(id) => <NumberInput id={id} value={p.qfzp.nonQualifyingRevenue} placeholder="Not answered" onChange={(v) => setQ({ nonQualifyingRevenue: v })} min={0} />}
            </CardField>
            <CardField label="Carries on a qualifying activity?" need={p.qfzp.qualifyingActivity === undefined}>
              {(id) => <YesNo id={id} value={p.qfzp.qualifyingActivity} onChange={(v) => setQ({ qualifyingActivity: v })} />}
            </CardField>
            <CardField label="Adequate substance in the free zone?" need={p.qfzp.substance === undefined}>
              {(id) => <YesNo id={id} value={p.qfzp.substance} onChange={(v) => setQ({ substance: v })} />}
            </CardField>
            <CardField label="Audited financial statements?" need={p.qfzp.auditedFS === undefined}>
              {(id) => <YesNo id={id} value={p.qfzp.auditedFS} onChange={(v) => setQ({ auditedFS: v })} />}
            </CardField>
            <CardField label="Transfer pricing rules met?" need={p.qfzp.tpCompliance === undefined}>
              {(id) => <YesNo id={id} value={p.qfzp.tpCompliance} onChange={(v) => setQ({ tpCompliance: v })} />}
            </CardField>
            <CardField label="Has NOT elected to be taxed at 9%?" need={p.qfzp.noElection === undefined}>
              {(id) => <YesNo id={id} value={p.qfzp.noElection} onChange={(v) => setQ({ noElection: v })} yes="Correct, no election" no="Election made" />}
            </CardField>
            <CardField
              label="QFZP status lost in an earlier period: period end"
              note={
                q.lostUntil
                  ? `Standard rate for that period and the next ${SETTINGS.qfzp.failurePenaltyPeriods - 1}: until the period ending ${fmtDate(q.lostUntil)}.`
                  : 'Filled when the client is duplicated after a failed year. Leave empty if QFZP status was never lost.'
              }
            >
              {(id) => <DateInput id={id} value={p.qfzpLostPeriodEnd} onChange={(v) => setP({ qfzpLostPeriodEnd: v })} />}
            </CardField>
          </div>
          {q.failedThisPeriod && (
            <p className="callout warn-callout" role="status">
              QFZP fails this period. This is saved with the client: when you duplicate it to next year, the standard rate applies there too, until the period ending{' '}
              {fmtDate(p.periodEnd ? qfzpLockUntil(p.periodEnd) : undefined)}.
            </p>
          )}
        </fieldset>
      )}
    </Section>
  );
}
