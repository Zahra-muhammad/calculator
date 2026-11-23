import type { InputVatTreatment, InvoiceLine, VatChoice, Workspace } from '../engine/types';
import { INPUT_VAT_LABELS } from '../engine/types';
import { fmtDate, num, pct } from '../engine/util';
import type { RegisterTotals, SalesLine, VatBox, VatLine } from '../engine/vat';
import { SUPPLY_LABELS } from '../engine/vat';
import { SETTINGS } from '../engine/settings';
import type { Evaluation } from '../engine/workspace';
import type { Update } from './Profile';
import { LevelBadge, Section } from './ui';

const rateText = (l: InvoiceLine) => (l.rate === undefined ? '' : pct(l.rate, 2));

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'main' | 'warn' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function Totals({ t, cols, extra }: { t: RegisterTotals; cols: number; extra?: React.ReactNode }) {
  return (
    <tfoot>
      <tr>
        <th scope="row" colSpan={cols}>
          Total ({t.count} line{t.count === 1 ? '' : 's'})
        </th>
        <td className="num">{num(t.net, 2)}</td>
        <td />
        <td className="num">{num(t.vat, 2)}</td>
        <td className="num">{num(t.gross, 2)}</td>
        {extra !== undefined && <td className="small">{extra}</td>}
      </tr>
    </tfoot>
  );
}

/** "Count this line" for an exact repeat of an earlier invoice. */
function DupToggle({ l, included, onChoice }: { l: { dupOf?: string; excluded: boolean; row: number }; included: boolean; onChoice: (p: Partial<VatChoice>) => void }) {
  if (!l.dupOf) return null;
  return (
    <label className="dup-toggle small">
      <input type="checkbox" checked={included} onChange={(e) => onChoice({ include: e.target.checked || undefined })} /> Count this line{' '}
      <span className="faint">({l.excluded ? 'left out: repeats row ' : 'repeats row '}
      {l.dupOf.split('!').pop()})</span>
    </label>
  );
}

