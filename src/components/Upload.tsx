import { useEffect, useRef, useState } from 'react';
import type { FileKind, ParsedFile } from '../engine/types';
import { FILE_KIND_LABELS, SHEET_ROLE_LABELS, refText } from '../engine/types';
import { usedParts } from '../engine/workspace';
import { aed, fmtDate } from '../engine/util';
import { Section } from './ui';
import { CURRENCIES, conversion, currencyInfo, type CurrencyChoice } from '../engine/currency';

/** The two choices staff see. Corporate tax reads the statements and trial balance (and any VAT sheets in the
 * same workbook); VAT reads only the sales and purchase registers, imports and filed VAT returns. */
type Mode = 'ct' | 'vat';
const VAT_KINDS: FileKind[] = ['vatdata', 'sales', 'purchases', 'imports'];
const CT_KINDS: FileKind[] = ['fs_tb', 'fs', 'tb', 'gl', 'rp', 'vat', 'doc'];
const modeOf = (k: FileKind): Mode | undefined => (VAT_KINDS.includes(k) ? 'vat' : CT_KINDS.includes(k) ? 'ct' : undefined);
const MODE_LABELS: Record<Mode, string> = { ct: 'Corporate tax', vat: 'VAT' };
/** The file type to use for a mode: the detected one when it fits, otherwise the general one. */
const kindFor = (f: ParsedFile, m: Mode): FileKind => (modeOf(f.detected) === m ? f.detected : m === 'vat' ? 'vatdata' : 'fs_tb');

