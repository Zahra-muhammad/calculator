import { Fragment, useMemo, useState } from 'react';
import { openQuestions } from '../engine/classify';
import type { Category, ClassifiedLine, LineAnswer, ParticipationAnswers, SubLine, Tri, Workspace } from '../engine/types';
import { CATEGORIES, CATEGORY_MAP, EVIDENCE_LABELS } from '../engine/types';
import type { Evaluation } from '../engine/workspace';
import { num } from '../engine/util';
import type { Update } from './Profile';
import { Field, NumberInput, PercentInput, RuleChip, Section, YesNo } from './ui';

type Tab = 'pl' | 'review' | 'all';

function balanceText(b: number): string {
  return `${num(Math.abs(b), Number.isInteger(b) ? 0 : 2)} ${b >= 0 ? 'Dr' : 'Cr'}`;
}

/** Add-back (positive) or deduction (negative) for one line, or "–". */
function effectText(v: number | undefined): string {
  return v ? num(v, Number.isInteger(v) ? 0 : 2) : '–';
}

export function Accounts({ ws, ev, update }: { ws: Workspace; ev: Evaluation; update: Update }) {
  const [tab, setTab] = useState<Tab>('pl');

  const setAnswer = (key: string, patch: Partial<LineAnswer>) =>
    update((w) => ({ ...w, answers: { ...w.answers, [key]: { ...w.answers[key], ...patch } } }));
  const setCategory = (key: string, cat: Category | undefined) =>
    update((w) => {
      const mappings = { ...w.mappings };
      if (cat) mappings[key] = cat;
      else delete mappings[key];
      return { ...w, mappings };
    });

  const items = useMemo(() => {
    const subsBy = new Map<string, SubLine[]>();
    for (const s of ev.subLines) subsBy.set(s.parentKey, [...(subsBy.get(s.parentKey) ?? []), s]);
    return ev.classified.map((line) => {
      const subs = subsBy.get(line.key) ?? [];
      const open =
        openQuestions(line.category, ws.answers[line.key], line.evidence, line.relatedParty).length > 0 || subs.some((s) => openQuestions(s.category, ws.answers[s.key]).length > 0);
      return { line, subs, open };
    });
  }, [ev.classified, ev.subLines, ws.answers]);

  // What each line adds back (+) or deducts (−) in the computation.
  const effect = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of ev.result.addBacks) if (a.lineKey) m.set(a.lineKey, (m.get(a.lineKey) ?? 0) + a.amount);
    for (const d of ev.result.deductions) if (d.lineKey) m.set(d.lineKey, (m.get(d.lineKey) ?? 0) - d.amount);
    return m;
  }, [ev.result]);

  const needCount = items.filter((i) => i.open).length;
  const plCount = items.filter((i) => i.line.category !== 'balance_sheet').length;
  const shown = items.filter((i) => (tab === 'all' ? true : tab === 'review' ? i.open : i.line.category !== 'balance_sheet'));
  const sug = ws.suggestions;
  const sugCount = sug ? Object.keys(sug.mappings).filter((k) => ev.classified.some((l) => l.key === k && l.category !== sug.mappings[k])).length : 0;

  return (
    <Section
      id="accounts"
      step="4"
      title="Accounts"
      intro="Each trial balance line gets one tax category. Change any category from the list; your choice is saved for this client. Lines that need a person are highlighted, with their questions below them."
      actions={
        ev.classified.length > 0 && (
          <div className="seg" role="tablist" aria-label="Which lines to show">
            {(
              [
                ['review', `Needs a person (${needCount})`],
                ['pl', `P&L lines (${plCount})`],
                ['all', `All (${items.length})`],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </div>
        )
      }
    >
      {!ev.classified.length ? (
        <p className="empty-state">Upload a trial balance to see the accounts.</p>
      ) : (
        <>
          <div className="cautious">
            <label className="switch" title="When on, a few unanswered questions take the stricter reading.">
              <input type="checkbox" checked={ws.cautious} onChange={(e) => update((w) => ({ ...w, cautious: e.target.checked }))} />
              Cautious mode {ws.cautious ? 'on' : 'off'}
            </label>
            <span>
              {ws.cautious
                ? 'Cautious mode is on: unsplit entertainment counts as client entertainment, and VAT of unknown recoverability is added back. Other open questions add nothing until answered; their flags stay open.'
                : 'Cautious mode is off: unsplit entertainment and VAT of unknown recoverability add nothing until answered. Flags are still raised.'}
            </span>
          </div>
          {sugCount > 0 && sug && (
            <div className="callout">
              <span>{sugCount} line(s) had a different category last year.</span>
              <button type="button" className="small" onClick={() => update((w) => ({ ...w, mappings: { ...sug.mappings, ...w.mappings } }))}>
                Use last year’s categories
              </button>
            </div>
          )}
          <div className="acc-wrap" role="tabpanel" aria-label="Trial balance lines">
            {shown.length === 0 ? (
              <p className="empty-state">Nothing to show here.</p>
            ) : (
              <table className="acc-table">
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Account</th>
                    <th scope="col" className="r">
                      Balance
                    </th>
                    <th scope="col">Tax category</th>
                    <th scope="col">Rule</th>
                    <th scope="col">Why</th>
                    <th scope="col" className="r">
                      Add-back
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ line, subs, open }) => (
                    <Fragment key={line.key}>
                      <LineRows
                        line={line}
                        open={open && openQuestions(line.category, ws.answers[line.key], line.evidence, line.relatedParty).length > 0}
                        mapped={!!ws.mappings[line.key]}
                        answer={ws.answers[line.key]}
                        lastYear={sug?.mappings[line.key]}
                        lastYearAnswer={sug?.answers[line.key]}
                        effect={effect.get(line.key)}
                        ev={ev}
                        ws={ws}
                        onCategory={(c) => setCategory(line.key, c)}
                        onAnswer={(p) => setAnswer(line.key, p)}
                      />
                      {subs.map((s) => (
                        <SubRows key={s.key} sub={s} answer={ws.answers[s.key]} effect={effect.get(s.key)} ev={ev} ws={ws} onAnswer={(p) => setAnswer(s.key, p)} />
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

function CategorySelect({ value, onChange, label }: { value: Category; onChange: (c: Category) => void; label: string }) {
  return (
    <select className="cat" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Category)}>
      {CATEGORIES.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
          {c.rule !== '—' ? ` (${c.rule})` : ''}
        </option>
      ))}
    </select>
  );
}

function LineRows(props: {
  line: ClassifiedLine;
  open: boolean;
  mapped: boolean;
  answer?: LineAnswer;
  lastYear?: Category;
  lastYearAnswer?: LineAnswer;
  effect?: number;
  ev: Evaluation;
  ws: Workspace;
  onCategory: (c: Category | undefined) => void;
  onAnswer: (p: Partial<LineAnswer>) => void;
}) {
  const { line } = props;
  const info = CATEGORY_MAP[line.category];
  return (
    <>
      <tr className={`acc-row ${props.open ? 'open' : ''}`} data-testid="acc-line">
        <td className="c-row" title={`Sheet ${line.sheet}, row ${line.row}`}>
          {line.row}
        </td>
        <td className="c-name">
          <div className="name">{line.account}</div>
          {line.comment && <div className="comment">“{line.comment}”</div>}
        </td>
        <td className="c-bal num r">{balanceText(line.balance)}</td>
        <td className="c-cat">
          <CategorySelect value={line.category} label={`Category for ${line.account}`} onChange={(c) => props.onCategory(c)} />
          {(props.mapped || (props.lastYear && props.lastYear !== line.category)) && (
            <div className="cat-actions">
              {props.mapped && (
                <button type="button" className="link-btn" onClick={() => props.onCategory(undefined)}>
                  Reset to automatic
                </button>
              )}
              {props.lastYear && props.lastYear !== line.category && (
                <button type="button" className="small" onClick={() => props.onCategory(props.lastYear)}>
                  Last year: {CATEGORY_MAP[props.lastYear].label}. Use it
                </button>
              )}
            </div>
          )}
        </td>
        <td className="c-rule">{info.rule !== '—' ? <RuleChip rule={info.rule} /> : <span className="dash">–</span>}</td>
        <td className="c-why">
          <span className="evidence">{EVIDENCE_LABELS[line.evidence]}</span> {line.reason} <span className="treatment">{info.treatment}</span>
        </td>
        <td className={`c-eff num r ${props.effect && props.effect > 0 ? 'strong' : ''}`}>{effectText(props.effect)}</td>
      </tr>
      <tr className={`q-row ${props.open ? 'open' : ''}`}>
        <td colSpan={7}>
          <Questions
            lineKey={line.key}
            account={line.account}
            category={line.category}
            amount={line.balance}
            answer={props.answer}
            lastYearAnswer={props.lastYearAnswer}
            evidence={line.evidence}
            relatedParty={line.relatedParty}
            ev={props.ev}
            ws={props.ws}
            onAnswer={props.onAnswer}
          />
        </td>
      </tr>
    </>
  );
}

function SubRows(props: { sub: SubLine; answer?: LineAnswer; effect?: number; ev: Evaluation; ws: Workspace; onAnswer: (p: Partial<LineAnswer>) => void }) {
  const { sub } = props;
  const open = openQuestions(sub.category, props.answer).length > 0;
  return (
    <>
      <tr className={`acc-row sub ${open ? 'open' : ''}`}>
        <td className="c-row" aria-label="Sub-line">
          ↳
        </td>
        <td className="c-name">
          <div className="name">{sub.label}</div>
          <details>
            <summary className="small">Evidence ({sub.evidence.length})</summary>
            <ul className="small muted">
              {sub.evidence.slice(0, 50).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        </td>
        <td className="c-bal num r">{balanceText(sub.amount)}</td>
        <td className="c-cat">
          <span className="tag">{CATEGORY_MAP[sub.category].label}</span>
        </td>
        <td className="c-rule">
          <RuleChip rule={CATEGORY_MAP[sub.category].rule} />
        </td>
        <td className="c-why">{sub.source === 'gl' ? 'Accepted from the general ledger.' : 'Found in the adjustments column.'}</td>
        <td className={`c-eff num r ${props.effect && props.effect > 0 ? 'strong' : ''}`}>{effectText(props.effect)}</td>
      </tr>
      <tr className={`q-row ${open ? 'open' : ''}`}>
        <td colSpan={7}>
          <Questions lineKey={sub.key} account={sub.label} category={sub.category} amount={sub.amount} answer={props.answer} ev={props.ev} ws={props.ws} onAnswer={props.onAnswer} />
        </td>
      </tr>
    </>
  );
}


function TriSelect({ id, value, onChange }: { id: string; value: Tri | undefined; onChange: (v: Tri) => void }) {
  return (
    <select id={id} value={value ?? 'unknown'} onChange={(e) => onChange(e.target.value as Tri)}>
      <option value="unknown">Not known yet</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
  );
}

function Questions(props: {
  lineKey: string;
  account: string;
  category: Category;
  amount: number;
  answer?: LineAnswer;
  lastYearAnswer?: LineAnswer;
  evidence?: string;
  relatedParty?: string;
  ev: Evaluation;
  ws: Workspace;
  onAnswer: (p: Partial<LineAnswer>) => void;
}) {
  const a = props.answer ?? {};
  const qs = openQuestions(props.category, props.answer, props.evidence, props.relatedParty);
  const set = props.onAnswer;
  const p: ParticipationAnswers = a.participation ?? {};
  const setP = (patch: Partial<ParticipationAnswers>) => set({ participation: { ...p, ...patch } });
  const fields: JSX.Element[] = [];

  switch (props.category) {
    case 'entertainment_unsplit':
      fields.push(<Field key="c" label="Client part (AED)" need={a.clientAmount === undefined}>{(id) => <NumberInput id={id} value={a.clientAmount} min={0} onChange={(v) => set({ clientAmount: v })} />}</Field>);
      break;
    case 'pension':
      fields.push(
        <Field key="c" need={a.confirmedAmount === undefined} label="Amount to add back (AED)" hint="As confirmed by the tax team. 0 if none.">
          {(id) => <NumberInput id={id} value={a.confirmedAmount} min={0} onChange={(v) => set({ confirmedAmount: v })} />}
        </Field>,
      );
      break;
    case 'vat_expensed':
      fields.push(<Field key="v" label="Could this VAT have been recovered?" need={!a.vatRecoverable || a.vatRecoverable === 'unknown'}>{(id) => <TriSelect id={id} value={a.vatRecoverable} onChange={(v) => set({ vatRecoverable: v })} />}</Field>);
      break;
    case 'penalty_review':
      fields.push(
        <Field
          key="pt"
          need={!a.penaltyType || a.penaltyType === 'unknown'}
          label="What is this penalty?"
          hint="Only compensation for damages or a breach of contract is allowed (Art. 33). Every other fine or penalty is added back. Nothing is added back until you choose."
        >
          {(id) => (
            <select id={id} value={a.penaltyType ?? 'unknown'} onChange={(e) => set({ penaltyType: e.target.value as LineAnswer['penaltyType'] })}>
              <option value="unknown">Not decided yet</option>
              <option value="government">Fine or penalty, not under a contract (FTA, traffic, municipality…): added back</option>
              <option value="contract">Compensation under a contract (customer, supplier, late delivery…): allowed</option>
            </select>
          )}
        </Field>,
      );
      break;
    case 'no_invoice':
      fields.push(
        <Field key="se" need={!a.supportEvidence || a.supportEvidence === 'unknown'} label="Supporting evidence?" hint='Added back only if you answer "No evidence".'>
          {(id) => (
            <select id={id} value={a.supportEvidence ?? 'unknown'} onChange={(e) => set({ supportEvidence: e.target.value as LineAnswer['supportEvidence'] })}>
              <option value="unknown">Not checked yet</option>
              <option value="found">Evidence found</option>
              <option value="none">No evidence</option>
            </select>
          )}
        </Field>,
      );
      break;
    case 'interest_expense':
      if (props.relatedParty)
        fields.push(
          <Field
            key="a31"
            need={!a.art31Use || a.art31Use === 'unknown'}
            label="Loan used for a dividend, share buyback or capital contribution? (Art. 31)"
            hint="Answer Yes only if there is no good commercial reason for the loan: then all of this interest is added back."
          >
            {(id) => <TriSelect id={id} value={a.art31Use} onChange={(v) => set({ art31Use: v })} />}
          </Field>,
        );
      break;
    case 'related_party_expense':
      fields.push(
        <Field key="m" label="Market value (AED)" hint="From transfer pricing support." need={a.marketValue === undefined}>
          {(id) => <NumberInput id={id} value={a.marketValue} min={0} onChange={(v) => set({ marketValue: v })} />}
        </Field>,
      );
      break;
    case 'connected_person_payment':
      fields.push(
        <Field key="n" label="Person paid" hint="Used to group relatives for the AED 500,000 disclosure.">
          {(id) => (
            <>
              <input id={id} list={`${id}-list`} value={a.personName ?? ''} onChange={(e) => set({ personName: e.target.value || undefined })} />
              <datalist id={`${id}-list`}>
                {props.ws.relatedParties.map((r) => (
                  <option key={r.name} value={r.name} />
                ))}
              </datalist>
            </>
          )}
        </Field>,
        <Field key="b" label="Paid for the business?" hint="Answer No only if it was not for the business: then all of it is added back.">
          {(id) => (
            <select id={id} value={a.businessPurpose === 'no' ? 'no' : ''} onChange={(e) => set({ businessPurpose: e.target.value === 'no' ? 'no' : undefined })}>
              <option value="">Yes (default)</option>
              <option value="no">No</option>
            </select>
          )}
        </Field>,
        <Field key="m" label="Market value (AED)" need={a.marketValue === undefined}>{(id) => <NumberInput id={id} value={a.marketValue} min={0} onChange={(v) => set({ marketValue: v })} />}</Field>,
      );
      break;
    case 'mixed_use':
      fields.push(<Field key="p" label="Private use (%)" need={a.privateUse === undefined}>{(id) => <PercentInput id={id} value={a.privateUse} onChange={(v) => set({ privateUse: v })} />}</Field>);
      break;
    case 'capital_expensed':
      fields.push(
        <Field key="d" label="Tax depreciation this period (AED)" hint="Deducted in Step 3." need={a.taxDepreciation === undefined}>
          {(id) => <NumberInput id={id} value={a.taxDepreciation} min={0} onChange={(v) => set({ taxDepreciation: v })} />}
        </Field>,
      );
      break;
    case 'dividend_received_foreign': {
      const res = props.ev.result.participation.find((x) => x.lineKey === props.lineKey);
      fields.push(
        <Field key="o" label="Ownership (%)" need={p.ownership === undefined && p.acquisitionCost === undefined}>{(id) => <PercentInput id={id} value={p.ownership} onChange={(v) => setP({ ownership: v })} />}</Field>,
        <Field key="ac" label="Acquisition cost (AED)" need={p.ownership === undefined && p.acquisitionCost === undefined}>{(id) => <NumberInput id={id} value={p.acquisitionCost} min={0} onChange={(v) => setP({ acquisitionCost: v })} />}</Field>,
        <Field key="mh" label="Months held" need={p.monthsHeld === undefined && p.intendsToHold12 === undefined}>{(id) => <NumberInput id={id} value={p.monthsHeld} min={0} onChange={(v) => setP({ monthsHeld: v })} />}</Field>,
        <Field key="ih" label="Intends to hold 12 months?" need={p.monthsHeld === undefined && p.intendsToHold12 === undefined}>{(id) => <YesNo id={id} value={p.intendsToHold12} onChange={(v) => setP({ intendsToHold12: v })} />}</Field>,
        <Field key="tr" label="Investee tax rate (%)" hint="Unknown = test fails." need={p.investeeTaxRate === undefined}>{(id) => <PercentInput id={id} value={p.investeeTaxRate} onChange={(v) => setP({ investeeTaxRate: v })} />}</Field>,
        <Field key="nq" label="Non-qualifying assets (%)" need={p.nonQualifyingAssets === undefined}>{(id) => <PercentInput id={id} value={p.nonQualifyingAssets} onChange={(v) => setP({ nonQualifyingAssets: v })} />}</Field>,
        <Field key="dd" label="Investee deducts the dividend?">{(id) => <YesNo id={id} value={p.investeeDeducts} onChange={(v) => setP({ investeeDeducts: v })} />}</Field>,
        <Field key="im" label="Deductible impairment taken?">{(id) => <YesNo id={id} value={p.deductibleImpairment} onChange={(v) => setP({ deductibleImpairment: v })} />}</Field>,
        <Field key="lq" label="Loss on liquidation?">{(id) => <YesNo id={id} value={p.liquidationLoss} onChange={(v) => setP({ liquidationLoss: v })} />}</Field>,
        <Field key="rs" label="Acquired in a restructuring within 2 years?">{(id) => <YesNo id={id} value={p.restructuringWithin2Years} onChange={(v) => setP({ restructuringWithin2Years: v })} />}</Field>,
        <Field key="fb" label="Ownership fell below 5% within 12 months?">{(id) => <YesNo id={id} value={p.fellBelowBefore12} onChange={(v) => setP({ fellBelowBefore12: v })} />}</Field>,
      );
      if (p.fellBelowBefore12)
        fields.push(<Field key="cb" label="Earlier exempt income to claw back (AED)">{(id) => <NumberInput id={id} value={p.clawbackAmount} min={0} onChange={(v) => setP({ clawbackAmount: v })} />}</Field>);
      if (res)
        fields.push(
          <p key="res" className="q-result" style={{ color: res.exempt ? 'var(--pass-fg)' : 'var(--high-fg)' }}>
            {res.exempt ? 'All participation tests pass: exempt.' : `Taxable. Failed: ${res.failed.join('; ')}.`}
          </p>,
        );
      break;
    }
    default:
      break;
  }

  const hasLastYear = props.lastYearAnswer && Object.keys(props.lastYearAnswer).length > 0 && !props.answer;
  if (!fields.length && !qs.length && !hasLastYear) return null;
  return (
    <div className="questions" aria-label={`Questions for ${props.account}`}>
      {qs.length > 0 && <p className="q-title">{qs.join(' ')}</p>}
      {fields}
      {hasLastYear && (
        <p className="q-result">
          <button type="button" className="small" onClick={() => set({ ...props.lastYearAnswer })}>
            Use last year’s answers
          </button>
        </p>
      )}
    </div>
  );
}
