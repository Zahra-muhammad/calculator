import type { Evaluation } from '../engine/workspace';
import type { Workspace } from '../engine/types';
import { fmtDate, num, pct } from '../engine/util';

const REGIME: Record<string, string> = { standard: 'Standard rate', sbr: 'Small Business Relief', qfzp: 'QFZP' };


export function Header(props: {
  ws: Workspace;
  ev: Evaluation;
  dirty: boolean;
  onSave: () => void;
  onClients: () => void;
  onExcel: () => void;
  onPdf: () => void;
}) {
  const { ws, ev } = props;
  const r = ev.result;
  // Only VAT data (no trial balance and no profit figure): show the VAT result instead of corporate tax 0.
  const vatOnly = ev.vat.hasData && ws.tbLines.length === 0 && ws.headline.pbt.value === undefined;
  const status = props.dirty ? 'unsaved' : ws.clientId ? 'saved' : '';
  const sub = [ws.clientName || 'No client saved yet', ws.profile.periodEnd ? fmtDate(ws.profile.periodEnd) : '', status].filter(Boolean).join(' · ');
  return (
    <div className="header-inner">
      <div className="brand">
        <span className="logo" aria-hidden="true">
          CT
        </span>
        <div style={{ minWidth: 0 }}>
          <h1>Finapt Calculator</h1>
          <p className="brand-sub">{sub}</p>
        </div>
      </div>
      {vatOnly ? (
        <div className="tax-figure" aria-live="polite">
          <span className="label">{ev.vat.payable >= 0 ? 'VAT payable' : 'VAT refundable'}</span>
          <strong className="big" data-testid="tax-figure">
            <span className="cur">AED</span> {num(Math.abs(ev.vat.payable), 2)}
          </strong>
          <span className="sub">
            Output AED {num(ev.vat.outputVat, 2)} · input AED {num(ev.vat.inputRecoverable, 2)} · no trial balance, so no corporate tax
          </span>
        </div>
      ) : (
        <div className="tax-figure" aria-live="polite">
          <span className="label">Corporate tax due</span>
          <strong className="big" data-testid="tax-figure">
            <span className="cur">AED</span> {num(Math.round(r.tax))}
          </strong>
          <span className="sub">
            {REGIME[r.regime]} · taxable AED {num(Math.round(r.taxableAfterLoss))}
            {r.pbt > 0 ? ` · ${pct(r.effectiveRate)} of PBT` : ''}
            {ev.vat.hasData ? ` · VAT ${ev.vat.payable >= 0 ? 'payable' : 'refundable'} AED ${num(Math.abs(ev.vat.payable))}` : ''}
          </span>
        </div>
      )}
      <div className="actions">
        <button type="button" onClick={props.onClients}>
          Clients
        </button>
        <button type="button" onClick={props.onExcel}>
          Export Excel
        </button>
        <button type="button" onClick={props.onPdf}>
          Export PDF
        </button>
        <button type="button" className="primary" onClick={props.onSave}>
          Save client
        </button>
      </div>
    </div>
  );
}
