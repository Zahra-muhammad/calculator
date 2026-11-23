import { useId, useState, type ReactNode } from 'react';
import type { Level, Sourced } from '../engine/types';
import { refText } from '../engine/types';
import { aed, num, parseAmount } from '../engine/util';

/** A numbered white card. `step` may be "3" or "3." (the dot is dropped). */
export function Section(props: { id: string; step?: string; title: string; badge?: ReactNode; intro?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`section ${props.className ?? ''}`} id={props.id} aria-labelledby={`${props.id}-title`}>
      <div className="section-head">
        <div className="section-title">
          <h2 id={`${props.id}-title`}>
            {props.step && <span className="step">{props.step.replace(/\.$/, '')}</span>}
            {props.title}
          </h2>
          {props.badge}
        </div>
        {props.actions && <div className="section-actions">{props.actions}</div>}
      </div>
      {props.intro && <p className="intro">{props.intro}</p>}
      {props.children}
    </section>
  );
}

/** Text input for amounts: shows "1,234,567", accepts commas, brackets and minus signs. Commits on blur or Enter. */
export function NumberInput(props: {
  id?: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  ariaLabel?: string;
  placeholder?: string;
  min?: number;
  disabled?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (props.value === undefined ? '' : num(props.value, Number.isInteger(props.value) ? 0 : 2).replace('−', '-'));
  const commit = () => {
    if (text === null) return;
    const t = text.trim();
    if (t === '') props.onChange(undefined);
    else {
      let n = parseAmount(t);
      if (n !== undefined && props.min !== undefined) n = Math.max(props.min, n);
      if (n !== undefined) props.onChange(n);
    }
    setText(null);
  };
  return (
    <input
      id={props.id}
      className={`num-input ${props.className ?? ''}`}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={props.ariaLabel}
      aria-describedby={props.describedBy}
      placeholder={props.placeholder}
      disabled={props.disabled}
      value={shown}
      onFocus={() => setText(props.value === undefined ? '' : String(props.value))}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(null);
      }}
    />
  );
}

/** Percentage input for values stored as 0–1. */
export function PercentInput(props: { id?: string; value: number | undefined; onChange: (v: number | undefined) => void; ariaLabel?: string }) {
  return (
    <NumberInput
      id={props.id}
      ariaLabel={props.ariaLabel}
      placeholder="%"
      value={props.value === undefined ? undefined : Math.round(props.value * 10000) / 100}
      onChange={(v) => props.onChange(v === undefined ? undefined : Math.min(100, Math.max(0, v)) / 100)}
    />
  );
}

export function DateInput(props: { id?: string; value: string | undefined; onChange: (v: string | undefined) => void; ariaLabel?: string }) {
  return (
    <input
      id={props.id}
      type="date"
      className={props.value ? '' : 'empty'}
      aria-label={props.ariaLabel}
      value={props.value ?? ''}
      onChange={(e) => props.onChange(e.target.value || undefined)}
    />
  );
}

/** Yes / No / Not answered. */
export function YesNo(props: {
  id?: string;
  value: boolean | undefined;
  onChange: (v: boolean | undefined) => void;
  ariaLabel?: string;
  yes?: string;
  no?: string;
  unset?: string;
  disabled?: boolean;
}) {
  const v = props.value === undefined ? '' : props.value ? 'yes' : 'no';
  return (
    <select
      id={props.id}
      className={v === '' ? 'empty' : ''}
      aria-label={props.ariaLabel}
      value={v}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value === '' ? undefined : e.target.value === 'yes')}
    >
      <option value="">{props.unset ?? 'Not answered'}</option>
      <option value="yes">{props.yes ?? 'Yes'}</option>
      <option value="no">{props.no ?? 'No'}</option>
    </select>
  );
}

/** A labelled control. `need` gives the yellow "needs an answer" box, the same as the profile cards. */
export function Field(props: { label: string; children: (id: string) => ReactNode; hint?: ReactNode; className?: string; need?: boolean }) {
  const id = useId();
  return (
    <div className={`field ${props.need ? 'need' : ''} ${props.className ?? ''}`}>
      <label htmlFor={id}>{props.label}</label>
      {props.children(id)}
      {props.hint && <span className="hint">{props.hint}</span>}
    </div>
  );
}

export type PillKind = 'auto' | 'pass' | 'need' | 'medium' | 'high' | 'suggested' | 'info' | 'data' | 'neutral';

/** Small rounded status label: auto/pass green, needs you/medium yellow, high red, suggested blue, neutral grey. */
export function Pill({ kind, children, title }: { kind: PillKind; children: ReactNode; title?: string }) {
  return (
    <span className={`pill ${kind}`} title={title}>
      {children}
    </span>
  );
}

/**
 * A field shown as a small card: label and status pill on top, the control, then a grey note.
 * `need` gives the yellow "needs you" tint.
 */
export function CardField(props: { label: string; pill?: ReactNode; need?: boolean; note?: ReactNode; className?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className={`cfield ${props.need ? 'need' : ''} ${props.className ?? ''}`}>
      <div className="cfield-top">
        <label htmlFor={id}>{props.label}</label>
        {props.pill}
      </div>
      {props.children(id)}
      {props.note && <div className="cfield-note">{props.note}</div>}
    </div>
  );
}

const LEVEL_PILL: Record<Level, PillKind> = { HIGH: 'high', MEDIUM: 'medium', DATA: 'data', INFO: 'info', PASS: 'pass' };

export function LevelBadge({ level }: { level: Level }) {
  return <span className={`pill lvl ${LEVEL_PILL[level]}`}>{level}</span>;
}

export function RuleChip({ rule }: { rule: string }) {
  if (!rule || rule === '—') return null;
  return <span className="rule-pill">{rule}</span>;
}

export function SourceChip({ s, fallback }: { s: Sourced; fallback?: string }) {
  if (s.byHand) return <span className="src">Entered by hand</span>;
  if (s.ref) return <span className="src" title={s.ref.file ? `From ${s.ref.file}` : undefined}>{refText(s.ref)}</span>;
  if (s.note) return <span className="src">{s.note}</span>;
  return <span className="src">{fallback ?? 'Not found'}</span>;
}

export function Money({ value, decimals = 0 }: { value: number; decimals?: number }) {
  return <span className="num">{aed(value, decimals)}</span>;
}
