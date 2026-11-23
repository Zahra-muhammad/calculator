import { useState } from 'react';
import { countByLevel } from '../engine/flags';
import type { Flag, Level, Resolution } from '../engine/types';
import { LEVEL_ORDER } from '../engine/types';
import { aed } from '../engine/util';
import { LevelBadge, Pill, RuleChip, Section } from './ui';

const LEVEL_NAME: Record<Level, string> = { HIGH: 'High', MEDIUM: 'Medium', DATA: 'Data', INFO: 'Info', PASS: 'Pass' };

/** Bold the lead of a message up to its first colon ("Supporting evidence missing: …"), when it is short. */
function Message({ text }: { text: string }) {
  const at = text.indexOf(': ');
  if (at > 0 && at <= 70) {
    return (
      <>
        <strong>{text.slice(0, at + 1)}</strong>
        {text.slice(at + 1)}
      </>
    );
  }
  return <>{text}</>;
}

export function Flags(props: { flags: Flag[]; resolved: Record<string, Resolution>; onResolve: (key: string, note: string | null) => void }) {
  const [filter, setFilter] = useState<Level | 'ALL'>('ALL');
  const counts = countByLevel(props.flags);
  const openHigh = props.flags.filter((f) => f.level === 'HIGH' && !props.resolved[f.key]).length;
  const shown = props.flags.filter((f) => filter === 'ALL' || f.level === filter);
  const open = shown.filter((f) => f.level !== 'PASS');
  const passes = shown.filter((f) => f.level === 'PASS');

  return (
    <Section
      id="flags"
      step="8"
      title="Red flags"
      intro="Sorted from most to least serious. Mark a flag resolved with a short note; the note is saved with the client and exported."
      actions={
        <div className="seg" role="group" aria-label="Filter flags by level">
          <button type="button" aria-pressed={filter === 'ALL'} onClick={() => setFilter('ALL')}>
            All {props.flags.length}
          </button>
          {LEVEL_ORDER.map((l) => (
            <button key={l} type="button" aria-pressed={filter === l} onClick={() => setFilter(l)}>
              {LEVEL_NAME[l]} {counts[l]}
            </button>
          ))}
        </div>
      }
    >
      {openHigh > 0 && (
        <div className="alert-high" role="alert">
          The tax figure is not final until every HIGH flag is resolved. ({openHigh} open)
        </div>
      )}
      <ul className="flags">
        {open.map((f) => (
          <FlagItem key={f.key} f={f} resolution={props.resolved[f.key]} onResolve={props.onResolve} />
        ))}
        {passes.length > 0 && (
          <li className="flag PASS" data-level="PASS">
            <LevelBadge level="PASS" />
            <div className="flag-body">
              <div className="flag-msg pass-list">
                {passes.map((f, i) => (
                  <span key={f.key}>
                    {i > 0 && <span className="sep"> · </span>}
                    <span className="pass-id">{f.id}</span> {f.message}
                  </span>
                ))}
              </div>
            </div>
          </li>
        )}
        {shown.length === 0 && <li className="empty-state">No flags at this level.</li>}
      </ul>
    </Section>
  );
}

function FlagItem({ f, resolution, onResolve }: { f: Flag; resolution?: Resolution; onResolve: (key: string, note: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const canResolve = f.level !== 'PASS';
  return (
    <li className={`flag ${f.level} ${resolution ? 'resolved' : ''}`} data-level={f.level}>
      <LevelBadge level={f.level} />
      <div className="flag-body">
        <div className="flag-msg">
          <Message text={f.message} />
        </div>
        {f.action && f.action !== 'None.' && (
          <div className="flag-action">
            <span className="visually-hidden">What to do: </span>
            {f.action}
          </div>
        )}
        <div className="flag-meta">
          <RuleChip rule={f.id} />
          {f.amount !== undefined && <span className="num">{aed(f.amount)}</span>}
          {f.source && <span className="tag">{f.source}</span>}
          {resolution && <Pill kind="pass">Resolved</Pill>}
        </div>
        {resolution && (
          <div className="resolution">
            Resolved {resolution.at.slice(0, 10)}: {resolution.note}{' '}
            <button type="button" className="link-btn" onClick={() => onResolve(f.key, null)}>
              Reopen
            </button>
          </div>
        )}
        {editing && !resolution && (
          <form
            className="resolve-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim().length < 3) return;
              onResolve(f.key, note.trim());
              setEditing(false);
              setNote('');
            }}
          >
            <label htmlFor={`note-${f.key}`} className="small">
              How was it resolved? (required)
            </label>
            <textarea id={`note-${f.key}`} value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} />
            <div className="btn-row">
              <button type="submit" className="primary small" disabled={note.trim().length < 3}>
                Save
              </button>
              <button type="button" className="small" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
      <div className="flag-side">
        {canResolve && !resolution && !editing && (
          <button type="button" onClick={() => setEditing(true)}>
            Mark resolved
          </button>
        )}
      </div>
    </li>
  );
}
