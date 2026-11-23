import type { GlSuggestion } from '../engine/gl';
import { suggestionToSubLine } from '../engine/gl';
import { CATEGORY_MAP } from '../engine/types';
import type { Workspace } from '../engine/types';
import { num } from '../engine/util';
import type { Update } from './Profile';
import { Pill, RuleChip, Section } from './ui';

export function GlSuggestions({ ws, suggestions, hasGl, glCount, update }: { ws: Workspace; suggestions: GlSuggestion[]; hasGl: boolean; glCount: number; update: Update }) {
  const decide = (s: GlSuggestion, d: 'accepted' | 'rejected' | null) =>
    update((w) => {
      const glDecisions = { ...w.glDecisions };
      let subLines = w.subLines.filter((x) => x.key !== s.id);
      if (d) glDecisions[s.id] = d;
      else delete glDecisions[s.id];
      if (d === 'accepted') subLines = [...subLines, suggestionToSubLine(s)];
      return { ...w, glDecisions, subLines };
    });

  // Accepted sub-lines stay even when the ledger file is not loaded (it is never stored).
  const keptOnly = ws.subLines.filter((s) => s.source === 'gl' && !suggestions.some((g) => g.id === s.key));

  return (
    <Section
      id="ledger"
      step="5"
      title="General ledger suggestions"
      intro="Transactions inside normal expense accounts whose description looks like a hidden add-back. Accept to add them back as a sub-line with the transactions as evidence."
    >
      {!hasGl && !keptOnly.length && <p className="empty-state">Upload a general ledger to scan it.</p>}
      {hasGl && !suggestions.length && (
        <div className="ok-box">
          <span className="ok-icon" aria-hidden="true">
            ✓
          </span>
          <span>
            <strong>
              {glCount} transaction{glCount === 1 ? '' : 's'} scanned
            </strong>
            <br />
            No hidden add-backs found.
          </span>
        </div>
      )}
      <ul className="gl-list">
        {suggestions.map((s) => {
          const d = ws.glDecisions[s.id];
          return (
            <li key={s.id} className={`gl-item ${d ?? 'open'}`}>
              <div className="gl-head">
                <RuleChip rule={s.ruleId} />
                <span className="tag">{CATEGORY_MAP[s.category].label}</span>
                {d && <Pill kind={d === 'accepted' ? 'pass' : 'neutral'}>{d === 'accepted' ? 'Accepted' : 'Rejected'}</Pill>}
              </div>
              <div className="gl-msg">{s.message}</div>
              <details>
                <summary className="small">Show the {s.count} transaction(s)</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>GL row</th>
                        <th>Date</th>
                        <th>Description</th>
                        <th className="num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.txns.slice(0, 200).map((t) => (
                        <tr key={t.row}>
                          <td className="num">{t.row}</td>
                          <td className="nowrap">{t.date ?? ''}</td>
                          <td>{t.description}</td>
                          <td className="num">{num(t.amount, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <div className="btn-row">
                {d !== 'accepted' && (
                  <button type="button" className="small primary" onClick={() => decide(s, 'accepted')}>
                    Accept
                  </button>
                )}
                {d !== 'rejected' && (
                  <button type="button" className="small" onClick={() => decide(s, 'rejected')}>
                    Reject
                  </button>
                )}
                {d && (
                  <button type="button" className="link-btn" onClick={() => decide(s, null)}>
                    Undo
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {keptOnly.map((s) => (
          <li key={s.key} className="gl-item accepted">
            <div className="gl-head">
              <RuleChip rule={CATEGORY_MAP[s.category].rule} />
              <Pill kind="pass">Accepted earlier</Pill>
            </div>
            <div className="gl-msg">
              {s.label}: {num(s.amount, 2)} ({s.evidence.length} transactions)
            </div>
            <div className="btn-row">
              <button
                type="button"
                className="small"
                onClick={() => update((w) => ({ ...w, subLines: w.subLines.filter((x) => x.key !== s.key), glDecisions: Object.fromEntries(Object.entries(w.glDecisions).filter(([k]) => k !== s.key)) }))}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
