import type { ForeignTaxRow, Headline as HeadlineT, LineAnswer, Sourced, Workspace } from '../engine/types';
import { CT_REVENUE_GROUP_LABELS, refText } from '../engine/types';
import type { Evaluation } from '../engine/workspace';
import { addDays, addMonths, aed, num } from '../engine/util';
import type { Update } from './Profile';
import { CardField, DateInput, Field, NumberInput, Pill, Section, SourceChip } from './ui';

/** Foreign tax credit (Art. 47): one row per country or source; each row is capped on its own. */
function ForeignTaxCredit({ ws, ev, update }: { ws: Workspace; ev: Evaluation; update: Update }) {
  const rows = ws.headline.foreignTax ?? [];
  const ftc = ev.result.foreignTaxCredit;
  const setRows = (next: ForeignTaxRow[]) => update((w) => ({ ...w, headline: { ...w.headline, foreignTax: next.length ? next : undefined } }));
  const setRow = (i: number, patch: Partial<ForeignTaxRow>) => setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="box">
      <h3 className="box-title">Foreign tax credit (Art. 47)</h3>
      <p className="box-text">
        One row per country or source of foreign income. For each row the credit is the lower of the foreign tax paid and the UAE tax on that income (tax × that income ÷ taxable income
        after losses). Unused credit is lost: it is not carried forward, carried back or refunded.
      </p>
      {rows.length === 0 && <p className="box-empty">No foreign income</p>}
      {rows.map((row, i) => {
        const res = ftc.rows[i];
        return (
          <div key={i} className="box-row">
            <div className="row-fields">
              <Field label="Country or source" hint="Shown in the working paper.">
                {(id) => <input id={id} value={row.country ?? ''} placeholder={`Row ${i + 1}`} onChange={(e) => setRow(i, { country: e.target.value || undefined })} />}
              </Field>
              <Field label="Foreign income in taxable income (AED)" hint="After the costs that relate to it.">
                {(id) => <NumberInput id={id} value={row.income} min={0} onChange={(v) => setRow(i, { income: v })} />}
              </Field>
              <Field label="Foreign tax paid on it (AED)" hint="Keep the foreign tax certificate.">
                {(id) => <NumberInput id={id} value={row.taxPaid} min={0} onChange={(v) => setRow(i, { taxPaid: v })} />}
              </Field>
            </div>
            {res && res.taxPaid > 0 && (
              <p className="box-result">
                UAE tax on this income (cap) {aed(res.cap, 2)} · credit {aed(res.credit, 2)} · cannot be used {aed(res.unused, 2)}
              </p>
            )}
            <button type="button" className="link-btn danger-link" aria-label={`Remove foreign tax row ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        );
      })}
      {ftc.taxPaid > 0 && (
        <dl className="rows">
          <div>
            <dt>Foreign tax paid</dt>
            <dd>{aed(ftc.taxPaid, 2)}</dd>
          </div>
          <div>
            <dt>Foreign tax credit</dt>
            <dd>{aed(ftc.credit, 2)}</dd>
          </div>
          <div>
            <dt>Cannot be used (lost)</dt>
            <dd>{aed(ftc.unused, 2)}</dd>
          </div>
        </dl>
      )}
      <button type="button" className="link-btn" onClick={() => setRows([...rows, {}])}>
        + Add country
      </button>
    </div>
  );
}

/** Total revenue for the SBR and QFZP de minimis tests: the figure, its breakdown, and a choice per income line. */
function RevenueForTests({ ws, ev, update }: { ws: Workspace; ev: Evaluation; update: Update }) {
  const ct = ev.result.ctRevenue;
  const setAnswer = (key: string, patch: Partial<LineAnswer>) => update((w) => ({ ...w, answers: { ...w.answers, [key]: { ...w.answers[key], ...patch } } }));
  const fromStatements = ws.headline.revenue.value !== undefined;
  return (
    <div className="box">
      <h3 className="box-title">
        Total revenue for SBR / QFZP tests ·{' '}
        <output data-testid="ct-revenue-total" aria-label="Total revenue for SBR / QFZP tests">
          {aed(ct.total)}
        </output>
      </h3>
      <p className="box-text">
        Used for the Small Business Relief limit and the QFZP de minimis test. Every income line counts, because the law defines revenue as the gross amount of income (Art. 1). Leave a line
        out only when the law excludes it, and give the reason. VAT is never part of revenue.
      </p>
      <dl className="rows">
        <div>
          <dt>Revenue{fromStatements ? ' (from the statements)' : ' (TB revenue lines)'}</dt>
          <dd>{num(ct.revenue)}</dd>
        </div>
        <div>
          <dt>{CT_REVENUE_GROUP_LABELS.other_income}</dt>
          <dd>{num(ct.otherIncome)}</dd>
        </div>
        <div>
          <dt>{CT_REVENUE_GROUP_LABELS.gains}</dt>
          <dd>{num(ct.gains)}</dd>
        </div>
        <div>
          <dt>{CT_REVENUE_GROUP_LABELS.exempt_income}</dt>
          <dd>{num(ct.exemptIncome)}</dd>
        </div>
        <div>
          <dt>Left out by staff (not counted)</dt>
          <dd>{num(ct.excluded)}</dd>
        </div>
        <div>
          <dt>VAT</dt>
          <dd>
            <Pill kind="neutral">Excluded</Pill>
          </dd>
        </div>
      </dl>
      {ct.lines.length > 0 && (
        <details className="box-details">
          <summary>
            Choose which lines count ({ct.lines.filter((l) => l.included).length} of {ct.lines.length} counted)
          </summary>
          <div className="rev-lines">
            {ct.lines.map((l) => {
              const changed = l.included !== l.includedByDefault;
              return (
                <div key={l.key} className={`rev-line ${changed ? 'changed' : ''}`}>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={l.included}
                      onChange={(e) => setAnswer(l.key, { revenueTest: e.target.checked === l.includedByDefault ? undefined : e.target.checked })}
                    />
                    <span>
                      {l.account} <span className="tag">{CT_REVENUE_GROUP_LABELS[l.group]}</span> {l.source && <span className="tag">{l.source}</span>}
                    </span>
                  </label>
                  <span className="num">{aed(l.amount)}</span>
                  <span className="rev-reason">
                    <input
                      aria-label={`Reason for ${l.included ? 'counting' : 'leaving out'} ${l.account}`}
                      placeholder={changed ? 'Reason (needed)' : 'Reason (optional)'}
                      value={ws.answers[l.key]?.revenueTestReason ?? ''}
                      onChange={(e) => setAnswer(l.key, { revenueTestReason: e.target.value || undefined })}
                      style={{ width: '100%' }}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

type Key = 'pbt' | 'revenue' | 'totalIncome' | 'sharedOverheads' | 'otherDeductions';

export function Headline({ ws, ev, update, onReset }: { ws: Workspace; ev: Evaluation; update: Update; onReset: (k: Key) => void }) {
  const h = ws.headline;
  const set = (k: Key, v: number | undefined) => update((w) => ({ ...w, headline: { ...w.headline, [k]: v === undefined ? {} : ({ value: v, byHand: true } as Sourced) } }));
  const setH = (patch: Partial<HeadlineT>) => update((w) => ({ ...w, headline: { ...w.headline, ...patch } }));
  const r = ev.result;
  const defaultTotal = r.revenue + r.otherIncome + r.exemptIncome;
  const sug = ws.fsFacts.lossSuggestion;
  const priorStart = ws.profile.periodStart ? addDays(addMonths(ws.profile.periodStart, -12), 0) : '';

  const box = (k: Key, label: string, hint: string, placeholder?: string, fallback?: string, need?: boolean) => (
    <CardField
      className="nbox"
      label={label}
      need={need}
      note={
        <>
          <span>
            <SourceChip s={h[k]} fallback={fallback} />
            {h[k].byHand && (
              <>
                {' · '}
                <button type="button" className="link-btn" onClick={() => onReset(k)}>
                  Use file value
                </button>
              </>
            )}
          </span>
          {hint && <span>{hint}</span>}
        </>
      }
    >
      {(id) => <NumberInput id={id} value={h[k].value} onChange={(v) => set(k, v)} placeholder={placeholder ?? 'Enter by hand'} />}
    </CardField>
  );

  return (
    <Section id="numbers" step="3" title="Headline numbers" intro="Numbers read from the files show their sheet and cell. Type over any number to change it.">
      <div className="nboxes">
        {box('pbt', 'Profit before tax (AED)', '', h.pbt.value === undefined ? num(r.pbt) : undefined, h.pbt.value === undefined ? ev.pbtSource || 'Not found' : undefined, h.pbt.value === undefined && !ws.tbLines.length && !ev.vat.hasData)}
        {box('revenue', 'Revenue (AED)', '', h.revenue.value === undefined ? `${num(r.revenue)} from TB` : undefined, h.revenue.value === undefined ? 'Sum of TB revenue lines' : undefined)}
        {box('totalIncome', 'Total income for AB-04 (AED)', 'Revenue + other income + exempt income.', num(defaultTotal), 'Default')}
        {box('sharedOverheads', 'Shared overheads (AED)', 'Costs that serve both taxable and exempt income.', undefined, 'Entered by hand')}
        {box('otherDeductions', 'Other deductions (AED)', 'Any other Step 3 deduction.', undefined, 'Entered by hand')}
      </div>

      <div className="numbers-split">
        <RevenueForTests ws={ws} ev={ev} update={update} />

        <div className="numbers-side">
          <div className="box">
            <h3 className="box-title">Tax losses brought forward</h3>
            {sug && !h.lossesBF.length && (
              <div className="callout">
                <span>
                  Found “{sug.label}” of {aed(sug.value)} at <span className="tag">{refText(sug.ref)}</span>. Is this the loss brought forward?
                </span>
                <button type="button" className="small" onClick={() => setH({ lossesBF: [{ periodStart: priorStart, amount: sug.value, source: refText(sug.ref) }] })}>
                  Yes, add it
                </button>
              </div>
            )}
            <p className="box-text">
              {h.lossesBF.length ? '' : 'None entered. '}One row per loss period. Losses from periods that started before 1 June 2023 are not allowed.
            </p>
            {h.lossesBF.map((l, i) => (
              <div className="box-row" key={i}>
                <div className="row-fields">
                  <Field label="Loss period started" hint="Required. Without it the loss is not used.">
                    {(id) => <DateInput id={id} value={l.periodStart || undefined} onChange={(v) => setH({ lossesBF: h.lossesBF.map((x, j) => (j === i ? { ...x, periodStart: v ?? '' } : x)) })} />}
                  </Field>
                  <Field label="Loss (AED)" hint={l.source ? `From ${l.source}` : 'Entered by hand'}>
                    {(id) => <NumberInput id={id} value={l.amount} min={0} onChange={(v) => setH({ lossesBF: h.lossesBF.map((x, j) => (j === i ? { ...x, amount: v ?? 0 } : x)) })} />}
                  </Field>
                </div>
                <button type="button" className="link-btn danger-link" aria-label={`Remove loss row ${i + 1}`} onClick={() => setH({ lossesBF: h.lossesBF.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="link-btn" onClick={() => setH({ lossesBF: [...h.lossesBF, { periodStart: priorStart, amount: 0 }] })}>
              + Add loss row
            </button>
          </div>

          <div className="numbers-pair">
            <div className="box">
              <h3 className="box-title">Interest carried forward (AB-13)</h3>
              <p className="box-text">Disallowed net interest from earlier periods, by the year it was disallowed. It expires after 10 years.</p>
              {h.interestCF.length === 0 && <p className="box-empty">None</p>}
              {h.interestCF.map((l, i) => (
                <div className="box-row" key={i}>
                  <div className="row-fields">
                    <Field label="Year disallowed">
                      {(id) => <NumberInput id={id} value={l.year} onChange={(v) => setH({ interestCF: h.interestCF.map((x, j) => (j === i ? { ...x, year: Math.round(v ?? 0) } : x)) })} />}
                    </Field>
                    <Field label="Amount (AED)">
                      {(id) => <NumberInput id={id} value={l.amount} min={0} onChange={(v) => setH({ interestCF: h.interestCF.map((x, j) => (j === i ? { ...x, amount: v ?? 0 } : x)) })} />}
                    </Field>
                  </div>
                  <button type="button" className="link-btn danger-link" aria-label={`Remove interest row ${i + 1}`} onClick={() => setH({ interestCF: h.interestCF.filter((_, j) => j !== i) })}>
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="link-btn"
                onClick={() => setH({ interestCF: [...h.interestCF, { year: ws.profile.periodEnd ? Number(ws.profile.periodEnd.slice(0, 4)) - 1 : new Date().getFullYear() - 1, amount: 0 }] })}
              >
                + Add row
              </button>
            </div>
            <ForeignTaxCredit ws={ws} ev={ev} update={update} />
          </div>
        </div>
      </div>
    </Section>
  );
}
