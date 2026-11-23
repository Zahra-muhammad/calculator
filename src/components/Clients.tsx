import { useEffect, useRef, useState } from 'react';
import { fmtDate } from '../engine/util';
import type { ClientRecord } from '../store/clients';

export function ClientsPanel(props: {
  clients: ClientRecord[];
  currentId?: string;
  onClose: () => void;
  onOpen: (c: ClientRecord) => void;
  onDuplicate: (c: ClientRecord) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
}) {
  const [q, setQ] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { onClose } = props;

  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const term = q.trim().toLowerCase();
  const list = props.clients.filter((c) => !term || c.name.toLowerCase().includes(term) || c.trn.includes(term) || (c.periodEnd ?? '').includes(term));

  return (
    <div className="panel-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel" role="dialog" aria-modal="true" aria-labelledby="clients-title">
        <div className="panel-head">
          <h2 id="clients-title">Clients</h2>
          <button type="button" onClick={onClose} aria-label="Close clients">
            Close
          </button>
        </div>
        <p className="muted small">Saved in this browser only. Uploaded files are never stored. Export a backup to keep a copy.</p>
        <div className="chips" style={{ marginBottom: 10 }}>
          <button type="button" className="primary small" onClick={props.onNew}>
            New client
          </button>
          <button type="button" className="small" onClick={props.onExport} disabled={!props.clients.length}>
            Export all (JSON)
          </button>
          <button type="button" className="small" onClick={() => importRef.current?.click()}>
            Import backup
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="visually-hidden"
            tabIndex={-1}
            aria-label="Import client backup"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) props.onImport(f);
              e.target.value = '';
            }}
          />
        </div>
        <label htmlFor="client-search" className="small" style={{ fontWeight: 600 }}>
          Search
        </label>
        <input id="client-search" ref={searchRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, TRN or period" style={{ width: '100%' }} />
        <ul className="client-list">
          {list.length === 0 && <li className="muted">{props.clients.length ? 'No match.' : 'No clients saved yet.'}</li>}
          {list.map((c) => (
            <li key={c.id} className="client-item" aria-current={c.id === props.currentId ? 'true' : undefined}>
              <div>
                <strong>{c.name}</strong>
                {c.id === props.currentId && <span className="chip accent" style={{ marginLeft: 6 }}>Open now</span>}
                <div className="muted small">
                  {c.trn ? `TRN ${c.trn} · ` : ''}Period ending {fmtDate(c.periodEnd)} · Saved {c.updatedAt.slice(0, 10)}
                </div>
                {c.qfzpFailedPeriodEnd && <div className="small">QFZP status lost in the period ending {fmtDate(c.qfzpFailedPeriodEnd)}: the standard rate carries into next year.</div>}
              </div>
              <div className="row">
                <button type="button" className="small primary" onClick={() => props.onOpen(c)}>
                  Open
                </button>
                <button type="button" className="small" onClick={() => props.onDuplicate(c)}>
                  Duplicate to next year
                </button>
                <button type="button" className="small danger" onClick={() => setConfirmId(c.id)}>
                  Delete
                </button>
              </div>
              {confirmId === c.id && (
                <div className="confirm" role="alertdialog" aria-label={`Confirm delete ${c.name}`}>
                  <span>Delete {c.name} for good?</span>
                  <button
                    type="button"
                    className="small danger"
                    onClick={() => {
                      props.onDelete(c.id);
                      setConfirmId(null);
                    }}
                  >
                    Yes, delete
                  </button>
                  <button type="button" className="small" onClick={() => setConfirmId(null)} autoFocus>
                    Keep
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
