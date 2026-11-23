import { SETTINGS } from '../engine/settings';
import type { DeadlineInputs, RegistrantType, Workspace } from '../engine/types';
import { REGISTRANT_LABELS } from '../engine/types';
import type { Evaluation } from '../engine/workspace';
import { aed, daysBetween, fmtDate, pct, todayIso } from '../engine/util';
import type { Update } from './Profile';
import { DateInput, Field, NumberInput, Section } from './ui';

export function Deadlines({ ws, ev, update }: { ws: Workspace; ev: Evaluation; update: Update }) {
  const d = ws.deadlines;
  const r = ev.deadlines;
  const set = (patch: Partial<DeadlineInputs>) => update((w) => ({ ...w, deadlines: { ...w.deadlines, ...patch } }));
  const today = todayIso();

  const type = r.registrantType;
  const defaultYear = ws.profile.periodEnd ? Number(ws.profile.periodEnd.slice(0, 4)) : undefined;

  return (
    <Section id="deadlines" step="9" title="Deadlines and penalties" intro="Enter the dates you know. Dates that have not happened yet are estimated to today.">
      <div className="grid two">
        <Field label="Who is registering?" hint={!d.registrantType && ws.profile.businessType === 'natural_person' ? 'From the profile: natural person.' : 'Decides the registration deadline.'}>
          {(id) => (
            <select id={id} value={type} onChange={(e) => set({ registrantType: e.target.value as RegistrantType })}>
              {(Object.keys(REGISTRANT_LABELS) as RegistrantType[]).map((k) => (
                <option key={k} value={k}>
                  {REGISTRANT_LABELS[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {type === 'company' && <Field label="Incorporation date">{(id) => <DateInput id={id} value={d.incorporationDate} onChange={(v) => set({ incorporationDate: v })} />}</Field>}
        {type === 'natural_person' && (
          <>
            <Field label="Business turnover in the year (AED)" hint={`Registration is needed when it is above ${aed(SETTINGS.naturalPersonTurnover)}.`}>
              {(id) => <NumberInput id={id} value={d.turnover} min={0} onChange={(v) => set({ turnover: v })} />}
            </Field>
            <Field label="Calendar year of that turnover" hint={d.turnoverYear === undefined && defaultYear ? `Default: ${defaultYear} (the period end).` : undefined}>
              {(id) => <NumberInput id={id} value={d.turnoverYear} placeholder={defaultYear ? String(defaultYear) : undefined} min={0} onChange={(v) => set({ turnoverYear: v === undefined ? undefined : Math.round(v) })} />}
            </Field>
          </>
        )}
        {type === 'nonresident_pe' && (
          <Field label="Date the permanent establishment started">{(id) => <DateInput id={id} value={d.peStartDate} onChange={(v) => set({ peStartDate: v })} />}</Field>
        )}
        {type === 'nonresident_nexus' && <Field label="Date the nexus was established">{(id) => <DateInput id={id} value={d.nexusDate} onChange={(v) => set({ nexusDate: v })} />}</Field>}
        <Field label="First tax period start">{(id) => <DateInput id={id} value={d.firstPeriodStart} onChange={(v) => set({ firstPeriodStart: v })} />}</Field>
        <Field label="First tax period end">{(id) => <DateInput id={id} value={d.firstPeriodEnd} onChange={(v) => set({ firstPeriodEnd: v })} />}</Field>
        <Field label="This period ends" need={!d.periodEnd && !ws.profile.periodEnd} hint={!d.periodEnd && ws.profile.periodEnd ? `From the profile: ${fmtDate(ws.profile.periodEnd)}` : undefined}>
          {(id) => <DateInput id={id} value={d.periodEnd ?? ws.profile.periodEnd} onChange={(v) => set({ periodEnd: v })} />}
        </Field>
        <Field label="Registration date">{(id) => <DateInput id={id} value={d.registrationDate} onChange={(v) => set({ registrationDate: v })} />}</Field>
        <Field label="Return filed on">{(id) => <DateInput id={id} value={d.returnFiledDate} onChange={(v) => set({ returnFiledDate: v })} />}</Field>
        <Field label="Tax paid on">{(id) => <DateInput id={id} value={d.taxPaidDate} onChange={(v) => set({ taxPaidDate: v })} />}</Field>
        <Field label="Tax to pay (AED)" hint={d.taxAmount === undefined ? 'Default: the computed tax.' : undefined}>
          {(id) => <NumberInput id={id} value={d.taxAmount} placeholder={aed(Math.round(ev.result.tax))} min={0} onChange={(v) => set({ taxAmount: v })} />}
        </Field>
      </div>

      <dl className="rows">
        <div>
          <dt>Registration due{r.registrationBasis ? ` (${r.registrationBasis})` : ''}</dt>
          <dd>{fmtDate(r.registrationDue)}</dd>
        </div>
        <div>
          <dt>Return and payment due</dt>
          <dd>{fmtDate(r.returnDue)}</dd>
        </div>
        <div>
          <dt>Late-registration waiver: file first return by</dt>
          <dd>{fmtDate(r.waiverDeadline)}</dd>
        </div>
        <div>
          <dt>Late registration</dt>
          <dd>{r.registrationLate ? (r.waiverApplies ? 'Late, waived' : aed(r.penalties.lateRegistration)) : aed(0)}</dd>
        </div>
        <div>
          <dt>Late filing ({r.monthsLateFiling} month{r.monthsLateFiling === 1 ? '' : 's'})</dt>
          <dd>{aed(r.penalties.lateFiling)}</dd>
        </div>
        <div>
          <dt>
            Late payment ({r.daysLatePayment} days late = {r.monthsLatePayment} month{r.monthsLatePayment === 1 ? '' : 's'} or part, {pct(SETTINGS.penalties.latePaymentAnnualRate, 0)} a year)
          </dt>
          <dd>{aed(r.penalties.latePayment, 2)}</dd>
        </div>
        <div className="total">
          <dt>Penalties in total (estimate)</dt>
          <dd className={r.penalties.total > 0 ? 'bad' : ''}>{aed(r.penalties.total, 2)}</dd>
        </div>
      </dl>

      {r.notes.length > 0 && (
        <ul className="notes">
          {r.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <h3 className="sub-title">Timeline</h3>
      {r.events.length === 0 ? (
        <p className="muted">Enter some dates to see the timeline.</p>
      ) : (
        <>
          <div className="legend" aria-hidden="true">
            <span>
              <span className="dot" style={{ background: 'var(--sug-fg)' }} />
              Due
            </span>
            <span>
              <span className="dot" style={{ background: 'var(--pass-fg)' }} />
              Done on time
            </span>
            <span>
              <span className="dot" style={{ background: 'var(--high-fg)' }} />
              Late
            </span>
            <span>
              <span className="dot" style={{ background: 'var(--muted)' }} />
              Fact
            </span>
          </div>
          <ol className="vtl" aria-label="Timeline of dates">
            {withToday(r.events, today).map((e, i) => {
              const days = daysBetween(today, e.date);
              const rel = e.kind === 'today' ? 'Today' : days === 0 ? 'today' : days > 0 ? `in ${days} days` : `${-days} days ago`;
              return (
                <li key={`${e.date}-${i}`} className={`vtl-item ${e.kind}`}>
                  <span className="vtl-dot" aria-hidden="true" />
                  <span className="vtl-date num">{fmtDate(e.date)}</span>
                  <span className="vtl-label">
                    {e.label}
                    {e.kind !== 'today' && <span className="muted small"> · {rel}</span>}
                    <span className="visually-hidden"> ({e.kind === 'due' ? 'due date' : e.kind === 'late' ? 'late' : e.kind === 'done' ? 'on time' : 'fact'})</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Section>
  );
}

function withToday(events: Evaluation['deadlines']['events'], today: string) {
  const list: { date: string; label: string; kind: string }[] = events.map((e) => ({ ...e }));
  const at = list.findIndex((e) => e.date > today);
  const item = { date: today, label: 'Today', kind: 'today' };
  if (at === -1) list.push(item);
  else list.splice(at, 0, item);
  return list;
}