function BoxesTable({ boxes }: { boxes: VatBox[] }) {
  const strong = new Set(['8', '11', '14']);
  return (
    <div className="table-wrap vat-table" role="region" aria-label="VAT return boxes" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th scope="col">Box</th>
            <th scope="col">Description</th>
            <th scope="col" className="num">
              Amount (AED)
            </th>
            <th scope="col" className="num">
              VAT (AED)
            </th>
          </tr>
        </thead>
        <tbody>
          {boxes.map((b) => (
            <tr key={b.id} className={strong.has(b.id) ? 'box-total' : undefined} data-box={b.id}>
              <td>{b.id === '1?' ? '1' : b.id}</td>
              <td>{b.label}</td>
              <td className="num">{b.amount === undefined ? '' : num(b.amount, 2)}</td>
              <td className="num">{b.vat === undefined ? '' : num(b.vat, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Vat({ ws, ev, update }: { ws: Workspace; ev: Evaluation; update: Update }) {
  const v = ev.vat;
  const setChoice = (key: string, patch: Partial<VatChoice>) =>
    update((w) => {
      const next = { ...w.vatChoices?.[key], ...patch };
      (Object.keys(next) as (keyof VatChoice)[]).forEach((k) => next[k] === undefined && delete next[k]);
      return { ...w, vatChoices: { ...w.vatChoices, [key]: next } };
    });
  const checks = ev.flags.filter((f) => f.id === 'VAT');
  const included = (key: string) => ws.vatChoices?.[key]?.include === true;

  return (
    <Section
      id="vat"
      step="7"
      title="VAT"
      intro={`Worked out from the sales and purchase registers and the imports list at the ${pct(v.rate, 0)} standard rate, and set out as the VAT return (VAT201). Input VAT is blocked (UAE VAT Executive Regulation Art. 53) for entertainment of people who are not employees, motor vehicles available for personal use, and goods or services for employees' personal use, and held when the supplier's TRN is missing. Change any purchase or import line, with a reason.`}
    >
      {!v.hasData ? (
        <p className="empty-state">
          No sales register, purchase register or imports list in the files yet. To work out VAT, upload a list of sales invoices, purchase invoices / receipts or imports with net and VAT
          amounts (they can be sheets in the same workbook). Filed VAT returns are a different file type: they are only used to check revenue.
        </p>
      ) : (
        <>
          <div className="stats" aria-label="VAT summary">
            <Stat label="Output VAT (Box 8)" value={num(v.outputVat, 2)} />
            <Stat label="Input VAT recoverable (Box 11)" value={num(v.inputRecoverable, 2)} />
            <Stat label={v.inputHeld ? 'Input VAT blocked · held' : 'Input VAT blocked'} value={v.inputHeld ? `${num(v.inputBlocked, 2)} · ${num(v.inputHeld, 2)}` : num(v.inputBlocked, 2)} tone={v.inputBlocked || v.inputHeld ? 'warn' : undefined} />
            <Stat label={v.payable >= 0 ? 'VAT payable (Box 14)' : 'VAT refundable (Box 14)'} value={`AED ${num(Math.abs(v.payable), 2)}`} tone="main" />
          </div>
          <p className="stats-note">
            {v.payable >= 0 ? 'VAT payable' : 'VAT refundable'} = output VAT {num(v.outputVat, 2)} − recoverable input VAT {num(v.inputRecoverable, 2)}.
            {v.inputHeld ? ` Held until a valid tax invoice arrives: ${num(v.inputHeld, 2)}.` : ''}
            {v.inputNotApplicable ? ` Input VAT marked not applicable: ${num(v.inputNotApplicable, 2)}.` : ''}
          </p>

          {checks.length === 0 ? (
            <div className="ok-box">
              <span className="ok-icon" aria-hidden="true">
                ✓
              </span>
              <span>All VAT checks passed: rates, net + VAT = gross, duplicates, supplier TRNs, and VAT on sales against revenue.</span>
            </div>
          ) : (
            <ul className="vat-checks" aria-label="VAT checks">
              {checks.map((f) => (
                <li key={f.key}>
                  <LevelBadge level={f.level} />
                  <span>
                    {f.message} <span className="muted">{f.action}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="sub-title">VAT return (VAT201)</h3>
          <BoxesTable boxes={v.boxes} />

          {v.sales.length > 0 && (
            <>
              <h3 className="sub-title">Sales invoices</h3>
              <div className="table-wrap vat-table" role="region" aria-label="Sales invoices" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Invoice</th>
                      <th scope="col">Date</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Description</th>
                      <th scope="col" className="num">
                        Net
                      </th>
                      <th scope="col" className="num">
                        Rate
                      </th>
                      <th scope="col" className="num">
                        VAT
                      </th>
                      <th scope="col" className="num">
                        Gross
                      </th>
                      <th scope="col">On the return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.sales.map((l) => (
                      <SalesRow key={l.key} l={l} included={included(l.key)} onChoice={(p) => setChoice(l.key, p)} />
                    ))}
                  </tbody>
                  <Totals t={v.salesTotals} cols={4} extra={`VAT counted ${num(v.sales.reduce((a, l) => a + l.counted, 0), 2)}`} />
                </table>
              </div>
            </>
          )}

          {v.purchases.length > 0 && (
            <>
              <h3 className="sub-title">Purchase invoices / receipts</h3>
              <div className="table-wrap vat-table" role="region" aria-label="Purchase invoices and receipts" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Invoice</th>
                      <th scope="col">Date</th>
                      <th scope="col">Supplier</th>
                      <th scope="col">Description</th>
                      <th scope="col" className="num">
                        Net
                      </th>
                      <th scope="col" className="num">
                        Rate
                      </th>
                      <th scope="col" className="num">
                        VAT
                      </th>
                      <th scope="col" className="num">
                        Gross
                      </th>
                      <th scope="col">Input VAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.purchases.map((l) => (
                      <InputRow key={l.key} l={l} reason={ws.vatChoices?.[l.key]?.reason ?? ''} included={included(l.key)} onChoice={(p) => setChoice(l.key, p)} />
                    ))}
                  </tbody>
                  <Totals
                    t={v.purchaseTotals}
                    cols={4}
                    extra={`Recoverable ${num(v.boxes.find((b) => b.id === '9')?.vat ?? 0, 2)} · Blocked ${num(v.purchases.filter((l) => !l.excluded && l.treatment === 'blocked').reduce((a, l) => a + l.vat, 0), 2)} · Held ${num(v.purchases.filter((l) => !l.excluded && l.treatment === 'held').reduce((a, l) => a + l.vat, 0), 2)}`}
                  />
                </table>
              </div>
            </>
          )}

          {v.imports.length > 0 && (
            <>
              <h3 className="sub-title">Imports (reverse charge and customs)</h3>
              <p className="muted small">The company accounts for this VAT itself: it is output VAT (Box 3 for services, Box 6 for goods) and, unless blocked, recoverable input VAT (Box 10).</p>
              <div className="table-wrap vat-table" role="region" aria-label="Imports" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Ref</th>
                      <th scope="col">Date</th>
                      <th scope="col">Supplier</th>
                      <th scope="col">Description</th>
                      <th scope="col" className="num">
                        Value
                      </th>
                      <th scope="col" className="num">
                        Rate
                      </th>
                      <th scope="col" className="num">
                        VAT
                      </th>
                      <th scope="col">Type</th>
                      <th scope="col">Input VAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.imports.map((l) => (
                      <InputRow key={l.key} l={l} reason={ws.vatChoices?.[l.key]?.reason ?? ''} included={included(l.key)} onChoice={(p) => setChoice(l.key, p)} isImport />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={4}>
                        Total ({v.importTotals.count} line{v.importTotals.count === 1 ? '' : 's'})
                      </th>
                      <td className="num">{num(v.importTotals.net, 2)}</td>
                      <td />
                      <td className="num">{num(v.importTotals.vat, 2)}</td>
                      <td colSpan={2} className="small">
                        Recoverable (Box 10) {num(v.boxes.find((b) => b.id === '10')?.vat ?? 0, 2)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Section>
  );
}

function SalesRow({ l, included, onChoice }: { l: SalesLine; included: boolean; onChoice: (p: Partial<VatChoice>) => void }) {
  const differs = l.supply === 'standard' && !l.excluded && Math.abs(l.counted - l.vat) > 0.005;
  return (
    <tr className={l.excluded ? 'excluded' : differs ? 'chosen' : undefined}>
      <td>
        {l.number}
        <div className="faint small">
          {l.sheet} row {l.row}
        </div>
      </td>
      <td className="nowrap">{l.date ? fmtDate(l.date) : ''}</td>
      <td>
        {l.party}
        {l.trn && <div className="faint small">TRN {l.trn}</div>}
      </td>
      <td>
        {l.description}
        {(l.supplyType || l.emirate) && <div className="faint small">{[l.supplyType, l.emirate].filter(Boolean).join(' · ')}</div>}
      </td>
      <td className="num">{num(l.net, 2)}</td>
      <td className="num">{rateText(l)}</td>
      <td className="num">{num(l.vat, 2)}</td>
      <td className="num">{l.gross === undefined ? '' : num(l.gross, 2)}</td>
      <td className="small">
        {l.excluded ? (
          <span className="bad">Left out</span>
        ) : (
          <>
            {SUPPLY_LABELS[l.supply]}
            {l.box ? ` · Box ${l.box === '1?' ? '1' : l.box}` : l.supply === 'zero' ? ' · Box 4' : l.supply === 'exempt' ? ' · Box 5' : ''}
            {differs && <div className="warn-text">VAT due {num(l.counted, 2)}</div>}
          </>
        )}
        <DupToggle l={l} included={included} onChoice={onChoice} />
      </td>
    </tr>
  );
}

function InputRow({ l, reason, included, onChoice, isImport }: { l: VatLine; reason: string; included: boolean; onChoice: (p: Partial<VatChoice>) => void; isImport?: boolean }) {
  const capped = !l.excluded && l.treatment === 'recoverable' && Math.abs(l.counted - l.vat) > 0.005;
  return (
    <tr className={l.excluded ? 'excluded' : l.treatment === 'blocked' || l.treatment === 'held' ? 'blocked' : l.chosen ? 'chosen' : undefined}>
      <td>
        {l.number}
        <div className="faint small">
          {l.sheet} row {l.row}
        </div>
      </td>
      <td className="nowrap">{l.date ? fmtDate(l.date) : ''}</td>
      <td>
        {l.party}
        {isImport ? (l.category ? <div className="faint small">{l.category}</div> : null) : l.trn ? <div className="faint small">TRN {l.trn}</div> : l.trnColumn ? <div className="bad small">No TRN</div> : null}
      </td>
      <td>
        {l.description}
        {!isImport && (l.category || l.status) && <div className="faint small">{[l.category, l.status].filter(Boolean).join(' · ')}</div>}
        {isImport && l.customsNo && <div className="faint small">Customs {l.customsNo}</div>}
      </td>
      <td className="num">{num(l.net, 2)}</td>
      <td className="num">{rateText(l)}</td>
      <td className="num">{num(l.vat, 2)}</td>
      {isImport ? (
        <td className="small">{l.importType === 'goods' ? 'Goods · Box 6' : l.importType === 'services' ? 'Services · Box 3' : 'Not clear · Box 3'}</td>
      ) : (
        <td className="num">{l.gross === undefined ? '' : num(l.gross, 2)}</td>
      )}
      <td className="vat-treat">
        {l.excluded ? (
          <div className="bad small">Left out (repeat)</div>
        ) : (
          <>
            <select aria-label={`Input VAT on ${l.number}`} value={l.treatment} onChange={(e) => onChoice({ treatment: e.target.value as InputVatTreatment })}>
              {(Object.keys(INPUT_VAT_LABELS) as InputVatTreatment[]).map((t) => (
                <option key={t} value={t}>
                  {INPUT_VAT_LABELS[t]}
                  {t === l.auto ? ' (automatic)' : ''}
                </option>
              ))}
            </select>
            <div className="faint small">{l.chosen ? `Changed from ${INPUT_VAT_LABELS[l.auto].toLowerCase()}.` : l.why}</div>
            {capped && <div className="warn-text small">Only {num(l.counted, 2)} counted ({pct(SETTINGS.vatRate, 0)} of net).</div>}
            <input
              className={l.chosen && !reason.trim() ? 'need-input' : undefined}
              aria-label={`Reason for the input VAT treatment of ${l.number}`}
              placeholder={l.chosen ? 'Reason (needed)' : 'Reason (optional)'}
              value={reason}
              onChange={(e) => onChoice({ reason: e.target.value || undefined })}
            />
          </>
        )}
        <DupToggle l={l} included={included} onChoice={onChoice} />
      </td>
    </tr>
  );
}
