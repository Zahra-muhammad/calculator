import type { ReactNode } from 'react';
import { SETTINGS } from '../engine/settings';
import type { Evaluation } from '../engine/workspace';
import { aed, num, pct } from '../engine/util';
import { Pill, RuleChip, Section } from './ui';

/** kind: "step", "step strong", "detail" or "total". */
function Row(props: { step?: string; desc: ReactNode; meta?: ReactNode; rule?: string; amount?: string; kind?: string }) {
  return (
    <div className={`tape-row ${props.kind ?? ''}`} role="row">
      <span className="step-no" role="cell">
        {props.step ?? ''}
      </span>
      <span className="desc" role="cell">
        {props.desc}
        {props.meta && <span className="meta">{props.meta}</span>}
      </span>
      <span className="rule" role="cell">
        {props.rule ? <RuleChip rule={props.rule} /> : null}
      </span>
      <span className="amt" role="cell">
        {props.amount ?? ''}
      </span>
    </div>
  );
}

const REGIME_LABEL = { standard: 'Standard', sbr: 'SBR', qfzp: 'QFZP' } as const;

export function Computation({ ev }: { ev: Evaluation }) {
  const r = ev.result;
  const S = SETTINGS;
  const regimeText =
    r.regime === 'sbr'
      ? 'Small Business Relief applies: no tax.'
      : r.regime === 'qfzp'
        ? `QFZP: ${aed(r.qfzp.qualifyingIncome)} qualifying income at 0%; ${aed(r.qfzp.taxableNonQualifying)} taxable non-qualifying income at ${pct(S.rate, 0)} with no 0% band.`
        : `Standard: ${pct(S.rate, 0)} on taxable income above ${aed(S.zeroBand)}.`;
  const taxDesc = r.regime === 'standard' ? `Tax: ${pct(S.rate, 0)} × (${num(r.taxableAfterLoss)} − ${num(S.zeroBand)})` : 'Tax';
  const sbrStatus = r.sbr.applied
    ? { kind: 'pass' as const, text: 'Applied' }
    : r.sbr.elected && !r.sbr.eligible
      ? { kind: 'high' as const, text: 'Elected, not eligible' }
      : r.sbr.elected
        ? { kind: 'medium' as const, text: 'Elected, not applied: confirm first' }
        : r.sbr.eligible
          ? { kind: 'pass' as const, text: 'Eligible · not elected' }
          : { kind: 'neutral' as const, text: 'Not eligible' };

  return (
    <Section id="computation" step="6" title="Computation" intro="The tax tape, step by step. Each add-back shows its rule and the line it came from.">
      <div className="comp-grid">
        <div className="tape" role="table" aria-label="Tax computation">
          <Row
            step="Step 1"
            kind="step"
            desc={
              <>
                Profit before tax <span className="faint">· {ev.pbtSource || 'Not found'}</span>
              </>
            }
            amount={num(r.pbt)}
          />
          <Row step="Step 2" kind="step" desc="Add-backs" amount={`+ ${num(r.totalAddBacks)}`} />
          {r.addBacks.length === 0 && <Row kind="detail" desc="No add-backs." />}
          {r.addBacks.map((a, i) => (
            <Row
              key={`ab-${i}`}
              kind="detail"
              desc={
                <>
                  {a.label}
                  {a.account ? ` — ${a.account}` : ''}
                  {a.source ? ` · ${a.source}` : ''}
                </>
              }
              meta={
                <>
                  {a.basis}
                  {a.answer ? ` · ${a.answer}` : ''}
                </>
              }
              rule={a.ruleId}
              amount={num(a.amount)}
            />
          ))}
          <Row step="Step 3" kind="step" desc="Exempt income and other deductions" amount={`− ${num(r.totalDeductions)}`} />
          {r.deductions.length === 0 && <Row kind="detail" desc="No deductions." />}
          {r.deductions.map((d, i) => (
            <Row
              key={`d-${i}`}
              kind="detail"
              desc={
                <>
                  {d.label}
                  {d.account ? ` — ${d.account}` : ''}
                  {d.source ? ` · ${d.source}` : ''}
                </>
              }
              meta={d.basis}
              rule={d.ruleId}
              amount={num(d.amount)}
            />
          ))}
          <Row step="Step 4" kind="step strong" desc="Taxable income" amount={num(r.taxableIncome)} />
          <Row
            step="Step 5"
            kind="step"
            desc={
              r.regime === 'sbr'
                ? 'Loss relief: not used under Small Business Relief'
                : `Loss relief: brought forward ${num(r.loss.broughtForward)}, cap ${pct(S.lossOffsetCap, 0)} = ${num(r.loss.cap)}`
            }
            amount={`− ${num(r.loss.used)}`}
          />
          <Row kind="detail" desc="Taxable income after losses" amount={num(r.taxableAfterLoss)} />
          <Row kind="detail" desc={regimeText} />
          {r.foreignTaxCredit.credit > 0 ? (
            <>
              <Row step="Step 6" kind="step" desc={taxDesc} amount={num(r.taxBeforeCredits, 2)} />
              <Row kind="detail" desc="Foreign tax credit" meta={r.foreignTaxCredit.basis} rule="Art. 47" amount={`− ${num(r.foreignTaxCredit.credit, 2)}`} />
              <Row kind="total" desc="Tax payable" amount={aed(Math.round(r.tax))} />
            </>
          ) : (
            <Row step="Step 6" kind="total" desc={taxDesc} amount={num(Math.round(r.tax))} />
          )}
        </div>

        <aside className="summary" aria-label="Summary">
          <div className="summary-head">
            <span>Corporate tax</span>
            <Pill kind="neutral">{REGIME_LABEL[r.regime]}</Pill>
          </div>
          <div className="summary-tax">
            <span className="cur">AED</span> {num(Math.round(r.tax))}
          </div>
          <dl className="rows">
            <div>
              <dt>Effective rate on PBT</dt>
              <dd>{r.pbt > 0 ? pct(r.effectiveRate, 2) : '—'}</dd>
            </div>
            <div>
              <dt>Losses carried forward</dt>
              <dd>{num(r.loss.carriedForward)}</dd>
            </div>
            <div>
              <dt>Interest carried forward</dt>
              <dd>{num(r.interest.totalCarriedForward)}</dd>
            </div>
            <div>
              <dt>Net interest / limit</dt>
              <dd>
                {num(r.interest.net)} / {r.interest.exempt ? 'no limit' : num(r.interest.limit)}
              </dd>
            </div>
            <div>
              <dt>Exempt income</dt>
              <dd>{num(r.exemptIncome)}</dd>
            </div>
            <div>
              <dt>Total revenue for SBR / QFZP</dt>
              <dd>{num(r.ctRevenue.total)}</dd>
            </div>
            {r.foreignTaxCredit.taxPaid > 0 && (
              <div>
                <dt>Foreign tax credit</dt>
                <dd>{num(r.foreignTaxCredit.credit, 2)}</dd>
              </div>
            )}
            <div>
              <dt>Small Business Relief</dt>
              <dd>
                <Pill kind={sbrStatus.kind}>{sbrStatus.text}</Pill>
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      {r.notes.length > 0 && (
        <ul className="notes">
          {r.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}