export function Upload(props: { files: ParsedFile[]; busy: boolean; onAdd: (files: File[]) => void; onKind: (id: string, kind: FileKind) => void; onRemove: (id: string) => void; currency?: CurrencyChoice; onCurrency?: (c: CurrencyChoice) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const seen = useRef(props.files.length);
  const [over, setOver] = useState(false);

  // After files are added, bring the newest card into view (its scroll margin keeps it clear of the status bar).
  useEffect(() => {
    const added = props.files.length > seen.current;
    seen.current = props.files.length;
    if (!added) return;
    const last = list.current?.lastElementChild as HTMLElement | null;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    last?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [props.files.length]);

  return (
    <Section
      id="upload"
      step="1."
      title="Upload files"
      intro="Add the financial statements and trial balance. The general ledger, VAT returns and related-parties list are optional. Files are read on this computer only. Nothing is uploaded."
    >
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const list = Array.from(e.dataTransfer.files);
          if (list.length) props.onAdd(list);
        }}
      >
        <p className="dz-title">Drag files here, or</p>
        <button type="button" className="dark" onClick={() => input.current?.click()} disabled={props.busy}>
          {props.busy ? 'Reading…' : 'Choose files'}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".xlsx,.xls,.xlsm,.xlsb,.csv,.txt,.pdf"
          className="visually-hidden"
          aria-label="Choose files to upload"
          data-testid="file-input"
          tabIndex={-1}
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            if (list.length) props.onAdd(list);
            e.target.value = '';
          }}
        />
        <p className="dz-hint">
          Excel (.xlsx, .xls), CSV, or PDF documents (auditor's report, director's confirmation, notes). You can add several files at once.
        </p>
      </div>

      {props.files.length > 0 && (
        <ul className="file-list" aria-label="Uploaded files" ref={list}>
          {props.files.map((f) => (
            <li key={f.id} className="file-row">
              <div className="file-top">
                <span className="file-name">{f.name}</span>
                {f.kind === 'doc' ? (
                  <span className="file-kind doc-kind">Supporting document</span>
                ) : (
                <label className="file-kind">
                  <span className="visually-hidden">Type of {f.name}</span>
                  <select value={modeOf(f.kind) ?? ''} onChange={(e) => props.onKind(f.id, kindFor(f, e.target.value as Mode))}>
                    {!modeOf(f.kind) && (
                      <option value="" disabled>
                        {FILE_KIND_LABELS.unknown}: pick one
                      </option>
                    )}
                    {(['ct', 'vat'] as Mode[]).map((m) => (
                      <option key={m} value={m}>
                        {MODE_LABELS[m]}
                        {modeOf(f.detected) === m ? ' (detected)' : holdsMode(f, m) ? '' : ' (not found in this file)'}
                      </option>
                    ))}
                  </select>
                </label>
                )}
                <button type="button" className="small" onClick={() => props.onRemove(f.id)} aria-label={`Remove ${f.name}`}>
                  Remove
                </button>
              </div>
              {f.kind !== 'doc' && modeOf(f.kind) !== modeOf(f.detected) && f.kind !== 'ignore' && <ChosenType f={f} onUseDetected={() => props.onKind(f.id, f.detected)} />}
              {modeOf(f.kind) === 'ct' && holdsMode(f, 'vat') && <p className="sheet-roles">The VAT sheets in this workbook are read too: see the VAT section.</p>}
              <FoundChips f={f} />
              {f.warnings.length > 0 && (
                <ul className="warn">
                  {f.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {props.files.length > 0 && props.onCurrency && <CurrencyBar c={props.currency ?? { code: 'AED', rate: 1 }} onChange={props.onCurrency} />}
    </Section>
  );
}

/** Currency of the amounts in the files. Everything is worked out in AED, so other currencies are converted. */
function CurrencyBar({ c, onChange }: { c: CurrencyChoice; onChange: (c: CurrencyChoice) => void }) {
  const conv = conversion(c);
  const known = currencyInfo(c.code);
  return (
    <div className="currency-bar" data-testid="currency-bar">
      <label className={`field ${conv.missingRate ? 'need' : ''}`}>
        <span className="field-label">Currency of the amounts in the files</span>
        <select
          value={c.code}
          aria-label="Currency of the amounts"
          onChange={(e) => {
            const code = e.target.value;
            onChange({ code, rate: currencyInfo(code)?.pegRate, foundAt: c.foundAt });
          }}
        >
          {!known && <option value={c.code}>{c.code}</option>}
          {CURRENCIES.map((x) => (
            <option key={x.code} value={x.code}>
              {x.code} – {x.name}
            </option>
          ))}
        </select>
      </label>
      {c.code !== 'AED' && (
        <label className={`field ${conv.missingRate ? 'need' : ''}`}>
          <span className="field-label">AED for 1 {c.code}</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            aria-label={`AED for 1 ${c.code}`}
            className={conv.missingRate ? 'need-input' : ''}
            placeholder="Enter the rate"
            value={c.rate ?? ''}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onChange({ ...c, rate: Number.isFinite(v) && v > 0 ? v : undefined });
            }}
          />
        </label>
      )}
      <p className="currency-note">
        {c.code === 'AED'
          ? 'Amounts are used as they are, in AED (dirhams).'
          : conv.missingRate
            ? `The files are in ${c.code}${c.foundAt ? ` (found at ${c.foundAt})` : ''}. Enter the AED rate, or choose AED if the amounts are already in dirhams. Nothing is converted until then.`
            : `The files are in ${c.code}${c.foundAt ? ` (found at ${c.foundAt})` : ''}. Every amount is converted to AED at ${conv.rate}. Choose AED to use the amounts as they are.`}
        {c.code !== 'AED' && ' FTA returns are filed in AED: use the UAE Central Bank rate.'}
      </p>
      {c.code !== 'AED' && (
        <button type="button" className="small" onClick={() => onChange({ code: 'AED', rate: 1, foundAt: c.foundAt })}>
          Change to AED (Dhs)
        </button>
      )}
    </div>
  );
}

/** Does the file hold corporate tax data (statements, trial balance) or VAT data (registers, imports)? */
function holdsMode(f: ParsedFile, m: Mode): boolean {
  if (modeOf(f.detected) === m) return true;
  const roles = new Set<string>((f.sheets ?? []).map((s) => s.role));
  return m === 'ct' ? roles.has('fs') || roles.has('tb') : roles.has('sales') || roles.has('purchases') || roles.has('imports');
}

/** Shown when a person picked a type other than the detected one: what that means, and the way back. */
function ChosenType({ f, onUseDetected }: { f: ParsedFile; onUseDetected: () => void }) {
  const used = Object.values(usedParts(f)).some((p) => p !== undefined);
  const chosen = MODE_LABELS[modeOf(f.kind) ?? 'ct'];
  return (
    <div className="callout warn-callout chosen-type" role="status">
      <span>
        {used
          ? `You chose “${chosen}”: only that type is read from this file.`
          : `You chose “${chosen}”, but this file has none, so nothing from it is used${f.detected !== 'unknown' ? ' and the tax figure leaves it out' : ''}.`}
        {f.detected !== 'unknown' && modeOf(f.detected) && ` It was detected as “${MODE_LABELS[modeOf(f.detected)!]}”.`}
        {modeOf(f.kind) === 'vat' && !used && ' VAT needs a list of sales invoices, purchase invoices / receipts or imports, with net and VAT amounts.'}
        {modeOf(f.kind) === 'ct' && !used && ' Corporate tax needs financial statements or a trial balance.'}
      </span>
      {f.detected !== 'unknown' && (
        <button type="button" className="small" onClick={onUseDetected}>
          Use the detected type
        </button>
      )}
    </div>
  );
}

function FoundChips({ f }: { f: ParsedFile }) {
  const chips: string[] = [];
  const k = f.kind;
  // Every part of the workbook that is used (with the detected type, each sheet counts for what it holds).
  const parts = usedParts(f);
  if (parts.fs) {
    if (parts.fs.pbt) chips.push(`Found PBT ${aed(parts.fs.pbt.value)} at ${refText(parts.fs.pbt.ref)}`);
    if (parts.fs.revenue) chips.push(`Revenue ${aed(parts.fs.revenue.value)} at ${refText(parts.fs.revenue.ref)}`);
    if (parts.fs.totalAssets) chips.push(`Total assets at ${refText(parts.fs.totalAssets.ref)}`);
    if (parts.fs.lossSuggestion) chips.push(`Possible tax loss b/f at ${refText(parts.fs.lossSuggestion.ref)}`);
    if (parts.fs.auditedText) chips.push("Auditor's report found");
  }
  if (k !== 'ignore') {
    const h = f.hints ?? {};
    const ev = f.evidence ?? [];
    const name = ev.find((e) => e.key === 'clientName')?.value ?? h.clientName?.value;
    const end = ev.find((e) => e.key === 'periodEnd')?.value ?? h.periodEnd?.value;
    if (name) chips.push(`Company: ${name}`);
    if (end) chips.push(`Period ends ${fmtDate(String(end))}`);
    if (h.trn || ev.some((e) => e.key === 'trn')) chips.push(`TRN found`);
    const answers = new Set(ev.filter((e) => e.strength === 'stated' && !['clientName', 'trn', 'periodEnd', 'periodStart'].includes(e.key)).map((e) => e.key)).size;
    if (answers) chips.push(`${answers} profile answer${answers === 1 ? '' : 's'} found`);
    if (k === 'doc' && (h.audited || ev.some((e) => e.key === 'audited' && e.value === true))) chips.push("Auditor's report");
  }
  if (parts.tb)
    chips.push(`Trial balance: ${parts.tb.lines.length} lines on ${parts.tb.sheet}${parts.tb.hasAdjustments ? ' (with adjustments)' : ''}${parts.tb.singleColumn ? ' (one balance column)' : ''}`);
  if (parts.gl) chips.push(`General ledger: ${parts.gl.length} transactions`);
  if (parts.vat) chips.push(`VAT returns: ${parts.vat.length} periods`);
  if (parts.sales) chips.push(`Sales invoices: ${parts.sales.length}`);
  if (parts.purchases) chips.push(`Purchase invoices / receipts: ${parts.purchases.length}`);
  if (parts.imports) chips.push(`Imports: ${parts.imports.length}`);
  if (parts.rp) chips.push(`Related parties: ${parts.rp.length}`);
  if (f.errors.length) chips.push(`${f.errors.length} formula error(s), first at ${refText(f.errors[0])}`);
  const sheets = f.sheets ?? [];
  if (!chips.length && sheets.length < 2) return null;
  return (
    <>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <span key={c} className="chip found">
              {c}
            </span>
          ))}
        </div>
      )}
      {sheets.length > 1 && (
        <p className="sheet-roles">
          Sheets:{' '}
          {sheets.map((sh, i) => (
            <span key={sh.name}>
              {i > 0 && ' · '}
              {sh.name} – {SHEET_ROLE_LABELS[sh.role]}
            </span>
          ))}
        </p>
      )}
    </>
  );
}
